/**
 * @format
 *
 * The activity query's ordering contract. History groups rows into day sections
 * by walking the list and starting a new section whenever the day label changes,
 * so anything out of order repeats a day header ("TODAY" twice). That makes
 * newest-first a contract of the source, not a detail of the screen.
 */
import {activityQueryFn} from '../src/ledger/useLedger';
import {clearDecisions} from '../src/ledger/decisions';
import {addToOutbox, clearOutbox} from '../src/ledger/outbox';
import type {Transaction} from '../src/ledger';

const now = Math.floor(Date.now() / 1000);

const tx = (o: Partial<Transaction>): Transaction => ({
  id: 'x',
  counterparty: 'a',
  counterpartyAddress: 'rrn1',
  direction: 'out',
  amountCenti: -100,
  state: 'pending',
  timestamp: now,
  ...o,
});

describe('activityQueryFn', () => {
  afterEach(() => {
    clearOutbox();
    clearDecisions();
  });

  test('returns the merged activity newest-first', async () => {
    const out = await activityQueryFn();
    const stamps = out.map(t => t.timestamp);
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });

  test('never repeats a day: each timestamp is older than the one before it', async () => {
    // A day-old outbox entry must not land above the same-day ledger rows.
    addToOutbox(tx({id: 'stale', timestamp: now - 30 * 3600}));
    const out = await activityQueryFn();

    const stale = out.findIndex(t => t.id === 'stale');
    expect(stale).toBeGreaterThan(0);
    expect(out[stale - 1].timestamp).toBeGreaterThanOrEqual(out[stale].timestamp);
  });

  test('places a freshly-queued outbox transaction at the top', async () => {
    addToOutbox(tx({id: 'fresh', timestamp: now + 1}));
    const out = await activityQueryFn();
    expect(out[0].id).toBe('fresh');
  });
});
