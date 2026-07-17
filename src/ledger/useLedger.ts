/**
 * React-Query hooks over the ledger data source (T1.3.4).
 *
 * Screens read identity, balance, and activity through these hooks rather than
 * touching the transport directly, so loading/error/refetch behaviour is uniform
 * and the screens stay unaware of the station wire format. Each read is an
 * authenticated {@link StationClient} call against the device's active paired
 * station; when the app is locked or no station is paired the queries stay
 * disabled and resolve to no data (the screens show a lock / "pair a station"
 * state accordingly).
 *
 * The activity list still folds in the local outbox and any local confirm/reject
 * decisions on top of the station's authoritative view — see {@link assembleActivity}.
 */
import {useCallback} from 'react';
import {useQuery, useQueryClient, type UseQueryResult} from '@tanstack/react-query';

import type {ConnectivityLevel} from '../components';
import {loadProfile} from '../wallet/profile';
import {useWalletSession} from '../wallet/WalletSession';
import {
  useActiveStation,
  useStationClient,
} from '../network/useStation';
import type {StationTransactionRow} from '../network/StationClient';
import {applyDecisions, recordDecision, type Decision} from './decisions';
import {shortAddress} from './format';
import {addToOutbox, getOutbox} from './outbox';
import type {Balance, Identity, Transaction} from './types';

/** Maps one station transaction row to the display {@link Transaction} model. */
export function stationRowToTransaction(row: StationTransactionRow): Transaction {
  return {
    id: row.id,
    // No local contact book yet — show a shortened address as the label. When
    // nicknames arrive, resolve them here from the counterparty address.
    counterparty: shortAddress(row.counterparty_address),
    counterpartyAddress: row.counterparty_address,
    direction: row.direction,
    amountCenti: row.amount_centi,
    memo: row.memo,
    state: row.state,
    timestamp: row.timestamp,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    settledAt: row.settled_at,
    nonce: row.nonce,
  };
}

/**
 * Assembles the activity list from the station's transactions plus the local
 * overlays: freshly-sent proposals still in the outbox (not yet reflected by the
 * station) and local confirm/reject decisions. The station's row wins on a
 * collision — it is authoritative — so a sent payment de-dupes to one entry once
 * the station has it. Newest first (History's day grouping relies on the order).
 */
export function assembleActivity(stationTxns: Transaction[]): Transaction[] {
  const byId = new Map<string, Transaction>();
  // Outbox first, then the station overwrites any id it also knows.
  for (const tx of getOutbox()) {
    byId.set(tx.id, tx);
  }
  for (const tx of stationTxns) {
    byId.set(tx.id, tx);
  }
  return applyDecisions([...byId.values()]).sort((a, b) => b.timestamp - a.timestamp);
}

/** Query keys, all under a `ledger` root so a refresh can invalidate them together. */
export const ledgerKeys = {
  root: ['ledger'] as const,
  identity: ['ledger', 'identity'] as const,
  balance: ['ledger', 'balance'] as const,
  activity: ['ledger', 'activity'] as const,
};

export function useIdentity(): UseQueryResult<Identity> {
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.identity, wallet?.address],
    enabled: wallet !== null,
    queryFn: async (): Promise<Identity> => {
      const address = wallet!.address;
      let nickname: string | undefined;
      try {
        const profile = await loadProfile();
        if (profile.nickname !== undefined && profile.nickname.length > 0) {
          nickname = profile.nickname;
        }
      } catch {
        // No secure store (e.g. tests) — the address alone is a valid identity.
      }
      return {address, nickname};
    },
  });
}

export function useBalance(): UseQueryResult<Balance> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.balance, wallet?.address],
    enabled: client !== null && wallet !== null,
    queryFn: async (): Promise<Balance> => {
      const result = await client!.balance(wallet!.address);
      return {centi: result.balance_centi};
    },
  });
}

/** The station's transactions for this member, mapped and overlaid (see {@link assembleActivity}). */
function useActivityQuery(): UseQueryResult<Transaction[]> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.activity, wallet?.address],
    enabled: client !== null && wallet !== null,
    queryFn: async (): Promise<Transaction[]> => {
      const {transactions} = await client!.transactions(wallet!.address);
      return assembleActivity(transactions.map(stationRowToTransaction));
    },
  });
}

export function useActivity(): UseQueryResult<Transaction[]> {
  return useActivityQuery();
}

/**
 * The receiver's inbox: incoming proposals still awaiting this member's
 * confirmation. Derived from the same activity query (a `select` filter), so
 * confirming or rejecting one removes it from the inbox on the next refresh.
 */
export function useInbox(): UseQueryResult<Transaction[]> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.activity, wallet?.address],
    enabled: client !== null && wallet !== null,
    queryFn: async (): Promise<Transaction[]> => {
      const {transactions} = await client!.transactions(wallet!.address);
      return assembleActivity(transactions.map(stationRowToTransaction));
    },
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
 * Station reachability, driving the offline banner. A lightweight `whoami` probe
 * against the active station, refreshed periodically; if it errors (with an
 * `unreachable` failure), the station is offline. With no station paired there is
 * nothing to be offline *from*, so it reports online (the "pair a station" empty
 * state is a separate concern the screens handle).
 */
export function useConnectivity(): Connectivity {
  const client = useStationClient();
  const {station} = useActiveStation();
  const probe = useQuery({
    queryKey: ['reachability', station?.address],
    enabled: client !== null,
    queryFn: () => client!.whoami(),
    refetchInterval: 15_000,
    retry: false,
    staleTime: 10_000,
  });
  const isOffline = client !== null && probe.isError;
  return {level: isOffline ? 'offline' : 'mesh', isOffline};
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
 * refreshes the ledger so it shows up (as Pending) immediately. The station
 * transmission itself is done by the Send flow; this keeps the just-sent item
 * visible until the station's transaction view reflects it (see
 * {@link assembleActivity}).
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
 * immediately. The signed confirmation is transmitted by the ConfirmReceived
 * flow; this overlays the local state until the station reflects it.
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
