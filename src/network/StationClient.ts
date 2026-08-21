/**
 * The authenticated request channel to a paired station (T1.3.4, ADR-0008).
 *
 * After pairing, the mobile reaches its station over a **sealed, signed
 * envelope** on plain HTTP. This client builds that envelope, POSTs it to
 * `/rpc`, and opens the sealed reply — the one place the wire format lives on
 * the mobile side. The transport is a dumb carrier; all security is in the
 * envelope, so the same request is valid over any network (see
 * {@link resolveEndpoint} for the carrier-agnostic address seam).
 *
 * ## The envelope (must match the station byte-for-byte)
 *
 * A request is built inner-to-outer:
 *  1. a **request envelope** — `{v, method, params, signer, recipient, nonce,
 *     timestamp}` — is encoded to canonical dCBOR (the same encoder the station
 *     decodes with), where `params` is a JSON string and `signer`/`recipient`
 *     are the raw 32-byte keys;
 *  2. the wallet signs those payload bytes;
 *  3. `len(u32 BE) ‖ payload ‖ signature(64)` is framed and **sealed** to the
 *     station's public key.
 *
 * `recipient` is bound *inside* the signed bytes so the envelope cannot be
 * peeled out and re-sealed to another station. The reply comes back sealed to
 * this wallet; the client opens it, verifies it is signed by the station, and
 * returns the result. The reply payload is **JSON**, not dCBOR — the station
 * signs bytes the mobile only needs to verify-then-parse, so no dCBOR *decoder*
 * is needed here (the mobile carries only the encoder).
 */
import {bytes, canonicalBytes, int, map, text, type CborValue} from '../crypto/cbor';
import {getRrnCryptoFfi, type PublicKey} from '../crypto/ffi';
import type {Wallet} from '../wallet/Wallet';
import {parseAddress} from '../crypto/address';
import {bytesToHex} from '../crypto/hex';
import {seal} from '../crypto/seal';
import {bytesToUtf8} from '../crypto/utf8';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {isResolveError, resolveEndpoint} from './resolveEndpoint';
import {nextNonce} from './stationNonce';
import {noteReachable} from './connectivityStore';
import {updatePairedStationHost} from './pairedStation';

/** The envelope version, mirrored from the station's `ENVELOPE_VERSION`. */
const ENVELOPE_VERSION = 1;
/** The station's authenticated-channel route. */
const RPC_PATH = '/rpc';
/** The station's long-poll subscribe route (T1.3.5). */
const SUBSCRIBE_PATH = '/subscribe';
/** Length of an Ed25519 signature, in bytes. */
const SIG_LEN = 64;
/** Length of the big-endian u32 payload-length prefix. */
const LEN_PREFIX = 4;

/**
 * How long to wait for the station before giving up. A single small round-trip
 * on the local network; a station silent this long is unreachable, not slow.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long to wait on a `/subscribe` long-poll before giving up. The station
 * holds it open up to ~30s (its `subscribe_hold`), so this must exceed that —
 * the client only aborts when the station is truly gone, not on a normal empty
 * heartbeat.
 */
const SUBSCRIBE_TIMEOUT_MS = 35_000;

/** Why a channel request did not return a result. */
export type StationErrorKind =
  /** The station could not be reached (offline, wrong host, timeout, no endpoint). */
  | 'unreachable'
  /** The station rejected authentication (not paired, replayed, stale, bad seal). */
  | 'unauthenticated'
  /** The station rejected the request as malformed or wrongly addressed. */
  | 'rejected'
  /** The reply did not have the shape of a station response. */
  | 'malformed'
  /** The reply was not verifiably signed by the paired station. */
  | 'unverified'
  /** Authenticated and reached the method, but the method returned an error. */
  | 'method-error';

/** A typed channel failure. Never leaks the sealed bytes. */
export class StationClientError extends Error {
  constructor(
    readonly kind: StationErrorKind,
    message: string,
    /** The station method's error code, when {@link kind} is `method-error`. */
    readonly code?: number,
  ) {
    super(message);
    this.name = 'StationClientError';
  }
}

/** Options for a {@link StationClient}, all injectable for tests. */
export interface StationClientOptions {
  /** The `fetch` to use. Defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Returns Unix seconds to stamp a request. Defaults to the wall clock. */
  now?: () => number;
  /** Secure store for nonce/host persistence. Defaults to the process store. */
  store?: SecureStore;
}

/**
 * A client bound to one paired station, signing with one wallet. Construct per
 * use (it holds no long-lived connection); the wallet must be unlocked.
 */
export class StationClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly store: SecureStore;
  private readonly stationKey: PublicKey;

  /**
   * @param wallet the unlocked signing wallet (this device's identity)
   * @param stationAddress the paired station's bech32m `rrn1…` address — the
   *   durable identity the request is sealed and bound to (not a host)
   */
  constructor(
    private readonly wallet: Wallet,
    private readonly stationAddress: string,
    options: StationClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.store = options.store ?? getSecureStore();
    const key = parseAddress(stationAddress);
    if ('error' in key) {
      throw new Error(`invalid station address: ${key.error.message}`);
    }
    this.stationKey = key;
  }

  /**
   * `whoami` — the station's own address (a cheap reachability probe), plus the
   * `community` a member stamps into a vouch (T1.4.3; `undefined` from a station
   * that predates the field) and the Tier-2 **bootstrap-grace** status (T1.8.6):
   * while `bootstrap_in_grace` is true the community has fewer than
   * `grace_threshold` established members, so any member may confirm a Tier-2
   * payment — the wallet shows a banner. All three grace fields are `undefined`
   * from a station that predates them.
   */
  async whoami(): Promise<{
    address: string;
    community?: string;
    bootstrap_in_grace?: boolean;
    established_members?: number;
    grace_threshold?: number;
  }> {
    return this.call('whoami', {}) as Promise<{
      address: string;
      community?: string;
      bootstrap_in_grace?: boolean;
      established_members?: number;
      grace_threshold?: number;
    }>;
  }

  /** `balance` — the signed-integer centi balance of `address` (defaults to us). */
  async balance(address?: string): Promise<{balance_centi: number}> {
    const params = address === undefined ? {} : {address};
    return this.call('balance', params) as Promise<{balance_centi: number}>;
  }

  /**
   * `next_nonce` — the authoritative nonce this member's next proposal must
   * carry. Queried before composing a send, because the nonce is signed into the
   * proposal and the ledger requires it to be exactly the next in sequence.
   */
  async nextNonce(address: string): Promise<{nonce: number}> {
    return this.call('next_nonce', {address}) as Promise<{nonce: number}>;
  }

  /**
   * `transactions` — the member-relative, structured transaction view the wallet
   * renders. `address` is the member to query (this device's own address).
   */
  async transactions(
    address: string,
    limit?: number,
  ): Promise<{transactions: StationTransactionRow[]}> {
    const params: Record<string, unknown> = {address};
    if (limit !== undefined) {
      params.limit = limit;
    }
    return this.call('transactions', params) as Promise<{
      transactions: StationTransactionRow[];
    }>;
  }

  /**
   * `subscribe` — the long-poll for push updates (T1.3.5). Sends the device's
   * cursor (`lastSeen`, a log seq); the station returns the events after it that
   * concern this member, holding the connection open up to ~30s if there are
   * none (an empty heartbeat that still advances the cursor). Pass a `signal` to
   * abort the in-flight poll promptly (e.g. when the app backgrounds).
   */
  async subscribe(
    lastSeen: number,
    opts: {signal?: AbortSignal} = {},
  ): Promise<{lastSeenEventId: number; events: StationEvent[]}> {
    const result = await this.call(
      'subscribe',
      {last_seen_event_id: lastSeen},
      {path: SUBSCRIBE_PATH, timeoutMs: SUBSCRIBE_TIMEOUT_MS, signal: opts.signal},
    );
    const lastSeenEventId =
      typeof result.last_seen_event_id === 'number' ? result.last_seen_event_id : lastSeen;
    const events = Array.isArray(result.events) ? (result.events as StationEvent[]) : [];
    return {lastSeenEventId, events};
  }

  /**
   * Submits a mobile-signed record (a proposal or confirmation) over the write
   * path. `field` is the station's params field (`signed_proposal` /
   * `signed_confirmation`); `canonicalPayload` is the record's canonical dCBOR
   * bytes and `signature` the wallet's signature over them. The client frames
   * them as `len ‖ payload ‖ signer ‖ signature` (the station's
   * `frame_signed_record`) and sends them hex-encoded.
   */
  async submitSignedRecord(
    method:
      | 'submit_proposal'
      | 'submit_confirmation'
      | 'submit_vouch'
      | 'submit_listing'
      | 'submit_listing_update'
      | 'submit_listing_close'
      | 'submit_inquiry'
      | 'submit_inquiry_message'
      | 'submit_inquiry_close'
      | 'submit_contract'
      | 'submit_contract_termination'
      | 'governance_submit_cosign'
      | 'governance_submit_vote'
      | 'submit_dispute'
      | 'submit_dispute_response'
      | 'submit_verdict'
      | 'submit_escalation'
      | 'submit_escalation_ballot',
    field:
      | 'signed_proposal'
      | 'signed_confirmation'
      | 'signed_vouch'
      | 'signed_listing'
      | 'signed_listing_update'
      | 'signed_listing_close'
      | 'signed_inquiry'
      | 'signed_message'
      | 'signed_close'
      | 'signed_contract'
      | 'signed_termination'
      | 'signed_cosign'
      | 'signed_vote'
      | 'signed_dispute'
      | 'signed_response'
      | 'signed_verdict'
      | 'signed_escalation'
      | 'signed_ballot',
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<Record<string, unknown>> {
    const frame = frameSignedRecord(
      canonicalPayload,
      this.wallet.publicKey().toBytes(),
      signature,
    );
    return this.call(method, {[field]: bytesToHex(frame)});
  }

  /**
   * Submits a mobile-signed vouch (T1.4.3). `canonicalPayload`/`signature` come
   * from `createSignedVouch`; the station verifies the voucher is this paired
   * mobile, appends the vouch, and returns its content-address `vouch_id`.
   */
  async submitVouch(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{vouchId: string}> {
    const result = await this.submitSignedRecord(
      'submit_vouch',
      'signed_vouch',
      canonicalPayload,
      signature,
    );
    return {
      vouchId: typeof result.vouch_id === 'string' ? result.vouch_id : '',
    };
  }

  /**
   * `vouch_counts` — this member's own vouching tallies (T1.4.4): how many
   * vouches it has given (signed) and received (is the subject of). The member is
   * the authenticated signer server-side, so there is no address param — a mobile
   * only ever reads its own counts.
   */
  async vouchCounts(): Promise<StationVouchCounts> {
    const result = await this.call('vouch_counts', {});
    return {
      given: typeof result.given === 'number' ? result.given : 0,
      received: typeof result.received === 'number' ? result.received : 0,
    };
  }

  /**
   * `list_vouches` — this member's own vouches for the vouching browser
   * (T1.4.5), split into `given` (it signed) and `received` (it is the subject
   * of), newest first. Like {@link vouchCounts} the member is the authenticated
   * signer server-side, so there is no address param. `limit`/`offset` window
   * each list; the browser fetches the member's set and searches client-side.
   */
  async listVouches(
    opts: {limit?: number; offset?: number} = {},
  ): Promise<StationVouchLists> {
    const params: Record<string, unknown> = {};
    if (opts.limit !== undefined) {
      params.limit = opts.limit;
    }
    if (opts.offset !== undefined) {
      params.offset = opts.offset;
    }
    const result = await this.call('list_vouches', params);
    const rows = (v: unknown): StationVouchListRow[] =>
      Array.isArray(v) ? (v as StationVouchListRow[]) : [];
    return {given: rows(result.given), received: rows(result.received)};
  }

  /**
   * `reputation` — this member's own standing (T1.5.9): the five ADR-0009
   * dimensions, the composite and its band, and whether an anchoring vouch has
   * lifted the newcomer cap. Like {@link vouchCounts} the member is the
   * authenticated signer server-side, so there is no address param — the
   * dimension breakdown is only ever your own.
   */
  async reputation(): Promise<StationReputation> {
    return (await this.call('reputation', {})) as unknown as StationReputation;
  }

  /**
   * `reputation_band` — the band for *another* address, which is all a listing
   * card shows about its lister (M1.7). Never the dimension breakdown. An
   * address with no history answers `New` rather than failing.
   */
  async reputationBand(address: string): Promise<StationReputationBand> {
    const result = await this.call('reputation_band', {address});
    return result as unknown as StationReputationBand;
  }

  /**
   * `marketplace_search` — the browse read (T1.7.1). Runs the station's ranked
   * search over the tantivy index and returns a page of cards, each carrying its
   * provider's band inline so a browse row draws without a round trip per lister.
   * Only ever *active* listings: the index holds nothing else. `params` omits its
   * absent filters (the station defaults them); the station clamps `limit` to its
   * own maximum, so an over-large page is answered, not refused.
   */
  async marketplaceSearch(
    params: MarketplaceSearchParams,
  ): Promise<{listings: StationListingCard[]}> {
    const result = await this.call('marketplace_search', params);
    const listings = Array.isArray(result.listings)
      ? (result.listings as StationListingCard[])
      : [];
    return {listings};
  }

  /**
   * `submit_listing` — publish a mobile-signed listing (T1.7.2). The wallet is
   * the provider and signed the listing on-device; the station verifies and
   * appends it. Returns the content-address `listingId` and the oracle tier it
   * was recorded with.
   */
  async submitListing(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{listingId: string; oracleTier: number}> {
    const result = await this.submitSignedRecord(
      'submit_listing',
      'signed_listing',
      canonicalPayload,
      signature,
    );
    return {
      listingId: typeof result.listing_id === 'string' ? result.listing_id : '',
      oracleTier: typeof result.oracle_tier === 'number' ? result.oracle_tier : 0,
    };
  }

  /**
   * `submit_listing_update` — apply a mobile-signed patch to one of the member's
   * own listings (T1.7.2 Phase B). The wallet is the provider and signed the
   * `ListingUpdated` on-device; the station verifies, applies, and re-validates
   * it. The listing's content id is fixed and returned unchanged.
   */
  async submitListingUpdate(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{listingId: string}> {
    const result = await this.submitSignedRecord(
      'submit_listing_update',
      'signed_listing_update',
      canonicalPayload,
      signature,
    );
    return {
      listingId: typeof result.listing_id === 'string' ? result.listing_id : '',
    };
  }

  /**
   * `submit_listing_close` — take one of the member's own listings off offer
   * (T1.7.2), by a mobile-signed `ProviderClosed`. The station verifies the
   * signer owns the listing and appends the close.
   */
  async submitListingClose(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{listingId: string}> {
    const result = await this.submitSignedRecord(
      'submit_listing_close',
      'signed_listing_close',
      canonicalPayload,
      signature,
    );
    return {
      listingId: typeof result.listing_id === 'string' ? result.listing_id : '',
    };
  }

  /**
   * `marketplace_my_listings` — the authenticated member's own listings (T1.7.2),
   * in whatever state, newest first. The member is the signer, so there is no
   * address param — a mobile only ever reads its own.
   */
  async myListings(): Promise<{listings: StationMyListingRow[]}> {
    const result = await this.call('marketplace_my_listings', {});
    const listings = Array.isArray(result.listings)
      ? (result.listings as StationMyListingRow[])
      : [];
    return {listings};
  }

  /**
   * `marketplace_listing` — one listing in full (T1.7.1), for the detail screen.
   * Reads state from the log rather than the index, so it can return a listing
   * that is `closed` or `expired` — a card the member tapped may have gone off
   * offer since the browse read, and the detail screen has to say so rather than
   * present it as buyable. Throws `method-error` when the station has never seen
   * the id.
   */
  async marketplaceListing(listingId: string): Promise<StationListingDetail> {
    const result = await this.call('marketplace_listing', {listing_id: listingId});
    return result as unknown as StationListingDetail;
  }

  /**
   * `submit_inquiry` — open a mobile-signed inquiry against a listing (T1.7.4).
   * The wallet is the buyer and signed the opening on-device; the station
   * verifies it, checks the listing's requirements against the buyer, and appends
   * it. A buyer who does not qualify comes back as a `method-error` naming the
   * unmet requirement. Returns the content-address `inquiryId`.
   */
  async submitInquiry(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{inquiryId: string}> {
    const result = await this.submitSignedRecord(
      'submit_inquiry',
      'signed_inquiry',
      canonicalPayload,
      signature,
    );
    return {inquiryId: typeof result.inquiry_id === 'string' ? result.inquiry_id : ''};
  }

  /**
   * `submit_inquiry_message` — send a mobile-signed message (optionally a
   * counter-offer) in an open inquiry the member is a party to (T1.7.4).
   */
  async submitInquiryMessage(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{inquiryId: string}> {
    const result = await this.submitSignedRecord(
      'submit_inquiry_message',
      'signed_message',
      canonicalPayload,
      signature,
    );
    return {inquiryId: typeof result.inquiry_id === 'string' ? result.inquiry_id : ''};
  }

  /**
   * `submit_inquiry_close` — close an inquiry the member is a party to (T1.7.4):
   * agreeing a price, or declining their side. A non-negotiable listing accepts
   * only its listed price; the station refuses anything else.
   */
  async submitInquiryClose(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{inquiryId: string}> {
    const result = await this.submitSignedRecord(
      'submit_inquiry_close',
      'signed_close',
      canonicalPayload,
      signature,
    );
    return {inquiryId: typeof result.inquiry_id === 'string' ? result.inquiry_id : ''};
  }

  /**
   * `inquiry_thread` — one inquiry's full thread (T1.7.4), for the chat screen.
   * Only a party to the inquiry may read it; the station answers a non-party (or
   * an unknown id) with a `method-error`, so the screen cannot confirm an inquiry
   * the member is not part of.
   */
  async inquiryThread(inquiryId: string): Promise<StationInquiryThread> {
    const result = await this.call('inquiry_thread', {inquiry_id: inquiryId});
    return result as unknown as StationInquiryThread;
  }

  /**
   * `my_inquiries` — the member's own inquiries (T1.7.4), as buyer or provider,
   * newest activity first. The member is the authenticated signer, so there is no
   * address param — a mobile only ever lists its own.
   */
  async myInquiries(): Promise<{inquiries: StationMyInquiryRow[]}> {
    const result = await this.call('my_inquiries', {});
    const inquiries = Array.isArray(result.inquiries)
      ? (result.inquiries as StationMyInquiryRow[])
      : [];
    return {inquiries};
  }

  /**
   * `submit_contract` — sign up to a recurring service (T1.7.7 Stage 2). The
   * wallet is the buyer and signed the mandate on-device, snapshotting the terms
   * from the agreed inquiry; the station re-checks all of it against the log and
   * appends it. Returns the content-address `contractId` and its fresh `state`
   * (`active`).
   */
  async submitContract(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{contractId: string; state: string}> {
    const result = await this.submitSignedRecord(
      'submit_contract',
      'signed_contract',
      canonicalPayload,
      signature,
    );
    return {
      contractId: typeof result.contract_id === 'string' ? result.contract_id : '',
      state: typeof result.state === 'string' ? result.state : '',
    };
  }

  /**
   * `submit_contract_termination` — end a contract the member is a party to
   * (T1.7.7 Stage 2). Either party may; the notice window and any penalty are the
   * charge sweep's to apply. Returns the `contractId` so the caller can refetch.
   */
  async submitContractTermination(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{contractId: string}> {
    const result = await this.submitSignedRecord(
      'submit_contract_termination',
      'signed_termination',
      canonicalPayload,
      signature,
    );
    return {contractId: typeof result.contract_id === 'string' ? result.contract_id : ''};
  }

  /**
   * `marketplace_contracts` — the member's own contracts (T1.7.7 Stage 2), as
   * buyer or provider, newest first. The member is the authenticated signer, so
   * there is no address param — a mobile only ever lists its own.
   */
  async marketplaceContracts(): Promise<{contracts: StationContractRow[]}> {
    const result = await this.call('marketplace_contracts', {});
    const contracts = Array.isArray(result.contracts)
      ? (result.contracts as StationContractRow[])
      : [];
    return {contracts};
  }

  /**
   * `marketplace_contract_show` — one contract's full status (T1.7.7 Stage 2).
   * Only a party may read it; the station answers a non-party (or an unknown id)
   * with a `method-error`.
   */
  async marketplaceContractShow(contractId: string): Promise<StationContractDetail> {
    const result = await this.call('marketplace_contract_show', {
      contract_id: contractId,
    });
    return result as unknown as StationContractDetail;
  }

  /**
   * `governance_charter` — the community's Charter (T1.9.8), as the constitutional
   * layer the governance hub renders. A community that has not published its
   * genesis Charter yet comes back as a placeholder with `published: false` and
   * all-zero defaults; the hub renders a "still bootstrapping" empty state for it
   * rather than a real charter.
   */
  async governanceCharter(): Promise<StationCharter> {
    const result = await this.call('governance_charter', {});
    return result as unknown as StationCharter;
  }

  /**
   * `governance_proposals` — every proposal the station knows (T1.9.8), each with
   * its phase, co-signer count, and live tally, for the hub list. Derived on the
   * station from the log on each read; there is no address param.
   */
  async governanceProposals(): Promise<{proposals: StationProposalSummary[]}> {
    const result = await this.call('governance_proposals', {});
    const proposals = Array.isArray(result.proposals)
      ? (result.proposals as StationProposalSummary[])
      : [];
    return {proposals};
  }

  /**
   * `governance_proposal` — one proposal in full (T1.9.8), for the detail screen:
   * the summary fields plus the markdown `body` and the list of co-signers.
   * Throws a `method-error` when the station has never seen the id.
   */
  async governanceProposal(proposalId: string): Promise<StationProposalDetail> {
    const result = await this.call('governance_proposal', {proposal_id: proposalId});
    return result as unknown as StationProposalDetail;
  }

  /**
   * `governance_statutes` — the statutes in force (T1.9.8): proposals that passed
   * and have been enacted, newest first, for the "in force" section of the hub.
   */
  async governanceStatutes(): Promise<{statutes: StationStatuteSummary[]}> {
    const result = await this.call('governance_statutes', {});
    const statutes = Array.isArray(result.statutes)
      ? (result.statutes as StationStatuteSummary[])
      : [];
    return {statutes};
  }

  /**
   * `governance_submit_cosign` — endorse a proposal toward its publication
   * threshold (T1.9.8). `canonicalPayload`/`signature` come from
   * `createSignedCosign`; the station verifies the co-signer is this paired
   * mobile and an established member, appends it, and returns the distinct
   * co-signer count now gathered.
   */
  async submitCosign(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<{cosignerCount: number}> {
    const result = await this.submitSignedRecord(
      'governance_submit_cosign',
      'signed_cosign',
      canonicalPayload,
      signature,
    );
    return {
      cosignerCount:
        typeof result.cosigner_count === 'number' ? result.cosigner_count : 0,
    };
  }

  /**
   * `governance_submit_vote` — cast a ballot on a published proposal (T1.9.8).
   * `canonicalPayload`/`signature` come from `createSignedVote`; the station
   * verifies the voter is this paired mobile and an established member, that the
   * window is open, and that they have not already voted, then appends it.
   */
  async submitVote(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<void> {
    await this.submitSignedRecord(
      'governance_submit_vote',
      'signed_vote',
      canonicalPayload,
      signature,
    );
  }

  /**
   * `disputes` — every disputed transaction the station knows (T1.10.6), each as
   * a browse row with its live jury tally and the outcome a resolve pass would
   * enact right now. Derived on the station from the log on each read; there is
   * no address param. A resolved transaction has left the `Disputed` state, so
   * it no longer appears here.
   */
  async disputes(): Promise<{disputes: DisputeSummary[]}> {
    const result = await this.call('disputes', {});
    const disputes = Array.isArray(result.disputes)
      ? (result.disputes as DisputeSummary[])
      : [];
    return {disputes};
  }

  /**
   * `dispute` — one disputed transaction in full (T1.10.6), for the detail
   * screen: the summary fields plus every party response, the seated jury with
   * each juror's verdict, and any open escalation. Throws a `method-error` when
   * there is no live dispute for the id.
   */
  async dispute(txId: string): Promise<DisputeDetail> {
    const result = await this.call('dispute', {tx_id: txId});
    return result as unknown as DisputeDetail;
  }

  /**
   * `submit_dispute` — open a dispute against a confirmed transaction (T1.10.6).
   * `canonicalPayload`/`signature` come from `createSignedDispute`; the station
   * verifies the raiser is this paired mobile and a party to the transaction,
   * freezes settlement across the `Confirmed → Disputed` edge, and appends it.
   */
  async submitDispute(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<void> {
    await this.submitSignedRecord(
      'submit_dispute',
      'signed_dispute',
      canonicalPayload,
      signature,
    );
  }

  /**
   * `submit_dispute_response` — file the counterparty's rebuttal on an open
   * dispute (T1.10.6). `canonicalPayload`/`signature` come from
   * `createSignedDisputeResponse`; the station verifies the responder is this
   * paired mobile and a party, and that they have not already responded.
   */
  async submitDisputeResponse(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<void> {
    await this.submitSignedRecord(
      'submit_dispute_response',
      'signed_response',
      canonicalPayload,
      signature,
    );
  }

  /**
   * `submit_verdict` — cast a seated juror's ruling on an open dispute (T1.10.6).
   * `canonicalPayload`/`signature` come from `createSignedVerdict`; the station
   * verifies the juror is this paired mobile and holds a live seat on the derived
   * panel, and that they have not already voted.
   */
  async submitVerdict(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<void> {
    await this.submitSignedRecord(
      'submit_verdict',
      'signed_verdict',
      canonicalPayload,
      signature,
    );
  }

  /**
   * `submit_escalation` — put a dispute to the electorate (ADR-0014 §5, T1.10.6).
   * `canonicalPayload`/`signature` come from `createSignedEscalation`; the station
   * verifies the initiator is this paired mobile and a party, and that the reason
   * fits the dispute's state (an appeal only against a live ruling in its appeal
   * window; a cannot-seat only when the pool genuinely can't seat a panel).
   */
  async submitEscalation(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<void> {
    await this.submitSignedRecord(
      'submit_escalation',
      'signed_escalation',
      canonicalPayload,
      signature,
    );
  }

  /**
   * `submit_escalation_ballot` — cast a ballot in an open escalation (ADR-0014 §5,
   * T1.10.6). `canonicalPayload`/`signature` come from
   * `createSignedEscalationBallot`; the station verifies the voter is this paired
   * mobile and an eligible established non-party member, that the sub-window is
   * open, and that they have not already voted.
   */
  async submitEscalationBallot(
    canonicalPayload: Uint8Array,
    signature: Uint8Array,
  ): Promise<void> {
    await this.submitSignedRecord(
      'submit_escalation_ballot',
      'signed_ballot',
      canonicalPayload,
      signature,
    );
  }

  /**
   * The full request→reply round-trip: reserve a nonce, build+sign+seal the
   * envelope, POST it, open and verify the reply, return the parsed result.
   * Throws a {@link StationClientError} for every failure mode.
   */
  private async call(
    method: string,
    params: unknown,
    opts: {path?: string; timeoutMs?: number; signal?: AbortSignal} = {},
  ): Promise<Record<string, unknown>> {
    const endpoint = await resolveEndpoint(this.stationAddress, this.store);
    if (isResolveError(endpoint)) {
      throw new StationClientError(
        'unreachable',
        endpoint.error === 'not-paired'
          ? 'not paired with this station'
          : 'no known address for this station',
      );
    }

    // Reserve the nonce before sending; a burned nonce that then fails only
    // skips a value (allowed), never risks reuse (rejected).
    const nonce = await nextNonce(this.stationAddress, this.store);
    const timestamp = this.now();

    const payload = this.buildPayload(method, JSON.stringify(params), nonce, timestamp);
    const signature = (await this.wallet.sign(payload)).toBytes();
    const frame = frameWithSig(payload, signature);
    const sealed = await seal(this.stationKey, frame);

    const replyBytes = await this.post(
      endpoint.baseUrl,
      sealed,
      opts.path ?? RPC_PATH,
      opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      opts.signal,
    );
    const reply = await this.openReply(replyBytes, nonce);

    // A verified reply — even a method-error below — means we reached the
    // station. Mark the connection reachable so the "connecting" indicator
    // resolves on the first fast read, not only when the ~30s subscribe long-poll
    // returns. Subscribe owns the *offline* transition itself (its loop debounces
    // failures — see connectivityStore), so a poll pass reports through that path
    // rather than here.
    if ((opts.path ?? RPC_PATH) !== SUBSCRIBE_PATH) {
      noteReachable();
    }

    // A successful round-trip confirms the host hint is good; keep it fresh (a
    // no-op if unchanged). Best-effort — a persistence hiccup must not fail the
    // request that already succeeded.
    updatePairedStationHost(
      this.stationAddress,
      endpoint.host,
      endpoint.port,
      this.store,
    ).catch(() => {});

    if (reply.error != null) {
      throw new StationClientError('method-error', reply.error.message, reply.error.code);
    }
    if (reply.result === undefined || reply.result === null) {
      throw new StationClientError('malformed', 'reply had neither result nor error');
    }
    try {
      return JSON.parse(reply.result) as Record<string, unknown>;
    } catch {
      throw new StationClientError('malformed', 'reply result was not valid JSON');
    }
  }

  /** Canonical dCBOR of the request envelope — matches the station byte-for-byte. */
  private buildPayload(
    method: string,
    paramsJson: string,
    nonce: number,
    timestamp: number,
  ): Uint8Array {
    // Field order is irrelevant (the encoder sorts keys); the set, types, and
    // key-as-byte-string encoding must match the station's `RequestEnvelope`.
    const envelope: CborValue = map([
      ['v', int(ENVELOPE_VERSION)],
      ['method', text(method)],
      ['params', text(paramsJson)],
      ['signer', bytes(this.wallet.publicKey().toBytes())],
      ['recipient', bytes(this.stationKey.toBytes())],
      ['nonce', int(nonce)],
      ['timestamp', int(timestamp)],
    ]);
    return canonicalBytes(envelope);
  }

  /** POSTs the sealed request to `path`; returns the sealed reply bytes or throws. */
  private async post(
    baseUrl: string,
    sealed: Uint8Array,
    path: string,
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // An external abort (e.g. the app backgrounding) cancels the in-flight poll
    // immediately rather than waiting out the timeout.
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, {once: true});
    if (externalSignal?.aborted) {
      controller.abort();
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/octet-stream'},
        body: sealed as unknown as BodyInit_,
        signal: controller.signal,
      });
    } catch (e) {
      // A refused connection, DNS miss, or our own timeout all mean unreachable.
      throw new StationClientError(
        'unreachable',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }

    if (!res.ok) {
      const reason = (await safeText(res)).trim();
      if (res.status === 401) {
        throw new StationClientError('unauthenticated', reason || 'not authenticated');
      }
      if (res.status === 503) {
        throw new StationClientError('unreachable', reason || 'station unavailable');
      }
      throw new StationClientError('rejected', reason || `HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Opens, verifies, and parses the sealed reply frame. */
  private async openReply(sealedReply: Uint8Array, sentNonce: number): Promise<ResponseEnvelope> {
    let frame: Uint8Array;
    try {
      frame = await this.wallet.open(sealedReply);
    } catch {
      // Not openable with our key — not a reply for us, or corrupt.
      throw new StationClientError('unverified', 'could not open the station reply');
    }
    if (frame.length < LEN_PREFIX + SIG_LEN) {
      throw new StationClientError('malformed', 'reply frame too short');
    }
    const payloadLen = readU32BE(frame, 0);
    const payloadEnd = LEN_PREFIX + payloadLen;
    if (frame.length !== payloadEnd + SIG_LEN) {
      throw new StationClientError('malformed', 'reply frame length mismatch');
    }
    const payload = frame.subarray(LEN_PREFIX, payloadEnd);
    const sigBytes = frame.subarray(payloadEnd);

    // The reply must be signed by the station we sealed to.
    let verified = false;
    try {
      const signature = getRrnCryptoFfi().Signature.fromBytes(sigBytes);
      verified = this.stationKey.verify(payload, signature);
    } catch {
      verified = false;
    }
    if (!verified) {
      throw new StationClientError('unverified', 'reply signature did not verify');
    }

    let parsed: ResponseEnvelope;
    try {
      parsed = JSON.parse(bytesToUtf8(payload)) as ResponseEnvelope;
    } catch {
      throw new StationClientError('malformed', 'reply was not valid JSON');
    }
    if (parsed.v !== ENVELOPE_VERSION) {
      throw new StationClientError('malformed', `unexpected reply version ${parsed.v}`);
    }
    if (parsed.nonce !== sentNonce) {
      // A reply for a different request — never accept it as this one's answer.
      throw new StationClientError('malformed', 'reply nonce did not match the request');
    }
    return parsed;
  }
}

/** One transaction row from the station's member-relative view (T1.3.4). */
export interface StationTransactionRow {
  id: string;
  counterparty_address: string;
  direction: 'in' | 'out';
  amount_centi: number;
  memo?: string;
  /** The marketplace listing this paid for, hex (T1.7.6) — present on a
   * marketplace payment, absent on a direct pay. */
  listing_id?: string;
  /** That listing's title, resolved by the station so history reads as what it
   * bought. Present when the station knows the listing. */
  listing_title?: string;
  state: 'pending' | 'confirmed' | 'settled' | 'cancelled';
  /** The oracle tier governing this transaction (T1.8.1): `1` (settlement window
   * only) or `2` (reputation-staked confirmation). Optional so a station that
   * predates the field is tolerated — the UI treats an absent tier as Tier 1. */
  oracle_tier?: number;
  timestamp: number;
  expires_at?: number;
  confirmed_at?: number;
  /** Unix seconds the settlement window closes — `confirmed_at` plus this tier's
   * window (T1.8.4/T1.8.6). Present once confirmed; the wallet counts down to it
   * rather than hardcoding the window. Absent from a station predating the field
   * (the wallet falls back to a tier-derived window). */
  settle_by?: number;
  settled_at?: number;
  nonce: number;
}

/**
 * A push-event kind (T1.3.5). The full set is the station's wire contract; only
 * the first four have a live source in M1.3 — the rest arrive with later
 * milestones and are here so the router does not choke on one it does not know.
 */
export type StationEventKind =
  | 'proposal_received'
  | 'confirmation_received'
  | 'settlement'
  | 'cancellation'
  | 'vouch_received'
  | 'listing_match'
  | 'governance_proposal'
  | 'vote_needed';

/** The display payload of a `vouch_received` event (T1.4.1). */
export interface StationVouchRow {
  /** Content address: hex of the Blake3 hash of the signed canonical bytes. */
  vouch_id: string;
  /** The voucher's bech32m `rrn1…` address. */
  voucher_address: string;
  /** The community the vouch was stamped into. */
  community: string;
  /** The voucher's free-text statement about the subject. */
  statement: string;
  /** Reputation staked, in centipoints. */
  stake_centi: number;
  /** Unix seconds when the vouch was issued. */
  issued_at: number;
}

/** A member's vouching tallies (T1.4.4), for the "your vouching chain" display. */
export interface StationVouchCounts {
  /** Vouches this member signed (vouched for someone else). */
  given: number;
  /** Vouches naming this member as the subject (someone vouched for them). */
  received: number;
}

/**
 * One vouch row from the station's vouching browser view (T1.4.5). Unlike the
 * push-only {@link StationVouchRow}, a browser row names *both* parties so the
 * "made" and "received" lists render from one shape.
 */
export interface StationVouchListRow {
  /** Content address: hex of the Blake3 hash of the signed canonical bytes. */
  vouch_id: string;
  /** The voucher's bech32m `rrn1…` address (the log entry's signer). */
  voucher_address: string;
  /** The vouched-for member's bech32m `rrn1…` address (attestation subject). */
  subject_address: string;
  /** The community the vouch was stamped into. */
  community: string;
  /** The voucher's free-text statement about the subject. */
  statement: string;
  /** Reputation staked, in centipoints. */
  stake_centi: number;
  /** Unix seconds when the vouch was issued. */
  issued_at: number;
}

/** A member's vouches split by direction (T1.4.5), for the vouching browser. */
export interface StationVouchLists {
  /** Vouches this member signed (they are the voucher). */
  given: StationVouchListRow[];
  /** Vouches naming this member as the subject. */
  received: StationVouchListRow[];
}

/** The presentation band a composite falls in (ADR-0009). */
export type StationReputationBandName = 'New' | 'Member' | 'Trusted' | 'Senior';

/**
 * One reputation dimension as the station reports it (T1.5.9).
 *
 * `live` is the field that matters for honest presentation: a dimension with no
 * data source yet reads `0.0` because nothing feeds it, not because the member
 * scored badly, and the UI has to draw that distinction.
 */
export interface StationReputationDimension {
  /** Stable machine name (`trade_reliability`, …); the app owns the wording. */
  name: string;
  /** The scored value, 0.0–5.0. */
  value: number;
  /** This dimension's fixed ADR-0009 weight in the composite. */
  weight: number;
  /** Whether anything feeds this dimension yet. */
  live: boolean;
}

/** One category of domain competence; empty until the marketplace (M1.7). */
export interface StationDomainScore {
  /** The category label, e.g. `carpentry`. */
  tag: string;
  /** The score in that category, 0.0–5.0. */
  value: number;
}

/** This member's own standing (T1.5.9), as the Standing screen renders it. */
export interface StationReputation {
  /** The scored identity's bech32m `rrn1…` address. */
  address: string;
  /** The ADR-0009 weighted composite, 0.0–5.0. */
  composite: number;
  /** The band the composite falls in. */
  band: StationReputationBandName;
  /** All five dimensions, dormant ones included. */
  dimensions: StationReputationDimension[];
  /** Per-category domain competence; empty in Phase 1. */
  domain_competence: StationDomainScore[];
  /** The nominal top of the scale (5.0). */
  scale_max: number;
  /**
   * The highest composite reachable *today* — below `scale_max` while any
   * dimension is dormant. Sent by the station rather than hard-coded here so it
   * cannot go stale when a later milestone lights a dimension up.
   */
  max_composite_now: number;
  /** Whether an anchoring vouch has lifted the newcomer cap. */
  anchored: boolean;
  /** Who vouched, when anchored. */
  anchoring_voucher_address: string | null;
  /** The per-dimension ceiling an unanchored identity is held to (1.0). */
  anchor_dimension_cap: number;
  /** Unix seconds the profile was computed as of. */
  computed_at: number;
}

/** Another address's band (T1.5.9) — what a listing card shows (M1.7). */
export interface StationReputationBand {
  /** The scored identity's bech32m `rrn1…` address. */
  address: string;
  /** The ADR-0009 weighted composite, 0.0–5.0. */
  composite: number;
  /** The band the composite falls in. */
  band: StationReputationBandName;
  /** Unix seconds the underlying profile was computed as of. */
  computed_at: number;
}

/**
 * A community's Charter, as the station reports it (T1.9.8). A community that has
 * not published its genesis Charter yet comes back with `published: false` and
 * all-zero defaults — the governance hub renders a bootstrapping empty state for
 * that rather than a real charter.
 */
export interface StationCharter {
  /** Whether a genuine Charter has been published (vs. the bootstrap placeholder). */
  published: boolean;
  /** The Charter's version; 1 for the genesis Charter, +1 per enacted amendment. */
  version: number;
  /** Content address: hex of the Blake3 hash of the Charter body; null while unpublished. */
  charter_hash: string | null;
  /** The community identifier the Charter governs. */
  community_id: string;
  /** The founding principles, as free-text lines. */
  founding_principles: string[];
  /** The rights floor every member is guaranteed, as free-text lines. */
  rights_floor: string[];
  /** The founders' bech32m `rrn1…` addresses. */
  founders: string[];
  /** Statute proposals: participation quorum, as a percent of the electorate. */
  statute_quorum_pct: number;
  /** Statute proposals: yes-of-decisive approval, as a percent. */
  statute_approval_pct: number;
  /** Days a proposal deliberates and votes (one concurrent window). */
  deliberation_window_days: number;
  /** Days between a proposal passing and taking effect. */
  implementation_delay_days: number;
  /** Emergency proposals: the approval threshold, as a percent. */
  emergency_threshold_pct: number;
  /** Charter amendments: participation quorum, as a percent. */
  charter_quorum_pct: number;
  /** Charter amendments: yes-of-decisive approval, as a percent. */
  charter_approval_pct: number;
  /** Days a charter amendment deliberates and votes. */
  charter_deliberation_window_days: number;
  /** Distinct established co-signers a proposal needs to publish. */
  cosign_threshold: number;
}

/** What a proposal would do (T1.9.8) — the station's `kind` discriminant. */
export type StationProposalKind =
  | 'statute'
  | 'administrative_rule'
  | 'charter_amendment'
  | 'emergency';

/** Where a proposal sits in its lifecycle (T1.9.8). */
export type StationProposalPhase = 'deliberation' | 'voting' | 'concluded';

/** A concluded proposal's result, once its window has closed. */
export type StationProposalOutcome = 'passed' | 'failed';

/** A proposal's running vote count and thresholds (T1.9.8). */
export interface StationTally {
  /** Yes ballots. */
  yes: number;
  /** No ballots. */
  no: number;
  /** Abstain ballots — turnout toward quorum, but not toward approval. */
  abstain: number;
  /** The electorate size (established members) the thresholds are measured against. */
  eligible_voters: number;
  /** Whether participation has reached the quorum threshold. */
  quorum_met: boolean;
  /** Whether yes-of-decisive has reached the approval threshold. */
  approval_met: boolean;
  /** The decided outcome; absent while voting is still open. */
  outcome?: StationProposalOutcome;
}

/** One proposal as the hub list shows it (T1.9.8). */
export interface StationProposalSummary {
  /** Content address: hex of the Blake3 hash of the proposal's canonical bytes. */
  proposal_id: string;
  /** The author's bech32m `rrn1…` address. */
  author: string;
  /** The proposal's title. */
  title: string;
  /** What the proposal would do. */
  kind: StationProposalKind;
  /** The administrative scope — present only for `administrative_rule`. */
  scope?: string;
  /** Unix seconds the proposal was created. */
  created_at: number;
  /** Unix seconds the deliberation+voting window closes. */
  voting_ends_at: number;
  /** Unix seconds the proposal takes effect if it passes. */
  implementation_at: number;
  /** Where the proposal sits in its lifecycle. */
  phase: StationProposalPhase;
  /** Whether the co-sign threshold has been met (voting is genuinely open). */
  published: boolean;
  /** Distinct established co-signers gathered. */
  cosigner_count: number;
  /** The running vote count and thresholds. */
  tally: StationTally;
  /** Whether the proposal has been enacted (its effect recorded). */
  enacted: boolean;
}

/** One proposal in full (T1.9.8) — the summary plus body and co-signers. */
export interface StationProposalDetail extends StationProposalSummary {
  /** The proposal's markdown body. */
  body: string;
  /** The co-signers' bech32m `rrn1…` addresses. */
  cosigners: string[];
}

/** A statute in force (T1.9.8): a proposal that passed and was enacted. */
export interface StationStatuteSummary {
  /** The originating proposal's content address, hex. */
  proposal_id: string;
  /** The statute's title. */
  title: string;
  /** What kind of rule it enacted. */
  kind: StationProposalKind;
  /** Unix seconds the statute took effect. */
  implemented_at: number;
}

/**
 * The outcome a resolve pass would enact on a dispute right now (T1.10.6),
 * recomputed by the station on each read. `pending` = jury still out, window
 * open; `awaiting_appeal` = jury ruled, appeal window open; `upheld`/`rejected`
 * = a terminal jury majority; `lapsed` = window closed with no majority (the
 * confirmed transaction stands); the `escalation_*` variants appear once a party
 * has put the dispute to the electorate (ADR-0014 §5, surfaced fully in Slice B).
 */
export type StationDisputeResolution =
  | 'pending'
  | 'awaiting_appeal'
  | 'upheld'
  | 'rejected'
  | 'lapsed'
  | 'escalation_pending'
  | 'escalation_upheld'
  | 'escalation_rejected'
  | 'escalation_lapsed';

/** A seated juror's verdict as of the view's `now` (T1.10.6). */
export type StationJurorVerdict = 'uphold' | 'reject' | 'awaiting';

/** The seated jury's verdict counts (T1.10.6). */
export interface DisputeTallyView {
  /** Seated jurors who have voted to uphold. */
  uphold: number;
  /** Seated jurors who have voted to reject. */
  reject: number;
  /** Seated jurors yet to cast a valid verdict. */
  awaiting: number;
  /** The panel size a majority is measured against (3 in Phase 1). */
  panel_size: number;
}

/** One disputed transaction as a browse row (T1.10.6). */
export interface DisputeSummary {
  /** The disputed transaction's content address, hex. */
  tx_id: string;
  /** The transaction's sender `rrn1…` address. */
  sender: string;
  /** The transaction's receiver (also the confirmer under contest). */
  receiver: string;
  /** The party who raised the dispute. */
  raiser: string;
  /** The grievance, free text. */
  reason: string;
  /** The opening evidence hash, hex — present only when one was attached. */
  evidence_hash?: string;
  /** Unix seconds the dispute was opened — the start of its window. */
  opened_at: number;
  /** Unix seconds the resolution window closes; past it an unresolved dispute lapses. */
  window_ends_at: number;
  /** The seated jury's counts so far. */
  tally: DisputeTallyView;
  /** The outcome a resolve pass would enact right now. */
  resolution: StationDisputeResolution;
}

/** A party's filed response to a dispute (T1.10.6). */
export interface DisputeResponseView {
  /** The responding party's `rrn1…` address. */
  responder: string;
  /** Their statement, free text. */
  statement: string;
  /** Their evidence hash, hex — present only when one was attached. */
  evidence_hash?: string;
  /** Unix seconds the response was filed. */
  responded_at: number;
}

/** One occupied seat on the jury as of the view's `now` (T1.10.6). */
export interface PanelSeatView {
  /** The juror in this seat, `rrn1…`. */
  juror: string;
  /** Unix seconds they took the seat. */
  seated_at: number;
  /** Their verdict, or `awaiting` if they have not cast a valid one. */
  verdict: StationJurorVerdict;
}

/**
 * An open escalation to the electorate (ADR-0014 §5, T1.10.6). Read-only here in
 * Slice A — the ballot write path arrives in Slice B.
 */
export interface EscalationView {
  /** Why it was opened: `appeal` of a ruling, or `cannot_seat` when no jury could sit. */
  reason: 'appeal' | 'cannot_seat';
  /** The party who opened it, `rrn1…`. */
  initiator: string;
  /** Unix seconds it was opened — the electorate is snapshotted here. */
  opened_at: number;
  /** Unix seconds its window closes (clamped to the dispute's overall window). */
  closes_at: number;
  /** Ballots to uphold the dispute from eligible voters inside the window. */
  uphold: number;
  /** Ballots to reject the dispute from eligible voters inside the window. */
  reject: number;
  /** Established, non-party members eligible to vote. */
  eligible: number;
  /** Whether turnout has reached the escalation quorum. */
  quorum_met: boolean;
  /** Whether the uphold share of decisive ballots has cleared the approval bar. */
  approval_met: boolean;
}

/** One disputed transaction in full (T1.10.6) — the summary plus responses and jury. */
export interface DisputeDetail extends DisputeSummary {
  /** The responses each party filed, in the order they were made. */
  responses: DisputeResponseView[];
  /** The jury as seated right now, each juror with their verdict if cast. */
  panel: PanelSeatView[];
  /** How many members were eligible for the draw (the pool the jury was seated from). */
  eligible_pool_size: number;
  /** The escalation to the electorate, if a party has opened one. */
  escalation?: EscalationView;
}

/** A marketplace surface tag (T1.7.0): which of the three catalogues a listing sits in. */
export type StationSurface = 'goods' | 'services' | 'commons';

/** What `amount_centi` *is* — a firm price or an opening one. */
export type StationPricingModel = 'fixed' | 'negotiable';

/** A listing's availability tag; the three mean different things per surface. */
export type StationAvailabilityStatus = 'available' | 'limited_stock' | 'unavailable';

/** A listing's lifecycle state (T1.7.0). Anything but `active` is not for sale. */
export type StationListingState = 'draft' | 'active' | 'closed' | 'expired';

/** Why a listing closed, when its state is `closed`. */
export type StationCloseReason = 'provider_closed' | 'sold_out' | 'expiration_reached';

/**
 * A listing's availability, flattened (T1.7.0). The three fields mean different
 * things per surface — `capacity` for Goods, `next_slot` for Services, neither
 * for Commons — so the station sends all three and the card draws the
 * fulfillment indicator its surface calls for.
 */
export interface StationAvailability {
  /** `available`, `limited_stock`, or `unavailable`. */
  status: StationAvailabilityStatus;
  /** Units left, for Goods. */
  capacity: number | null;
  /** Unix seconds of the next open slot, for Services. */
  next_slot: number | null;
}

/**
 * One browse row (T1.7.0's `ListingCard`). Everything a card draws and nothing
 * more — the description, requirements, and provider context arrive with
 * {@link StationListingDetail} on a tap the member chose to make.
 */
export interface StationListingCard {
  /** Content address, hex — the id the detail read and an inquiry both take. */
  listing_id: string;
  /** The provider's bech32m `rrn1…` address. */
  provider: string;
  /** Which catalogue the listing sits in. */
  surface: StationSurface;
  /** The controlled-vocabulary category (also an ADR-0009 domain tag). */
  category: string;
  /** The listing's title. */
  title: string;
  /** The price in centi-Commons. Negative is legal on `commons` (a subsidy). */
  amount_centi: number;
  /** `fixed` or `negotiable` — what `amount_centi` *is*. */
  pricing_model: StationPricingModel;
  /** Whether offers are invited (independent of `pricing_model`). */
  negotiable: boolean;
  /** Availability, per surface. */
  availability: StationAvailability;
  /** The provider's current composite, as ranking saw it. */
  provider_composite: number;
  /** The band that composite falls in — the chip the card shows. */
  provider_band: StationReputationBandName;
  /** Unix seconds the listing was published. */
  created_at: number;
  /** Unix seconds it stops being on offer, if it does. */
  expires_at: number | null;
}

/**
 * A listing in full (T1.7.0's `ListingDetailView`), for the detail screen. The
 * card fields are flattened in — one renderer draws the header — with the
 * description, the provider's stated requirements, and their vouching context
 * layered on top.
 */
export interface StationListingDetail extends StationListingCard {
  /** The community the listing was published in. */
  community: string;
  /** The full description (markdown, per T1.7.2). */
  description: string;
  /**
   * The minimum capped composite an inquirer must have. Recorded provider
   * intent; T1.7.4 is where it becomes a check against a specific buyer, so a
   * browse-time CTA can only treat it as a courtesy hint.
   */
  min_reputation: number;
  /** Whether the provider will deal only with members of `community`. */
  community_member_only: boolean;
  /** The dispute tier a sale would run under (1 or 2 in Phase 1). */
  oracle_tier: number;
  /** The standing terms, when this listing is a recurring service (T1.7.7).
   * Absent on a one-off offer; present lets the detail badge it as recurring. */
  recurring?: StationRecurringTerms;
  /** `active`, `closed`, or `expired`. Treat anything but `active` as off offer. */
  state: StationListingState;
  /** Why it closed, when `state` is `closed`. */
  close_reason: StationCloseReason | null;
  /** Unix seconds it closed, when `state` is `closed`. */
  closed_at: number | null;
  /** How many members have vouched for the provider — vouching context a buyer weighs. */
  provider_vouches_received: number;
  /**
   * Whether *this* authenticated member may open an inquiry (T1.7.4), computed
   * against the listing's requirements. Absent on an anonymous read. A courtesy
   * that lets the detail disable "Inquire" with the reason — enforcement is the
   * station's at submit time, not this.
   */
  viewer_eligible?: ViewerEligibility;
}

/** Whether the viewer meets a listing's requirements, and if not, why (T1.7.4). */
export interface ViewerEligibility {
  /** Whether the member may open an inquiry. */
  eligible: boolean;
  /** The unmet requirement in words, when `eligible` is false. */
  unmet?: string;
}

/**
 * One of the member's own listings (T1.7.2's `MyListingRow`): a browse card plus
 * its lifecycle. Unlike a browse card, this includes closed and expired
 * listings — a provider's own list must show the ones no longer on offer, or a
 * listing that went off offer looks deleted.
 */
export interface StationMyListingRow extends StationListingCard {
  /** `active`, `closed`, or `expired`. */
  state: StationListingState;
  /** Why it closed, when `state` is `closed`. */
  close_reason: StationCloseReason | null;
  /** Unix seconds it closed, when `state` is `closed`. */
  closed_at: number | null;
}

/** An inquiry's lifecycle state (T1.7.4). Anything but `open` accepts no writes. */
export type StationInquiryState = 'open' | 'expired_pending' | 'closed';

/** How an inquiry ended, when its state is `closed`. */
export type StationInquiryOutcome =
  | 'agreed'
  | 'declined_by_buyer'
  | 'declined_by_seller'
  | 'expired';

/** One message in a thread (T1.7.4), flattened for the wire. */
export interface StationInquiryMessageRow {
  /** The sender's bech32m `rrn1…` address — align the bubble by comparing it to
   * your own address and to the thread's `buyer`/`provider`. */
  sender: string;
  /** The message body (may be empty when the move is a bare counter-offer). */
  body: string;
  /** A revised price in centi-Commons, if this message carried one. */
  counter_offer_centi?: number;
  /** Unix seconds the message was sent. */
  sent_at: number;
}

/** One inquiry in full (T1.7.4), for the chat-thread screen. */
export interface StationInquiryThread {
  /** The inquiry's content address, hex. */
  inquiry_id: string;
  /** The listing being negotiated, hex — the id an eventual transaction links. */
  listing_id: string;
  /** The listing's title, for the header. */
  listing_title: string;
  /** The listing's listed price in centi-Commons — the reference the offers move
   * around, and the only acceptable price when `negotiable` is false. */
  listed_amount_centi: number;
  /** Whether the listing invites offers. When false, only `listed_amount_centi`
   * may be agreed. */
  negotiable: boolean;
  /** The listing's standing terms, when it is a recurring service (T1.7.7).
   * Present on an agreed thread lets the buyer's phone build the contract it
   * signs — the cadence alongside `final_price_centi`. */
  listing_recurring?: StationRecurringTerms;
  /** The buyer's `rrn1…` address. */
  buyer: string;
  /** The provider's `rrn1…` address. */
  provider: string;
  /** The buyer's opening message (may be empty). */
  initial_message: string;
  /** The buyer's opening offer, if they made one. */
  initial_offer_centi?: number;
  /** Unix seconds the inquiry was opened. */
  opened_at: number;
  /** The messages, in log order. */
  messages: StationInquiryMessageRow[];
  /** `open`, `expired_pending`, or `closed`. */
  state: StationInquiryState;
  /** How it ended, when `state` is `closed`. */
  outcome?: StationInquiryOutcome;
  /** The agreed price, when the outcome is `agreed`. */
  final_price_centi?: number;
  /** Unix seconds it closed, when `state` is `closed`. */
  closed_at?: number;
  /** Unix seconds of the latest activity. */
  last_activity_at: number;
}

/** One inbox row (T1.7.4): enough to list and route, not the whole thread. */
export interface StationMyInquiryRow {
  /** The inquiry's content address, hex. */
  inquiry_id: string;
  /** The listing, hex. */
  listing_id: string;
  /** The listing's title. */
  listing_title: string;
  /** The viewer's role: `buyer` or `provider`. */
  role: 'buyer' | 'provider';
  /** The other party's `rrn1…` address. */
  counterparty: string;
  /** `open`, `expired_pending`, or `closed`. */
  state: StationInquiryState;
  /** How it ended, when `state` is `closed` — lets the inbox show "Agreed" vs
   * "Declined" rather than a flat "Closed". Absent while the inquiry is live. */
  outcome?: StationInquiryOutcome;
  /** The most recent offer on the table (opening, last counter, or agreed price),
   * in centi-Commons. */
  latest_offer_centi?: number;
  /** Unix seconds of the latest activity — rows sort by this, newest first. */
  last_activity_at: number;
}

/** How often a recurring service's period falls due (T1.7.7). */
export type StationFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';

/**
 * A recurring service's standing terms (T1.7.7's `RecurringTermsView`), carried
 * on the listing detail (to badge the offer) and on the agreed inquiry thread (so
 * the buyer's phone can snapshot them into the contract it signs).
 */
export interface StationRecurringTerms {
  /** `daily`, `weekly`, `monthly`, or `custom`. */
  frequency: StationFrequency;
  /** The period length in seconds — the cadence detail a `custom` frequency needs. */
  period_secs: number;
  /** How many periods the commitment runs for. */
  duration_periods: number;
  /** Days of notice either side must give to end it early. */
  notice_period_days: number;
  /** The penalty in centi-Commons on whoever ends it before its natural end. */
  early_termination_penalty_centi: number;
}

/** A contract's lifecycle state (T1.7.7). */
export type StationContractState = 'active' | 'terminating' | 'ended';

/** Why a contract ended, when its state is `ended`. */
export type StationContractEndReason = 'completed' | 'terminated';

/** Which party ended a contract early. */
export type StationTerminatedBy = 'buyer' | 'provider';

/**
 * One contract as an inbox row (T1.7.7's `ContractRow`): enough to list and
 * route, not the full status.
 */
export interface StationContractRow {
  /** The contract's content address, hex. */
  contract_id: string;
  /** The agreed inquiry this contract was born from, hex — the key to tell
   * whether an agreed inquiry already has a contract. */
  inquiry_id: string;
  /** The listing's title. */
  listing_title: string;
  /** The viewer's role: `buyer` or `provider`. */
  role: 'buyer' | 'provider';
  /** The other party's `rrn1…` address. */
  counterparty: string;
  /** `active`, `terminating`, or `ended`. */
  state: StationContractState;
  /** The per-period charge in centi-Commons. */
  commons_per_period_centi: number;
  /** How many periods the ledger has charged. */
  periods_charged: number;
  /** How many periods are still to run. */
  periods_remaining: number;
  /** When the next unbilled period falls due, while billing. */
  next_charge_due?: number;
  /** Unix seconds the contract began — rows sort by this, newest first. */
  started_at: number;
}

/** One contract in full (T1.7.7's `ContractDetailView`), for the status screen. */
export interface StationContractDetail {
  /** The contract's content address, hex. */
  contract_id: string;
  /** The agreed inquiry this contract was born from, hex. */
  inquiry_id: string;
  /** The listing subscribed to, hex. */
  listing_id: string;
  /** The listing's title, for the header. */
  listing_title: string;
  /** The subscriber's `rrn1…` address. */
  buyer: string;
  /** The provider's `rrn1…` address. */
  provider: string;
  /** `daily`, `weekly`, `monthly`, or `custom`. */
  frequency: StationFrequency;
  /** The period length in seconds. */
  period_secs: number;
  /** How many periods the commitment runs for. */
  duration_periods: number;
  /** The per-period charge in centi-Commons. */
  commons_per_period_centi: number;
  /** Days of notice either side must give to end it early. */
  notice_period_days: number;
  /** The penalty in centi-Commons on whoever ends it before its natural end. */
  early_termination_penalty_centi: number;
  /** The buyer's free-form performance notes recorded on the contract. */
  performance_metrics: Record<string, string>;
  /** Unix seconds the contract began; period 0 fell due here. */
  started_at: number;
  /** `active`, `terminating`, or `ended`. */
  state: StationContractState;
  /** How many periods the ledger has charged. */
  periods_charged: number;
  /** How many periods are still to run. */
  periods_remaining: number;
  /** When the next unbilled period falls due, while billing. */
  next_charge_due?: number;
  /** When a pending termination takes effect, while `state` is `terminating`. */
  terminating_effective_at?: number;
  /** Why it ended, when `state` is `ended`. */
  ended_reason?: StationContractEndReason;
  /** Which party ended it, when it ended by termination. */
  terminated_by?: StationTerminatedBy;
  /** Whether it ended before its natural end (so the penalty applied). */
  ended_early?: boolean;
  /** Unix seconds it ended, when `state` is `ended`. */
  ended_at?: number;
}

/**
 * The `marketplace_search` params (T1.7.1). Every filter is optional; an absent
 * one is not sent, so the station applies its default. Field names are the
 * station's snake_case wire names, since this object is serialised straight into
 * the request params.
 */
export interface MarketplaceSearchParams {
  /** Free-text query over title and description. */
  text?: string;
  /** Restrict to one surface. An unknown tag is a station-side error, not ignored. */
  surface?: StationSurface;
  /** Restrict to one controlled-vocabulary category. */
  category?: string;
  /** Price ceiling in centi-Commons. */
  max_price_centi?: number;
  /** Only listings whose provider's capped composite is at least this. */
  min_provider_reputation?: number;
  /** Page size; the station clamps it to its own maximum. */
  limit?: number;
  /** How many ranked hits to skip (the paging cursor). */
  offset?: number;
}

/**
 * One push event from the station's subscribe long-poll (T1.3.5). Exactly one
 * of the payload fields is present: `transaction` for the four ledger kinds,
 * `vouch` for a `vouch_received` (T1.4.1).
 */
export interface StationEvent {
  /** The event id — a monotonic log seq; the device's cursor is the highest seen. */
  id: number;
  /** What happened. */
  kind: StationEventKind;
  /** The affected transaction, member-relative (same shape as the read view). */
  transaction?: StationTransactionRow;
  /** The vouch, for a `vouch_received` event. */
  vouch?: StationVouchRow;
}

/** The station's reply shape (parsed from the JSON reply payload). */
interface ResponseEnvelope {
  v: number;
  nonce: number;
  result?: string | null;
  error?: {code: number; message: string} | null;
}

// --- framing helpers --------------------------------------------------------

/** Frames a signed request: `len(u32 BE) ‖ payload ‖ signature(64)`. */
function frameWithSig(payload: Uint8Array, signature: Uint8Array): Uint8Array {
  const out = new Uint8Array(LEN_PREFIX + payload.length + signature.length);
  writeU32BE(out, 0, payload.length);
  out.set(payload, LEN_PREFIX);
  out.set(signature, LEN_PREFIX + payload.length);
  return out;
}

/**
 * Frames a signed record for the write path: `len(u32 BE) ‖ payload ‖ signer(32)
 * ‖ signature(64)` — the station's `frame_signed_record`.
 */
function frameSignedRecord(
  payload: Uint8Array,
  signer: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(LEN_PREFIX + payload.length + signer.length + signature.length);
  writeU32BE(out, 0, payload.length);
  out.set(payload, LEN_PREFIX);
  out.set(signer, LEN_PREFIX + payload.length);
  out.set(signature, LEN_PREFIX + payload.length + signer.length);
  return out;
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(offset, value, false);
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(offset, false);
}

/** Reads a response body as text, never throwing. */
async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
