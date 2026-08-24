/**
 * The durable crash log (crash surfacing).
 *
 * A pilot user needs a crash report to survive the crash — including a restart,
 * a force-close, or a fatal exception that tears the process down a beat later —
 * so reports are persisted, not just held in memory. The app has one persistence
 * backend, {@link crypto/SecureStore} (keychain-backed JSON KV), and this is its
 * file-equivalent here: a small ring under {@link SecureStoreKeys.CRASH_LOG}.
 *
 * Two rules shape everything below:
 *
 *  1. **Diagnostics must never become the crash.** Every function swallows its
 *     own errors — a keychain read that fails, malformed stored JSON — and
 *     degrades to an empty log rather than throwing. A crash reporter that can
 *     itself throw (from the global handler, no less) would be worse than none.
 *
 *  2. **Bounded, newest-wins.** The ring is capped at {@link MAX_ENTRIES}; a
 *     runaway error loop can only ever cost that many slots, and the oldest are
 *     dropped first. Records are stored oldest→newest; readers newest-first.
 *
 * Writes are serialized through an in-process lock (mirroring
 * {@link network/stationNonce}) because two producers — the error boundary and
 * the global handler — can fire near-simultaneously, and each append is a
 * load→modify→persist that would otherwise clobber the other.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';
import {makeCrashReport, type CrashKind, type CrashReport} from './crashReport';

/** How many reports the ring keeps. A handful is plenty to diagnose a pilot. */
export const MAX_ENTRIES = 20;

/** Reads and parses the stored ring, degrading to `[]` on any failure. */
async function load(store: SecureStore): Promise<CrashReport[]> {
  try {
    const bytes = await store.load(SecureStoreKeys.CRASH_LOG);
    if (bytes === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(bytesToUtf8(bytes));
    return Array.isArray(parsed) ? (parsed as CrashReport[]) : [];
  } catch {
    // A corrupt or unreadable log is not worth propagating — start fresh.
    return [];
  }
}

async function persist(reports: CrashReport[], store: SecureStore): Promise<void> {
  await store.save(
    SecureStoreKeys.CRASH_LOG,
    utf8ToBytes(JSON.stringify(reports)),
    {requireBiometric: false},
  );
}

/**
 * Serialization tail: each mutation appends to it so its load→modify→persist
 * completes before the next begins. A rejected op does not poison the chain.
 */
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op, op);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Appends a captured failure to the ring, trimming to the newest {@link
 * MAX_ENTRIES}. Never throws: a persistence failure is logged to the console and
 * swallowed, because the caller is usually already handling a crash.
 */
export function recordCrash(
  report: CrashReport,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  return withLock(async () => {
    try {
      const existing = await load(store);
      const next = [...existing, report].slice(-MAX_ENTRIES);
      await persist(next, store);
    } catch (e) {
      // Last line of defence — diagnostics must not surface their own failure.
      console.warn('[crashLog] failed to record crash', e);
    }
  });
}

/**
 * Convenience wrapper: build a report from a thrown value and record it in one
 * call. Used by the global handler where only the raw error is in hand.
 */
export function recordError(
  kind: CrashKind,
  err: unknown,
  extra?: {componentStack?: string},
  store: SecureStore = getSecureStore(),
): Promise<void> {
  return recordCrash(makeCrashReport(kind, err, extra), store);
}

/** Returns the stored reports newest-first. Never throws. */
export function loadCrashLog(
  store: SecureStore = getSecureStore(),
): Promise<CrashReport[]> {
  return withLock(async () => {
    const reports = await load(store);
    return [...reports].reverse();
  });
}

/** Empties the log. Never throws. */
export function clearCrashLog(
  store: SecureStore = getSecureStore(),
): Promise<void> {
  return withLock(async () => {
    try {
      await store.delete(SecureStoreKeys.CRASH_LOG);
    } catch (e) {
      console.warn('[crashLog] failed to clear crash log', e);
    }
  });
}
