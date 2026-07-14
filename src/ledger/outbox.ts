/**
 * ⚠️ Local outbox — the pending proposals this device has created but not yet
 * transmitted. In M1.2 there is no transport (M1.3 ships mobile↔station RPC), so
 * a freshly-sent payment has nowhere authoritative to live; it is kept here, in
 * memory, purely so the sender sees it as **Pending** in Home/History right
 * away (the T1.2.5 / T1.2.7 acceptance criterion).
 *
 * This is deliberately not persisted and not authoritative: it is cleared on app
 * restart, and holds the *display* {@link Transaction} (outgoing, so a debit —
 * negative amount), not the signed proposal bytes. When M1.3 lands, the real
 * queue replaces this module (same "add on send, show as pending, reconcile when
 * the station confirms" shape), carrying the {@link SignedSendProposal} for
 * transmission and reconciling against station state.
 */
import type {Transaction} from './types';

let entries: Transaction[] = [];

/** The pending outgoing transactions, newest first. */
export function getOutbox(): Transaction[] {
  return entries;
}

/** Adds a freshly-created pending transaction to the front of the outbox. */
export function addToOutbox(tx: Transaction): void {
  entries = [tx, ...entries];
}

/** How many proposals are queued locally — the M1.2 stand-in for the nonce. */
export function outboxCount(): number {
  return entries.length;
}

/** Empties the outbox (test hook; also used by a future factory reset). */
export function clearOutbox(): void {
  entries = [];
}
