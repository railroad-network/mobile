/**
 * The mobile wallet: one identity, sealed as a `.rrnwallet` file (M1.1 T1.1.5).
 *
 * The file format — a canonical-CBOR envelope whose secret is sealed with
 * XChaCha20-Poly1305 under an argon2id key (M0.3.3) — lives entirely in the
 * Rust `rrn_identity::wallet` code, reached here through the uniffi FFI. Mobile
 * does **not** reimplement encryption, key derivation, or the CBOR layout, so a
 * wallet created on mobile opens on the station and vice versa (proven by
 * `__tests__/fixtures/cross_platform_wallet.json`).
 *
 * Two layers of protection guard the secret at rest:
 *   1. **Passphrase** — the `.rrnwallet` bytes are encrypted; without the
 *      passphrase they are opaque.
 *   2. **Keychain / Keystore** — those bytes are then stored in the OS secure
 *      store ({@link SecureStore}) under {@link SecureStoreKeys.WALLET_FILE}, so
 *      other apps cannot even read the ciphertext.
 *
 * All operations are `async`: FFI may run on a worker thread, and SecureStore is
 * inherently asynchronous.
 */
import {
  getRrnCryptoFfi,
  type EncryptedWallet,
  type PublicKey,
  type RecoveryPackage,
  type Signature,
  type WalletContents,
} from '../crypto/ffi';
import {bytesToBase64} from '../crypto/base64';
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {loadProfile, saveProfile} from './profile';

/**
 * An opened, in-memory wallet. Wraps the FFI {@link WalletContents} handle; the
 * secret seed stays in Rust and is never exposed here.
 */
export class Wallet {
  /**
   * The underlying FFI handle. Internal to this module (consumed by
   * {@link saveWalletToBytes}); not part of the public surface.
   * @internal
   */
  readonly contents: WalletContents;

  private constructor(contents: WalletContents) {
    this.contents = contents;
  }

  /** @internal Wraps a raw FFI handle. */
  static fromContents(contents: WalletContents): Wallet {
    return new Wallet(contents);
  }

  /** The bech32m `rrn1…` address of this identity. */
  get address(): string {
    return this.contents.address();
  }

  /** This identity's public key. */
  publicKey(): PublicKey {
    return this.contents.publicKey();
  }

  /** Unix seconds when the identity was created. */
  createdAt(): number {
    return this.contents.createdAt();
  }

  /** Arbitrary, non-secret user metadata. */
  metadata(): Record<string, string> {
    return this.contents.metadata();
  }

  /** Signs `message` with this identity. The secret never leaves Rust. */
  async sign(message: Uint8Array): Promise<Signature> {
    return this.contents.keypair().sign(message);
  }

  /**
   * Splits this identity's secret into a social-recovery package (T1.2.3):
   * one sealed shard per `holderAddresses` entry, any `threshold` (`K`) of
   * which reconstruct the identity. The split runs entirely in Rust — no shard
   * or secret material crosses into JS. Rejects (recovery error) on an invalid
   * holder address or bad parameters (`2 <= K <= N <= 16`).
   */
  async createRecoveryPackage(
    holderAddresses: string[],
    threshold: number,
  ): Promise<RecoveryPackage> {
    return getRrnCryptoFfi().RecoveryPackage.create(
      this.contents,
      holderAddresses,
      threshold,
    );
  }
}

/** Options for {@link createWallet}. */
export interface CreateWalletOptions {
  /**
   * Gate reads of the stored wallet behind biometric authentication. Defaults
   * to `true`; set `false` when the user declines biometrics during onboarding.
   * The passphrase layer protects the bytes either way — biometrics only guard
   * retrieval of the (already encrypted) `.rrnwallet` blob from the keychain.
   */
  requireBiometric?: boolean;
}

/**
 * Creates a brand-new identity and persists it, sealed under `passphrase`, to
 * the OS secure store. Returns the opened wallet.
 *
 * @param store overridable for tests; defaults to the process-wide SecureStore.
 */
export async function createWallet(
  passphrase: string,
  store: SecureStore = getSecureStore(),
  options: CreateWalletOptions = {},
): Promise<Wallet> {
  const wallet = Wallet.fromContents(getRrnCryptoFfi().WalletContents.createNew());
  const bytes = await saveWalletToBytes(wallet, passphrase);
  await store.save(SecureStoreKeys.WALLET_FILE, bytes, {
    requireBiometric: options.requireBiometric,
  });
  return wallet;
}

/**
 * Opens a wallet from its `.rrnwallet` bytes. Rejects with the FFI wallet error
 * if the passphrase is wrong or the bytes are corrupt/tampered.
 */
export async function loadWalletFromBytes(
  bytes: Uint8Array,
  passphrase: string,
): Promise<Wallet> {
  const sealed: EncryptedWallet =
    getRrnCryptoFfi().EncryptedWallet.fromBytes(bytes);
  return Wallet.fromContents(sealed.decrypt(passphrase));
}

/**
 * Seals `wallet` under `passphrase` and returns the `.rrnwallet` bytes. A fresh
 * salt and nonce are used each call, so the bytes differ every time (the
 * identity inside does not).
 */
export async function saveWalletToBytes(
  wallet: Wallet,
  passphrase: string,
): Promise<Uint8Array> {
  const sealed = getRrnCryptoFfi().EncryptedWallet.encrypt(
    wallet.contents,
    passphrase,
  );
  return sealed.toBytes();
}

/**
 * Loads and opens the persisted wallet from the OS secure store, or returns
 * `null` if none has been created on this device. Rejects if a wallet exists
 * but the passphrase is wrong.
 */
export async function loadWallet(
  passphrase: string,
  store: SecureStore = getSecureStore(),
): Promise<Wallet | null> {
  const bytes = await store.load(SecureStoreKeys.WALLET_FILE);
  if (bytes === null) {
    return null;
  }
  return loadWalletFromBytes(bytes, passphrase);
}

/** Whether a wallet has been persisted on this device. No biometric prompt. */
export async function hasWallet(
  store: SecureStore = getSecureStore(),
): Promise<boolean> {
  return store.has(SecureStoreKeys.WALLET_FILE);
}

/**
 * Re-encrypts the stored wallet under `newPassphrase` (T1.2.8 change passphrase).
 * The `oldPassphrase` is verified first by opening the wallet — a wrong old
 * passphrase rejects with the FFI wallet error and nothing is written. The new
 * bytes keep the current biometric gate.
 */
export async function changePassphrase(
  oldPassphrase: string,
  newPassphrase: string,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const wallet = await loadWallet(oldPassphrase, store);
  if (wallet === null) {
    throw new Error('No wallet on this device.');
  }
  const {biometricEnabled = true} = await loadProfile(store);
  const bytes = await saveWalletToBytes(wallet, newPassphrase);
  await store.save(SecureStoreKeys.WALLET_FILE, bytes, {
    requireBiometric: biometricEnabled,
  });
}

/**
 * Turns biometric unlock on or off (T1.2.8). Re-stores the *unchanged* encrypted
 * wallet bytes with the new keychain access control, and records the preference.
 * Reading the current bytes may itself prompt for biometrics if they are gated.
 */
export async function setBiometricUnlock(
  enabled: boolean,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const bytes = await store.load(SecureStoreKeys.WALLET_FILE);
  if (bytes === null) {
    throw new Error('No wallet on this device.');
  }
  await store.save(SecureStoreKeys.WALLET_FILE, bytes, {requireBiometric: enabled});
  await saveProfile({biometricEnabled: enabled}, store);
}

/**
 * Produces the exportable `.rrnwallet` bytes as base64, for transferring the
 * identity to another device (T1.2.8). The passphrase is required and verified
 * (the export is still passphrase-encrypted — it is the same sealed format).
 */
export async function exportWalletBytes(
  passphrase: string,
  store: SecureStore = getSecureStore(),
): Promise<string> {
  const wallet = await loadWallet(passphrase, store);
  if (wallet === null) {
    throw new Error('No wallet on this device.');
  }
  return bytesToBase64(await saveWalletToBytes(wallet, passphrase));
}

/**
 * Factory reset (T1.2.8): erases every wallet-scoped entry from the secure store
 * — the wallet file, recovery config, held shards, pairing token, and local
 * profile. Irreversible; without a recovery circle the identity is gone. The
 * caller then refreshes the wallet session to return to onboarding.
 */
export async function factoryReset(
  store: SecureStore = getSecureStore(),
): Promise<void> {
  await Promise.all(Object.values(SecureStoreKeys).map(key => store.delete(key)));
}
