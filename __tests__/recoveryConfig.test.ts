/**
 * @format
 *
 * The recovery config persists through SecureStore as UTF-8 JSON. It must
 * round-trip (including unicode nicknames), report "not set up" when absent,
 * and degrade to null rather than throwing on an unreadable blob.
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore, SaveOptions} from '../src/crypto/SecureStore';
import {
  loadRecoveryConfig,
  saveRecoveryConfig,
  type RecoveryConfig,
} from '../src/wallet/recoveryConfig';

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
  /** Test-only: plant raw bytes under the config key. */
  put(key: string, value: Uint8Array): void {
    this.data.set(key, value);
  }
}

const config: RecoveryConfig = {
  originalAddress: 'rrn1owneraddress',
  threshold: 3,
  total: 5,
  holders: [
    {address: 'rrn1holder1', nickname: 'Mãe', delivered: true},
    {address: 'rrn1holder2', delivered: false},
  ],
  createdAt: 1_700_000_000,
};

describe('recovery config persistence', () => {
  test('round-trips through the store', async () => {
    const store = new FakeStore();
    await saveRecoveryConfig(config, store);
    expect(await loadRecoveryConfig(store)).toEqual(config);
  });

  test('saves without a biometric gate (non-secret)', async () => {
    const store = new FakeStore();
    await saveRecoveryConfig(config, store);
    expect(store.lastSaveOptions).toEqual({requireBiometric: false});
  });

  test('returns null when no config is stored', async () => {
    expect(await loadRecoveryConfig(new FakeStore())).toBeNull();
  });

  test('returns null on an unreadable blob rather than throwing', async () => {
    const store = new FakeStore();
    store.put(SecureStoreKeys.RECOVERY_CONFIG, Uint8Array.from([1, 2, 3, 4]));
    expect(await loadRecoveryConfig(store)).toBeNull();
  });
});
