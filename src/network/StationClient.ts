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
   * that predates the field).
   */
  async whoami(): Promise<{address: string; community?: string}> {
    return this.call('whoami', {}) as Promise<{address: string; community?: string}>;
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
    method: 'submit_proposal' | 'submit_confirmation' | 'submit_vouch',
    field: 'signed_proposal' | 'signed_confirmation' | 'signed_vouch',
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
  state: 'pending' | 'confirmed' | 'settled' | 'cancelled';
  timestamp: number;
  expires_at?: number;
  confirmed_at?: number;
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
