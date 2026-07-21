/**
 * One background drain pass (T1.3.6).
 *
 * Invoked by the OS background-fetch scheduler (see {@link registerBackgroundFetch})
 * while the app is backgrounded or killed. It authenticates with the opt-in
 * background credential (there is no in-memory wallet in a headless process),
 * pulls any events the paired station has queued since this device's cursor, and
 * raises a local notification for each one the user's preferences allow — then
 * advances the cursor and returns. Unlike the foreground loop
 * ({@link stationSubscription}) it does exactly one short pass: a background task
 * has a tight, OS-imposed budget, so the subscribe wait is capped and an idle
 * station simply yields nothing this time.
 *
 * Every dependency is injectable so the drain is unit-testable without native
 * modules, a real wallet, or a real station.
 */
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {getNotifier, type Notifier} from '../notifications/Notifications';
import {buildEventNotification} from '../notifications/eventNotification';
import {getPrefs} from '../notifications/notificationPrefs';
import {loadBackgroundCredential} from './backgroundCredential';
import {loadPairedStations, type PairedStation} from './pairedStation';
import {getCursor, setCursor} from './stationCursor';
import {StationClient, type StationEvent} from './StationClient';
import type {Wallet} from '../wallet/Wallet';

/** The subset of {@link StationClient} the drain uses. */
export interface SubscribeClient {
  subscribe(
    lastSeenEventId: number,
    options?: {signal?: AbortSignal},
  ): Promise<{lastSeenEventId: number; events: StationEvent[]}>;
}

/** Injectable seams; all default to the real modules. */
export interface BackgroundSyncDeps {
  store?: SecureStore;
  /** The notification backend (defaults to the registered notifier). */
  notifier?: Notifier | null;
  /** Loads the background signing wallet. */
  loadCredential?: (store: SecureStore) => Promise<Wallet | null>;
  /** Loads the paired stations. */
  loadStations?: () => Promise<PairedStation[]>;
  /** Builds a client for a wallet + station address. */
  makeClient?: (wallet: Wallet, address: string) => SubscribeClient;
  /** How long to hold the subscribe before giving up this pass. */
  timeoutMs?: number;
  /** External abort (e.g. the OS reclaiming the task). */
  signal?: AbortSignal;
}

/** Default cap on the subscribe wait — short, to fit a background budget. */
const DEFAULT_TIMEOUT_MS = 8_000;

/** The outcome of a drain pass, for logging/tests. */
export interface BackgroundSyncResult {
  /** Why the pass did nothing, or `null` if it ran. */
  skipped: 'disabled' | 'no-credential' | 'no-station' | 'error' | null;
  /** Events received this pass. */
  received: number;
  /** Notifications displayed this pass. */
  notified: number;
}

/**
 * Runs one background drain pass. Never throws — a background task must always
 * finish cleanly — so failures resolve with `skipped: 'error'`.
 */
export async function runBackgroundSync(deps: BackgroundSyncDeps = {}): Promise<BackgroundSyncResult> {
  const store = deps.store ?? getSecureStore();
  const notifier = deps.notifier !== undefined ? deps.notifier : getNotifier();
  const loadCredential = deps.loadCredential ?? loadBackgroundCredential;
  const loadStations = deps.loadStations ?? loadPairedStations;
  const makeClient =
    deps.makeClient ?? ((wallet, address) => new StationClient(wallet, address));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const prefs = await getPrefs(store);
    if (!prefs.backgroundSyncEnabled) {
      return {skipped: 'disabled', received: 0, notified: 0};
    }

    const wallet = await loadCredential(store);
    if (wallet === null) {
      // Not provisioned, or the device is locked (keychain unreadable).
      return {skipped: 'no-credential', received: 0, notified: 0};
    }

    const stations = await loadStations();
    if (stations.length === 0) {
      return {skipped: 'no-station', received: 0, notified: 0};
    }
    const station = stations[0];

    const client = makeClient(wallet, station.address);
    const lastSeen = await getCursor(station.address, store);

    // Best-effort cap on the wait, combined with any external abort the scheduler
    // passes. NOTE: JS timers are throttled/suspended in the background execution
    // context, so this setTimeout is unreliable there — the real bounds are the
    // station's own subscribe hold (≤30s, returns a heartbeat) and the OS task
    // budget (which finishes and reschedules the job). The cursor is only advanced
    // on a real reply, so an aborted/killed pass simply retries next wake.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    deps.signal?.addEventListener('abort', onExternalAbort, {once: true});

    let events: StationEvent[];
    let newCursor: number;
    try {
      const reply = await client.subscribe(lastSeen, {signal: controller.signal});
      events = reply.events;
      newCursor = reply.lastSeenEventId;
    } finally {
      clearTimeout(timer);
      deps.signal?.removeEventListener('abort', onExternalAbort);
    }

    let notified = 0;
    for (const event of events) {
      const content = buildEventNotification(event, prefs);
      if (content !== null && notifier !== null) {
        await notifier.display(content);
        notified += 1;
      }
    }

    await setCursor(station.address, newCursor, store);
    return {skipped: null, received: events.length, notified};
  } catch {
    // Any failure (unreachable station, aborted wait, malformed reply) ends the
    // pass quietly; the cursor is untouched so the next wake retries.
    return {skipped: 'error', received: 0, notified: 0};
  }
}
