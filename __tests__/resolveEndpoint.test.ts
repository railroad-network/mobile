/**
 * @format
 *
 * Endpoint resolution (T1.3.4): the carrier-agnostic seam that turns a paired
 * station's address into somewhere to POST. Today it reads the stored host hint;
 * an unpaired address or a station with no host yields a typed error, and the
 * relay resolver slots in here later without touching the client.
 */
import type {SecureStore} from '../src/crypto/SecureStore';
import {addPairedStation} from '../src/network/pairedStation';
import {
  endpointFor,
  isResolveError,
  resolveEndpoint,
} from '../src/network/resolveEndpoint';

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

describe('resolveEndpoint', () => {
  test('resolves a paired station to its stored host/port', async () => {
    const store = new MemStore();
    await addPairedStation(
      {address: 'rrn1s', host: '10.0.0.9', port: 7500, pairedAt: 1},
      store,
    );
    const result = await resolveEndpoint('rrn1s', store);
    expect(isResolveError(result)).toBe(false);
    expect(result).toMatchObject({
      baseUrl: 'http://10.0.0.9:7500',
      host: '10.0.0.9',
      port: 7500,
    });
  });

  test('an unpaired address is not-paired', async () => {
    const result = await resolveEndpoint('rrn1stranger', new MemStore());
    expect(result).toEqual({error: 'not-paired'});
  });

  test('a paired station with no host is no-endpoint', () => {
    expect(endpointFor({address: 'rrn1s', host: '', port: 7500, pairedAt: 1})).toEqual({
      error: 'no-endpoint',
    });
    expect(endpointFor({address: 'rrn1s', host: 'h', port: 0, pairedAt: 1})).toEqual({
      error: 'no-endpoint',
    });
  });
});
