/**
 * ⚠️ Local decisions overlay — the confirm/reject choices this device has made
 * on incoming proposals but not yet reconciled with a station (M1.3 ships that).
 *
 * The mock ledger reseeds its activity on every fetch, so a confirmation or
 * rejection made in the UI would evaporate on the next refresh. This module
 * remembers those decisions in memory and {@link applyDecisions} folds them onto
 * whatever the (mock, later real) source returns — flipping a confirmed proposal
 * to `confirmed` (with its `confirmedAt`) and a rejected one to `cancelled`. When
 * M1.3 lands, the station is the source of truth for these transitions and this
 * overlay goes away (or becomes an optimistic-update cache).
 *
 * Not persisted, not authoritative; cleared on app restart.
 */
import type {Transaction, TransactionState} from './types';

/** Why a proposal was cancelled — mirrors the station's `CancelReason` strings. */
export type CancelReason = 'rejected_by_receiver' | 'expired';

/** A local confirm/reject decision on one proposal. */
export interface Decision {
  state: Extract<TransactionState, 'confirmed' | 'cancelled'>;
  /** Unix seconds the receiver confirmed (present when `state` is confirmed). */
  confirmedAt?: number;
  /** Why it was cancelled (present when `state` is cancelled). */
  reason?: CancelReason;
}

const decisions = new Map<string, Decision>();

/** The decision recorded for proposal `id`, if any. */
export function getDecision(id: string): Decision | undefined {
  return decisions.get(id);
}

/** Records (or replaces) the local decision for proposal `id`. */
export function recordDecision(id: string, decision: Decision): void {
  decisions.set(id, decision);
}

/** Forgets all recorded decisions (test hook; also a future factory reset). */
export function clearDecisions(): void {
  decisions.clear();
}

/** Returns `txs` with any locally-recorded decisions folded in. */
export function applyDecisions(txs: Transaction[]): Transaction[] {
  if (decisions.size === 0) {
    return txs;
  }
  return txs.map(tx => {
    const decision = decisions.get(tx.id);
    if (decision === undefined) {
      return tx;
    }
    return {...tx, state: decision.state, confirmedAt: decision.confirmedAt ?? tx.confirmedAt};
  });
}
