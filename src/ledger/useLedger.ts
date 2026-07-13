/**
 * React-Query hooks over the ledger data source. Screens read identity, balance,
 * and activity through these rather than calling the (currently mocked) fetchers
 * directly, so loading/error/refetch behaviour is uniform and the M1.3 swap to
 * real station RPC is invisible to the UI.
 */
import {useCallback} from 'react';
import {useQuery, useQueryClient, type UseQueryResult} from '@tanstack/react-query';

import type {ConnectivityLevel} from '../components';
import {fetchActivity, fetchBalance, fetchIdentity} from './mockLedger';
import type {Balance, Identity, Transaction} from './types';

/** Query keys, all under a `ledger` root so a refresh can invalidate them together. */
export const ledgerKeys = {
  root: ['ledger'] as const,
  identity: ['ledger', 'identity'] as const,
  balance: ['ledger', 'balance'] as const,
  activity: ['ledger', 'activity'] as const,
};

export function useIdentity(): UseQueryResult<Identity> {
  return useQuery({queryKey: ledgerKeys.identity, queryFn: fetchIdentity});
}

export function useBalance(): UseQueryResult<Balance> {
  return useQuery({queryKey: ledgerKeys.balance, queryFn: fetchBalance});
}

export function useActivity(): UseQueryResult<Transaction[]> {
  return useQuery({queryKey: ledgerKeys.activity, queryFn: fetchActivity});
}

/** Current transport state. */
export interface Connectivity {
  level: ConnectivityLevel;
  /** Whether the station is unreachable — drives the offline banner/indicator. */
  isOffline: boolean;
}

/**
 * ⚠️ MOCK connectivity — replaced in M1.3 by NetInfo + station reachability.
 * Until the transport layer lands we report a healthy local-mesh link. The UI
 * is wired for every level, so it lights up the moment real detection arrives.
 */
export function useConnectivity(): Connectivity {
  return {level: 'mesh', isOffline: false};
}

/**
 * Returns a function that refetches all ledger data — wired to pull-to-refresh.
 * Resolves once the active ledger queries have refetched.
 */
export function useRefreshLedger(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({queryKey: ledgerKeys.root});
  }, [queryClient]);
}
