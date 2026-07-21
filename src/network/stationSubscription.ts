/**
 * The subscribe long-poll loop (T1.3.5).
 *
 * Drives {@link StationClient.subscribe} in a loop so the phone learns of ledger
 * events — a proposal to it, its proposal confirmed, a settlement, a
 * cancellation — within ~1s of them happening, instead of waiting for the next
 * poll or manual refresh. Each pass sends the persisted {@link getCursor cursor},
 * dispatches whatever events come back, advances the cursor, and immediately
 * re-subscribes. A reachability failure backs off (capped exponential) and
 * retries; an abort (the app backgrounding, the wallet locking, unmount) stops
 * the loop and cancels any in-flight poll.
 *
 * The loop is deliberately transport-only: it does not touch React or the query
 * cache itself. The caller passes an `onEvent` handler — in the app that
 * invalidates the ledger queries so Home/History refetch; in tests it just
 * records — which keeps this unit testable with a fake client and fake timers.
 */
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {getCursor, setCursor} from './stationCursor';
import {StationClient, StationClientError, type StationEvent} from './StationClient';

/** Backoff bounds for reconnecting after the station is unreachable. */
export interface Backoff {
  /** First wait after a failure (ms). */
  baseMs: number;
  /** Ceiling the wait doubles up to (ms). */
  maxMs: number;
}

const DEFAULT_BACKOFF: Backoff = {baseMs: 1_000, maxMs: 30_000};

/** Everything the loop needs, all injectable for tests. */
export interface SubscriptionOptions {
  /** Aborts the loop and any in-flight poll. */
  signal: AbortSignal;
  /** Cursor persistence. Defaults to the process secure store. */
  store?: SecureStore;
  /** Reconnect backoff bounds. */
  backoff?: Backoff;
  /** Called for each event, in order (dispatch to local handlers). */
  onEvent: (event: StationEvent) => void;
  /** Called when a subscribe pass fails (before backing off). Optional. */
  onError?: (error: unknown) => void;
  /** Abortable delay, injectable so tests can drive it with fake timers. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Runs the subscribe loop for one paired station until `signal` aborts. Resolves
 * when the loop stops (always via the abort); never rejects — transport failures
 * are handled internally with backoff.
 */
export async function runSubscription(
  client: StationClient,
  stationAddress: string,
  options: SubscriptionOptions,
): Promise<void> {
  const {signal, onEvent, onError} = options;
  const store = options.store ?? getSecureStore();
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? abortableSleep;

  let wait = backoff.baseMs;
  while (!signal.aborted) {
    try {
      const lastSeen = await getCursor(stationAddress, store);
      const {lastSeenEventId, events} = await client.subscribe(lastSeen, {signal});
      if (signal.aborted) {
        break;
      }
      for (const event of events) {
        onEvent(event);
      }
      await setCursor(stationAddress, lastSeenEventId, store);
      // A good round-trip resets the backoff and re-subscribes immediately.
      wait = backoff.baseMs;
    } catch (error) {
      if (signal.aborted) {
        break;
      }
      // An abort surfaces as a fetch error; do not treat it as a failure.
      if (isAbortError(error)) {
        break;
      }
      onError?.(error);
      await sleep(wait, signal);
      wait = Math.min(wait * 2, backoff.maxMs);
    }
  }
}

/** Whether an error is an abort (from our own AbortController), not a real fault. */
function isAbortError(error: unknown): boolean {
  if (error instanceof StationClientError) {
    // A caller-driven abort turns the fetch into an `unreachable` with an
    // AbortError message; the `signal.aborted` checks above catch the common
    // case, this is the belt-and-braces.
    return /abort/i.test(error.message);
  }
  return error instanceof Error && error.name === 'AbortError';
}

/** A `setTimeout` delay that resolves early (and cleans up) when `signal` aborts. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, {once: true});
  });
}
