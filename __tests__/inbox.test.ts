/**
 * @format
 *
 * The confirmation inbox plumbing (T1.2.6): the local decisions overlay folds
 * confirm/reject choices onto the ledger, and the expiry/settlement helpers
 * drive the countdown and the expired-and-uncomfirmable state.
 */
import {applyDecisions, clearDecisions, recordDecision} from '../src/ledger/decisions';
import {isExpired, settlementAt, SETTLEMENT_WINDOW_SECS} from '../src/ledger/txDisplay';
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
});

describe('isExpired / settlementAt', () => {
  test('isExpired compares expiresAt (secs) against now (ms)', () => {
    expect(isExpired(tx({expiresAt: 1000}), 2_000_000)).toBe(true);
    expect(isExpired(tx({expiresAt: 1000}), 500)).toBe(false);
    expect(isExpired(tx({}), Number.MAX_SAFE_INTEGER)).toBe(false); // no expiry → never
  });

  test('settlementAt is confirmedAt + window, or undefined when unconfirmed', () => {
    expect(settlementAt(tx({confirmedAt: 100}))).toBe(100 + SETTLEMENT_WINDOW_SECS);
    expect(settlementAt(tx({}))).toBeUndefined();
  });
});
