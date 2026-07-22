/**
 * Local notification preferences (T1.3.6).
 *
 * Three things live here, all user-controlled from the Notifications settings
 * screen:
 *   - `notificationsEnabled` — the master switch. Off = no local notifications
 *     at all, whatever the per-kind flags say.
 *   - `backgroundSyncEnabled` — the opt-in that provisions a background signing
 *     credential (see {@link network/backgroundCredential}) so the app can drain
 *     events and notify while backgrounded/killed. Default off: without it the
 *     app can only catch up (and notify) on the next foreground open.
 *   - `kinds` — a per-event-kind allow map. Only the four kinds with a live source
 *     in M1.3 are meaningful; the rest arrive with later milestones.
 *
 * Defaults (decided with the user): notify on `proposal_received` (needs the user
 * to act), `settlement` (money settled), and `vouch_received` (rare and socially
 * meaningful — someone staked reputation on you); stay quiet on
 * `confirmation_received` and `cancellation` (informational, visible in-app). The
 * master switch defaults on so enabling background sync alone is enough to get
 * the intended alerts.
 *
 * Persisted through {@link SecureStore} like {@link network/stationCursor}: these
 * are preferences, not secrets, so they are stored without a biometric gate. A
 * missing or corrupt record reads as the defaults.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';
import type {StationEventKind} from '../network/StationClient';

/** The event kinds a user can toggle a notification for today (live sources). */
export const NOTIFIABLE_KINDS: readonly StationEventKind[] = [
  'proposal_received',
  'confirmation_received',
  'settlement',
  'cancellation',
  'vouch_received',
];

/** Per-kind notification allow map. */
export type KindPrefs = Partial<Record<StationEventKind, boolean>>;

/** The full preferences shape. */
export interface NotificationPrefs {
  /** Master switch. Off suppresses everything. */
  notificationsEnabled: boolean;
  /** Opt-in background sync (provisions the background credential). */
  backgroundSyncEnabled: boolean;
  /** Per-kind allow flags; a kind absent from the map falls back to its default. */
  kinds: KindPrefs;
}

/** Per-kind defaults: proposal + settlement + vouch on, the rest off. */
const DEFAULT_KINDS: Record<StationEventKind, boolean> = {
  proposal_received: true,
  confirmation_received: false,
  settlement: true,
  cancellation: false,
  vouch_received: true,
  listing_match: false,
  governance_proposal: false,
  vote_needed: false,
};

/** The defaults applied when nothing is stored yet. */
export const DEFAULT_PREFS: NotificationPrefs = {
  notificationsEnabled: true,
  backgroundSyncEnabled: false,
  kinds: {},
};

/**
 * Whether a notification for `kind` should fire under `prefs`. The master switch
 * gates everything; otherwise the per-kind flag wins, falling back to the kind's
 * built-in default when the user has not set it.
 */
export function shouldNotify(prefs: NotificationPrefs, kind: StationEventKind): boolean {
  if (!prefs.notificationsEnabled) {
    return false;
  }
  return prefs.kinds[kind] ?? DEFAULT_KINDS[kind] ?? false;
}

/** The effective per-kind value shown in the UI (stored flag or the default). */
export function kindEnabled(prefs: NotificationPrefs, kind: StationEventKind): boolean {
  return prefs.kinds[kind] ?? DEFAULT_KINDS[kind] ?? false;
}

/**
 * Loads the stored preferences, or the defaults if none are stored. A corrupt
 * record is treated as absent so a bad write can never wedge notifications.
 */
export async function getPrefs(store: SecureStore = getSecureStore()): Promise<NotificationPrefs> {
  const bytes = await store.load(SecureStoreKeys.NOTIFICATION_PREFS);
  if (bytes === null) {
    return {...DEFAULT_PREFS, kinds: {}};
  }
  try {
    const parsed = JSON.parse(bytesToUtf8(bytes)) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return {...DEFAULT_PREFS, kinds: {}};
    }
    const raw = parsed as Record<string, unknown>;
    const kinds: KindPrefs = {};
    if (typeof raw.kinds === 'object' && raw.kinds !== null) {
      for (const [k, v] of Object.entries(raw.kinds as Record<string, unknown>)) {
        if (typeof v === 'boolean') {
          kinds[k as StationEventKind] = v;
        }
      }
    }
    return {
      notificationsEnabled:
        typeof raw.notificationsEnabled === 'boolean'
          ? raw.notificationsEnabled
          : DEFAULT_PREFS.notificationsEnabled,
      backgroundSyncEnabled:
        typeof raw.backgroundSyncEnabled === 'boolean'
          ? raw.backgroundSyncEnabled
          : DEFAULT_PREFS.backgroundSyncEnabled,
      kinds,
    };
  } catch {
    return {...DEFAULT_PREFS, kinds: {}};
  }
}

async function persist(prefs: NotificationPrefs, store: SecureStore): Promise<void> {
  await store.save(SecureStoreKeys.NOTIFICATION_PREFS, utf8ToBytes(JSON.stringify(prefs)), {
    requireBiometric: false,
  });
}

/** Overwrites the master switch. */
export async function setNotificationsEnabled(
  enabled: boolean,
  store: SecureStore = getSecureStore(),
): Promise<NotificationPrefs> {
  const prefs = await getPrefs(store);
  const next = {...prefs, notificationsEnabled: enabled};
  await persist(next, store);
  return next;
}

/** Overwrites the background-sync opt-in. Provisioning the credential is separate. */
export async function setBackgroundSyncEnabled(
  enabled: boolean,
  store: SecureStore = getSecureStore(),
): Promise<NotificationPrefs> {
  const prefs = await getPrefs(store);
  const next = {...prefs, backgroundSyncEnabled: enabled};
  await persist(next, store);
  return next;
}

/** Sets the allow flag for one event kind. */
export async function setKindEnabled(
  kind: StationEventKind,
  enabled: boolean,
  store: SecureStore = getSecureStore(),
): Promise<NotificationPrefs> {
  const prefs = await getPrefs(store);
  const next = {...prefs, kinds: {...prefs.kinds, [kind]: enabled}};
  await persist(next, store);
  return next;
}

/** Forgets all preferences (factory reset). */
export async function clearPrefs(store: SecureStore = getSecureStore()): Promise<void> {
  await store.delete(SecureStoreKeys.NOTIFICATION_PREFS);
}
