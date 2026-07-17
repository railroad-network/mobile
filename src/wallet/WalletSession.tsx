/**
 * The wallet session: whether a wallet exists on this device, and — once the
 * user has unlocked it this launch — the in-memory unlocked {@link Wallet}.
 *
 * Two things drive top-level routing from here ({@link navigation/RootNavigator}):
 *   1. **Existence** ({@link WalletSession.hasWallet}) chooses onboarding vs. the
 *      main app. Onboarding can't navigate into the app itself — the stacks are
 *      siblings picked by this flag — so finishing creation calls
 *      {@link WalletSession.adopt} (which also holds the just-created wallet, so
 *      the user is not immediately asked to unlock what they just made).
 *   2. **Unlocked** ({@link WalletSession.wallet}) gates the main app behind a
 *      lock screen. The authenticated station channel (T1.3.4) signs *every*
 *      request, including reads, so the app holds the unlocked wallet for the
 *      foreground session and signs silently — rather than prompting per action.
 *      The wallet is dropped when the app backgrounds, so it is never held
 *      unlocked while the app is not in front of the user.
 *
 * The unlocked wallet lives only in memory (its secret stays in Rust regardless;
 * this holds the FFI handle). It is never persisted here — the encrypted
 * `.rrnwallet` in the secure store remains the only at-rest copy.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {AppState} from 'react-native';

import {hasWallet, loadWallet, type Wallet} from './Wallet';

export interface WalletSession {
  /**
   * Whether a wallet is persisted on this device. `null` while the initial
   * check is in flight (the app shows a blank canvas until it resolves).
   */
  hasWallet: boolean | null;
  /**
   * The unlocked wallet for this foreground session, or `null` when locked. When
   * a wallet exists but this is `null`, the app shows the lock screen.
   */
  wallet: Wallet | null;
  /** Re-reads the secure store and updates {@link hasWallet}. */
  refresh: () => Promise<void>;
  /**
   * Unlocks the persisted wallet with `passphrase` (which also passes the
   * keychain's biometric gate on read), holding it for the session. Returns
   * `true` on success; `false` if the passphrase is wrong or no wallet exists.
   */
  unlock: (passphrase: string) => Promise<boolean>;
  /**
   * Adopts a freshly-created wallet as the unlocked session wallet and flips
   * {@link hasWallet} to `true` — the onboarding hand-off, so a new user lands in
   * the app unlocked instead of at the lock screen.
   */
  adopt: (wallet: Wallet) => void;
  /** Drops the in-memory unlocked wallet, returning to the lock screen. */
  lock: () => void;
}

const WalletSessionContext = createContext<WalletSession | null>(null);

export function WalletSessionProvider({children}: {children: ReactNode}) {
  const [walletExists, setWalletExists] = useState<boolean | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWalletExists(await hasWallet());
    } catch {
      // No native secure store (e.g. under Jest) — treat as "no wallet yet"
      // rather than crashing the app shell.
      setWalletExists(false);
    }
  }, []);

  const unlock = useCallback(async (passphrase: string): Promise<boolean> => {
    try {
      const opened = await loadWallet(passphrase);
      if (opened === null) {
        return false;
      }
      setWallet(opened);
      setWalletExists(true);
      return true;
    } catch {
      // A wrong passphrase (or tampered bytes) rejects from the FFI; surface it
      // as a failed unlock the screen can retry, not a crash.
      return false;
    }
  }, []);

  const adopt = useCallback((created: Wallet) => {
    setWallet(created);
    setWalletExists(true);
  }, []);

  const lock = useCallback(() => setWallet(null), []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // Drop the unlocked wallet whenever the app leaves the foreground, so it is
  // never held while the app is backgrounded. `lock` is stable, so this
  // subscribes once. Kept in a ref to avoid re-subscribing on every render.
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        lockRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <WalletSessionContext.Provider value={{hasWallet: walletExists, wallet, refresh, unlock, adopt, lock}}>
      {children}
    </WalletSessionContext.Provider>
  );
}

/** Reads the wallet session. Must be used under {@link WalletSessionProvider}. */
export function useWalletSession(): WalletSession {
  const ctx = useContext(WalletSessionContext);
  if (ctx === null) {
    throw new Error('useWalletSession must be used within a WalletSessionProvider');
  }
  return ctx;
}
