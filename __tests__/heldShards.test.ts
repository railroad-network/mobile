/**
 * @format
 *
 * Shards this device holds for others (T1.2.3). The store is a map keyed by the
 * wallet each shard helps recover; it must round-trip through SecureStore, hold
 * many wallets at once, replace a wallet's shard on re-receipt, forget on
 * request, report "none" when absent or unreadable, and never gate reads behind
 * biometrics (the payloads are already sealed ciphertext).
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore, SaveOptions} from '../src/crypto/SecureStore';
import {
  deleteHeldShard,
  loadHeldShards,
  saveHeldShard,
  shardPayloadBytes,
  type HeldShard,
} from '../src/wallet/heldShards';
import {bytesToBase64} from '../src/crypto/base64';

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
  /** Test-only: plant raw bytes under the shards key. */
  put(key: string, value: Uint8Array): void {
    this.data.set(key, value);
  }
}

function shard(originalAddress: string, overrides: Partial<HeldShard> = {}): HeldShard {
  return {
    originalAddress,
    holderAddress: 'rrn1me',
    threshold: 3,
    total: 5,
    payload: bytesToBase64(Uint8Array.from([1, 2, 3, 4])),
    receivedAt: 1_700_000_000,
    ...overrides,
  };
}

describe('held-shard persistence', () => {
  test('returns an empty map when nothing is held', async () => {
    expect(await loadHeldShards(new FakeStore())).toEqual({});
  });

  test('round-trips a shard through the store', async () => {
    const store = new FakeStore();
    const s = shard('rrn1alice');
    await saveHeldShard(s, store);
    expect(await loadHeldShards(store)).toEqual({rrn1alice: s});
  });

  test('holds shards for several different wallets', async () => {
    const store = new FakeStore();
    await saveHeldShard(shard('rrn1alice'), store);
    await saveHeldShard(shard('rrn1bob'), store);
    const held = await loadHeldShards(store);
    expect(Object.keys(held).sort()).toEqual(['rrn1alice', 'rrn1bob']);
  });

  test('re-receiving a wallet’s shard replaces the previous one', async () => {
    const store = new FakeStore();
    await saveHeldShard(shard('rrn1alice', {receivedAt: 1}), store);
    await saveHeldShard(shard('rrn1alice', {receivedAt: 2}), store);
    const held = await loadHeldShards(store);
    expect(Object.keys(held)).toEqual(['rrn1alice']);
    expect(held.rrn1alice.receivedAt).toBe(2);
  });

  test('forgets a held shard, leaving others intact', async () => {
    const store = new FakeStore();
    await saveHeldShard(shard('rrn1alice'), store);
    await saveHeldShard(shard('rrn1bob'), store);
    await deleteHeldShard('rrn1alice', store);
    expect(Object.keys(await loadHeldShards(store))).toEqual(['rrn1bob']);
  });

  test('forgetting an unheld wallet is a no-op', async () => {
    const store = new FakeStore();
    await saveHeldShard(shard('rrn1alice'), store);
    await deleteHeldShard('rrn1nobody', store);
    expect(Object.keys(await loadHeldShards(store))).toEqual(['rrn1alice']);
  });

  test('saves without a biometric gate (already sealed ciphertext)', async () => {
    const store = new FakeStore();
    await saveHeldShard(shard('rrn1alice'), store);
    expect(store.lastSaveOptions).toEqual({requireBiometric: false});
  });

  test('returns an empty map on an unreadable blob rather than throwing', async () => {
    const store = new FakeStore();
    store.put(SecureStoreKeys.RECOVERY_SHARDS, Uint8Array.from([0xff, 0x00, 0x01]));
    expect(await loadHeldShards(store)).toEqual({});
  });

  test('recovers the raw sealed bytes from a held shard', async () => {
    const bytes = Uint8Array.from([9, 8, 7, 6]);
    const s = shard('rrn1alice', {payload: bytesToBase64(bytes)});
    expect(shardPayloadBytes(s)).toEqual(bytes);
  });
});
