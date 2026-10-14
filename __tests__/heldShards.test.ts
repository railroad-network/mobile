/**
 * @format
 *
 * Shards this device holds for others (T1.2.3). The store is a map keyed by the
 * wallet each shard helps recover; it must round-trip through SecureStore, hold
 * many wallets at once, refuse to silently replace a held piece with a different
 * one, forget on request, report "none" when absent or unreadable, and never
 * gate reads behind biometrics (the payloads are already sealed ciphertext).
 * `shardIsForKey` compares public-key bytes through the (faked) address FFI.
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore, SaveOptions} from '../src/crypto/SecureStore';
import {
  deleteHeldShard,
  HeldShardExistsError,
  loadHeldShards,
  saveHeldShard,
  shardIsForKey,
  shardPayloadBytes,
  type HeldShard,
} from '../src/wallet/heldShards';
import {bytesToBase64} from '../src/crypto/base64';
import {
  registerRrnCryptoFfi,
  type PublicKey,
  type RrnCryptoFfi,
} from '../src/crypto/ffi';

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

  test('a different payload for a held owner is refused without replace', async () => {
    const store = new FakeStore();
    const original = shard('rrn1alice', {receivedAt: 1});
    await saveHeldShard(original, store);
    const forged = shard('rrn1alice', {
      payload: bytesToBase64(Uint8Array.from([9, 9, 9])),
      receivedAt: 2,
    });

    const attempt = saveHeldShard(forged, store);
    await expect(attempt).rejects.toBeInstanceOf(HeldShardExistsError);
    await expect(saveHeldShard(forged, store)).rejects.toMatchObject({
      existing: original,
    });
    expect(await loadHeldShards(store)).toEqual({rrn1alice: original});
  });

  test('replace:true replaces; identical payload is unchanged', async () => {
    const store = new FakeStore();
    expect(await saveHeldShard(shard('rrn1alice', {receivedAt: 1}), store)).toBe(
      'saved',
    );

    // The same payload again: nothing written, the first receipt time kept.
    expect(await saveHeldShard(shard('rrn1alice', {receivedAt: 2}), store)).toBe(
      'unchanged',
    );
    expect((await loadHeldShards(store)).rrn1alice.receivedAt).toBe(1);

    // A different payload, explicitly confirmed: it replaces the held piece.
    const fresh = shard('rrn1alice', {
      payload: bytesToBase64(Uint8Array.from([5, 6, 7])),
      receivedAt: 3,
    });
    expect(await saveHeldShard(fresh, store, {replace: true})).toBe('saved');
    const held = await loadHeldShards(store);
    expect(Object.keys(held)).toEqual(['rrn1alice']);
    expect(held.rrn1alice).toEqual(fresh);
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

// --- shardIsForKey ------------------------------------------------------------

// A minimal address FFI: two known addresses map to fixed key bytes, and a
// second spelling of the first maps to the same key (as a non-canonical but
// valid encoding would). Everything else fails to parse.
const KEY_ME = Uint8Array.from({length: 32}, (_, i) => i);
const KEY_OTHER = Uint8Array.from({length: 32}, (_, i) => 255 - i);
const keysByAddress = new Map<string, Uint8Array>([
  ['rrn1me', KEY_ME],
  ['RRN1ME', KEY_ME],
  ['rrn1other', KEY_OTHER],
]);

function unused(): never {
  throw new Error('not exercised by held-shard tests');
}

const fakeFfi = {
  PublicKey: {
    fromBytes: unused,
    fromAddress: (address: string): PublicKey => {
      const bytes = keysByAddress.get(address);
      if (bytes === undefined) {
        throw new Error('invalid address');
      }
      return {
        toBytes: () => bytes,
        toAddress: () => address,
        verify: unused,
        seal: unused,
      };
    },
  },
} as unknown as RrnCryptoFfi;

describe('shardIsForKey', () => {
  beforeAll(() => registerRrnCryptoFfi(fakeFfi));

  test('matching key is true', () => {
    expect(shardIsForKey('rrn1me', KEY_ME)).toBe(true);
  });

  test('another spelling of the same key is true (bytes, not strings)', () => {
    expect(shardIsForKey('RRN1ME', KEY_ME)).toBe(true);
  });

  test('another key is false', () => {
    expect(shardIsForKey('rrn1other', KEY_ME)).toBe(false);
  });

  test('an unparseable address is false', () => {
    expect(shardIsForKey('not-an-address', KEY_ME)).toBe(false);
  });

  test('a key of a different length is false', () => {
    expect(shardIsForKey('rrn1me', KEY_ME.slice(0, 31))).toBe(false);
  });
});
