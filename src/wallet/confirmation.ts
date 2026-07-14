/**
 * Building and signing a transaction confirmation on-device (T1.2.6).
 *
 * When the receiver accepts an incoming proposal the app creates the receiver's
 * half of the transaction: a `TransactionConfirmation` signed by the receiver.
 * As with {@link createSendProposal}, the canonical CBOR is built here and
 * shipped to Rust for canonicalization + signing, byte-identical to the
 * station's `rrn_ledger::transaction::TransactionConfirmation` (ADR-0002), so a
 * confirmation signed on mobile verifies on the station. The `proposal_id` is
 * the proposal's content address — a 32-byte hash — encoded (like the station's
 * `TransactionId`) as a CBOR byte string; `confirmer` is this wallet's address,
 * also a byte string of the raw public-key bytes.
 *
 * Rejecting a proposal signs nothing — it is a local state change (the proposal
 * becomes `cancelled` with reason `rejected_by_receiver`); only confirmation
 * puts the receiver's name on the ledger, so only it is signed here.
 *
 * Transmitting the signed confirmation to the station is M1.3.
 */
import {bytes, canonicalBytes, int, map, text, type CborValue} from '../crypto/cbor';
import type {Wallet} from './Wallet';

/** The `kind` discriminant the station stamps on a confirmation's canonical CBOR. */
const CONFIRMATION_KIND = 'rrn.tx.confirmation';

/** The signed receiver-half of a transaction. */
export interface SignedConfirmation {
  /** The confirmed proposal's content address (hex of its 32-byte hash). */
  proposalId: string;
  /** The confirmer's (this wallet's) bech32m `rrn1…` address. */
  confirmerAddress: string;
  /** Unix seconds when the confirmation was made. */
  confirmedAt: number;
  /** The confirmer's Ed25519 signature over the canonical bytes. */
  signature: Uint8Array;
}

/** Decodes a hex string (the proposal id) to its raw bytes. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('proposal id is not valid hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Builds and signs a {@link SignedConfirmation} with `wallet`, accepting the
 * proposal whose content-address is `proposalIdHex`. Rejects if that id is not
 * valid hex. The wallet's secret never leaves Rust — signing goes through
 * {@link Wallet.sign}.
 */
export async function createConfirmation(
  wallet: Wallet,
  proposalIdHex: string,
  confirmedAt: number,
): Promise<SignedConfirmation> {
  // Field set, types, and byte-string encodings must match the station's
  // `From<TransactionConfirmation> for CBOR` exactly (`id` has no analogue here
  // — a confirmation is not content-addressed). Map key order is irrelevant; the
  // dCBOR encoder sorts canonically.
  const payload: CborValue = map([
    ['kind', text(CONFIRMATION_KIND)],
    ['proposal_id', bytes(hexToBytes(proposalIdHex))],
    ['confirmer', bytes(wallet.publicKey().toBytes())],
    ['confirmed_at', int(confirmedAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const signature = await wallet.sign(canonical);

  return {
    proposalId: proposalIdHex,
    confirmerAddress: wallet.address,
    confirmedAt,
    signature: signature.toBytes(),
  };
}
