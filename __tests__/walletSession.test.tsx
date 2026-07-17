/**
 * @format
 *
 * Wallet session (T1.3.4): the in-memory unlocked-wallet holder that gates the
 * app behind a lock screen. Unlock loads and holds the wallet; a wrong
 * passphrase fails without holding anything; adopt takes a freshly-created
 * wallet; lock drops it; and backgrounding the app locks it.
 */
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {AppState} from 'react-native';

import {WalletSessionProvider, useWalletSession, type WalletSession} from '../src/wallet/WalletSession';
import * as WalletModule from '../src/wallet/Wallet';
import type {Wallet} from '../src/wallet/Wallet';

jest.mock('../src/wallet/Wallet', () => ({
  hasWallet: jest.fn(),
  loadWallet: jest.fn(),
}));

const mockedHasWallet = WalletModule.hasWallet as jest.Mock;
const mockedLoadWallet = WalletModule.loadWallet as jest.Mock;

/** Renders the provider and captures the live session value. */
function renderSession(): {get: () => WalletSession; unmount: () => void} {
  let latest: WalletSession | null = null;
  function Probe() {
    latest = useWalletSession();
    return null;
  }
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <WalletSessionProvider>
        <Probe />
      </WalletSessionProvider>,
    );
  });
  return {
    get: () => {
      if (latest === null) throw new Error('session not captured');
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

const fakeWallet = (address: string): Wallet => ({address}) as unknown as Wallet;

beforeEach(() => {
  jest.clearAllMocks();
  mockedHasWallet.mockResolvedValue(true);
});

describe('WalletSession', () => {
  test('starts locked when a wallet exists', async () => {
    const s = renderSession();
    await act(async () => {}); // flush the initial hasWallet check
    expect(s.get().hasWallet).toBe(true);
    expect(s.get().wallet).toBeNull();
  });

  test('unlock holds the loaded wallet', async () => {
    mockedLoadWallet.mockResolvedValue(fakeWallet('rrn1me'));
    const s = renderSession();
    await act(async () => {});

    let ok = false;
    await act(async () => {
      ok = await s.get().unlock('correct horse');
    });
    expect(ok).toBe(true);
    expect(s.get().wallet?.address).toBe('rrn1me');
  });

  test('a wrong passphrase fails without holding a wallet', async () => {
    mockedLoadWallet.mockResolvedValue(null); // loadWallet returns null on no/bad wallet
    const s = renderSession();
    await act(async () => {});

    let ok = true;
    await act(async () => {
      ok = await s.get().unlock('nope');
    });
    expect(ok).toBe(false);
    expect(s.get().wallet).toBeNull();
  });

  test('a thrown load (tampered/wrong) is a failed unlock, not a crash', async () => {
    mockedLoadWallet.mockRejectedValue(new Error('decrypt failed'));
    const s = renderSession();
    await act(async () => {});

    let ok = true;
    await act(async () => {
      ok = await s.get().unlock('bad');
    });
    expect(ok).toBe(false);
    expect(s.get().wallet).toBeNull();
  });

  test('adopt holds a freshly-created wallet and marks it existing', async () => {
    mockedHasWallet.mockResolvedValue(false); // brand-new device
    const s = renderSession();
    await act(async () => {});
    expect(s.get().hasWallet).toBe(false);

    act(() => s.get().adopt(fakeWallet('rrn1new')));
    expect(s.get().hasWallet).toBe(true);
    expect(s.get().wallet?.address).toBe('rrn1new');
  });

  test('lock drops the unlocked wallet', async () => {
    mockedLoadWallet.mockResolvedValue(fakeWallet('rrn1me'));
    const s = renderSession();
    await act(async () => {});
    await act(async () => {
      await s.get().unlock('correct horse');
    });
    expect(s.get().wallet).not.toBeNull();

    act(() => s.get().lock());
    expect(s.get().wallet).toBeNull();
  });

  test('leaving the foreground locks the wallet', async () => {
    mockedLoadWallet.mockResolvedValue(fakeWallet('rrn1me'));
    let handler: ((state: string) => void) | null = null;
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, cb) => {
        handler = cb as (state: string) => void;
        return {remove: jest.fn()} as never;
      });

    const s = renderSession();
    await act(async () => {});
    await act(async () => {
      await s.get().unlock('correct horse');
    });
    expect(s.get().wallet).not.toBeNull();

    // Simulate the OS backgrounding the app.
    act(() => handler?.('background'));
    expect(s.get().wallet).toBeNull();

    spy.mockRestore();
  });
});
