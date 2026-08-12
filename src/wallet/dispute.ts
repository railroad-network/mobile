/**
 * Building and signing dispute records on-device (T1.10.6, Slice A).
 *
 * When a bilaterally-confirmed transaction is contested, the raiser opens a
 * dispute, the counterparty files a response, and a sortition-drawn juror casts
 * a verdict — three signed records, each keyed by the disputed transaction. As
 * with {@link createSendProposal} and {@link createSignedVote} the canonical
 * CBOR is built here with the {@link cbor} helpers and shipped to Rust for
 * canonicalization + signing, byte-identical to the station's `DisputeRecord`
 * / `DisputeResponse` (see `rrn-ledger` `dispute.rs`) and `JurorVerdict` (see
 * `rrn-dispute` `verdict.rs`), so a record signed on the phone verifies on the
 * station (ADR-0002, ADR-0006, ADR-0014).
 *
 * A `txId` is the disputed transaction's content address — the station's read
 * surface returns it as hex; here it is decoded and encoded as a CBOR byte
 * string of the raw 32-byte hash, exactly as `From<TransactionId> for CBOR`
 * does. The `raiser`/`responder`/`juror` are this wallet's own address, encoded
 * — like a proposal's `sender` — as a CBOR byte string of the raw 32 key bytes.
 *
 * **Evidence is text-only in v1** (user decision 2026-08-12): ADR-0014 keeps a
 * rich artifact channel in Tier-3/Phase-2 and there is no on-device artifact
 * store to hash, so the optional `evidence_hash` field is always omitted here.
 * The station's `#[serde(skip_serializing_if = "Option::is_none")]` mirrors the
 * omission, so the bytes still match.
 *
 * None of these records carries its own content-address id — they are plain
 * signed payloads keyed by `(proposal_id, signer)` on the station. Transmitting
 * them is `StationClient.submitDispute` / `submitDisputeResponse` /
 * `submitVerdict`.
 */
import {bytes, canonicalBytes, int, map, text, type CborValue} from '../crypto/cbor';
import {hexToBytes} from '../crypto/hex';
import type {Wallet} from './Wallet';

/** The `kind` discriminant the station stamps on a dispute's canonical CBOR. */
const DISPUTE_KIND = 'rrn.tx.dispute';
/** The `kind` discriminant on a dispute response's canonical CBOR. */
const DISPUTE_RESPONSE_KIND = 'rrn.tx.dispute.response';
/** The `kind` discriminant on a juror verdict's canonical CBOR. */
const VERDICT_KIND = 'rrn.dispute.verdict';
/** The `kind` discriminant on an escalation's canonical CBOR. */
const ESCALATION_KIND = 'rrn.dispute.escalation';
/** The `kind` discriminant on an escalation ballot's canonical CBOR. */
const ESCALATION_BALLOT_KIND = 'rrn.dispute.escalation_ballot';

/**
 * Why a dispute is put to the electorate (ADR-0014 §5): a party contests the
 * jury's ruling (`appeal`), or the jury could not seat a panel (`cannot_seat`).
 * Matches the text the station's `EscalationReason` encodes to.
 */
export type EscalationReason = 'appeal' | 'cannot_seat';

/** A signed dispute, ready to transmit to the paired station. */
export interface SignedDispute {
  /** The disputed transaction's content address, hex. */
  txId: string;
  /** The raiser's (this wallet's) bech32m `rrn1…` address. */
  raiserAddress: string;
  /** The grievance, free text (bounded to 2048 bytes by the station). */
  reason: string;
  /** Unix seconds when the dispute was opened. */
  openedAt: number;
  /**
   * The canonical dCBOR bytes that were signed — the payload the station's
   * `frame_signed_record` re-assembles and re-verifies before appending.
   */
  payloadBytes: Uint8Array;
  /** The raiser's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/** A signed dispute response, ready to transmit to the paired station. */
export interface SignedDisputeResponse {
  /** The disputed transaction's content address, hex. */
  txId: string;
  /** The responder's (this wallet's) bech32m `rrn1…` address. */
  responderAddress: string;
  /** The rebuttal, free text (bounded to 2048 bytes by the station). */
  statement: string;
  /** Unix seconds when the response was filed. */
  respondedAt: number;
  /** The canonical dCBOR bytes that were signed. */
  payloadBytes: Uint8Array;
  /** The responder's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/** A signed juror verdict, ready to transmit to the paired station. */
export interface SignedVerdict {
  /** The disputed transaction's content address, hex. */
  txId: string;
  /** The juror's (this wallet's) bech32m `rrn1…` address. */
  jurorAddress: string;
  /** Whether the juror votes to uphold the dispute (true) or reject it (false). */
  uphold: boolean;
  /** Unix seconds when the verdict was cast. */
  castAt: number;
  /** The canonical dCBOR bytes that were signed. */
  payloadBytes: Uint8Array;
  /** The juror's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/**
 * Builds and signs a {@link SignedDispute} opening a dispute against `txIdHex`
 * with `wallet`. The wallet's secret never leaves Rust — signing goes through
 * {@link Wallet.sign}.
 */
export async function createSignedDispute(
  wallet: Wallet,
  txIdHex: string,
  reason: string,
  openedAt: number,
): Promise<SignedDispute> {
  // Field set, types, and byte-string encodings must match the station's
  // `From<DisputeRecord> for CBOR` exactly, or the signature will not verify
  // there. `evidence_hash` is omitted (text-only v1), mirroring the station's
  // omit-when-None. Map key order is irrelevant — dCBOR sorts canonically.
  const payload: CborValue = map([
    ['kind', text(DISPUTE_KIND)],
    ['proposal_id', bytes(hexToBytes(txIdHex))],
    ['raiser', bytes(wallet.publicKey().toBytes())],
    ['reason', text(reason)],
    ['opened_at', int(openedAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    txId: txIdHex,
    raiserAddress: wallet.address,
    reason,
    openedAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/**
 * Builds and signs a {@link SignedDisputeResponse} rebutting the dispute on
 * `txIdHex` with `wallet`.
 */
export async function createSignedDisputeResponse(
  wallet: Wallet,
  txIdHex: string,
  statement: string,
  respondedAt: number,
): Promise<SignedDisputeResponse> {
  // Matches the station's `From<DisputeResponse> for CBOR`; `evidence_hash`
  // omitted (text-only v1).
  const payload: CborValue = map([
    ['kind', text(DISPUTE_RESPONSE_KIND)],
    ['proposal_id', bytes(hexToBytes(txIdHex))],
    ['responder', bytes(wallet.publicKey().toBytes())],
    ['statement', text(statement)],
    ['responded_at', int(respondedAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    txId: txIdHex,
    responderAddress: wallet.address,
    statement,
    respondedAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/**
 * Builds and signs a {@link SignedVerdict} casting a seated juror's ruling on
 * the dispute over `txIdHex` with `wallet`.
 */
export async function createSignedVerdict(
  wallet: Wallet,
  txIdHex: string,
  uphold: boolean,
  castAt: number,
): Promise<SignedVerdict> {
  // Matches the station's `From<JurorVerdict> for CBOR`. The boolean `uphold`
  // encodes as a text `ruling` field (`uphold`/`reject`), exactly as the
  // station does — the wire field is `ruling`, not a bool.
  const payload: CborValue = map([
    ['kind', text(VERDICT_KIND)],
    ['proposal_id', bytes(hexToBytes(txIdHex))],
    ['juror', bytes(wallet.publicKey().toBytes())],
    ['ruling', text(uphold ? 'uphold' : 'reject')],
    ['cast_at', int(castAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    txId: txIdHex,
    jurorAddress: wallet.address,
    uphold,
    castAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/** A signed escalation, ready to transmit to the paired station. */
export interface SignedEscalation {
  /** The disputed transaction's content address, hex. */
  txId: string;
  /** The initiator's (this wallet's) bech32m `rrn1…` address. */
  initiatorAddress: string;
  /** Why the escalation was opened. */
  reason: EscalationReason;
  /** Unix seconds when the escalation was opened. */
  openedAt: number;
  /** The canonical dCBOR bytes that were signed. */
  payloadBytes: Uint8Array;
  /** The initiator's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/** A signed escalation ballot, ready to transmit to the paired station. */
export interface SignedEscalationBallot {
  /** The disputed transaction's content address, hex. */
  txId: string;
  /** The voter's (this wallet's) bech32m `rrn1…` address. */
  voterAddress: string;
  /** Whether the voter votes to uphold the dispute (true) or reject it (false). */
  uphold: boolean;
  /** Unix seconds when the ballot was cast. */
  castAt: number;
  /** The canonical dCBOR bytes that were signed. */
  payloadBytes: Uint8Array;
  /** The voter's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/**
 * Builds and signs a {@link SignedEscalation} putting the dispute over `txIdHex`
 * to the electorate with `wallet` (ADR-0014 §5). A party opens it — to `appeal`
 * a jury ruling or because the jury `cannot_seat` a panel.
 */
export async function createSignedEscalation(
  wallet: Wallet,
  txIdHex: string,
  reason: EscalationReason,
  openedAt: number,
): Promise<SignedEscalation> {
  // Matches the station's `From<EscalationRecord> for CBOR` (rrn-dispute
  // `escalation.rs`). `reason` is a text field (`appeal`/`cannot_seat`).
  const payload: CborValue = map([
    ['kind', text(ESCALATION_KIND)],
    ['proposal_id', bytes(hexToBytes(txIdHex))],
    ['initiator', bytes(wallet.publicKey().toBytes())],
    ['reason', text(reason)],
    ['opened_at', int(openedAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    txId: txIdHex,
    initiatorAddress: wallet.address,
    reason,
    openedAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}

/**
 * Builds and signs a {@link SignedEscalationBallot} casting an eligible member's
 * ballot on an open escalation with `wallet` (ADR-0014 §5).
 */
export async function createSignedEscalationBallot(
  wallet: Wallet,
  txIdHex: string,
  uphold: boolean,
  castAt: number,
): Promise<SignedEscalationBallot> {
  // Matches the station's `From<EscalationBallot> for CBOR`. As with a juror
  // verdict, the boolean encodes as a text `ruling` field (`uphold`/`reject`).
  const payload: CborValue = map([
    ['kind', text(ESCALATION_BALLOT_KIND)],
    ['proposal_id', bytes(hexToBytes(txIdHex))],
    ['voter', bytes(wallet.publicKey().toBytes())],
    ['ruling', text(uphold ? 'uphold' : 'reject')],
    ['cast_at', int(castAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    txId: txIdHex,
    voterAddress: wallet.address,
    uphold,
    castAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}
