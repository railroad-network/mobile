/**
 * Signing and verification (M1.1 T1.1.4).
 *
 * The actual sign-and-verify path on mobile. Both operations delegate to the
 * Rust `rrn_crypto::keypair` implementation via the FFI — mobile does **not**
 * carry its own Ed25519. Ed25519 signing is deterministic (RFC 8032 §5.1.6), so
 * the same keypair and message produce the same 64-byte signature on mobile and
 * station alike; the station generates the reference vectors that
 * `__tests__/sign.test.ts` checks these wrappers against.
 *
 * The functions are `async` even though the current FFI returns synchronously:
 * some platforms run FFI work on a worker thread, and callers should not have to
 * change shape if that becomes the case. Keep the surface minimal — there is one
 * way to sign and one way to verify, nothing else.
 */
import {getRrnCryptoFfi, type Keypair, type PublicKey, type Signature} from './ffi';

/** Signs `message` with `keypair`, producing a detached signature. */
export async function sign(
  keypair: Keypair,
  message: Uint8Array,
): Promise<Signature> {
  return keypair.sign(message);
}

/**
 * Verifies a detached signature over `message` against `pk`. Never throws — a
 * bad signature, the wrong key, or the wrong message all resolve to `false`.
 */
export async function verify(
  pk: PublicKey,
  message: Uint8Array,
  sig: Signature,
): Promise<boolean> {
  return pk.verify(message, sig);
}

/** Generates a fresh keypair from the OS CSPRNG (via the Rust core). */
export function generateKeypair(): Keypair {
  return getRrnCryptoFfi().Keypair.generate();
}

export type {Keypair, PublicKey, Signature} from './ffi';
