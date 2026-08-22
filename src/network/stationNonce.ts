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
 *
 * The read-modify-write is over a genuinely async store, so two overlapping
 * callers (e.g. a background poll firing while the user sends) could otherwise
 * both load the same high-water mark, both compute the same `+1`, and both send
 * it — the station accepts the first and rejects the second as a replay. Every
 * mutation therefore runs through {@link withLock}, a single in-process promise
 * chain, so reservations can never interleave and no value is ever handed out
 * twice.
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
 * The tail of the serialization chain. Every nonce mutation appends to it, so an
 * operation's load→modify→persist runs to completion before the next one starts,
 * even when callers overlap. A rejected op does not poison the chain: the `catch`
 * keeps the tail resolved so later reservations still proceed.
 */
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  // Keep the chain alive regardless of this op's outcome; the caller still sees
  // the real result/rejection through `run`.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Reserves and returns the next nonce for the station at `address` (the previous
 * high-water mark + 1, starting at 1), persisting it **before** the caller sends
 * the request. Burning it up front means a failed send skips a nonce rather than
 * risking reuse of one the station may already have accepted.
 */
export function nextNonce(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<number> {
  return withLock(async () => {
    const map = await load(store);
    const next = (map[address] ?? 0) + 1;
    map[address] = next;
    await persist(map, store);
    return next;
  });
}

/**
 * Forgets the nonce counter for `address` — called when unpairing, so a later
 * re-pair starts the window cleanly from 1 (matching the station's reset).
 */
export function clearNonce(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  return withLock(async () => {
    const map = await load(store);
    if (!(address in map)) {
      return;
    }
    delete map[address];
    await persist(map, store);
  });
}
