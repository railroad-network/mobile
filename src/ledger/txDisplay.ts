/**
 * Presentation mapping for transaction state → a {@link Badge} variant + label.
 * Kept next to the ledger types (rather than in a screen) so Home, History, and
 * the detail view all label states identically.
 */
import type {BadgeVariant} from '../components';
import type {Transaction, TransactionState} from './types';

export interface StateBadge {
  variant: BadgeVariant;
  label: string;
}

const STATE_BADGE: Record<TransactionState, StateBadge> = {
  pending: {variant: 'neutral', label: 'Pending'},
  confirmed: {variant: 'info', label: 'Confirmed'},
  window: {variant: 'warning', label: 'Settlement window'},
  settled: {variant: 'success', label: 'Settled'},
  cancelled: {variant: 'neutral', label: 'Cancelled'},
  disputed: {variant: 'danger', label: 'Disputed'},
};

/** The badge variant + label for a transaction state. */
export function stateBadge(state: TransactionState): StateBadge {
  return STATE_BADGE[state];
}

/**
 * The per-tier settlement windows (ADR-0011): Tier 1 = 24h, Tier 2 = 48h. Used
 * only as a **fallback** when the station did not send `settleBy` — a station
 * predating T1.8.6, or a locally-confirmed proposal not yet re-read. Normally the
 * countdown reads the station's authoritative `settleBy`.
 */
export const TIER1_WINDOW_SECS = 24 * 3600;
export const TIER2_WINDOW_SECS = 48 * 3600;

/** The fallback settlement window for a tier. An absent/unknown tier assumes
 * Tier 2 — the longer, safer window (never under-count the dispute window). */
export function settlementWindowSecs(tier?: number): number {
  return tier === 1 ? TIER1_WINDOW_SECS : TIER2_WINDOW_SECS;
}

/**
 * The tier badge for a transaction, or `null` when it should stay quiet. Tier 1
 * is the unremarkable default (no badge); Tier 2 is surfaced because the
 * confirmer stakes reputation on it — worth the member seeing.
 */
export function tierBadge(tier?: number): StateBadge | null {
  return tier === 2 ? {variant: 'info', label: 'Tier 2 · staked'} : null;
}

/** A human label for a tier, for the detail view (which shows it either way). */
export function tierLabel(tier?: number): string {
  return tier === 2 ? 'Tier 2 — reputation-staked' : 'Tier 1 — settlement window';
}

/**
 * Whether a proposal awaiting confirmation has passed its `expiresAt`. An
 * expired proposal can no longer be confirmed (it auto-cancels as `expired`).
 * A transaction with no `expiresAt` is never expired.
 */
export function isExpired(tx: Transaction, now: number = Date.now()): boolean {
  return tx.expiresAt !== undefined && tx.expiresAt * 1000 <= now;
}

/**
 * Unix seconds when a confirmed transaction settles. Prefers the station's
 * authoritative `settleBy` (T1.8.6); falls back to `confirmedAt` plus the tier's
 * window when the station didn't send it (a legacy station, or a just-confirmed
 * proposal whose re-read hasn't landed). Returns `undefined` if unconfirmed.
 */
export function settlementAt(tx: Transaction): number | undefined {
  if (tx.settleBy !== undefined) {
    return tx.settleBy;
  }
  return tx.confirmedAt === undefined
    ? undefined
    : tx.confirmedAt + settlementWindowSecs(tx.oracleTier);
}
