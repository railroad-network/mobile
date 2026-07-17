/**
 * Per-station request nonces for the authenticated channel (T1.3.4).
 *
 * Every request a mobile sends over the channel carries a nonce that must be
 * **strictly greater** than the last the station saw from it; the station
 * rejects anything else as a replay (see the station's `paired.rs`). So the
 * mobile must remember the highest nonce it has used for each station and never
 * reuse one — across app restarts included, or the first request after a restart
 * would collide with a burned nonce and be refused.
 *
 * This is a monotonic counter keyed by station address, persisted through
 * {@link SecureStore}. It is not secret (a counter reveals nothing), so it is
 * stored without a biometric gate, like {@link network/pairedStation}. The
 * counter resets implicitly when a station is re-paired: the station resets its
 * high-water mark to 0 on a fresh pair, and a re-pair that also clears this
 * device's stored nonce (or simply a value that stays ahead) keeps the two in
 * step. To stay safe under races, {@link nextNonce} reads, increments, and
 * writes before the request is sent — a nonce is burned even if the request then
 * fails, which only ever *skips* a value (allowed), never reuses one.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** The stored shape: station address → highest nonce sent. */
type NonceMap = Record<string, number>;

async function load(store: SecureStore): Promise<NonceMap> {
  const bytes = await store.load(SecureStoreKeys.STATION_NONCES);
  if (bytes === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(bytesToUtf8(bytes)) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    // Keep only well-formed integer entries; a corrupt record must not wedge
    // sending (worst case a nonce is re-tried and the station refuses it once).
    const out: NonceMap = {};
    for (const [addr, n] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) {
        out[addr] = n;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function persist(map: NonceMap, store: SecureStore): Promise<void> {
  await store.save(SecureStoreKeys.STATION_NONCES, utf8ToBytes(JSON.stringify(map)), {
    requireBiometric: false,
  });
}

/**
 * Reserves and returns the next nonce for the station at `address` (the previous
 * high-water mark + 1, starting at 1), persisting it **before** the caller sends
 * the request. Burning it up front means a failed send skips a nonce rather than
 * risking reuse of one the station may already have accepted.
 */
export async function nextNonce(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<number> {
  const map = await load(store);
  const next = (map[address] ?? 0) + 1;
  map[address] = next;
  await persist(map, store);
  return next;
}

/**
 * Forgets the nonce counter for `address` — called when unpairing, so a later
 * re-pair starts the window cleanly from 1 (matching the station's reset).
 */
export async function clearNonce(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const map = await load(store);
  if (!(address in map)) {
    return;
  }
  delete map[address];
  await persist(map, store);
}
