/**
 * @format
 *
 * The background drain pass (T1.3.6). Exercises the guards (disabled, no
 * credential, no station), the notify-per-preference behaviour, cursor advance,
 * and the always-finishes-cleanly contract — all with injected fakes, no native.
 */
import type {SecureStore} from '../src/crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../src/crypto/utf8';
import {SecureStoreKeys} from '../src/crypto/constants';
import type {Notifier, NotificationContent} from '../src/notifications/Notifications';
import type {NotificationPrefs} from '../src/notifications/notificationPrefs';
import {runBackgroundSync, type SubscribeClient} from '../src/network/backgroundSync';
import type {StationEvent, StationEventKind, StationTransactionRow} from '../src/network/StationClient';
import type {PairedStation} from '../src/network/pairedStation';
import type {Wallet} from '../src/wallet/Wallet';

class MemStore implements SecureStore {
  readonly map = new Map<string, Uint8Array>();
  async save(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value);
  }
  async load(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

function withPrefs(store: MemStore, prefs: Partial<NotificationPrefs>): void {
  store.map.set(
    SecureStoreKeys.NOTIFICATION_PREFS,
    utf8ToBytes(
      JSON.stringify({notificationsEnabled: true, backgroundSyncEnabled: true, kinds: {}, ...prefs}),
    ),
  );
}

function row(over: Partial<StationTransactionRow> = {}): StationTransactionRow {
  return {
    id: 'tx',
    counterparty_address: 'rrn1counterpartyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    direction: 'in',
    amount_centi: 500,
    state: 'pending',
    timestamp: 1_700_000_000,
    nonce: 0,
    ...over,
  };
}

function event(id: number, kind: StationEventKind): StationEvent {
  return {id, kind, transaction: row()};
}

const station: PairedStation = {address: 'rrn1station', host: '10.0.0.5', port: 7500, pairedAt: 1};
const fakeWallet = {address: 'rrn1self'} as unknown as Wallet;

function collectingNotifier(): {notifier: Notifier; shown: NotificationContent[]} {
  const shown: NotificationContent[] = [];
  return {
    shown,
    notifier: {
      requestPermission: async () => true,
      ensureChannel: async () => {},
      display: async (c: NotificationContent) => {
        shown.push(c);
      },
    },
  };
}

/** Base deps with an enabled pref, a credential, one station, and a client. */
function baseDeps(store: MemStore, client: SubscribeClient, notifier: Notifier) {
  return {
    store,
    notifier,
    loadCredential: async () => fakeWallet,
    loadStations: async () => [station],
    makeClient: () => client,
  };
}

describe('runBackgroundSync', () => {
  test('skips when background sync is disabled', async () => {
    const store = new MemStore();
    withPrefs(store, {backgroundSyncEnabled: false});
    const {notifier, shown} = collectingNotifier();
    const client: SubscribeClient = {
      subscribe: jest.fn(async () => ({lastSeenEventId: 0, events: []})),
    };
    const res = await runBackgroundSync(baseDeps(store, client, notifier));
    expect(res.skipped).toBe('disabled');
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
  });

  test('skips when no credential is provisioned', async () => {
    const store = new MemStore();
    withPrefs(store, {});
    const {notifier} = collectingNotifier();
    const client: SubscribeClient = {subscribe: jest.fn(async () => ({lastSeenEventId: 0, events: []}))};
    const res = await runBackgroundSync({
      ...baseDeps(store, client, notifier),
      loadCredential: async () => null,
    });
    expect(res.skipped).toBe('no-credential');
    expect(client.subscribe).not.toHaveBeenCalled();
  });

  test('skips when no station is paired', async () => {
    const store = new MemStore();
    withPrefs(store, {});
    const {notifier} = collectingNotifier();
    const client: SubscribeClient = {subscribe: jest.fn(async () => ({lastSeenEventId: 0, events: []}))};
    const res = await runBackgroundSync({
      ...baseDeps(store, client, notifier),
      loadStations: async () => [],
    });
    expect(res.skipped).toBe('no-station');
  });

  test('notifies only for allowed kinds and advances the cursor', async () => {
    const store = new MemStore();
    withPrefs(store, {}); // defaults: proposal + settlement on, confirmation off
    const {notifier, shown} = collectingNotifier();
    const client: SubscribeClient = {
      subscribe: async (lastSeen: number) => {
        expect(lastSeen).toBe(0); // fresh cursor
        return {
          lastSeenEventId: 12,
          events: [event(10, 'proposal_received'), event(11, 'confirmation_received'), event(12, 'settlement')],
        };
      },
    };
    const res = await runBackgroundSync(baseDeps(store, client, notifier));
    expect(res.skipped).toBeNull();
    expect(res.received).toBe(3);
    // proposal + settlement notify; confirmation is off by default.
    expect(res.notified).toBe(2);
    expect(shown.map(s => s.title)).toEqual(['Incoming payment', 'Payment settled']);
    // Cursor advanced to the highest event id.
    const cursorRaw = store.map.get(SecureStoreKeys.STATION_CURSORS);
    expect(cursorRaw).toBeDefined();
    expect(JSON.parse(bytesToUtf8(cursorRaw!))[station.address]).toBe(12);
  });

  test('sends the persisted cursor and stays quiet on an empty drain', async () => {
    const store = new MemStore();
    withPrefs(store, {});
    store.map.set(SecureStoreKeys.STATION_CURSORS, utf8ToBytes(JSON.stringify({[station.address]: 5})));
    const {notifier, shown} = collectingNotifier();
    const client: SubscribeClient = {
      subscribe: async (lastSeen: number) => {
        expect(lastSeen).toBe(5);
        return {lastSeenEventId: 5, events: []};
      },
    };
    const res = await runBackgroundSync(baseDeps(store, client, notifier));
    expect(res.skipped).toBeNull();
    expect(res.received).toBe(0);
    expect(shown).toHaveLength(0);
  });

  test('a subscribe failure ends the pass cleanly and leaves the cursor', async () => {
    const store = new MemStore();
    withPrefs(store, {});
    store.map.set(SecureStoreKeys.STATION_CURSORS, utf8ToBytes(JSON.stringify({[station.address]: 3})));
    const {notifier} = collectingNotifier();
    const client: SubscribeClient = {
      subscribe: async () => {
        throw new Error('unreachable');
      },
    };
    const res = await runBackgroundSync(baseDeps(store, client, notifier));
    expect(res.skipped).toBe('error');
    // Cursor untouched.
    expect(JSON.parse(bytesToUtf8(store.map.get(SecureStoreKeys.STATION_CURSORS)!))[station.address]).toBe(3);
  });

  test('master-off suppresses notifications but still advances the cursor', async () => {
    const store = new MemStore();
    withPrefs(store, {notificationsEnabled: false});
    const {notifier, shown} = collectingNotifier();
    const client: SubscribeClient = {
      subscribe: async () => ({lastSeenEventId: 9, events: [event(9, 'proposal_received')]}),
    };
    const res = await runBackgroundSync(baseDeps(store, client, notifier));
    expect(res.skipped).toBeNull();
    expect(res.notified).toBe(0);
    expect(shown).toHaveLength(0);
    expect(JSON.parse(bytesToUtf8(store.map.get(SecureStoreKeys.STATION_CURSORS)!))[station.address]).toBe(9);
  });
});
