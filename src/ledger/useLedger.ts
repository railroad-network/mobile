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
import {useCallback, useSyncExternalStore} from 'react';
import {useQuery, useQueryClient, type UseQueryResult} from '@tanstack/react-query';

import type {ConnectivityLevel} from '../components';
import {loadProfile} from '../wallet/profile';
import {useWalletSession} from '../wallet/WalletSession';
import {
  getReachability,
  subscribeReachability,
  type Reachability,
} from '../network/connectivityStore';
import {
  useActiveStation,
  useStationClient,
} from '../network/useStation';
import {
  StationClientError,
  type DisputeDetail,
  type DisputeSummary,
  type StationCharter,
  type StationErrorKind,
  type StationPendingCharter,
  type StationProposalDetail,
  type StationProposalSummary,
  type StationReputation,
  type StationStatuteSummary,
  type StationTransactionRow,
  type StationVouchCounts,
  type StationVouchLists,
} from '../network/StationClient';
import {createConfirmation} from '../wallet/confirmation';
import {
  createSignedDispute,
  createSignedDisputeResponse,
  createSignedEscalation,
  createSignedEscalationBallot,
  createSignedVerdict,
  type EscalationReason,
} from '../wallet/dispute';
import {
  createSignedCharterSignature,
  createSignedCosign,
  createSignedVote,
  type VoteChoice,
} from '../wallet/governance';
import {createSendProposal} from '../wallet/proposal';
import {createSignedVouch} from '../wallet/vouch';
import {saveVouchNickname} from '../wallet/vouchNicknames';
import {applyDecisions, recordDecision, type Decision} from './decisions';
import {shortAddress} from './format';
import {addToOutbox, getOutbox} from './outbox';
import type {Balance, Identity, Transaction} from './types';

/** How long, in seconds, a freshly-sent proposal stays valid before auto-cancel. */
const PROPOSAL_EXPIRY_SECS = 24 * 3600;

/**
 * How often the open-proposal detail refetches while it is on screen. Governance
 * moves at human pace, so a few seconds keeps the tally and phase feeling live
 * without hammering the station.
 */
const PROPOSAL_POLL_MS = 5000;

/**
 * How often the open-dispute detail refetches while it is on screen. A dispute
 * moves at human pace — a response filed, a juror's verdict landing, the window
 * ticking down — so a few seconds keeps the panel and tally live without
 * hammering the station.
 */
const DISPUTE_POLL_MS = 5000;

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
    listingTitle: row.listing_title,
    state: row.state,
    oracleTier: row.oracle_tier,
    settleBy: row.settle_by,
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
  vouchCounts: ['ledger', 'vouchCounts'] as const,
  vouches: ['ledger', 'vouches'] as const,
  reputation: ['ledger', 'reputation'] as const,
  charter: ['ledger', 'charter'] as const,
  pendingCharter: ['ledger', 'pendingCharter'] as const,
  proposals: ['ledger', 'proposals'] as const,
  proposal: ['ledger', 'proposal'] as const,
  statutes: ['ledger', 'statutes'] as const,
  disputes: ['ledger', 'disputes'] as const,
  dispute: ['ledger', 'dispute'] as const,
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
      let bootstrap: Identity['bootstrap'];
      if (client !== null) {
        try {
          const who = await client.whoami();
          community = who.community;
          // Present only from a station that carries the grace fields (T1.8.6);
          // a legacy station omits them and Home simply shows no grace banner.
          if (who.bootstrap_in_grace !== undefined) {
            bootstrap = {
              inGrace: who.bootstrap_in_grace,
              established: who.established_members ?? 0,
              threshold: who.grace_threshold ?? 0,
            };
          }
        } catch {
          // Offline or unreachable — the identity is still valid without the
          // community line; the refetch below fills it in.
        }
      }
      return {address, nickname, community, bootstrap};
    },
    // If we are paired but the community line is still blank — e.g. the station
    // was momentarily unreachable when this first ran at launch, so `whoami`
    // threw and cached an empty community on a screen that then stays mounted —
    // keep retrying so it fills in on its own. A reachable station answers the
    // next `whoami`, which sets the community and clears this condition, so the
    // polling stops as soon as the line resolves.
    refetchInterval: query =>
      client !== null && query.state.data?.community === undefined ? 8000 : false,
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

/**
 * This member's vouching tallies for the "your vouching chain" line on the
 * vouch success screen (T1.4.4). Gated by `enabled` so the caller fetches only
 * once it needs them (i.e. after a vouch is recorded); fetched fresh (no stale
 * window) so the just-appended vouch is included in `given`. On failure or
 * offline the query errors and the caller hides the line — it never shows a
 * fabricated number.
 */
export function useVouchCounts(enabled: boolean): UseQueryResult<StationVouchCounts> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.vouchCounts, wallet?.address],
    enabled: enabled && client !== null && wallet !== null,
    queryFn: (): Promise<StationVouchCounts> => client!.vouchCounts(),
    staleTime: 0,
    retry: false,
  });
}

/**
 * This member's vouches for the vouching browser (T1.4.5): the lists it has
 * `given` (signed) and `received` (is the subject of), newest first. Disabled
 * when locked / unpaired; keyed by the client's presence so pairing refetches.
 * Fetched fresh (no stale window) so a just-made vouch shows on next open
 * without a manual refresh.
 */
export function useVouches(): UseQueryResult<StationVouchLists> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.vouches, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: (): Promise<StationVouchLists> => client!.listVouches(),
    staleTime: 0,
  });
}

/**
 * This member's own reputation standing (T1.5.9): the five ADR-0009 dimensions,
 * the composite and band, and the anchoring state. Disabled when locked /
 * unpaired; keyed by the client's presence so pairing refetches.
 *
 * The station serves this from its snapshot cache, so the answer is "as of"
 * `computed_at` rather than live to the second — the Standing screen shows that
 * timestamp instead of implying otherwise. There is no local stale window on top
 * of it: a member who has just been vouched for reopens the screen expecting to
 * see the cap lift, and the station's own cache is what bounds the work.
 */
export function useReputation(): UseQueryResult<StationReputation> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.reputation, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: (): Promise<StationReputation> => client!.reputation(),
    staleTime: 0,
  });
}

/**
 * The community's Charter (T1.9.8) — the constitutional layer the governance hub
 * renders. Disabled when locked / unpaired; keyed by the client's presence so
 * pairing refetches. A community that has not published a genesis Charter comes
 * back with `published: false`, which the hub renders as a bootstrapping state.
 */
export function useCharter(): UseQueryResult<StationCharter> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.charter, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: (): Promise<StationCharter> => client!.governanceCharter(),
    staleTime: 0,
  });
}

/**
 * The state of a distributed founding ceremony (founding-charter) — the genesis
 * Charter body being signed, which founders have signed, and whether it has
 * published. A community with no ceremony under way comes back with
 * `exists: false`. Fetched fresh (no stale window) so a founder's own just-
 * submitted signature, and others' signatures, show on next open, and polled
 * while a ceremony is under way but not yet published so the progress advances
 * without re-opening the screen.
 */
export function usePendingCharter(): UseQueryResult<StationPendingCharter> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.pendingCharter, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: (): Promise<StationPendingCharter> => client!.pendingCharter(),
    staleTime: 0,
    refetchInterval: query =>
      query.state.data?.exists && !query.state.data.published
        ? PROPOSAL_POLL_MS
        : false,
  });
}

/**
 * Every governance proposal the station knows (T1.9.8), newest activity first,
 * for the hub list. Fetched fresh (no stale window) so a just-cast vote or a
 * just-published proposal shows on next open. Disabled when locked / unpaired.
 */
export function useProposals(): UseQueryResult<StationProposalSummary[]> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.proposals, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: async (): Promise<StationProposalSummary[]> =>
      (await client!.governanceProposals()).proposals,
    staleTime: 0,
  });
}

/**
 * One proposal in full (T1.9.8) for the detail screen: summary, markdown body,
 * and co-signers. Keyed by the proposal id; fetched fresh so a co-sign or vote
 * the member just cast is reflected when they return to it.
 *
 * While the proposal is still live it **polls** (every {@link PROPOSAL_POLL_MS}),
 * so the detail screen reflects the community acting in near-real-time — a
 * co-sign that opens voting, ballots landing in the tally, the phase turning
 * over — without the member re-opening it. Polling stops once the proposal has
 * concluded, since a settled outcome no longer changes.
 */
export function useProposal(proposalId: string): UseQueryResult<StationProposalDetail> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.proposal, proposalId, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: (): Promise<StationProposalDetail> => client!.governanceProposal(proposalId),
    staleTime: 0,
    refetchInterval: query =>
      query.state.data?.phase === 'concluded' ? false : PROPOSAL_POLL_MS,
  });
}

/** The statutes in force (T1.9.8): enacted proposals, newest first. */
export function useStatutes(): UseQueryResult<StationStatuteSummary[]> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.statutes, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: async (): Promise<StationStatuteSummary[]> =>
      (await client!.governanceStatutes()).statutes,
    staleTime: 0,
  });
}

/**
 * Returns a function that co-signs a proposal: it builds and signs a
 * {@link createSignedCosign} on-device and transmits it over the authenticated
 * channel (T1.9.8), endorsing the proposal toward its publication threshold.
 * Online-only like a vouch — the endorsement is signed at co-sign time — and on
 * success returns the distinct co-signer count the station now counts.
 */
export function useCosignProposal(): (
  proposalId: string,
) => Promise<WriteResult<{cosignerCount: number}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async proposalId => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const cosignedAt = Math.floor(Date.now() / 1000);
        const cosign = await createSignedCosign(wallet, proposalId, cosignedAt);
        const {cosignerCount} = await client.submitCosign(
          cosign.payloadBytes,
          cosign.signature,
        );
        await queryClient.invalidateQueries({queryKey: ledgerKeys.proposals});
        await queryClient.invalidateQueries({queryKey: ledgerKeys.proposal});
        return {ok: true, cosignerCount};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that casts a ballot on a published proposal: it builds and
 * signs a {@link createSignedVote} on-device and transmits it over the
 * authenticated channel (T1.9.8). Online-only — the ballot is signed at cast
 * time — and the station rejects a second ballot from the same member, so the
 * detail screen treats a successful cast as final.
 */
export function useCastVote(): (
  proposalId: string,
  choice: VoteChoice,
) => Promise<WriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async (proposalId, choice) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const castAt = Math.floor(Date.now() / 1000);
        const vote = await createSignedVote(wallet, proposalId, choice, castAt);
        await client.submitVote(vote.payloadBytes, vote.signature);
        await queryClient.invalidateQueries({queryKey: ledgerKeys.proposals});
        await queryClient.invalidateQueries({queryKey: ledgerKeys.proposal});
        return {ok: true};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that signs the genesis Charter as a founder in a
 * distributed founding ceremony: it reads the ceremony's current body fresh,
 * rebuilds and signs that exact body on-device
 * ({@link createSignedCharterSignature}, which fails safe if the reconstructed
 * body drifts from the station's `body_hex`), and submits only the signature. On
 * success it returns the updated ceremony state (so the caller can show progress
 * or the just-published Charter) and refreshes the ceremony and Charter reads.
 * Online-only — the signature is made at submit time against the live body.
 */
export function useSignFoundingCharter(): () => Promise<
  WriteResult<{pending: StationPendingCharter}>
> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (client === null || wallet === null) {
      return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
    }
    try {
      // Sign the freshest body the station holds, not a possibly-stale one from
      // the screen — the body is fixed at ceremony start, but re-reading keeps
      // the drift check honest against exactly what will be verified server-side.
      const pending = await client.pendingCharter();
      const signed = await createSignedCharterSignature(wallet, pending);
      const updated = await client.submitCharterSignature(signed.signature);
      await queryClient.invalidateQueries({queryKey: ledgerKeys.pendingCharter});
      await queryClient.invalidateQueries({queryKey: ledgerKeys.charter});
      return {ok: true, pending: updated};
    } catch (e) {
      return asWriteError(e);
    }
  }, [client, wallet, queryClient]);
}

/**
 * Every disputed transaction the station knows (T1.10.6), most-recent first, for
 * the dispute list. Fetched fresh (no stale window) so a just-raised dispute or a
 * just-cast verdict shows on next open. Disabled when locked / unpaired. A
 * resolved transaction has left the `Disputed` state, so it drops out of here.
 */
export function useDisputes(): UseQueryResult<DisputeSummary[]> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.disputes, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: async (): Promise<DisputeSummary[]> => (await client!.disputes()).disputes,
    staleTime: 0,
  });
}

/**
 * One dispute in full (T1.10.6) for the detail screen: the summary, both parties'
 * responses, and the seated jury with each juror's verdict. Keyed by the disputed
 * transaction id; fetched fresh so an action the member just took is reflected
 * when they return to it, and **polls** (every {@link DISPUTE_POLL_MS}) while it
 * is on screen so the panel and tally track the community acting in near-real
 * time. A dispute only exists while its transaction is frozen in `Disputed`, so
 * the query stays live until the station enacts the outcome (after which the read
 * errors — the screen surfaces that as "resolved").
 */
export function useDispute(txId: string): UseQueryResult<DisputeDetail> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useQuery({
    queryKey: [...ledgerKeys.dispute, txId, wallet?.address, client !== null],
    enabled: client !== null && wallet !== null,
    queryFn: (): Promise<DisputeDetail> => client!.dispute(txId),
    staleTime: 0,
    refetchInterval: DISPUTE_POLL_MS,
  });
}

/**
 * Returns a function that raises a dispute against a confirmed transaction: it
 * builds and signs a {@link createSignedDispute} on-device and transmits it over
 * the authenticated channel (T1.10.6), freezing settlement across the
 * `Confirmed → Disputed` edge. Online-only — the record is signed at raise time —
 * and the station rejects a non-party or a transaction that is not confirmed.
 */
export function useRaiseDispute(): (
  txId: string,
  reason: string,
) => Promise<WriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async (txId, reason) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const openedAt = Math.floor(Date.now() / 1000);
        const dispute = await createSignedDispute(wallet, txId, reason, openedAt);
        await client.submitDispute(dispute.payloadBytes, dispute.signature);
        await queryClient.invalidateQueries({queryKey: ledgerKeys.activity});
        await queryClient.invalidateQueries({queryKey: ledgerKeys.disputes});
        await queryClient.invalidateQueries({queryKey: ledgerKeys.dispute});
        return {ok: true};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that files the counterparty's response to an open dispute:
 * it builds and signs a {@link createSignedDisputeResponse} on-device and
 * transmits it (T1.10.6). Online-only, and the station rejects a non-party or a
 * second response from the same party, so the detail screen treats a successful
 * response as final.
 */
export function useRespondToDispute(): (
  txId: string,
  statement: string,
) => Promise<WriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async (txId, statement) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const respondedAt = Math.floor(Date.now() / 1000);
        const response = await createSignedDisputeResponse(
          wallet,
          txId,
          statement,
          respondedAt,
        );
        await client.submitDisputeResponse(response.payloadBytes, response.signature);
        await queryClient.invalidateQueries({queryKey: ledgerKeys.dispute});
        return {ok: true};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that casts a seated juror's verdict on an open dispute: it
 * builds and signs a {@link createSignedVerdict} on-device and transmits it
 * (T1.10.6). Online-only — the verdict is signed at cast time — and the station
 * rejects a juror who does not hold a live seat or has already voted, so the
 * detail screen treats a successful verdict as final.
 */
export function useCastVerdict(): (
  txId: string,
  uphold: boolean,
) => Promise<WriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async (txId, uphold) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const castAt = Math.floor(Date.now() / 1000);
        const verdict = await createSignedVerdict(wallet, txId, uphold, castAt);
        await client.submitVerdict(verdict.payloadBytes, verdict.signature);
        await queryClient.invalidateQueries({queryKey: ledgerKeys.dispute});
        return {ok: true};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that puts a dispute to the electorate (ADR-0014 §5,
 * T1.10.6): it builds and signs a {@link createSignedEscalation} on-device and
 * transmits it over the authenticated channel — an `appeal` of a jury ruling or
 * a `cannot_seat` when the pool is too small to seat a panel. Online-only, and
 * the station rejects a non-party, a reason that doesn't fit the dispute's state,
 * or a second escalation, so the detail screen surfaces a typed rejection plainly.
 */
export function useOpenEscalation(): (
  txId: string,
  reason: EscalationReason,
) => Promise<WriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async (txId, reason) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const openedAt = Math.floor(Date.now() / 1000);
        const escalation = await createSignedEscalation(wallet, txId, reason, openedAt);
        await client.submitEscalation(escalation.payloadBytes, escalation.signature);
        await queryClient.invalidateQueries({queryKey: ledgerKeys.dispute});
        return {ok: true};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/**
 * Returns a function that casts a ballot in an open escalation (ADR-0014 §5,
 * T1.10.6): it builds and signs a {@link createSignedEscalationBallot} on-device
 * and transmits it. Online-only — the ballot is signed at cast time — and the
 * station rejects a party (recused), a non-established member, or a second
 * ballot, so the detail screen treats a successful ballot as final.
 */
export function useCastEscalationBallot(): (
  txId: string,
  uphold: boolean,
) => Promise<WriteResult> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const queryClient = useQueryClient();
  return useCallback(
    async (txId, uphold) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const castAt = Math.floor(Date.now() / 1000);
        const ballot = await createSignedEscalationBallot(wallet, txId, uphold, castAt);
        await client.submitEscalationBallot(ballot.payloadBytes, ballot.signature);
        await queryClient.invalidateQueries({queryKey: ledgerKeys.dispute});
        return {ok: true};
      } catch (e) {
        return asWriteError(e);
      }
    },
    [client, wallet, queryClient],
  );
}

/** Current transport state. */
export interface Connectivity {
  level: ConnectivityLevel;
  /** Whether the station is unreachable — drives the offline banner/indicator. */
  isOffline: boolean;
  /**
   * Whether the app is still *establishing* the connection — paired and unlocked
   * but with no confirmed round-trip yet. A distinct in-between: neither a
   * confident "online" nor a settled "offline". Drives the "Connecting…" pill.
   */
  isConnecting: boolean;
}

/**
 * Maps station presence + the reachability verdict to the connectivity a screen
 * shows. Pure (no hooks), so the three-way mapping is unit-testable without a
 * renderer; {@link useConnectivity} is the thin hook that feeds it live values.
 *
 * - No active station (locked, or none paired) → online-optimistic `mesh`: there
 *   is nothing to be offline *from* or connecting *to* (the "pair a station"
 *   empty state is a separate concern the screens handle).
 * - `unknown` while active → **connecting**: no confirmed round-trip yet (or just
 *   after a teardown), the connection is being established — shown as its own
 *   state rather than a premature "online". It resolves fast: the first
 *   successful read marks reachable in milliseconds (see
 *   {@link connectivityStore.noteReachable}), so this shows only during a genuine
 *   establishing window, not for the ~30s a caught-up subscribe long-poll parks.
 * - `unreachable` → **offline**. The store only reaches this after a *run* of
 *   failed passes, not a single reconnect blip — see
 *   {@link connectivityStore.reportPass} — so this never flaps on a lone blip.
 * - `reachable` → `mesh` (online).
 */
export function connectivityFrom(
  hasActiveStation: boolean,
  reachability: Reachability,
): Connectivity {
  if (!hasActiveStation) {
    return {level: 'mesh', isOffline: false, isConnecting: false};
  }
  if (reachability === 'unreachable') {
    return {level: 'offline', isOffline: true, isConnecting: false};
  }
  if (reachability === 'unknown') {
    return {level: 'connecting', isOffline: false, isConnecting: true};
  }
  return {level: 'mesh', isOffline: false, isConnecting: false};
}

/**
 * Station connectivity, driving the header pill and offline banner. The verdict
 * comes from the subscribe long-poll — the app's live connection to the station —
 * rather than a separate `whoami` probe: {@link useStationSubscription} reports
 * each pass's outcome into {@link connectivityStore}, and this hook reflects it.
 * That avoids the probe-vs-subscribe contention that used to flap the indicator
 * on a cold connection pool. See {@link connectivityFrom} for the state mapping.
 */
export function useConnectivity(): Connectivity {
  const client = useStationClient();
  const {station} = useActiveStation();
  const reachability = useSyncExternalStore(
    subscribeReachability,
    getReachability,
  );
  return connectivityFrom(client !== null && station !== null, reachability);
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

/** The memo a marketplace payment carries. It leads with the listing's title so
 * it reads in history as what it is ("Seed potatoes · #71b326ed"), and carries a
 * short slice of the inquiry id so it stays unique — it doubles as the idempotency
 * key the thread screen checks, so a second tap (or the 5s poll) can't pay for the
 * same agreement twice, and two inquiries on the same listing don't collide. */
export function inquiryMemo(inquiryId: string, listingTitle: string): string {
  return `${listingTitle} · #${inquiryId.slice(0, 8)}`;
}

/**
 * Settles an agreed inquiry (T1.7.6): the buyer's payment for the price the
 * provider granted, linked to the listing. The provider agreed by *granting* the
 * inquiry; this is the buyer committing the payment, which the provider then
 * confirms via the standard M0.5 flow (confirm → settlement window → settle).
 *
 * Shares the exact path {@link useSendProposal} uses — station nonce, on-device
 * signing, authenticated transmit, local pending overlay — differing only in the
 * {@link inquiryMemo} and the `listing_id` link the proposal carries. The screen
 * guards against a double payment by checking {@link useActivity} for that memo
 * before offering the action.
 */
export function useSettleAgreement(): (args: {
  inquiryId: string;
  listingTitle: string;
  providerAddress: string;
  amountCenti: number;
  listingIdHex: string;
}) => Promise<WriteResult<{id: string}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  const enqueue = useEnqueueTransaction();
  return useCallback(
    async ({inquiryId, listingTitle, providerAddress, amountCenti, listingIdHex}) => {
      if (client === null || wallet === null) {
        return {ok: false, error: 'locked', message: 'Unlock your wallet and pair a station.'};
      }
      try {
        const {nonce} = await client.nextNonce(wallet.address);
        const now = Math.floor(Date.now() / 1000);
        const proposal = await createSendProposal(
          wallet,
          providerAddress,
          amountCenti,
          inquiryMemo(inquiryId, listingTitle),
          {nonce, proposedAt: now, expiresAt: now + PROPOSAL_EXPIRY_SECS},
          listingIdHex,
        );
        await client.submitSignedRecord(
          'submit_proposal',
          'signed_proposal',
          proposal.payloadBytes,
          proposal.signature,
        );
        await enqueue({
          id: proposal.id,
          counterparty: shortAddress(providerAddress),
          counterpartyAddress: providerAddress,
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
  nickname?: string,
) => Promise<WriteResult<{vouchId: string; community: string}>> {
  const client = useStationClient();
  const {wallet} = useWalletSession();
  return useCallback(
    async (subjectAddress, statement, stakeCenti, nickname) => {
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
        // Persist the local nickname only once the vouch is safely recorded, so
        // the browser can label this subject. A private display hint, kept on
        // this device (never part of the signed attestation).
        if (nickname !== undefined) {
          await saveVouchNickname(subjectAddress, nickname).catch(() => {});
        }
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
