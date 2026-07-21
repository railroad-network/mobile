/**
 * @format
 *
 * Per-station subscribe cursor persistence (T1.3.5). The station is
 * delivery-stateless; the phone holds the bookmark. These check the read/advance/
 * clear behaviour and the monotonic guard that stops a stale write from rewinding
 * it (which would replay events forever).
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore} from '../src/crypto/SecureStore';
import {utf8ToBytes} from '../src/crypto/utf8';
import {clearCursor, getCursor, setCursor} from '../src/network/stationCursor';

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

const A = 'rrn1alice';
const B = 'rrn1bob';

describe('stationCursor', () => {
  test('an unknown station reads 0', async () => {
    const store = new MemStore();
    expect(await getCursor(A, store)).toBe(0);
  });

  test('set then get round-trips', async () => {
    const store = new MemStore();
    await setCursor(A, 12, store);
    expect(await getCursor(A, store)).toBe(12);
  });

  test('advancing is monotonic — a lower value does not rewind', async () => {
    const store = new MemStore();
    await setCursor(A, 12, store);
    await setCursor(A, 5, store); // stale/out-of-order
    expect(await getCursor(A, store)).toBe(12);
    await setCursor(A, 20, store);
    expect(await getCursor(A, store)).toBe(20);
  });

  test('stations keep independent cursors', async () => {
    const store = new MemStore();
    await setCursor(A, 3, store);
    await setCursor(B, 9, store);
    expect(await getCursor(A, store)).toBe(3);
    expect(await getCursor(B, store)).toBe(9);
  });

  test('clear forgets a station', async () => {
    const store = new MemStore();
    await setCursor(A, 4, store);
    await clearCursor(A, store);
    expect(await getCursor(A, store)).toBe(0);
  });

  test('a corrupt record reads 0 rather than throwing', async () => {
    const store = new MemStore();
    await store.save(SecureStoreKeys.STATION_CURSORS, utf8ToBytes('not json'));
    expect(await getCursor(A, store)).toBe(0);
  });

  test('a negative or non-integer value is ignored', async () => {
    const store = new MemStore();
    await setCursor(A, -1, store);
    await setCursor(A, 1.5, store);
    expect(await getCursor(A, store)).toBe(0);
  });
});
