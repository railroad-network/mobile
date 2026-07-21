/**
 * Wires {@link runBackgroundSync} into the OS background scheduler (T1.3.6).
 *
 * The only file that imports `react-native-background-fetch` — kept out of the
 * Jest environment (the pure drain in {@link backgroundSync} is what tests
 * exercise). Called once from `index.js`:
 *   - `configure` schedules periodic wakes (min 15 min; the OS throttles tighter
 *     requests) that run while the app is backgrounded but alive, and registers a
 *     timeout callback so a slow pass still finishes its task id.
 *   - `registerHeadlessTask` (Android) handles wakes after the app is killed, in
 *     a fresh JS context — which is exactly why background sync needs the
 *     persisted credential rather than an in-memory wallet.
 *
 * `runBackgroundSync` never throws and returns quickly, but each entry point
 * still calls `finish(taskId)` in a `finally` — not finishing a task is what gets
 * an app's background privileges revoked by the OS.
 */
import BackgroundFetch from 'react-native-background-fetch';

import {runBackgroundSync} from './backgroundSync';

/** Android headless entry: runs after the app has been killed. */
async function headlessTask(event: {taskId: string; timeout: boolean}): Promise<void> {
  const {taskId, timeout} = event;
  if (timeout) {
    BackgroundFetch.finish(taskId);
    return;
  }
  try {
    await runBackgroundSync();
  } finally {
    BackgroundFetch.finish(taskId);
  }
}

/** Configures periodic background sync and registers the killed-app handler. */
export function registerBackgroundFetch(): void {
  // Killed-app wakes (Android). Registered before configure, at startup.
  BackgroundFetch.registerHeadlessTask(headlessTask);

  BackgroundFetch.configure(
    {
      minimumFetchInterval: 15, // minutes; the OS is free to space these out further
      stopOnTerminate: false,
      startOnBoot: true,
      enableHeadless: true,
      requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
    },
    async (taskId: string) => {
      // Foreground-scheduled wake (app still alive).
      try {
        await runBackgroundSync();
      } finally {
        BackgroundFetch.finish(taskId);
      }
    },
    async (taskId: string) => {
      // The OS signalled this task is out of time.
      BackgroundFetch.finish(taskId);
    },
  );
}
