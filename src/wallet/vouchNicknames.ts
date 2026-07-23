/**
 * Local labels for the people this wallet has vouched for (T1.4.5).
 *
 * When you vouch for someone you can type a nickname for them ("mom", "the guy
 * from the market"). That label is a **private display hint** — it is
 * deliberately *not* part of the signed vouch attestation (which federates and
 * reaches the subject's station), so it stays on this device only. This module
 * persists it, keyed by the subject's `rrn1…` address, so the vouching browser
 * can render a human name instead of a bare address for a vouch you made.
 *
 * Stored through {@link SecureStore} (the app's one persistence backend) without
 * a biometric gate, as a JSON `{ [subjectAddress]: nickname }` map encoded to
 * UTF-8 bytes — mirroring {@link wallet/recoveryConfig}. Nothing here is secret.
 * Because it is device-local it does not survive a wallet restore on a new
 * device; a station-side store could add that durability later (see the
 * planning notes) but is out of scope now.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** A map of subject `rrn1…` address → the local nickname for that person. */
export type VouchNicknames = Record<string, string>;

/**
 * Loads the saved nickname map, or `{}` if none is stored (or the blob is
 * unreadable — treated as empty rather than crashing the caller).
 */
export async function loadVouchNicknames(
  store: SecureStore = getSecureStore(),
): Promise<VouchNicknames> {
  const bytes = await store.load(SecureStoreKeys.VOUCH_NICKNAMES);
  if (bytes === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(bytesToUtf8(bytes)) as unknown;
    return isNicknameMap(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Records `nickname` for `subjectAddress`, merging into the existing map. A
 * blank nickname removes any existing label rather than storing an empty one
 * (the browser then falls back to a shortened address).
 */
export async function saveVouchNickname(
  subjectAddress: string,
  nickname: string,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const map = await loadVouchNicknames(store);
  const trimmed = nickname.trim();
  if (trimmed.length > 0) {
    map[subjectAddress] = trimmed;
  } else {
    delete map[subjectAddress];
  }
  const bytes = utf8ToBytes(JSON.stringify(map));
  // Non-secret display hints: no biometric prompt when the browser reads them.
  await store.save(SecureStoreKeys.VOUCH_NICKNAMES, bytes, {
    requireBiometric: false,
  });
}

/** Narrows parsed JSON to a string→string map. */
function isNicknameMap(value: unknown): value is VouchNicknames {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(v => typeof v === 'string')
  );
}
