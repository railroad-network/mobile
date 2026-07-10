/**
 * Content hashing (M1.1 T1.1.6).
 *
 * Blake3 over arbitrary bytes, delegating to the Rust `rrn_crypto::hash`
 * implementation via the FFI — mobile does **not** carry its own Blake3. The
 * same input produces the same 32-byte hash on mobile and station alike; the
 * station generates the reference vectors that `__tests__/ffi_invariants.test.ts`
 * checks this wrapper against.
 */
import {getRrnCryptoFfi, type Hash} from './ffi';

/** Hashes `data` with Blake3, returning an opaque {@link Hash} handle. */
export function hash(data: Uint8Array): Hash {
  return getRrnCryptoFfi().Hash.of(data);
}

/** The 32 raw bytes of the Blake3 hash of `data`. */
export function hashBytes(data: Uint8Array): Uint8Array {
  return hash(data).toBytes();
}

/** The lowercase hex of the Blake3 hash of `data`. */
export function hashHex(data: Uint8Array): string {
  return hash(data).toHex();
}

export type {Hash} from './ffi';
