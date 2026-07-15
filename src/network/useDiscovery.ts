/**
 * React binding for {@link DiscoverySession}.
 *
 * The session is a plain object with a subscribe/getState pair, which is
 * exactly what `useSyncExternalStore` wants — so this file is only glue. All
 * the behaviour worth testing lives in `Discovery.ts` and is tested without a
 * renderer.
 */
import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react';

import {DiscoverySession, type DiscoveryState} from './Discovery';

export interface UseDiscovery {
  state: DiscoveryState;
  /** Restarts the browse — the "Try again" affordance after an error. */
  restart: () => void;
}

/**
 * Browses for stations for as long as the calling component is mounted.
 *
 * Starting on mount is not laziness: on iOS, starting a browse *is* the local
 * network permission request. There is no API to ask ahead of time, so the
 * prompt appears when the user opens the screen that needs it, which is also
 * the only moment it makes sense to them.
 */
export function useDiscovery(): UseDiscovery {
  // Not `useMemo`: constructing the session reaches into native, and useMemo is
  // not a guarantee. A ref built once is.
  const ref = useRef<DiscoverySession | null>(null);
  if (ref.current === null) {
    ref.current = new DiscoverySession();
  }
  const session = ref.current;

  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(listener),
    [session],
  );
  const getSnapshot = useCallback(() => session.getState(), [session]);

  const state = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    session.start();
    // Stop on unmount: a live browse holds a socket and keeps the radio busy,
    // and nobody is looking at the results any more.
    return () => session.stop();
  }, [session]);

  const restart = useCallback(() => session.start(), [session]);

  return {state, restart};
}
