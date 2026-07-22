/**
 * @format
 *
 * Event → notification mapping (T1.3.6): the copy built from a transaction row,
 * the per-kind preference gate, and the kinds that never notify. T1.4.1 adds
 * the vouch_received copy, built from the event's vouch row.
 */
import type {
  StationEvent,
  StationEventKind,
  StationTransactionRow,
  StationVouchRow,
} from '../src/network/StationClient';
import {buildEventNotification} from '../src/notifications/eventNotification';
import {DEFAULT_PREFS, type NotificationPrefs} from '../src/notifications/notificationPrefs';

function row(over: Partial<StationTransactionRow> = {}): StationTransactionRow {
  return {
    id: 'tx1',
    counterparty_address: 'rrn1counterpartyaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    direction: 'in',
    amount_centi: 500,
    state: 'pending',
    timestamp: 1_700_000_000,
    nonce: 0,
    ...over,
  };
}

function event(kind: StationEventKind, over: Partial<StationTransactionRow> = {}): StationEvent {
  return {id: 7, kind, transaction: row(over)};
}

function vouchEvent(over: Partial<StationVouchRow> = {}): StationEvent {
  return {
    id: 9,
    kind: 'vouch_received',
    vouch: {
      vouch_id: 'ab'.repeat(32),
      voucher_address: 'rrn1voucheraddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      community: 'rrn-phase0',
      statement: 'I know them in person',
      stake_centi: 150,
      issued_at: 1_700_000_000,
      ...over,
    },
  };
}

const allOn: NotificationPrefs = {
  notificationsEnabled: true,
  backgroundSyncEnabled: false,
  kinds: {
    proposal_received: true,
    confirmation_received: true,
    settlement: true,
    cancellation: true,
  },
};

describe('buildEventNotification', () => {
  test('proposal_received builds an "Incoming payment" notification with amount + short address', () => {
    const n = buildEventNotification(event('proposal_received', {memo: 'lunch'}), allOn);
    expect(n).not.toBeNull();
    expect(n!.id).toBe('event-7');
    expect(n!.title).toBe('Incoming payment');
    expect(n!.body).toContain('5.00 ₡');
    expect(n!.body).toContain('rrn1count…'); // shortened
    expect(n!.body).toContain('lunch');
    expect(n!.body).toContain('confirm');
  });

  test('proposal_received without a memo omits the memo clause', () => {
    const n = buildEventNotification(event('proposal_received'), allOn);
    expect(n!.body).not.toContain('—');
  });

  test('settlement and confirmation and cancellation each produce content when enabled', () => {
    expect(buildEventNotification(event('settlement'), allOn)!.title).toBe('Payment settled');
    expect(buildEventNotification(event('confirmation_received'), allOn)!.title).toBe(
      'Payment confirmed',
    );
    expect(buildEventNotification(event('cancellation'), allOn)!.title).toBe('Payment cancelled');
  });

  test('returns null when the kind is switched off', () => {
    const prefs: NotificationPrefs = {...allOn, kinds: {...allOn.kinds, proposal_received: false}};
    expect(buildEventNotification(event('proposal_received'), prefs)).toBeNull();
  });

  test('returns null when the master switch is off', () => {
    const prefs: NotificationPrefs = {...allOn, notificationsEnabled: false};
    expect(buildEventNotification(event('proposal_received'), prefs)).toBeNull();
  });

  test('follows the built-in defaults (settlement on, confirmation off)', () => {
    const prefs = {...DEFAULT_PREFS, kinds: {}};
    expect(buildEventNotification(event('settlement'), prefs)).not.toBeNull();
    expect(buildEventNotification(event('confirmation_received'), prefs)).toBeNull();
  });

  test('kinds with no live source never notify, even fully enabled', () => {
    const prefs: NotificationPrefs = {
      notificationsEnabled: true,
      backgroundSyncEnabled: false,
      kinds: {listing_match: true, governance_proposal: true, vote_needed: true},
    };
    for (const kind of ['listing_match', 'governance_proposal', 'vote_needed'] as const) {
      expect(buildEventNotification(event(kind), prefs)).toBeNull();
    }
  });

  test('vouch_received builds a notification from the voucher and statement', () => {
    const prefs = {...DEFAULT_PREFS, kinds: {}}; // vouch_received defaults on
    const n = buildEventNotification(vouchEvent(), prefs);
    expect(n).not.toBeNull();
    expect(n!.id).toBe('event-9');
    expect(n!.title).toBe('Someone vouched for you');
    expect(n!.body).toContain('rrn1vouch…'); // shortened
    expect(n!.body).toContain('I know them in person');
  });

  test('vouch_received with an empty statement still reads sensibly', () => {
    const n = buildEventNotification(vouchEvent({statement: ''}), {...DEFAULT_PREFS, kinds: {}});
    expect(n!.body).toContain('vouched for you');
  });

  test('an event missing its payload row never notifies', () => {
    // A vouch event without a vouch row, and a ledger event without a
    // transaction row: malformed on the wire, dropped rather than crashed on.
    expect(
      buildEventNotification({id: 1, kind: 'vouch_received'}, {...DEFAULT_PREFS, kinds: {}}),
    ).toBeNull();
    expect(
      buildEventNotification({id: 2, kind: 'proposal_received'}, {...DEFAULT_PREFS, kinds: {}}),
    ).toBeNull();
  });
});
