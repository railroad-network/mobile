/**
 * Presentation mapping for transaction state → a {@link Badge} variant + label.
 * Kept next to the ledger types (rather than in a screen) so Home, History, and
 * the detail view all label states identically.
 */
import type {BadgeVariant} from '../components';
import {formatCommonsMagnitude} from './format';
import type {Transaction, TransactionDirection, TransactionState} from './types';

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
 * Who pays whom in a transaction, from this member's side. `direction` alone
 * says only who *proposed* it: a proposal with a negative amount is a payment
 * request, which debits its receiver (ADR-0018). The station keeps the
 * proposal's amount for the receiver and negates it for the sender, so the
 * member-relative sign is the money flow and the pair decides the role:
 *
 * - `paying_you` — inbound, amount ≥ 0: they propose to pay you.
 * - `requesting_from_you` — inbound, amount < 0: they ask you to pay.
 * - `you_paid` — outbound, amount ≤ 0: you proposed to pay them.
 * - `you_requested` — outbound, amount > 0: you asked them to pay.
 *
 * Zero takes the ordinary direction role.
 */
export type PaymentRole = 'paying_you' | 'requesting_from_you' | 'you_paid' | 'you_requested';

/** The {@link PaymentRole} of a transaction. Every money-flow label derives from it. */
export function paymentRole(tx: {direction: TransactionDirection; amountCenti: number}): PaymentRole {
  if (tx.direction === 'in') {
    return tx.amountCenti < 0 ? 'requesting_from_you' : 'paying_you';
  }
  return tx.amountCenti > 0 ? 'you_requested' : 'you_paid';
}

/** The direction-verb wording for one {@link PaymentRole}. */
export interface PaymentCopy {
  /** The list-row line under the title, e.g. `from Ana` / `request from Ana`. */
  caption: string;
  /** The confirm screen's line above the amount, e.g. `Ana is asking you to pay`. */
  heading: string;
  /** The detail screen's line above the amount, e.g. `Requested by Ana`. */
  detailTitle: string;
  /** The detail screen's "Direction" value, e.g. `Payment request — you pay`. */
  directionLabel: string;
  /**
   * The amount with no sign. Use it **only** right after this role's own verb
   * ("Pay 20.00", "asks you to pay 20.00"), where the wording already says which
   * way the money moves; anywhere else, format the signed amount.
   */
  magnitude: string;
}

/**
 * The wording for a transaction in `role` with `counterparty`. The only place
 * direction-verb copy is built, so a request can never read as a payment on one
 * screen and a request on another.
 */
export function paymentCopy(role: PaymentRole, counterparty: string, centi: number): PaymentCopy {
  const magnitude = formatCommonsMagnitude(centi);
  switch (role) {
    case 'paying_you':
      return {
        caption: `from ${counterparty}`,
        heading: `${counterparty} is paying you`,
        detailTitle: `Received from ${counterparty}`,
        directionLabel: 'Incoming credit',
        magnitude,
      };
    case 'requesting_from_you':
      return {
        caption: `request from ${counterparty}`,
        heading: `${counterparty} is asking you to pay`,
        detailTitle: `Requested by ${counterparty}`,
        directionLabel: 'Payment request — you pay',
        magnitude,
      };
    case 'you_paid':
      return {
        caption: `to ${counterparty}`,
        heading: `You paid ${counterparty}`,
        detailTitle: `Sent to ${counterparty}`,
        directionLabel: 'Outgoing debit',
        magnitude,
      };
    case 'you_requested':
      return {
        caption: `request to ${counterparty}`,
        heading: `You asked ${counterparty} to pay`,
        detailTitle: `Requested from ${counterparty}`,
        directionLabel: 'Payment request — they pay',
        magnitude,
      };
  }
}

/** {@link paymentCopy} for a transaction. */
export function txPaymentCopy(tx: Transaction): PaymentCopy {
  return paymentCopy(paymentRole(tx), tx.counterparty, tx.amountCenti);
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
