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
  window: {variant: 'warning', label: 'Dispute window'},
  settled: {variant: 'success', label: 'Settled'},
  cancelled: {variant: 'neutral', label: 'Cancelled'},
  disputed: {variant: 'danger', label: 'Disputed'},
};

/** The badge variant + label for a transaction state. */
export function stateBadge(state: TransactionState): StateBadge {
  return STATE_BADGE[state];
}

/**
 * ⚠️ MOCK settlement window — the real window comes from station config in M1.3
 * (`SettlementConfig.window_seconds`). The station's Phase-0 default is 48h; we
 * mirror it so the confirmed-payment countdown reads the same on-device.
 */
export const SETTLEMENT_WINDOW_SECS = 48 * 3600;

/**
 * Whether a proposal awaiting confirmation has passed its `expiresAt`. An
 * expired proposal can no longer be confirmed (it auto-cancels as `expired`).
 * A transaction with no `expiresAt` is never expired.
 */
export function isExpired(tx: Transaction, now: number = Date.now()): boolean {
  return tx.expiresAt !== undefined && tx.expiresAt * 1000 <= now;
}

/**
 * Unix seconds when a confirmed transaction settles: `confirmedAt` plus the
 * settlement window. Returns `undefined` if it has not been confirmed.
 */
export function settlementAt(tx: Transaction): number | undefined {
  return tx.confirmedAt === undefined ? undefined : tx.confirmedAt + SETTLEMENT_WINDOW_SECS;
}
