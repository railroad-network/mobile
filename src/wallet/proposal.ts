/**
 * Building and signing a transaction proposal on-device (T1.2.5).
 *
 * When the user sends Commons the app creates the sender's half of a
 * transaction: a {@link https://…|TransactionProposal} signed by the sender.
 * The proposal's canonical CBOR is built here with the {@link cbor} helpers and
 * shipped to the Rust core for canonicalization + signing — the exact same
 * bytes the station's `rrn_ledger::transaction::TransactionProposal` produces,
 * so a proposal signed on mobile verifies on the station (ADR-0002). The field
 * shape, the `kind` discriminant, and the address encoding (a bech32m address
 * is a CBOR byte string of the raw 32 public-key bytes) all mirror the station.
 *
 * ## Amount sign convention (matches the station)
 *
 * `amountCenti` here is the **station's** convention: *positive means the sender
 * pays the receiver* — the normal case for a send. This is the opposite sign to
 * the mobile ledger's display model, where an outgoing payment is a negative
 * (debit) {@link Transaction}. Callers pass the positive transfer amount; the UI
 * negates it separately for display.
 *
 * The `id` is the transaction's content address: the Blake3 hash of the same
 * canonical bytes that are signed (as the station computes it), returned as hex.
 * It is not part of the signed content — it is a function of it.
 *
 * ## What is NOT here (M1.3)
 *
 * Nothing transmits the proposal. The signed bytes are handed to the local
 * outbox (`ledger/outbox`); the mobile↔station transport that forwards them —
 * and the authoritative per-sender `nonce` and settlement/expiry window — arrive
 * in M1.3. Until then the caller supplies a locally-derived nonce and expiry.
 */
import {bytes, canonicalBytes, int, map, nul, text, type CborValue} from '../crypto/cbor';
import {parseAddress} from '../crypto/address';
import {getRrnCryptoFfi} from '../crypto/ffi';
import type {Wallet} from './Wallet';

/** The `kind` discriminant the station stamps on a proposal's canonical CBOR. */
const PROPOSAL_KIND = 'rrn.tx.proposal';

/** The signed sender-half of a transaction, ready to queue for the station. */
export interface SignedSendProposal {
  /** Content address: hex of the Blake3 hash of the signed canonical bytes. */
  id: string;
  /** The sender's (this wallet's) bech32m `rrn1…` address. */
  senderAddress: string;
  /** The receiver's bech32m `rrn1…` address. */
  receiverAddress: string;
  /** Station convention: positive = sender pays receiver. Integer centi. */
  amountCenti: number;
  /** Optional memo, trimmed; absent when blank. */
  memo?: string;
  /** Per-sender monotonic nonce. */
  nonce: number;
  /** Unix seconds when the proposal was made. */
  proposedAt: number;
  /** Unix seconds after which the proposal auto-cancels if unconfirmed. */
  expiresAt: number;
  /** The sender's Ed25519 signature over the canonical bytes. */
  signature: Uint8Array;
}

/** The locally-derived envelope fields the station will own in M1.3. */
export interface ProposalEnvelope {
  nonce: number;
  proposedAt: number;
  expiresAt: number;
}

/**
 * Builds and signs a {@link SignedSendProposal} with `wallet`, moving
 * `amountCenti` (positive = this wallet pays) to `receiverAddress`. Rejects if
 * the receiver address is not a valid bech32m `rrn1…` address. The wallet's
 * secret never leaves Rust — signing goes through {@link Wallet.sign}.
 */
export async function createSendProposal(
  wallet: Wallet,
  receiverAddress: string,
  amountCenti: number,
  memo: string | undefined,
  envelope: ProposalEnvelope,
): Promise<SignedSendProposal> {
  const receiver = parseAddress(receiverAddress);
  if ('error' in receiver) {
    throw new Error(`invalid receiver address: ${receiver.error.message}`);
  }

  const trimmedMemo = memo?.trim();
  const hasMemo = trimmedMemo !== undefined && trimmedMemo.length > 0;

  // Field order is irrelevant — the dCBOR encoder sorts map keys canonically —
  // but the set, types, and address-as-byte-string encoding must match the
  // station's `From<TransactionProposal> for CBOR` exactly, or the signature
  // will not verify there. `id` is deliberately omitted: it *is* the hash.
  const payload: CborValue = map([
    ['kind', text(PROPOSAL_KIND)],
    ['sender', bytes(wallet.publicKey().toBytes())],
    ['receiver', bytes(receiver.toBytes())],
    ['amount_centi', int(amountCenti)],
    ['memo', hasMemo ? text(trimmedMemo) : nul()],
    ['nonce', int(envelope.nonce)],
    ['proposed_at', int(envelope.proposedAt)],
    ['expires_at', int(envelope.expiresAt)],
  ]);

  const canonical = canonicalBytes(payload);
  const id = getRrnCryptoFfi().Hash.of(canonical).toHex();
  const signature = await wallet.sign(canonical);

  return {
    id,
    senderAddress: wallet.address,
    receiverAddress,
    amountCenti,
    memo: hasMemo ? trimmedMemo : undefined,
    nonce: envelope.nonce,
    proposedAt: envelope.proposedAt,
    expiresAt: envelope.expiresAt,
    signature: signature.toBytes(),
  };
}
