/**
 * Local device preferences (T1.2.8): the user's chosen nickname and whether
 * biometric unlock is on. Both are device-local and non-secret — the nickname
 * never leaves the phone, and the biometric flag only mirrors how the wallet
 * file is gated in the keychain. Persisted through {@link SecureStore} (the
 * app's one persistence backend) as JSON, without a biometric gate.
 *
 * The nickname read here is also merged into the ledger identity (`useLedger`'s
 * `useIdentity`), so editing it in Settings updates the name shown on Home.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** Device-local preferences. */
export interface Profile {
  /** The user's local nickname. Never leaves the device. */
  nickname?: string;
  /** Whether biometric unlock is enabled (mirrors the wallet file's keychain gate). */
  biometricEnabled?: boolean;
}

/** Loads the stored preferences, or `{}` if none (or the blob is unreadable). */
export async function loadProfile(store: SecureStore = getSecureStore()): Promise<Profile> {
  const bytes = await store.load(SecureStoreKeys.PROFILE);
  if (bytes === null) {
    return {};
  }
  try {
    return JSON.parse(bytesToUtf8(bytes)) as Profile;
  } catch {
    return {};
  }
}

/** Merges `patch` into the stored preferences (a shallow update). */
export async function saveProfile(
  patch: Profile,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const next = {...(await loadProfile(store)), ...patch};
  await store.save(SecureStoreKeys.PROFILE, utf8ToBytes(JSON.stringify(next)), {
    requireBiometric: false,
  });
}
