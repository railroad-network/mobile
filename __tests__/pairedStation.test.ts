/**
 * @format
 *
 * Paired-station persistence (T1.3.3): the mobile's record of which stations it
 * trusts, keyed by the durable identity address (ADR-0008). Round-trips through
 * the SecureStore, upserts by address, re-points the host hint, and forgets on
 * unpair. A corrupt or non-array blob loads as empty rather than wedging.
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore} from '../src/crypto/SecureStore';
import {utf8ToBytes} from '../src/crypto/utf8';
import {
  addPairedStation,
  getPairedStation,
  isPaired,
  loadPairedStations,
  removePairedStation,
  updatePairedStationHost,
  type PairedStation,
} from '../src/network/pairedStation';

class MemStore implements SecureStore {
  readonly map = new Map<string, Uint8Array>();
  readonly biometric = new Map<string, boolean>();
  async save(
    key: string,
    value: Uint8Array,
    options?: {requireBiometric?: boolean},
  ): Promise<void> {
    this.map.set(key, value);
    this.biometric.set(key, options?.requireBiometric ?? true);
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

const alice: PairedStation = {
  address: 'rrn1alice',
  host: 'alice.local',
  port: 7500,
  pairedAt: 1000,
};
const bob: PairedStation = {
  address: 'rrn1bob',
  host: '192.168.1.10',
  port: 7500,
  pairedAt: 2000,
};

test('no paired stations loads as an empty list', async () => {
  expect(await loadPairedStations(new MemStore())).toEqual([]);
});

test('add then load round-trips, sorted by address', async () => {
  const store = new MemStore();
  await addPairedStation(bob, store);
  await addPairedStation(alice, store);
  expect(await loadPairedStations(store)).toEqual([alice, bob]);
});

test('is stored without a biometric gate', async () => {
  const store = new MemStore();
  await addPairedStation(alice, store);
  expect(store.biometric.get(SecureStoreKeys.PAIRED_STATIONS)).toBe(false);
});

test('re-pairing the same address updates rather than duplicates', async () => {
  const store = new MemStore();
  await addPairedStation(alice, store);
  await addPairedStation({...alice, host: 'moved.local', pairedAt: 9000}, store);
  const stations = await loadPairedStations(store);
  expect(stations).toHaveLength(1);
  expect(stations[0]).toEqual({...alice, host: 'moved.local', pairedAt: 9000});
});

test('getPairedStation and isPaired find by address', async () => {
  const store = new MemStore();
  await addPairedStation(alice, store);
  expect(await getPairedStation('rrn1alice', store)).toEqual(alice);
  expect(await getPairedStation('rrn1nobody', store)).toBeNull();
  expect(await isPaired('rrn1alice', store)).toBe(true);
  expect(await isPaired('rrn1nobody', store)).toBe(false);
});

test('updatePairedStationHost re-points an existing station only', async () => {
  const store = new MemStore();
  await addPairedStation(alice, store);
  expect(await updatePairedStationHost('rrn1alice', '10.0.0.5', 7600, store)).toBe(true);
  expect(await getPairedStation('rrn1alice', store)).toEqual({
    ...alice,
    host: '10.0.0.5',
    port: 7600,
  });
  // pairedAt is preserved — re-pointing a host is not a re-pair.
  expect((await getPairedStation('rrn1alice', store))!.pairedAt).toBe(1000);
  expect(await updatePairedStationHost('rrn1nobody', 'x', 1, store)).toBe(false);
});

test('removePairedStation forgets it and reports presence', async () => {
  const store = new MemStore();
  await addPairedStation(alice, store);
  await addPairedStation(bob, store);
  expect(await removePairedStation('rrn1alice', store)).toBe(true);
  expect(await removePairedStation('rrn1alice', store)).toBe(false);
  expect(await loadPairedStations(store)).toEqual([bob]);
});

test('a corrupt blob loads as empty', async () => {
  const store = new MemStore();
  await store.save(SecureStoreKeys.PAIRED_STATIONS, Uint8Array.from([0xff, 0x00]));
  expect(await loadPairedStations(store)).toEqual([]);
});

test('a non-array JSON blob loads as empty', async () => {
  const store = new MemStore();
  await store.save(
    SecureStoreKeys.PAIRED_STATIONS,
    utf8ToBytes('{"not":"an array"}'),
  );
  expect(await loadPairedStations(store)).toEqual([]);
});

test('malformed entries are dropped, valid ones kept', async () => {
  const store = new MemStore();
  await store.save(
    SecureStoreKeys.PAIRED_STATIONS,
    utf8ToBytes(JSON.stringify([alice, {address: 'rrn1bad'}, {junk: true}])),
  );
  expect(await loadPairedStations(store)).toEqual([alice]);
});
