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
import {
  StationClientError,
  type StationErrorKind,
  type StationTransactionRow,
} from '../network/StationClient';
import {createConfirmation} from '../wallet/confirmation';
import {createSendProposal} from '../wallet/proposal';
import {createSignedVouch} from '../wallet/vouch';
import {applyDecisions, recordDecision, type Decision} from './decisions';
import {shortAddress} from './format';
import {addToOutbox, getOutbox} from './outbox';
import type {Balance, Identity, Transaction} from './types';

/** How long, in seconds, a freshly-sent proposal stays valid before auto-cancel. */
const PROPOSAL_EXPIRY_SECS = 24 * 3600;

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
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    // The client's presence is part of the key so pairing (or unpairing)
    // refetches and fills in / drops the community line.
    queryKey: [...ledgerKeys.identity, wallet?.address, client !== null],
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
      let community: string | undefined;
      if (client !== null) {
        try {
          community = (await client.whoami()).community;
        } catch {
          // Offline or unreachable — the identity is still valid without the
          // community line; a later refetch fills it in.
        }
      }
      return {address, nickname, community};
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

/** The outcome of a station write (send / confirm). Never throws to the screen. */
export type WriteResult<T = void> =
  | ({ok: true} & T)
  | {ok: false; error: StationErrorKind | 'locked'; message: string};

/**
 * Returns a function that sends a payment: it reads the authoritative ledger
 * nonce from the station, signs the proposal with the unlocked session wallet,
 * transmits it over the authenticated channel, and — on success — shows it
 * locally as pending until the station's view reflects it. Online-only by
 * design (ADR-0008 / T1.3.4): if the station is unreachable the send fails with
 * a typed error and nothing is queued for later; the user retries.
 *
 * `amountCenti` is the positive transfer amount (station convention: the sender
 * pays the receiver); the local display row negates it.
 */
export function useSendProposal(): (
  receiverAddress: string,
  amountCenti: number,
  memo: string | undefined,
) => Promise<WriteResult<{id: string}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const enqueue = useEnqueueTransaction();
  return useCallback(
    async (receiverAddress, amountCenti, memo) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        // Query-first: the nonce is signed into the proposal, so it must be the
        // station's authoritative next value before we sign.
        const {nonce} = await client.nextNonce(wallet.address);
        const now = Math.floor(Date.now() / 1000);
        const proposal = await createSendProposal(wallet, receiverAddress, amountCenti, memo, {
          nonce,
          proposedAt: now,
          expiresAt: now + PROPOSAL_EXPIRY_SECS,
        });
        await client.submitSignedRecord(
          'submit_proposal',
          'signed_proposal',
          proposal.payloadBytes,
          proposal.signature,
        );
        await enqueue({
          id: proposal.id,
          counterparty: shortAddress(receiverAddress),
          counterpartyAddress: receiverAddress,
          direction: 'out',
          amountCenti: -amountCenti, // display: an outgoing payment is a debit
          memo: proposal.memo,
          state: 'pending',
          timestamp: proposal.proposedAt,
          expiresAt: proposal.expiresAt,
          nonce: proposal.nonce,
        });
        return {ok: true, id: proposal.id};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, enqueue],
  );
}

/**
 * Returns a function that confirms an incoming proposal: it signs the
 * confirmation with the session wallet, transmits it, and overlays the local
 * `confirmed` state until the station reflects it. Rejecting is a purely local
 * decision (see {@link useRecordDecision}) — only confirmation is transmitted.
 */
export function useConfirmProposal(): (proposalId: string) => Promise<WriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const record = useRecordDecision();
  return useCallback(
    async proposalId => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const confirmedAt = Math.floor(Date.now() / 1000);
        const confirmation = await createConfirmation(wallet, proposalId, confirmedAt);
        await client.submitSignedRecord(
          'submit_confirmation',
          'signed_confirmation',
          confirmation.payloadBytes,
          confirmation.signature,
        );
        await record(proposalId, {state: 'confirmed', confirmedAt});
        return {ok: true};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, record],
  );
}

/**
 * Returns a function that vouches for a subject: it reads the station's
 * community from `whoami`, builds and signs the vouch attestation on-device
 * ({@link createSignedVouch}), and transmits it over the authenticated channel
 * (T1.4.1). Online-only like a send — the community is stamped into the signed
 * bytes, so it must be the station's authoritative value at vouch time; if the
 * station is unreachable nothing is queued and the user retries.
 */
export function useSubmitVouch(): (
  subjectAddress: string,
  statement: string,
  stakeCenti: number,
) => Promise<WriteResult<{vouchId: string; community: string}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useCallback(
    async (subjectAddress, statement, stakeCenti) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const {community} = await client.whoami();
        if (community === undefined) {
          // A station that predates the community field cannot accept a vouch
          // that stamps one; surface it as a station-side rejection.
          return {
            ok: false,
            error: 'rejected',
            message: 'Your station is too old to accept vouches — update it first.',
          };
        }
        const issuedAt = Math.floor(Date.now() / 1000);
        const vouch = await createSignedVouch(
          wallet,
          subjectAddress,
          community,
          statement,
          stakeCenti,
          issuedAt,
        );
        const {vouchId} = await client.submitVouch(vouch.payloadBytes, vouch.signature);
        return {ok: true, vouchId: vouchId.length > 0 ? vouchId : vouch.vouchId, community};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet],
  );
}

/** Normalises a thrown error into a typed {@link WriteResult} failure. */
function asWriteError(e: unknown): {ok: false; error: StationErrorKind | 'locked'; message: string} {
  if (e instanceof StationClientError) {
    return {ok: false, error: e.kind, message: e.message};
  }
  return {ok: false, error: 'malformed', message: e instanceof Error ? e.message : String(e)};
}
