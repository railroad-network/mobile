/**
 * Signed payloads (M1.1 T1.1.7).
 *
 * A {@link SignedPayload} is a value plus a signature over its **canonical dCBOR
 * bytes** (ADR-0002) — never over a wire envelope. This mirrors the station's
 * `rrn_crypto::signed::SignedPayload`, which signs `to_canonical_bytes(payload)`:
 * because {@link canonicalBytes} produces the same bytes the station would, a
 * payload signed here verifies there and vice versa, and the signature bytes are
 * identical (Ed25519 is deterministic).
 *
 * The payload is a {@link CborValue} — the dCBOR-constrained value model from
 * `cbor.ts`. Build it with that module's helpers (`map`, `text`, `int`,
 * `bytes`, …); floats are rejected at construction time.
 *
 * The functions are `async` to match the rest of the FFI-backed crypto surface
 * (`sign.ts`), even though canonicalization and signing currently return
 * synchronously.
 */
import {canonicalBytes, type CborValue} from './cbor';
import type {Keypair, PublicKey, Signature} from './ffi';

/** A value bundled with its signer's public key and a signature over it. */
export interface SignedPayload<T extends CborValue> {
  /** The signed value. */
  payload: T;
  /** The public key that produced {@link signature}. */
  signer: PublicKey;
  /** Signature over the payload's canonical dCBOR bytes. */
  signature: Signature;
}

/** Signs `payload` with `keypair`, producing a verifiable envelope. */
export async function signPayload<T extends CborValue>(
  payload: T,
  keypair: Keypair,
): Promise<SignedPayload<T>> {
  const signature = keypair.sign(canonicalBytes(payload));
  return {payload, signer: keypair.publicKey(), signature};
}

/**
 * Verifies that a {@link SignedPayload}'s signature is valid for its signer over
 * its payload. Re-canonicalizes the payload, so any change to it after signing
 * is detected as a failure. Never throws for a bad signature — returns `false`.
 */
export async function verifyPayload<T extends CborValue>(
  p: SignedPayload<T>,
): Promise<boolean> {
  return p.signer.verify(canonicalBytes(p.payload), p.signature);
}

export type {CborValue} from './cbor';
export type {Keypair, PublicKey, Signature} from './ffi';
