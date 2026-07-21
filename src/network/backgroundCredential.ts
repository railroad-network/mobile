/**
 * The opt-in background signing credential (T1.3.6).
 *
 * The authenticated `/subscribe` request (T1.3.4) must be signed with the
 * mobile's key, which normally requires the passphrase-decrypted, in-memory
 * wallet — unavailable to a headless background task running in a fresh process.
 * To let background sync authenticate while the app is closed, the user can opt
 * in (Settings → Notifications → Background sync). When they do, we re-encrypt
 * the wallet under a fresh random secret and store the blob *and* that secret at
 * device-unlock accessibility (no biometric gate), so the background task can
 * reconstruct a signing wallet without any passphrase prompt.
 *
 * The wallet secret still never leaves Rust: {@link saveWalletToBytes} produces a
 * standard `.rrnwallet` envelope sealed under the random secret, exactly like the
 * primary blob but with a machine-generated passphrase this module holds. The
 * random secret is 32 CSPRNG bytes from a throwaway keypair (the same source the
 * pairing token uses — no separate JS RNG, staying true to ADR-0003).
 *
 * Trade-off (accepted, opt-in, documented in the threat model): the pair is a
 * full-power signing wallet retrievable from the keychain by the app process
 * whenever the device screen is unlocked. It is device-bound
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) and never provisioned unless the user opts
 * in. A future station-issued read-only token would tighten this.
 */
import {getRrnCryptoFfi} from '../crypto/ffi';
import {SecureStoreKeys} from '../crypto/constants';
import {bytesToHex} from '../crypto/hex';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';
import {loadWalletFromBytes, saveWalletToBytes, type Wallet} from '../wallet/Wallet';

/** 32 CSPRNG bytes as a hex secret — the same source the pairing token uses. */
function generateSecret(): string {
  return bytesToHex(getRrnCryptoFfi().Keypair.generate().publicKey().toBytes());
}

/**
 * Re-encrypts `wallet` under a fresh random secret and persists the blob + secret
 * at device-unlock accessibility for background use. Overwrites any existing
 * credential. Requires the unlocked wallet (call from a foregrounded, unlocked
 * session).
 */
export async function provisionBackgroundCredential(
  wallet: Wallet,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const secret = generateSecret();
  const blob = await saveWalletToBytes(wallet, secret);
  await store.save(SecureStoreKeys.BG_SYNC_BLOB, blob, {requireBiometric: false});
  await store.save(SecureStoreKeys.BG_SYNC_SECRET, utf8ToBytes(secret), {
    requireBiometric: false,
  });
}

/**
 * Reconstructs the background signing wallet, or `null` if no credential is
 * provisioned (or the device is locked, making the keychain items unreadable).
 * Never throws — a background task treats a null as "cannot sync right now".
 */
export async function loadBackgroundCredential(
  store: SecureStore = getSecureStore(),
): Promise<Wallet | null> {
  try {
    const blob = await store.load(SecureStoreKeys.BG_SYNC_BLOB);
    const secretBytes = await store.load(SecureStoreKeys.BG_SYNC_SECRET);
    if (blob === null || secretBytes === null) {
      return null;
    }
    return await loadWalletFromBytes(blob, bytesToUtf8(secretBytes));
  } catch {
    return null;
  }
}

/** Whether a background credential is currently provisioned. */
export async function hasBackgroundCredential(
  store: SecureStore = getSecureStore(),
): Promise<boolean> {
  return (await store.has(SecureStoreKeys.BG_SYNC_BLOB)) &&
    (await store.has(SecureStoreKeys.BG_SYNC_SECRET));
}

/**
 * Removes the background credential. Called when the user turns background sync
 * off, on factory reset, and when the last station is unpaired.
 */
export async function clearBackgroundCredential(
  store: SecureStore = getSecureStore(),
): Promise<void> {
  await store.delete(SecureStoreKeys.BG_SYNC_BLOB);
  await store.delete(SecureStoreKeys.BG_SYNC_SECRET);
}
