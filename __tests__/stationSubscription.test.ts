/**
 * @format
 *
 * The subscribe long-poll loop (T1.3.5). Drives {@link runSubscription} with a
 * fake client, a fake abortable sleep, and an in-memory cursor store, so the loop
 * behaviour — dispatch events, advance the cursor, back off on failure, stop on
 * abort — is checked without real timers, network, or crypto.
 */
import type {SecureStore} from '../src/crypto/SecureStore';
import {getCursor} from '../src/network/stationCursor';
import {StationClient, StationClientError, type StationEvent} from '../src/network/StationClient';
import {runSubscription} from '../src/network/stationSubscription';

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

const ADDR = 'rrn1station';

function event(id: number): StationEvent {
  return {
    id,
    kind: 'proposal_received',
    transaction: {
      id: `tx${id}`,
      counterparty_address: 'rrn1x',
      direction: 'in',
      amount_centi: 100,
      state: 'pending',
      timestamp: 1,
      nonce: 0,
    },
  };
}

/** A client whose `subscribe` returns queued outcomes; anything else is unused. */
function fakeClient(subscribe: StationClient['subscribe']): StationClient {
  return {subscribe} as unknown as StationClient;
}

describe('runSubscription', () => {
  test('dispatches events in order and advances the persisted cursor', async () => {
    const store = new MemStore();
    const controller = new AbortController();
    const seen: StationEvent[] = [];
    let call = 0;

    const client = fakeClient(async (lastSeen: number) => {
      call += 1;
      if (call === 1) {
        expect(lastSeen).toBe(0); // fresh cursor
        return {lastSeenEventId: 3, events: [event(2), event(3)]};
      }
      controller.abort(); // stop after the second pass
      return {lastSeenEventId: 3, events: []};
    });

    await runSubscription(client, ADDR, {
      signal: controller.signal,
      store,
      onEvent: e => seen.push(e),
      sleep: async () => {},
    });

    expect(seen.map(e => e.id)).toEqual([2, 3]);
    expect(await getCursor(ADDR, store)).toBe(3);
  });

  test('the second pass sends the advanced cursor', async () => {
    const store = new MemStore();
    const controller = new AbortController();
    const cursors: number[] = [];
    let call = 0;

    const client = fakeClient(async (lastSeen: number) => {
      cursors.push(lastSeen);
      call += 1;
      if (call === 1) {
        return {lastSeenEventId: 5, events: [event(5)]};
      }
      controller.abort();
      return {lastSeenEventId: 5, events: []};
    });

    await runSubscription(client, ADDR, {
      signal: controller.signal,
      store,
      onEvent: () => {},
      sleep: async () => {},
    });

    expect(cursors).toEqual([0, 5]);
  });

  test('backs off (capped exponential) on unreachable, then recovers', async () => {
    const store = new MemStore();
    const controller = new AbortController();
    const waits: number[] = [];
    const errors: unknown[] = [];
    const seen: StationEvent[] = [];
    let call = 0;

    const client = fakeClient(async () => {
      call += 1;
      if (call <= 2) {
        throw new StationClientError('unreachable', 'ECONNREFUSED');
      }
      if (call === 3) {
        return {lastSeenEventId: 9, events: [event(9)]};
      }
      controller.abort();
      return {lastSeenEventId: 9, events: []};
    });

    await runSubscription(client, ADDR, {
      signal: controller.signal,
      store,
      backoff: {baseMs: 1000, maxMs: 30000},
      onEvent: e => seen.push(e),
      onError: e => errors.push(e),
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([1000, 2000]); // doubled after the second failure
    expect(errors).toHaveLength(2);
    expect(seen.map(e => e.id)).toEqual([9]);
    expect(await getCursor(ADDR, store)).toBe(9);
  });

  test('aborting during backoff stops the loop', async () => {
    const store = new MemStore();
    const controller = new AbortController();
    let calls = 0;

    const client = fakeClient(async () => {
      calls += 1;
      throw new StationClientError('unreachable', 'down');
    });

    await runSubscription(client, ADDR, {
      signal: controller.signal,
      store,
      onEvent: () => {},
      sleep: async () => {
        controller.abort(); // the app backgrounds mid-backoff
      },
    });

    // One failed pass, one backoff, then the abort ends the loop.
    expect(calls).toBe(1);
  });

  test('does not start when already aborted', async () => {
    const store = new MemStore();
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    await runSubscription(fakeClient(async () => {
      calls += 1;
      return {lastSeenEventId: 0, events: []};
    }), ADDR, {
      signal: controller.signal,
      store,
      onEvent: () => {},
      sleep: async () => {},
    });

    expect(calls).toBe(0);
  });
});
