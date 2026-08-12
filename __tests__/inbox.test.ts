/**
 * @format
 *
 * The confirmation inbox plumbing (T1.2.6): the local decisions overlay folds
 * confirm/reject choices onto the ledger, and the expiry/settlement helpers
 * drive the countdown and the expired-and-uncomfirmable state.
 */
import {applyDecisions, clearDecisions, recordDecision} from '../src/ledger/decisions';
import {
  isExpired,
  settlementAt,
  TIER1_WINDOW_SECS,
  TIER2_WINDOW_SECS,
} from '../src/ledger/txDisplay';
import type {Transaction} from '../src/ledger';

const tx = (o: Partial<Transaction>): Transaction => ({
  id: 'x',
  counterparty: 'a',
  counterpartyAddress: 'rrn1',
  direction: 'in',
  amountCenti: 100,
  state: 'pending',
  timestamp: 0,
  ...o,
});

describe('applyDecisions', () => {
  afterEach(() => clearDecisions());

  test('folds a confirmed decision (with confirmedAt) onto the matching tx', () => {
    recordDecision('x', {state: 'confirmed', confirmedAt: 500});
    const [out] = applyDecisions([tx({id: 'x'})]);
    expect(out.state).toBe('confirmed');
    expect(out.confirmedAt).toBe(500);
  });

  test('folds a rejected decision onto the matching tx', () => {
    recordDecision('x', {state: 'cancelled', reason: 'rejected_by_receiver'});
    const [out] = applyDecisions([tx({id: 'x'})]);
    expect(out.state).toBe('cancelled');
  });

  test('leaves undecided transactions untouched', () => {
    const input = [tx({id: 'y'})];
    expect(applyDecisions(input)).toEqual(input);
  });

  test('does not mask a station row that has advanced past pending', () => {
    // The station is authoritative once it reconciles the proposal. A stale local
    // "confirmed" decision must not override a `cancelled` row for a transfer the
    // dispute jury voided after the receiver had confirmed it (T1.10.7 finding).
    recordDecision('x', {state: 'confirmed', confirmedAt: 500});
    expect(applyDecisions([tx({id: 'x', state: 'cancelled'})])[0].state).toBe('cancelled');
    expect(applyDecisions([tx({id: 'x', state: 'settled'})])[0].state).toBe('settled');
    expect(applyDecisions([tx({id: 'x', state: 'disputed'})])[0].state).toBe('disputed');
  });
});

describe('isExpired / settlementAt', () => {
  test('isExpired compares expiresAt (secs) against now (ms)', () => {
    expect(isExpired(tx({expiresAt: 1000}), 2_000_000)).toBe(true);
    expect(isExpired(tx({expiresAt: 1000}), 500)).toBe(false);
    expect(isExpired(tx({}), Number.MAX_SAFE_INTEGER)).toBe(false); // no expiry → never
  });

  test('settlementAt prefers the station settleBy, else falls back to a tier window', () => {
    // The station's authoritative settle-by wins when present.
    expect(settlementAt(tx({confirmedAt: 100, settleBy: 9_999}))).toBe(9_999);
    // No settleBy: fall back to confirmedAt + the tier's window.
    expect(settlementAt(tx({confirmedAt: 100, oracleTier: 1}))).toBe(100 + TIER1_WINDOW_SECS);
    expect(settlementAt(tx({confirmedAt: 100, oracleTier: 2}))).toBe(100 + TIER2_WINDOW_SECS);
    // Unknown tier assumes the longer Tier-2 window.
    expect(settlementAt(tx({confirmedAt: 100}))).toBe(100 + TIER2_WINDOW_SECS);
    // Unconfirmed → nothing to settle.
    expect(settlementAt(tx({}))).toBeUndefined();
  });
});
