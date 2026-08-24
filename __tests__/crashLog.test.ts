/**
 * @format
 *
 * The durable crash log (crash surfacing). Drives the real record/load/clear
 * over an in-memory SecureStore, asserting: records come back newest-first,
 * survive a "restart" (a fresh read of the same store), the ring is capped at
 * MAX_ENTRIES dropping oldest, a corrupt payload degrades to empty rather than
 * throwing, and formatting produces a copyable block with the key facts.
 */
import type {SecureStore} from '../src/crypto/SecureStore';
import {SecureStoreKeys} from '../src/crypto/constants';
import {utf8ToBytes} from '../src/crypto/utf8';
import {
  MAX_ENTRIES,
  clearCrashLog,
  loadCrashLog,
  recordCrash,
  recordError,
} from '../src/diagnostics/crashLog';
import {
  formatCrashReport,
  makeCrashReport,
  type CrashReport,
} from '../src/diagnostics/crashReport';

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

function report(overrides: Partial<CrashReport> = {}): CrashReport {
  return {...makeCrashReport('render', new Error('boom')), ...overrides};
}

describe('crashLog', () => {
  test('records and reads back newest-first', async () => {
    const store = new MemStore();
    await recordCrash(report({id: 'a', message: 'first'}), store);
    await recordCrash(report({id: 'b', message: 'second'}), store);

    const log = await loadCrashLog(store);
    expect(log.map(r => r.id)).toEqual(['b', 'a']);
    expect(log[0].message).toBe('second');
  });

  test('survives a restart — a fresh read of the same store sees the records', async () => {
    const store = new MemStore();
    await recordCrash(report({id: 'x'}), store);
    // Simulate a process restart: nothing in memory, only the persisted bytes.
    const log = await loadCrashLog(store);
    expect(log.map(r => r.id)).toEqual(['x']);
  });

  test('caps the ring at MAX_ENTRIES, dropping the oldest', async () => {
    const store = new MemStore();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      await recordCrash(report({id: `r${i}`}), store);
    }
    const log = await loadCrashLog(store);
    expect(log).toHaveLength(MAX_ENTRIES);
    // Newest-first: the last five recorded survive, the first five are gone.
    expect(log[0].id).toBe(`r${MAX_ENTRIES + 4}`);
    expect(log.some(r => r.id === 'r0')).toBe(false);
  });

  test('recordError builds a report from a thrown value', async () => {
    const store = new MemStore();
    await recordError('rejection', 'network down', undefined, store);
    const log = await loadCrashLog(store);
    expect(log[0].kind).toBe('rejection');
    expect(log[0].message).toBe('network down');
  });

  test('clear empties the log', async () => {
    const store = new MemStore();
    await recordCrash(report(), store);
    await clearCrashLog(store);
    expect(await loadCrashLog(store)).toEqual([]);
  });

  test('a corrupt stored payload degrades to empty, not a throw', async () => {
    const store = new MemStore();
    await store.save(SecureStoreKeys.CRASH_LOG, utf8ToBytes('{not json'));
    await expect(loadCrashLog(store)).resolves.toEqual([]);
    // And a subsequent record still works, overwriting the garbage.
    await recordCrash(report({id: 'ok'}), store);
    expect((await loadCrashLog(store)).map(r => r.id)).toEqual(['ok']);
  });

  test('formatted report carries the message, version, and stack', () => {
    const r = report({message: 'kaboom', appVersion: '9.9.9'});
    const text = formatCrashReport(r);
    expect(text).toContain('kaboom');
    expect(text).toContain('9.9.9');
    expect(text).toContain('Stack:');
  });
});
