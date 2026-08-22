/**
 * Building and signing governance ballots on-device (T1.9.8).
 *
 * Phase-1 mobile governance is read-mostly with two write primitives: a member
 * can **co-sign** an existing proposal (endorsing it toward the publication
 * threshold) and **cast a vote** on a published one. Composing new proposals is
 * deferred to the CLI, so there is deliberately no proposal builder here.
 *
 * As with {@link createSendProposal} and {@link createSignedVouch} the canonical
 * CBOR is built here with the {@link cbor} helpers and shipped to Rust for
 * canonicalization + signing, byte-identical to the station's `ProposalCosign`
 * and `Vote` (see `rrn-governance` `proposal.rs` + `vote.rs`), so a ballot signed
 * on the phone verifies on the station (ADR-0002, ADR-0006).
 *
 * A `proposalId` is the proposal's content address — the station's read surface
 * returns it as hex; here it is decoded and encoded as a CBOR byte string of the
 * raw 32-byte Blake3 hash, exactly as `From<ProposalId> for CBOR` does. The
 * `cosigner`/`voter` are this wallet's own address, encoded — like a proposal's
 * `sender` — as a CBOR byte string of the raw 32 public-key bytes.
 *
 * Neither record carries its own content-address id: a cosign and a vote are
 * plain signed payloads keyed by `(proposal_id, signer)` on the station, so
 * there is nothing to hash back. Transmitting them is
 * `StationClient.submitCosign` / `submitVote`.
 */
import {bytes, canonicalBytes, int, list, map, text, type CborValue} from '../crypto/cbor';
import {bytesToHex, hexToBytes} from '../crypto/hex';
import {parseAddress} from '../crypto/address';
import type {StationPendingCharter} from '../network/StationClient';
import type {Wallet} from './Wallet';

/** The `kind` discriminant the station stamps on a co-signature's canonical CBOR. */
const COSIGN_KIND = 'rrn.gov.proposal_cosign';
/** The `kind` discriminant the station stamps on a vote's canonical CBOR. */
const VOTE_KIND = 'rrn.gov.vote';

/** A ballot choice — the text discriminant the station's `VoteChoice` encodes to. */
export type VoteChoice = 'yes' | 'no' | 'abstain';

/** A signed co-signature, ready to transmit to the paired station. */
export interface SignedCosign {
  /** The endorsed proposal's content address, hex. */
  proposalId: string;
  /** The co-signer's (this wallet's) bech32m `rrn1…` address. */
  cosignerAddress: string;
  /** Unix seconds when the endorsement was made. */
  cosignedAt: number;
  /**
   * The canonical dCBOR bytes that were signed — the payload the station's
   * `frame_signed_record` re-assembles and re-verifies before appending.
   */
  payloadBytes: Uint8Array;
  /** The co-signer's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/** A signed ballot, ready to transmit to the paired station. */
export interface SignedVote {
  /** The proposal being voted on, content address hex. */
  proposalId: string;
  /** The voter's (this wallet's) bech32m `rrn1…` address. */
  voterAddress: string;
  /** The choice cast. */
  choice: VoteChoice;
  /** Unix seconds when the ballot was cast. */
  castAt: number;
  /**
   * The canonical dCBOR bytes that were signed — the payload the station's
   * `frame_signed_record` re-assembles and re-verifies before appending.
   */
  payloadBytes: Uint8Array;
  /** The voter's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/**
 * Builds and signs a {@link SignedCosign} endorsing `proposalIdHex` with
 * `wallet`. The wallet's secret never leaves Rust — signing goes through
 * {@link Wallet.sign}.
 */
export async function createSignedCosign(
  wallet: Wallet,
  proposalIdHex: string,
  cosignedAt: number,
): Promise<SignedCosign> {
  // Field set, types, and byte-string encodings must match the station's
  // `From<ProposalCosign> for CBOR` exactly, or the signature will not verify
  // there. Map key order is irrelevant — dCBOR sorts canonically.
  const payload: CborValue = map([
    ['kind', text(COSIGN_KIND)],
    ['proposal_id', bytes(hexToBytes(proposalIdHex))],
    ['cosigner', bytes(wallet.publicKey().toBytes())],
    ['cosigned_at', int(cosignedAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    proposalId: proposalIdHex,
    cosignerAddress: wallet.address,
    cosignedAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/**
 * Builds and signs a {@link SignedVote} casting `choice` on `proposalIdHex` with
 * `wallet`. The wallet's secret never leaves Rust — signing goes through
 * {@link Wallet.sign}.
 */
export async function createSignedVote(
  wallet: Wallet,
  proposalIdHex: string,
  choice: VoteChoice,
  castAt: number,
): Promise<SignedVote> {
  // Field set, types, and encodings must match the station's `From<Vote> for
  // CBOR` exactly. `choice` is a text string (`yes`/`no`/`abstain`), matching
  // the station's `From<VoteChoice> for CBOR`.
  const payload: CborValue = map([
    ['kind', text(VOTE_KIND)],
    ['proposal_id', bytes(hexToBytes(proposalIdHex))],
    ['voter', bytes(wallet.publicKey().toBytes())],
    ['choice', text(choice)],
    ['cast_at', int(castAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    proposalId: proposalIdHex,
    voterAddress: wallet.address,
    choice,
    castAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/**
 * The `governance_structure` block of a genesis Charter, mirroring
 * `GovernanceStructure::default()` in `rrn-governance/charter.rs`. The station's
 * `governance_charter_begin` always fixes the body with these defaults, and the
 * ceremony's read surface (`governance_pending_charter`) does **not** echo them
 * back — only the body's canonical `body_hex` does. We reproduce them here and
 * rely on the {@link createSignedCharterSignature} `body_hex` equality check to
 * catch any drift rather than trusting these constants blindly.
 */
const GOVERNANCE_STRUCTURE_DEFAULTS: CborValue = map([
  ['voting_mechanism', text('direct')],
  ['statute_quorum_pct', int(30)],
  ['statute_approval_pct', int(50)],
  ['deliberation_window_days', int(7)],
  ['implementation_delay_days', int(7)],
  ['emergency_threshold_pct', int(67)],
]);

/**
 * The `amendment_rules` block of a genesis Charter, mirroring
 * `AmendmentRules::default()` in `rrn-governance/charter.rs`. See
 * {@link GOVERNANCE_STRUCTURE_DEFAULTS} for why these live here.
 */
const AMENDMENT_RULES_DEFAULTS: CborValue = map([
  ['charter_quorum_pct', int(50)],
  ['charter_approval_pct', int(75)],
  ['charter_deliberation_window_days', int(30)],
]);

/** A founder's Ed25519 signature over a genesis Charter body, ready to submit. */
export interface SignedCharterSignature {
  /** The signer's (this wallet's) bech32m `rrn1…` address. */
  signerAddress: string;
  /**
   * The canonical dCBOR Charter body that was signed — byte-identical to the
   * station's, asserted equal to the ceremony's `body_hex`.
   */
  payloadBytes: Uint8Array;
  /** The 64-byte Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/**
 * Raised when the Charter body reconstructed on-device does not match the
 * ceremony's `body_hex` — a fail-safe against signing a body that differs from
 * the one the coordinator fixed (a governance-default drift, an unexpected
 * field, or a malformed founder address).
 */
export class CharterBodyMismatchError extends Error {
  constructor(expectedHex: string, actualHex: string) {
    super(
      `reconstructed charter body does not match the station (expected ${expectedHex}, got ${actualHex}); refusing to sign`,
    );
    this.name = 'CharterBodyMismatchError';
  }
}

/**
 * Reconstructs the genesis Charter body the founding ceremony fixed
 * ({@link StationPendingCharter}) as canonical dCBOR, signs it with `wallet`,
 * and returns the raw signature to submit (`StationClient.submitCharterSignature`).
 *
 * The body is rebuilt here — not trusted from a server blob — and mirrors
 * `From<Charter> for CBOR` in `rrn-governance/charter.rs` field-for-field:
 * `version`, `community_id`, the two string lists, the two rule blocks (their
 * defaults reproduced above), `created_at`, and `founders` as byte strings of
 * each founder's raw 32-byte public key (decoded from its `rrn1…` address).
 * `previous_hash` is omitted at genesis. Because the station's read surface does
 * not echo the rule blocks, we **assert** the reconstructed bytes hash to the
 * ceremony's `body_hex` and throw {@link CharterBodyMismatchError} on any drift,
 * so a founder never signs a body that differs from the one being ratified.
 *
 * The wallet's secret never leaves Rust — signing goes through {@link Wallet.sign}.
 */
export async function createSignedCharterSignature(
  wallet: Wallet,
  pending: StationPendingCharter,
): Promise<SignedCharterSignature> {
  const founders: CborValue[] = pending.founders.map(address => {
    const parsed = parseAddress(address);
    if ('error' in parsed) {
      throw new CharterBodyMismatchError(
        pending.body_hex,
        `invalid founder address ${address}`,
      );
    }
    return bytes(parsed.toBytes());
  });

  // Field set, types, and encodings must match the station's `From<Charter> for
  // CBOR` exactly. Map key order is irrelevant — dCBOR sorts canonically.
  const payload: CborValue = map([
    ['version', int(pending.version)],
    ['community_id', text(pending.community_id)],
    ['founding_principles', list(pending.founding_principles.map(text))],
    ['rights_floor', list(pending.rights_floor.map(text))],
    ['governance_structure', GOVERNANCE_STRUCTURE_DEFAULTS],
    ['amendment_rules', AMENDMENT_RULES_DEFAULTS],
    ['created_at', int(pending.created_at)],
    ['founders', list(founders)],
    // `previous_hash` is omitted at genesis, matching the log's optional-field
    // convention on the station.
  ]);

  const canonical = canonicalBytes(payload);
  const actualHex = bytesToHex(canonical);
  if (actualHex !== pending.body_hex) {
    throw new CharterBodyMismatchError(pending.body_hex, actualHex);
  }

  const signature = await wallet.sign(canonical);
  return {
    signerAddress: wallet.address,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}
