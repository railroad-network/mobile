/**
 * Turns a station push event into local-notification content (T1.3.6).
 *
 * Pure and dependency-free (no native, no React), so the copy and the
 * preference gating are unit-testable. {@link buildEventNotification} returns
 * `null` when the event should not raise a notification — either the user has
 * that kind switched off (see {@link notifications/notificationPrefs}) or the
 * kind has no notification defined (the not-yet-live kinds). Callers only display
 * a non-null result.
 *
 * The copy is built from the payload the event carries — the member-relative
 * transaction row for the ledger kinds (the same shape the history view
 * renders), the vouch row for `vouch_received` — so amounts and counterparties
 * read consistently with the rest of the app.
 *
 * Wording follows who pays whom ({@link paymentRole}), not just the row's
 * direction: a proposal with a negative amount is a payment request the member
 * would pay, and is announced as one.
 */
import {formatCommons, formatSignedCommons, shortAddress} from '../ledger/format';
import {paymentCopy, paymentRole} from '../ledger/txDisplay';
import type {StationEvent, StationEventKind} from '../network/StationClient';
import {shouldNotify, type NotificationPrefs} from './notificationPrefs';
import type {NotificationContent} from './Notifications';

/** The Commons unit symbol, matching the wallet UI. */
const COMMONS = '₡';

/** Copy for a kind, given the event's payload. `null` = no notification. */
type Copy = (event: StationEvent) => {title: string; body: string} | null;

const COPY: Partial<Record<StationEventKind, Copy>> = {
  proposal_received: event => {
    if (event.transaction === undefined) {
      return null;
    }
    const {amount_centi, counterparty_address, direction, memo} = event.transaction;
    const who = shortAddress(counterparty_address);
    if (paymentRole({direction, amountCenti: amount_centi}) === 'requesting_from_you') {
      const magnitude = paymentCopy('requesting_from_you', who, amount_centi).magnitude;
      return {
        title: 'Payment request',
        body: memo
          ? `${who} asks you to pay ${magnitude} ${COMMONS} — ${memo}. Tap to review.`
          : `${who} asks you to pay ${magnitude} ${COMMONS}. Tap to review.`,
      };
    }
    const amount = `${formatCommons(amount_centi)} ${COMMONS}`;
    return {
      title: 'Incoming payment',
      body: memo
        ? `${amount} from ${who} — ${memo}. Tap to confirm.`
        : `${amount} from ${who}. Tap to confirm.`,
    };
  },
  confirmation_received: event => {
    if (event.transaction === undefined) {
      return null;
    }
    const {amount_centi, counterparty_address, direction} = event.transaction;
    const who = shortAddress(counterparty_address);
    const role = paymentRole({direction, amountCenti: amount_centi});
    const magnitude = paymentCopy(role, who, amount_centi).magnitude;
    switch (role) {
      case 'you_paid':
        return {
          title: 'Payment confirmed',
          body: `${who} confirmed your payment of ${magnitude} ${COMMONS}.`,
        };
      case 'you_requested':
        return {
          title: 'Payment confirmed',
          body: `${who} agreed to pay your request of ${magnitude} ${COMMONS}.`,
        };
      default:
        // The confirmer is the proposal's receiver, so this event reaches the
        // proposer (an `out` row). An `in` row is unexpected; word it neutrally
        // with the member-relative sign.
        return {
          title: 'Payment confirmed',
          body: `${who} confirmed ${formatSignedCommons(amount_centi)} ${COMMONS}.`,
        };
    }
  },
  settlement: event => {
    if (event.transaction === undefined) {
      return null;
    }
    const {amount_centi, counterparty_address} = event.transaction;
    return {
      title: 'Payment settled',
      body: `${formatSignedCommons(amount_centi)} ${COMMONS} with ${shortAddress(counterparty_address)} has settled.`,
    };
  },
  cancellation: event => {
    if (event.transaction === undefined) {
      return null;
    }
    const {amount_centi, counterparty_address} = event.transaction;
    return {
      title: 'Payment cancelled',
      body: `${formatSignedCommons(amount_centi)} ${COMMONS} with ${shortAddress(counterparty_address)} was cancelled.`,
    };
  },
  vouch_received: event => {
    if (event.vouch === undefined) {
      return null;
    }
    const {voucher_address, statement} = event.vouch;
    const who = shortAddress(voucher_address);
    return {
      title: 'Someone vouched for you',
      body: statement.trim().length > 0 ? `${who}: “${statement.trim()}”` : `${who} vouched for you.`,
    };
  },
};

/**
 * The notification content for `event` under `prefs`, or `null` if none should
 * be shown. The id is the event id so a re-drain (same event) replaces rather
 * than stacks a duplicate.
 */
export function buildEventNotification(
  event: StationEvent,
  prefs: NotificationPrefs,
): NotificationContent | null {
  if (!shouldNotify(prefs, event.kind)) {
    return null;
  }
  const copy = COPY[event.kind]?.(event);
  if (copy === undefined || copy === null) {
    return null;
  }
  return {id: `event-${event.id}`, title: copy.title, body: copy.body};
}
