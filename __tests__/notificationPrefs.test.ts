/**
 * @format
 *
 * Notification preferences (T1.3.6): defaults, the master gate, per-kind flags,
 * persistence, and corruption tolerance.
 */
import type {SecureStore} from '../src/crypto/SecureStore';
import {utf8ToBytes} from '../src/crypto/utf8';
import {SecureStoreKeys} from '../src/crypto/constants';
import {
  DEFAULT_PREFS,
  clearPrefs,
  getPrefs,
  kindEnabled,
  setBackgroundSyncEnabled,
  setKindEnabled,
  setNotificationsEnabled,
  shouldNotify,
} from '../src/notifications/notificationPrefs';

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

describe('notificationPrefs', () => {
  test('defaults when nothing stored: master on, bg off, proposal+settlement on', async () => {
    const store = new MemStore();
    const prefs = await getPrefs(store);
    expect(prefs.notificationsEnabled).toBe(true);
    expect(prefs.backgroundSyncEnabled).toBe(false);
    expect(kindEnabled(prefs, 'proposal_received')).toBe(true);
    expect(kindEnabled(prefs, 'settlement')).toBe(true);
    expect(kindEnabled(prefs, 'confirmation_received')).toBe(false);
    expect(kindEnabled(prefs, 'cancellation')).toBe(false);
  });

  test('shouldNotify honours defaults', async () => {
    const prefs = await getPrefs(new MemStore());
    expect(shouldNotify(prefs, 'proposal_received')).toBe(true);
    expect(shouldNotify(prefs, 'confirmation_received')).toBe(false);
  });

  test('master off suppresses even a kind that is on', async () => {
    const store = new MemStore();
    await setNotificationsEnabled(false, store);
    const prefs = await getPrefs(store);
    expect(shouldNotify(prefs, 'proposal_received')).toBe(false);
  });

  test('per-kind toggle overrides the default and persists', async () => {
    const store = new MemStore();
    await setKindEnabled('confirmation_received', true, store);
    await setKindEnabled('proposal_received', false, store);
    const prefs = await getPrefs(store);
    expect(shouldNotify(prefs, 'confirmation_received')).toBe(true);
    expect(shouldNotify(prefs, 'proposal_received')).toBe(false);
  });

  test('background-sync flag round-trips independently', async () => {
    const store = new MemStore();
    await setBackgroundSyncEnabled(true, store);
    expect((await getPrefs(store)).backgroundSyncEnabled).toBe(true);
    await setBackgroundSyncEnabled(false, store);
    expect((await getPrefs(store)).backgroundSyncEnabled).toBe(false);
  });

  test('a corrupt record reads as defaults', async () => {
    const store = new MemStore();
    await store.save(SecureStoreKeys.NOTIFICATION_PREFS, utf8ToBytes('{not json'));
    const prefs = await getPrefs(store);
    expect(prefs).toEqual({...DEFAULT_PREFS, kinds: {}});
  });

  test('clear removes the record', async () => {
    const store = new MemStore();
    await setNotificationsEnabled(false, store);
    await clearPrefs(store);
    expect(await store.has(SecureStoreKeys.NOTIFICATION_PREFS)).toBe(false);
    // Reads back as defaults.
    expect((await getPrefs(store)).notificationsEnabled).toBe(true);
  });

  test('non-boolean kind entries are dropped on read', async () => {
    const store = new MemStore();
    await store.save(
      SecureStoreKeys.NOTIFICATION_PREFS,
      utf8ToBytes(JSON.stringify({notificationsEnabled: true, kinds: {proposal_received: 'yes'}})),
    );
    const prefs = await getPrefs(store);
    // Falls back to the built-in default (true) since the bad entry was dropped.
    expect(kindEnabled(prefs, 'proposal_received')).toBe(true);
  });
});
