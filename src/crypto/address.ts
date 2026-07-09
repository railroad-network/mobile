/**
 * Address parsing and display (M1.1 T1.1.3).
 *
 * Addresses are bech32m `rrn1…` strings. Every operation here delegates to the
 * Rust `rrn_identity::address` implementation via the FFI — mobile does **not**
 * carry its own bech32 implementation. Two implementations would be two sources
 * of truth and, eventually, a divergence bug; the station's Rust is the one
 * source (ADR-0003). Same public key → same address string, byte-for-byte, on
 * both platforms.
 */
import {getRrnCryptoFfi, type PublicKey} from './ffi';

/** Why an address string failed to parse. */
export interface ParseError {
  kind: 'invalid-address';
  /** Human-readable detail from the Rust parser (not for branching on). */
  message: string;
}

/** Renders a public key as its bech32m `rrn1…` address. */
export function publicKeyToAddress(pk: PublicKey): string {
  return pk.toAddress();
}

/**
 * Parses a `rrn1…` address into the public key it encodes, or returns a
 * {@link ParseError} if the string is not a valid address (bad checksum, wrong
 * prefix, wrong length, or not a valid curve point).
 */
export function parseAddress(s: string): PublicKey | {error: ParseError} {
  try {
    return getRrnCryptoFfi().PublicKey.fromAddress(s);
  } catch (e) {
    return {
      error: {
        kind: 'invalid-address',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/** Whether `s` is a well-formed address. Never throws. */
export function isValidAddress(s: string): boolean {
  return getRrnCryptoFfi().isValidAddress(s);
}

export type {PublicKey} from './ffi';
