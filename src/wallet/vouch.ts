/**
 * Building and signing a vouch attestation on-device (T1.4.3).
 *
 * A vouch is the social primitive of the web of trust: the voucher signs a
 * statement that a subject key belongs to a real person they know, staking some
 * reputation on it. As with {@link createSendProposal} the canonical CBOR is
 * built here and shipped to Rust for canonicalization + signing, byte-identical
 * to the station's `SignedVouch` (a `SignedPayload<Attestation<VouchKind,
 * VouchBody>>` — see `rrn-identity` `attestation.rs` + `vouch.rs`), so a vouch
 * signed on the phone verifies on the station (ADR-0002, ADR-0006).
 *
 * The `subject` is the vouched-for address, encoded — like a proposal's
 * `sender`/`receiver` — as a CBOR byte string of the raw 32 public-key bytes.
 * The `body` is a nested map, and `expires_at` is an explicit CBOR null: a vouch
 * never expires in Phase 0 (revocation is a separate future attestation kind).
 * The `community` is the station's current community identifier, read from
 * `whoami` at vouch time rather than hardcoded (Phase 0: `"rrn-phase0"`).
 *
 * The `vouchId` is the vouch's content address — the Blake3 hash of the same
 * canonical bytes that are signed (what the station's `submit_vouch` returns).
 * It is not part of the signed content; it is a function of it.
 *
 * Transmitting the signed vouch to the station is `StationClient.submitVouch`;
 * the vouch UI (scan, stake, confirm) is T1.4.1.
 */
import {bytes, canonicalBytes, int, map, nul, text, type CborValue} from '../crypto/cbor';
import {parseAddress} from '../crypto/address';
import {getRrnCryptoFfi} from '../crypto/ffi';
import type {Wallet} from './Wallet';

/** The signed vouch, ready to transmit to the paired station. */
export interface SignedVouch {
  /** Content address: hex of the Blake3 hash of the signed canonical bytes. */
  vouchId: string;
  /** The voucher's (this wallet's) bech32m `rrn1…` address. */
  voucherAddress: string;
  /** The vouched-for bech32m `rrn1…` address (the attestation subject). */
  subjectAddress: string;
  /** The community identifier stamped into the vouch (from the station's whoami). */
  community: string;
  /** The voucher's free-text statement about the subject. */
  statement: string;
  /** Reputation staked, in centipoints (1 point = 100 centipoints). */
  stakeCenti: number | bigint;
  /** Unix seconds when the vouch was issued. */
  issuedAt: number;
  /**
   * The canonical dCBOR bytes that were signed — the payload the station's
   * `frame_signed_record` re-assembles and re-verifies before appending.
   */
  payloadBytes: Uint8Array;
  /** The voucher's Ed25519 signature over {@link payloadBytes}. */
  signature: Uint8Array;
}

/**
 * Builds and signs a {@link SignedVouch} with `wallet` for `subjectAddress`.
 * Rejects if the subject is not a valid bech32m `rrn1…` address. The wallet's
 * secret never leaves Rust — signing goes through {@link Wallet.sign}.
 *
 * `stakeCenti` accepts a `bigint` for the full u64 range; the vouch UI passes a
 * small `number` (defaulting to the community minimum).
 */
export async function createSignedVouch(
  wallet: Wallet,
  subjectAddress: string,
  community: string,
  statement: string,
  stakeCenti: number | bigint,
  issuedAt: number,
): Promise<SignedVouch> {
  const subject = parseAddress(subjectAddress);
  if ('error' in subject) {
    throw new Error(`invalid subject address: ${subject.error.message}`);
  }

  // Field set, nesting, types, and byte-string subject must match the station's
  // `From<Attestation<VouchKind, VouchBody>> for CBOR` exactly, or the signature
  // will not verify there. Map key order is irrelevant — dCBOR sorts canonically
  // — but `body` is a nested map and `expires_at` is an explicit null.
  const payload: CborValue = map([
    ['kind', text('vouch')],
    [
      'body',
      map([
        ['community', text(community)],
        ['statement', text(statement)],
        ['reputation_stake_centi', int(stakeCenti)],
      ]),
    ],
    ['subject', bytes(subject.toBytes())],
    ['issued_at', int(issuedAt)],
    ['expires_at', nul()],
  ]);

  const canonical = canonicalBytes(payload);
  const vouchId = getRrnCryptoFfi().Hash.of(canonical).toHex();
  const signature = await wallet.sign(canonical);

  return {
    vouchId,
    voucherAddress: wallet.address,
    subjectAddress,
    community,
    statement,
    stakeCenti,
    issuedAt,
    payloadBytes: canonical,
    signature: signature.toBytes(),
  };
}
