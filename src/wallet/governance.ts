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
import {bytes, canonicalBytes, int, map, text, type CborValue} from '../crypto/cbor';
import {hexToBytes} from '../crypto/hex';
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
