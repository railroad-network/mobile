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
 * Opaque handle to a decrypted wallet's contents: one identity plus metadata.
 * The secret seed never crosses this boundary — signing is reached through
 * {@link WalletContents.keypair}, which keeps the secret inside Rust.
 */
export interface WalletContents {
  publicKey(): PublicKey;
  /** The bech32m `rrn1…` address of this identity. */
  address(): string;
  /** Unix seconds when the identity was created. */
  createdAt(): number;
  /** Arbitrary, non-secret user metadata. */
  metadata(): Record<string, string>;
  /** The keypair for this identity, for signing. Secret stays in Rust. */
  keypair(): Keypair;
}

/**
 * Opaque handle to a sealed wallet. {@link EncryptedWallet.toBytes} is the
 * canonical-CBOR `.rrnwallet` file content.
 */
export interface EncryptedWallet {
  /** Opens the wallet; throws (wallet error) on wrong passphrase or tampering. */
  decrypt(passphrase: string): WalletContents;
  toBytes(): Uint8Array;
}

/**
 * Non-secret metadata read off a distributable recovery shard payload (T1.2.3),
 * for a holder's receive flow.
 */
export interface ShardInfo {
  /** The `rrn1…` address of the identity this shard helps recover — the key the
   * holder app files the payload under. */
  originalAddress: string;
  /** The `rrn1…` address this shard is sealed to; the receiver can check it
   * matches their own identity ("is this shard for me?"). */
  holderAddress: string;
  /** `K` — how many holders must cooperate to reconstruct. */
  threshold: number;
  /** `N` — how many holders the secret was split across. */
  total: number;
}

/**
 * Opaque handle to a social-recovery package: `N` shards of the wallet secret,
 * each sealed to a holder, any `K` of which reconstruct the identity. The
 * package's secret material never crosses this boundary — only the per-holder
 * sealed shard payloads, read out one at a time via {@link shardPayload}.
 */
export interface RecoveryPackage {
  /** `K` — decrypted shards required to reconstruct. */
  threshold(): number;
  /** `N` — total shards / holders. */
  total(): number;
  /** The number of sealed shards (equals {@link total}); valid indices for
   * {@link shardPayload} are `0..shardCount`. */
  shardCount(): number;
  /**
   * The self-contained, distributable payload for the shard at `index`
   * (canonical CBOR of the sealed shard plus routing metadata). The holder
   * scans this (e.g. as a QR) and stores it. Throws (recovery error) if `index`
   * is outside `0..shardCount`.
   */
  shardPayload(index: number): Uint8Array;
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
  /**
   * Serializes a signed-payload value to canonical dCBOR bytes (T1.1.7). The
   * argument is the tagged-value model as a JSON string (see `cbor.ts`); throws
   * (payload error) on a float or a malformed node. The bytes are byte-identical
   * to what the station produces, so a signature over them verifies there.
   */
  canonicalBytes(payloadJson: string): Uint8Array;
  WalletContents: {createNew(): WalletContents};
  EncryptedWallet: {
    /** Seals `contents` under `passphrase`; throws (wallet error) on failure. */
    encrypt(contents: WalletContents, passphrase: string): EncryptedWallet;
    /** Parses `.rrnwallet` bytes; throws if they are not a valid wallet file. */
    fromBytes(data: Uint8Array): EncryptedWallet;
  };
  RecoveryPackage: {
    /**
     * Splits `wallet`'s secret into one sealed shard per entry in
     * `holderAddresses`, requiring `threshold` (`K`) of the holders (`N`) to
     * reconstruct. Each holder address is a bech32m `rrn1…` string. Throws
     * (recovery error) on an invalid holder address or bad split parameters
     * (`K` must satisfy `2 <= K <= N <= 16`).
     */
    create(
      wallet: WalletContents,
      holderAddresses: string[],
      threshold: number,
    ): RecoveryPackage;
  };
  /**
   * Reads the non-secret routing metadata off a distributable shard payload
   * (the bytes from {@link RecoveryPackage.shardPayload}), for a holder's
   * receive flow. Does not decrypt the shard. Throws (recovery error) if the
   * bytes are not a valid payload.
   */
  parseShardPayload(payload: Uint8Array): ShardInfo;
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
