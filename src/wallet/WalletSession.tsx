/**
 * Tracks whether a wallet exists on this device and lets the app react when
 * that changes.
 *
 * The top-level navigator picks the onboarding stack vs. the main app from
 * {@link WalletSession.hasWallet}. Onboarding can't just navigate into the main
 * app itself — the two are sibling stacks chosen by this flag — so once wallet
 * creation completes it calls {@link WalletSession.refresh}, which re-checks the
 * secure store and flips {@link WalletSession.hasWallet} to `true`, swapping the
 * stacks.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {hasWallet} from './Wallet';

export interface WalletSession {
  /**
   * Whether a wallet is persisted on this device. `null` while the initial
   * check is in flight (the app shows a blank canvas until it resolves).
   */
  hasWallet: boolean | null;
  /** Re-reads the secure store and updates {@link hasWallet}. */
  refresh: () => Promise<void>;
}

const WalletSessionContext = createContext<WalletSession | null>(null);

export function WalletSessionProvider({children}: {children: ReactNode}) {
  const [walletExists, setWalletExists] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWalletExists(await hasWallet());
    } catch {
      // No native secure store (e.g. under Jest) — treat as "no wallet yet"
      // rather than crashing the app shell.
      setWalletExists(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return (
    <WalletSessionContext.Provider value={{hasWallet: walletExists, refresh}}>
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
