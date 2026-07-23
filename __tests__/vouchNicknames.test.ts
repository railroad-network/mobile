/**
 * @format
 *
 * The vouch nickname store (T1.4.5) persists private, device-only labels for
 * the people a member has vouched for, keyed by subject address. It must
 * round-trip (including unicode), merge new labels in, drop a label on a blank
 * nickname, save without a biometric gate, and degrade to `{}` rather than
 * throwing on a missing or unreadable blob.
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore, SaveOptions} from '../src/crypto/SecureStore';
import {loadVouchNicknames, saveVouchNickname} from '../src/wallet/vouchNicknames';

/** An in-memory SecureStore capturing the last save options. */
class FakeStore implements SecureStore {
  private data = new Map<string, Uint8Array>();
  lastSaveOptions: SaveOptions | undefined;

  async save(key: string, value: Uint8Array, options?: SaveOptions): Promise<void> {
    this.lastSaveOptions = options;
    this.data.set(key, value);
  }
  async load(key: string): Promise<Uint8Array | null> {
    return this.data.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  /** Test-only: plant raw bytes under the nicknames key. */
  put(key: string, value: Uint8Array): void {
    this.data.set(key, value);
  }
}

describe('vouch nickname store', () => {
  test('round-trips a nickname, including unicode', async () => {
    const store = new FakeStore();
    await saveVouchNickname('rrn1subject', 'María 🌾', store);
    expect(await loadVouchNicknames(store)).toEqual({rrn1subject: 'María 🌾'});
  });

  test('merges new labels rather than replacing the map', async () => {
    const store = new FakeStore();
    await saveVouchNickname('rrn1a', 'Ana', store);
    await saveVouchNickname('rrn1b', 'Ben', store);
    expect(await loadVouchNicknames(store)).toEqual({rrn1a: 'Ana', rrn1b: 'Ben'});
  });

  test('trims the label and drops it when blank', async () => {
    const store = new FakeStore();
    await saveVouchNickname('rrn1a', '  Ana  ', store);
    expect(await loadVouchNicknames(store)).toEqual({rrn1a: 'Ana'});
    await saveVouchNickname('rrn1a', '   ', store);
    expect(await loadVouchNicknames(store)).toEqual({});
  });

  test('saves without a biometric gate (non-secret display hints)', async () => {
    const store = new FakeStore();
    await saveVouchNickname('rrn1a', 'Ana', store);
    expect(store.lastSaveOptions).toEqual({requireBiometric: false});
  });

  test('returns an empty map when nothing is stored', async () => {
    expect(await loadVouchNicknames(new FakeStore())).toEqual({});
  });

  test('returns an empty map on an unreadable blob rather than throwing', async () => {
    const store = new FakeStore();
    store.put(SecureStoreKeys.VOUCH_NICKNAMES, Uint8Array.from([1, 2, 3, 4]));
    expect(await loadVouchNicknames(store)).toEqual({});
  });
});
