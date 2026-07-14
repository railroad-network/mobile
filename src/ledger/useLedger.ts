/**
 * React-Query hooks over the ledger data source. Screens read identity, balance,
 * and activity through these rather than calling the (currently mocked) fetchers
 * directly, so loading/error/refetch behaviour is uniform and the M1.3 swap to
 * real station RPC is invisible to the UI.
 */
import {useCallback} from 'react';
import {useQuery, useQueryClient, type UseQueryResult} from '@tanstack/react-query';

import type {ConnectivityLevel} from '../components';
import {applyDecisions, recordDecision, type Decision} from './decisions';
import {fetchActivity, fetchBalance, fetchIdentity} from './mockLedger';
import {addToOutbox, getOutbox} from './outbox';
import type {Balance, Identity, Transaction} from './types';

/**
 * The activity source: locally-queued outgoing proposals (the outbox) plus the
 * ledger's transactions, with any local confirm/reject decisions folded in.
 * Shared by {@link useActivity} and {@link useInbox} (same query key, so
 * react-query fetches it once).
 */
export async function activityQueryFn(): Promise<Transaction[]> {
  const merged = applyDecisions([...getOutbox(), ...(await fetchActivity())]);
  // Newest first. Consumers rely on this: History's day grouping only starts a
  // new section when the day label changes, so out-of-order entries would repeat
  // a day header.
  return merged.sort((a, b) => b.timestamp - a.timestamp);
}

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
  // Locally-queued proposals (the outbox) are merged in — they are not yet in
  // the mock/station activity. M1.3's real transport reconciles the two; until
  // then this merge is what makes a just-sent payment appear.
  return useQuery({queryKey: ledgerKeys.activity, queryFn: activityQueryFn});
}

/**
 * The receiver's inbox: incoming proposals still awaiting this member's
 * confirmation. Derived from the same activity query (a `select` filter), so
 * confirming or rejecting one — which flips its state via the decisions overlay
 * — removes it from the inbox on the next refresh.
 */
export function useInbox(): UseQueryResult<Transaction[]> {
  return useQuery({
    queryKey: ledgerKeys.activity,
    queryFn: activityQueryFn,
    select: txs => txs.filter(tx => tx.direction === 'in' && tx.state === 'pending'),
  });
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

/**
 * Returns a function that queues a freshly-sent transaction locally and
 * refreshes the ledger so it shows up (as Pending) immediately. The M1.2
 * stand-in for handing a signed proposal to the transport layer (M1.3).
 */
export function useEnqueueTransaction(): (tx: Transaction) => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    async (tx: Transaction) => {
      addToOutbox(tx);
      await queryClient.invalidateQueries({queryKey: ledgerKeys.root});
    },
    [queryClient],
  );
}

/**
 * Returns a function that records a local confirm/reject decision on a proposal
 * and refreshes the ledger so the change (and its removal from the inbox) shows
 * immediately. The M1.2 stand-in for transmitting the signed confirmation to the
 * station (M1.3).
 */
export function useRecordDecision(): (id: string, decision: Decision) => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    async (id: string, decision: Decision) => {
      recordDecision(id, decision);
      await queryClient.invalidateQueries({queryKey: ledgerKeys.root});
    },
    [queryClient],
  );
}
