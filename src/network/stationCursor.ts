/**
 * Per-station push-event cursor for the subscribe long-poll (T1.3.5).
 *
 * The station derives a member's events straight from its append-only log and
 * remembers nothing about delivery — the *phone* holds the cursor. Each subscribe
 * sends the highest event id (a log seq) it has processed as `last_seen_event_id`;
 * the station returns only newer events. Persisting the cursor through
 * {@link SecureStore} means a restart resumes where it left off — catching up on
 * events that arrived while the app was closed rather than replaying from zero or
 * missing them. This is the delivery bookmark the "no event is lost" guarantee
 * rests on (see the station's `events.rs`).
 *
 * It is not secret (a log position reveals nothing), so it is stored without a
 * biometric gate, like {@link network/stationNonce}. A fresh station (or a lost
 * record) reads as 0, and the station simply returns the member's whole backlog.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** The stored shape: station address → highest processed event id. */
type CursorMap = Record<string, number>;

async function load(store: SecureStore): Promise<CursorMap> {
  const bytes = await store.load(SecureStoreKeys.STATION_CURSORS);
  if (bytes === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(bytesToUtf8(bytes)) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    // Keep only well-formed integer entries; a corrupt record must not wedge the
    // subscription (worst case is replaying some already-seen events, which the
    // handlers absorb idempotently).
    const out: CursorMap = {};
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

async function persist(map: CursorMap, store: SecureStore): Promise<void> {
  await store.save(SecureStoreKeys.STATION_CURSORS, utf8ToBytes(JSON.stringify(map)), {
    requireBiometric: false,
  });
}

/**
 * The last event id this device has processed for the station at `address`, or 0
 * if it has never subscribed (the station then returns the whole backlog).
 */
export async function getCursor(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<number> {
  const map = await load(store);
  return map[address] ?? 0;
}

/**
 * Advances the stored cursor for `address` to `value`. Monotonic: a lower value
 * is ignored, so an out-of-order or stale write can never rewind the bookmark and
 * cause events to be re-delivered indefinitely.
 */
export async function setCursor(
  address: string,
  value: number,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  if (!Number.isSafeInteger(value) || value < 0) {
    return;
  }
  const map = await load(store);
  if ((map[address] ?? 0) >= value) {
    return;
  }
  map[address] = value;
  await persist(map, store);
}

/**
 * Forgets the cursor for `address` — called when unpairing, so a later pairing
 * starts from a clean bookmark.
 */
export async function clearCursor(
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
