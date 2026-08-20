/**
 * A tiny observable of station reachability, fed by the subscribe long-poll and
 * read by {@link useConnectivity}.
 *
 * Why this exists: connectivity used to run its *own* `whoami` probe on a timer,
 * which competed with the subscribe loop for the single HTTP/1.1 connection. On
 * a cold connection pool the probe lost that race and timed out, flipping the
 * header to "offline" for ~30–60s after launch even though the app was fine —
 * a visible flap. The subscribe loop is already the app's persistent connection
 * to the station, so its round-trips *are* the reachability signal: if a
 * subscribe pass succeeds we're online; if one fails (not an abort) we're
 * offline. Reusing that signal removes the competing probe and the flap.
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

let state: Reachability = 'unknown';
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
 * Clears the verdict back to `unknown` — call when the subscription tears down
 * (station change, or the wallet locking) so a stale `unreachable` doesn't
 * linger into the next session.
 */
export function resetReachability(): void {
  setReachability('unknown');
}

/** Subscribes to changes; returns an unsubscribe function. */
export function subscribeReachability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
