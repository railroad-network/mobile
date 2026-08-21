/**
 * A tiny observable of station reachability, fed by the subscribe long-poll and
 * read by {@link useConnectivity}.
 *
 * Why this exists: connectivity used to run its *own* `whoami` probe on a timer,
 * which competed with the subscribe loop for the single HTTP/1.1 connection. On
 * a cold connection pool the probe lost that race and timed out, flipping the
 * header to "offline" for ~30–60s after launch even though the app was fine —
 * a visible flap. The subscribe loop is already the app's persistent connection
 * to the station, so its round-trips *are* the reachability signal: a good
 * subscribe pass is online; a failed one (not an abort) is offline. Reusing that
 * signal removes the competing probe and the flap.
 *
 * One nuance the raw signal needs: a long-poll re-opens its connection every
 * ~30s, and OkHttp readily drops an idle keep-alive socket, so the first
 * re-subscribe on a stale one can fail *once* and succeed immediately on retry.
 * Reporting offline on that single blip flapped the pill. So {@link reportPass}
 * debounces: a good pass is online at once, but it takes
 * {@link OFFLINE_AFTER_CONSECUTIVE_FAILURES} failures *in a row* — a real outage,
 * not a blip — to show offline. (This is the tolerance the old `whoami` probe had
 * via `retry: 2`, restored on the connection-derived path.)
 *
 * The store is a plain subscribe/getState pair (the `useSyncExternalStore`
 * shape, like {@link DiscoverySession}), so it's testable without a renderer.
 */

/**
 * `unknown` — no verdict yet (before the first subscribe round-trip, or after a
 * teardown). Treated as online-optimistic by the reader, so warm-up never
 * flashes "offline". `reachable` / `unreachable` are the confirmed states.
 */
export type Reachability = 'unknown' | 'reachable' | 'unreachable';

/**
 * How many subscribe passes must fail *in a row* before the verdict goes
 * `unreachable`. Absorbs the single stale-socket blip on re-subscribe; a genuine
 * outage fails every pass, so it still shows offline within a pass or two.
 */
export const OFFLINE_AFTER_CONSECUTIVE_FAILURES = 2;

let state: Reachability = 'unknown';
let consecutiveFailures = 0;
const listeners = new Set<() => void>();

/** The current reachability. */
export function getReachability(): Reachability {
  return state;
}

/** Sets reachability, notifying subscribers only on an actual change. */
export function setReachability(next: Reachability): void {
  if (next === state) {
    return;
  }
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Reports the outcome of one subscribe pass, debouncing failures so a lone
 * reconnect blip doesn't flap the pill. A reachable pass is online immediately
 * and clears the failure run; an unreachable pass only shows offline once
 * {@link OFFLINE_AFTER_CONSECUTIVE_FAILURES} have failed in a row — until then
 * the prior verdict stands (optimistically online on a first blip).
 */
export function reportPass(reachable: boolean): void {
  if (reachable) {
    consecutiveFailures = 0;
    setReachability('reachable');
    return;
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= OFFLINE_AFTER_CONSECUTIVE_FAILURES) {
    setReachability('unreachable');
  }
}

/**
 * Clears the verdict back to `unknown` — call when the subscription tears down
 * (station change, or the wallet locking) so a stale `unreachable` doesn't
 * linger into the next session. Also clears the failure run, so the next
 * session's first blip is judged fresh.
 */
export function resetReachability(): void {
  consecutiveFailures = 0;
  setReachability('unknown');
}

/** Subscribes to changes; returns an unsubscribe function. */
export function subscribeReachability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
