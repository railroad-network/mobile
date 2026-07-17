/**
 * Wires the real uniffi-generated native bindings into the crypto seam
 * ({@link registerRrnCryptoFfi}) at app startup.
 *
 * The generated bindings speak `ArrayBuffer` for bytes, `Map` for records, and
 * `bigint` for 64-bit integers; the app-facing seam ({@link ./ffi}) speaks
 * `Uint8Array`, `Record`, and `number`. This adapter is the single place those
 * representations are marshalled — every returned handle is wrapped so its
 * methods convert at the boundary. There is still exactly one implementation of
 * the crypto (the Rust one); this only reshapes it.
 *
 * Called from the native entry point (`index.js`), never from tests — tests
 * register their own in-memory fake. Importing this module pulls in the
 * generated barrel, which installs the Rust crate into Hermes.
 */
import * as gen from '../index';

import {
  registerRrnCryptoFfi,
  type EncryptedWallet,
  type Hash,
  type Keypair,
  type PublicKey,
  type RecoveryPackage,
  type RrnCryptoFfi,
  type Signature,
  type WalletContents,
} from './ffi';

// --- byte marshalling -------------------------------------------------------

const toU8 = (bytes: ArrayBuffer): Uint8Array => new Uint8Array(bytes);
// `slice()` always allocates a fresh, exactly-sized ArrayBuffer, so this is
// correct even for a Uint8Array that is a subarray view of a larger buffer.
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.slice().buffer as ArrayBuffer;

// Handles that must be handed back to the native side later (verify against a
// signature, seal/split a wallet) need their underlying native object. Keyed
// weakly so wrappers stay garbage-collectable.
const nativeSignature = new WeakMap<Signature, gen.SignatureLike>();
const nativeWallet = new WeakMap<WalletContents, gen.WalletContentsLike>();

// --- handle wrappers --------------------------------------------------------

function wrapSignature(signature: gen.SignatureLike): Signature {
  const wrapped: Signature = {toBytes: () => toU8(signature.toBytes())};
  nativeSignature.set(wrapped, signature);
  return wrapped;
}

function wrapPublicKey(publicKey: gen.PublicKeyLike): PublicKey {
  return {
    toBytes: () => toU8(publicKey.toBytes()),
    toAddress: () => publicKey.toAddress(),
    verify: (message, signature) => {
      const native = nativeSignature.get(signature);
      if (native === undefined) {
        throw new Error('verify: signature is not a native FFI handle');
      }
      return publicKey.verify(toArrayBuffer(message), native);
    },
    seal: plaintext => toU8(publicKey.seal(toArrayBuffer(plaintext))),
  };
}

function wrapKeypair(keypair: gen.KeypairLike): Keypair {
  return {
    publicKey: () => wrapPublicKey(keypair.publicKey()),
    sign: message => wrapSignature(keypair.sign(toArrayBuffer(message))),
    open: sealedBox => toU8(keypair.open(toArrayBuffer(sealedBox))),
  };
}

function wrapHash(hash: gen.HashLike): Hash {
  return {toBytes: () => toU8(hash.toBytes()), toHex: () => hash.toHex()};
}

function wrapWalletContents(contents: gen.WalletContentsLike): WalletContents {
  const wrapped: WalletContents = {
    publicKey: () => wrapPublicKey(contents.publicKey()),
    address: () => contents.address(),
    createdAt: () => Number(contents.createdAt()),
    metadata: () => Object.fromEntries(contents.metadata()),
    keypair: () => wrapKeypair(contents.keypair()),
  };
  nativeWallet.set(wrapped, contents);
  return wrapped;
}

function wrapEncryptedWallet(wallet: gen.EncryptedWalletLike): EncryptedWallet {
  return {
    decrypt: passphrase => wrapWalletContents(wallet.decrypt(passphrase)),
    toBytes: () => toU8(wallet.toBytes()),
  };
}

function wrapRecoveryPackage(pkg: gen.RecoveryPackageLike): RecoveryPackage {
  return {
    threshold: () => pkg.threshold(),
    total: () => pkg.total(),
    shardCount: () => pkg.shardCount(),
    shardPayload: index => toU8(pkg.shardPayload(index)),
  };
}

// --- the seam implementation ------------------------------------------------

const nativeFfi: RrnCryptoFfi = {
  Keypair: {generate: () => wrapKeypair(gen.Keypair.generate())},
  PublicKey: {
    fromBytes: data => wrapPublicKey(gen.PublicKey.fromBytes(toArrayBuffer(data))),
    fromAddress: address => wrapPublicKey(gen.PublicKey.fromAddress(address)),
  },
  Signature: {
    fromBytes: data => wrapSignature(gen.Signature.fromBytes(toArrayBuffer(data))),
  },
  Hash: {of: data => wrapHash(gen.Hash.of(toArrayBuffer(data)))},
  isValidAddress: address => gen.isValidAddress(address),
  canonicalBytes: payloadJson => toU8(gen.canonicalBytes(payloadJson)),
  WalletContents: {createNew: () => wrapWalletContents(gen.WalletContents.createNew())},
  EncryptedWallet: {
    encrypt: (contents, passphrase) => {
      const native = nativeWallet.get(contents);
      if (native === undefined) {
        throw new Error('encrypt: contents is not a native FFI handle');
      }
      return wrapEncryptedWallet(gen.EncryptedWallet.encrypt(native, passphrase));
    },
    fromBytes: data =>
      wrapEncryptedWallet(gen.EncryptedWallet.fromBytes(toArrayBuffer(data))),
  },
  RecoveryPackage: {
    create: (wallet, holderAddresses, threshold) => {
      const native = nativeWallet.get(wallet);
      if (native === undefined) {
        throw new Error('RecoveryPackage.create: wallet is not a native FFI handle');
      }
      return wrapRecoveryPackage(
        gen.RecoveryPackage.create(native, holderAddresses, threshold),
      );
    },
  },
  parseShardPayload: payload => {
    const info = gen.parseShardPayload(toArrayBuffer(payload));
    return {
      originalAddress: info.originalAddress,
      holderAddress: info.holderAddress,
      threshold: info.threshold,
      total: info.total,
    };
  },
};

/** Registers the native bindings as the app's crypto FFI. Call once at startup. */
export function registerNativeRrnCryptoFfi(): void {
  registerRrnCryptoFfi(nativeFfi);
}
