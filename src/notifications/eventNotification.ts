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
 */
import {formatCommons, shortAddress} from '../ledger/format';
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
    const {amount_centi, counterparty_address, memo} = event.transaction;
    const amount = `${formatCommons(amount_centi)} ${COMMONS}`;
    const who = shortAddress(counterparty_address);
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
    const {amount_centi, counterparty_address} = event.transaction;
    return {
      title: 'Payment confirmed',
      body: `${shortAddress(counterparty_address)} confirmed ${formatCommons(amount_centi)} ${COMMONS}.`,
    };
  },
  settlement: event => {
    if (event.transaction === undefined) {
      return null;
    }
    const {amount_centi, counterparty_address} = event.transaction;
    return {
      title: 'Payment settled',
      body: `${formatCommons(amount_centi)} ${COMMONS} with ${shortAddress(counterparty_address)} has settled.`,
    };
  },
  cancellation: event => {
    if (event.transaction === undefined) {
      return null;
    }
    const {amount_centi, counterparty_address} = event.transaction;
    return {
      title: 'Payment cancelled',
      body: `${formatCommons(amount_centi)} ${COMMONS} with ${shortAddress(counterparty_address)} was cancelled.`,
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
