/**
 * Presentation mapping for transaction state → a {@link Badge} variant + label.
 * Kept next to the ledger types (rather than in a screen) so Home, History, and
 * the detail view all label states identically.
 */
import type {BadgeVariant} from '../components';
import type {TransactionState} from './types';

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
