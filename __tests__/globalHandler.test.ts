/**
 * @format
 *
 * Global JS error capture (crash surfacing). Installs the handler onto a fake
 * `global.ErrorUtils`, then asserts: the previously-installed handler is still
 * called (we chain, never replace — so RN's redbox/native path survives), a
 * fatal is recorded as 'fatal' and a non-fatal as 'error', and a second install
 * is a no-op.
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import * as store from '../src/crypto/SecureStore';
import {bytesToUtf8} from '../src/crypto/utf8';
import type {CrashReport} from '../src/diagnostics/crashReport';
import {
  installGlobalErrorHandler,
  resetGlobalErrorHandlerForTests,
} from '../src/diagnostics/globalHandler';

class MemStore implements store.SecureStore {
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

type Handler = (error: unknown, isFatal?: boolean) => void;

function readLog(mem: MemStore): CrashReport[] {
  const bytes = mem.map.get(SecureStoreKeys.CRASH_LOG);
  return bytes ? (JSON.parse(bytesToUtf8(bytes)) as CrashReport[]) : [];
}

/** Waits for the fire-and-forget record() to settle. */
const flush = () => new Promise(r => setImmediate(r));

describe('installGlobalErrorHandler', () => {
  let mem: MemStore;
  let previous: jest.Mock;
  let installedHandler: Handler | undefined;
  const realGlobal = globalThis as {ErrorUtils?: unknown};
  let savedErrorUtils: unknown;

  beforeEach(() => {
    mem = new MemStore();
    jest.spyOn(store, 'getSecureStore').mockReturnValue(mem);
    previous = jest.fn();
    installedHandler = undefined;
    savedErrorUtils = realGlobal.ErrorUtils;
    realGlobal.ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: Handler) => {
        installedHandler = h;
      },
    };
    resetGlobalErrorHandlerForTests();
  });

  afterEach(() => {
    realGlobal.ErrorUtils = savedErrorUtils;
    jest.restoreAllMocks();
  });

  test('chains the previous handler and records a fatal', async () => {
    installGlobalErrorHandler();
    const err = new Error('fatal boom');
    installedHandler?.(err, true);
    await flush();

    expect(previous).toHaveBeenCalledWith(err, true);
    const log = readLog(mem);
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe('fatal');
    expect(log[0].message).toBe('fatal boom');
  });

  test('records a non-fatal as kind "error"', async () => {
    installGlobalErrorHandler();
    installedHandler?.(new Error('soft'), false);
    await flush();
    expect(readLog(mem)[0].kind).toBe('error');
  });

  test('a second install is a no-op', () => {
    const spy = jest.spyOn(
      realGlobal.ErrorUtils as {setGlobalHandler: Handler},
      'setGlobalHandler',
    );
    installGlobalErrorHandler();
    installGlobalErrorHandler();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
