/**
 * The seam between the app's TypeScript and the Rust crypto core.
 *
 * The Rust `rrn-crypto` / `rrn-identity` code runs on-device through
 * `uniffi-bindgen-react-native` (ADR-0007). That generator produces the real
 * `Keypair` / `PublicKey` / `Signature` / `Hash` classes and the
 * `isValidAddress` function; this module declares the *contract* those bindings
 * satisfy and provides a registration point for them.
 *
 * Why a seam rather than importing the generated module directly:
 *   1. App code (`address.ts`, `sign.ts`, …) depends on this stable interface,
 *      not on the generated file's exact path or import mechanics.
 *   2. The generated bindings are a native module — they cannot load under Jest
 *      (Node). Tests register an in-memory implementation via
 *      {@link registerRrnCryptoFfi}; production registers the generated module.
 *
 * These are type *declarations*, not a second implementation: there remains
 * exactly one implementation of the crypto — the Rust one. The declarations
 * exist so the mobile code type-checks before the native bindings are wired,
 * and the generated classes structurally satisfy them.
 */

/** Opaque handle to an Ed25519 public key (a native object). */
export interface PublicKey {
  toBytes(): Uint8Array;
  /** The bech32m `rrn1…` address for this key. */
  toAddress(): string;
  verify(message: Uint8Array, signature: Signature): boolean;
}

/** Opaque handle to an Ed25519 signature. */
export interface Signature {
  toBytes(): Uint8Array;
}

/** Opaque handle to an Ed25519 keypair; the secret seed stays in Rust. */
export interface Keypair {
  publicKey(): PublicKey;
  sign(message: Uint8Array): Signature;
}

/** Opaque handle to a Blake3 hash. */
export interface Hash {
  toBytes(): Uint8Array;
  toHex(): string;
}

/**
 * The native module surface. Mirrors the shape uniffi generates: static
 * constructors grouped under each type, plus free functions. Fallible
 * constructors (`fromBytes`, `fromAddress`) throw on invalid input.
 */
export interface RrnCryptoFfi {
  Keypair: {generate(): Keypair};
  PublicKey: {
    fromBytes(data: Uint8Array): PublicKey;
    fromAddress(address: string): PublicKey;
  };
  Signature: {fromBytes(data: Uint8Array): Signature};
  Hash: {of(data: Uint8Array): Hash};
  isValidAddress(address: string): boolean;
}

let registered: RrnCryptoFfi | null = null;

/**
 * Registers the FFI implementation. Called once at app startup with the
 * generated native bindings, and in tests with an in-memory fake.
 */
export function registerRrnCryptoFfi(ffi: RrnCryptoFfi): void {
  registered = ffi;
}

/** Returns the registered FFI implementation, or throws if none is wired. */
export function getRrnCryptoFfi(): RrnCryptoFfi {
  if (registered === null) {
    throw new Error(
      'rrn crypto FFI not registered — call registerRrnCryptoFfi() with the ' +
        'uniffi-generated bindings at startup (or an in-memory fake in tests)',
    );
  }
  return registered;
}
