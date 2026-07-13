/**
 * Transient state shared across the social-recovery setup flow (RecoveryUnlock →
 * RecoveryIntro → ChooseHolders → RecoverySplit → DistributeShards →
 * RecoveryComplete). Scoped to the recovery stack, mirroring the onboarding
 * flow's own context.
 *
 * The re-unlocked {@link Wallet} handle is held here for the life of the flow —
 * splitting the key needs it, and it is dropped by {@link RecoveryState.clear}
 * once setup finishes. The secret seed itself never enters JS; the handle only
 * references the Rust-side wallet.
 */
import {createContext, useCallback, useContext, useMemo, useState, type ReactNode} from 'react';

import type {RecoveryPackage} from '../../crypto/ffi';
import type {Wallet} from '../../wallet/Wallet';
import type {RecoveryHolder} from '../../wallet/recoveryConfig';
import type {RecoveryOrigin} from '../../navigation/types';

/** Fixed threshold: any `RECOVERY_THRESHOLD` holders can restore the wallet. */
export const RECOVERY_THRESHOLD = 3;
/** Recommended number of holders — resilient to a couple being unreachable. */
export const RECOMMENDED_HOLDERS = 5;
/** Allowed range for the number of holders (`N`). */
export const MIN_HOLDERS = RECOVERY_THRESHOLD;
export const MAX_HOLDERS = 7;

/** A holder chosen during setup, before delivery has begun. */
export type ChosenHolder = Pick<RecoveryHolder, 'address' | 'nickname'>;

export interface RecoveryState {
  /** Where the flow was launched from — decides how it exits at the end. */
  origin: RecoveryOrigin;

  /** The re-unlocked wallet, available after RecoveryUnlock. */
  wallet: Wallet | null;
  setWallet: (wallet: Wallet) => void;

  /** The holders the key will be / was split across. */
  holders: ChosenHolder[];
  setHolders: (holders: ChosenHolder[]) => void;

  /** `K` — how many holders can restore. Fixed at {@link RECOVERY_THRESHOLD}. */
  threshold: number;

  /** The created package, available after RecoverySplit. */
  recoveryPackage: RecoveryPackage | null;
  setRecoveryPackage: (pkg: RecoveryPackage) => void;

  /** Indices of holders whose shard has been handed out (self-attested). */
  delivered: Set<number>;
  markDelivered: (index: number) => void;

  /** Drops the wallet handle and package once setup is complete. */
  clear: () => void;
}

const RecoveryContext = createContext<RecoveryState | null>(null);

export function RecoveryProvider({
  origin,
  children,
}: {
  origin: RecoveryOrigin;
  children: ReactNode;
}) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [holders, setHolders] = useState<ChosenHolder[]>([]);
  const [recoveryPackage, setRecoveryPackage] = useState<RecoveryPackage | null>(null);
  const [delivered, setDelivered] = useState<Set<number>>(new Set());

  const markDelivered = useCallback((index: number) => {
    setDelivered(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setWallet(null);
    setRecoveryPackage(null);
  }, []);

  const value = useMemo<RecoveryState>(
    () => ({
      origin,
      wallet,
      setWallet,
      holders,
      setHolders,
      threshold: RECOVERY_THRESHOLD,
      recoveryPackage,
      setRecoveryPackage,
      delivered,
      markDelivered,
      clear,
    }),
    [origin, wallet, holders, recoveryPackage, delivered, markDelivered, clear],
  );

  return <RecoveryContext.Provider value={value}>{children}</RecoveryContext.Provider>;
}

/** Reads the recovery flow state. Must be used under {@link RecoveryProvider}. */
export function useRecovery(): RecoveryState {
  const ctx = useContext(RecoveryContext);
  if (ctx === null) {
    throw new Error('useRecovery must be used within a RecoveryProvider');
  }
  return ctx;
}
