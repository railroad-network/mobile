/**
 * @format
 *
 * Per-station request nonces (T1.3.4): a monotonic counter the station's replay
 * check depends on. It must never repeat a value, must survive a restart (it is
 * persisted), and resets cleanly when a station is unpaired.
 */
import type {SecureStore} from '../src/crypto/SecureStore';
import {clearNonce, nextNonce} from '../src/network/stationNonce';

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

describe('stationNonce', () => {
  test('starts at 1 and strictly increases per station', async () => {
    const store = new MemStore();
    expect(await nextNonce('rrn1a', store)).toBe(1);
    expect(await nextNonce('rrn1a', store)).toBe(2);
    expect(await nextNonce('rrn1a', store)).toBe(3);
  });

  test('counters are independent per station', async () => {
    const store = new MemStore();
    expect(await nextNonce('rrn1a', store)).toBe(1);
    expect(await nextNonce('rrn1b', store)).toBe(1);
    expect(await nextNonce('rrn1a', store)).toBe(2);
    expect(await nextNonce('rrn1b', store)).toBe(2);
  });

  test('survives a restart (persisted): a fresh reader continues the count', async () => {
    const store = new MemStore();
    await nextNonce('rrn1a', store);
    await nextNonce('rrn1a', store);
    // A brand-new call sharing the same backing store must not reuse 1 or 2.
    expect(await nextNonce('rrn1a', store)).toBe(3);
  });

  test('clearing resets the window for a re-pair', async () => {
    const store = new MemStore();
    await nextNonce('rrn1a', store);
    await nextNonce('rrn1a', store);
    await clearNonce('rrn1a', store);
    expect(await nextNonce('rrn1a', store)).toBe(1);
  });

  test('a corrupt stored blob does not wedge sending', async () => {
    const store = new MemStore();
    await store.save('rrn.station.nonces', Uint8Array.from([0x7b, 0x00, 0x7d])); // not valid JSON
    // Falls back to an empty map and starts fresh rather than throwing.
    expect(await nextNonce('rrn1a', store)).toBe(1);
  });
});
