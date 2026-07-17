/**
 * @format
 *
 * Activity assembly (T1.3.4): how the station's authoritative transactions are
 * folded together with the local outbox and confirm/reject decisions into the
 * list History and Home render. The ordering contract matters — History groups
 * rows into day sections by walking the list and starting a new section when the
 * day label changes, so anything out of order repeats a day header — and the
 * station's copy of a transaction must win over a stale local outbox entry.
 */
import {assembleActivity, stationRowToTransaction} from '../src/ledger/useLedger';
import {clearDecisions, recordDecision} from '../src/ledger/decisions';
import {addToOutbox, clearOutbox} from '../src/ledger/outbox';
import type {Transaction} from '../src/ledger';
import type {StationTransactionRow} from '../src/network/StationClient';

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

const COUNTERPARTY = 'rrn1q9f2c8x7v3k0p4m6w2j5h8n1d4s7a0zqr';
const row = (o: Partial<StationTransactionRow>): StationTransactionRow => ({
  id: 'r',
  counterparty_address: COUNTERPARTY,
  direction: 'in',
  amount_centi: 500,
  state: 'settled',
  timestamp: now,
  nonce: 0,
  ...o,
});

describe('stationRowToTransaction', () => {
  afterEach(() => {
    clearOutbox();
    clearDecisions();
  });

  test('maps the station row to the display model, sign and direction intact', () => {
    const t = stationRowToTransaction(
      row({id: 'abc', direction: 'out', amount_centi: -300, memo: 'lunch', state: 'confirmed', confirmed_at: 42}),
    );
    expect(t).toMatchObject({
      id: 'abc',
      counterpartyAddress: COUNTERPARTY,
      direction: 'out',
      amountCenti: -300,
      memo: 'lunch',
      state: 'confirmed',
      confirmedAt: 42,
    });
    // The counterparty label is a shortened address until a contact book exists.
    expect(t.counterparty).toContain('…');
  });
});

describe('assembleActivity', () => {
  afterEach(() => {
    clearOutbox();
    clearDecisions();
  });

  test('returns the merged activity newest-first', () => {
    const out = assembleActivity([
      stationRowToTransaction(row({id: 'a', timestamp: now - 100})),
      stationRowToTransaction(row({id: 'b', timestamp: now - 5})),
    ]);
    const stamps = out.map(t => t.timestamp);
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });

  test('places a freshly-queued outbox transaction at the top', () => {
    addToOutbox(tx({id: 'fresh', timestamp: now + 1}));
    const out = assembleActivity([stationRowToTransaction(row({id: 'a', timestamp: now - 100}))]);
    expect(out[0].id).toBe('fresh');
  });

  test('never repeats a day: each timestamp is older than the one before it', () => {
    addToOutbox(tx({id: 'stale', timestamp: now - 30 * 3600}));
    const out = assembleActivity([
      stationRowToTransaction(row({id: 'a', timestamp: now})),
      stationRowToTransaction(row({id: 'b', timestamp: now - 40 * 3600})),
    ]);
    const stale = out.findIndex(t => t.id === 'stale');
    expect(stale).toBeGreaterThan(0);
    expect(out[stale - 1].timestamp).toBeGreaterThanOrEqual(out[stale].timestamp);
  });

  test('the station copy wins over a stale outbox entry with the same id', () => {
    // The device queued a proposal locally (pending); the station now reports it
    // settled. The row should de-dupe to one entry, in the station's state.
    addToOutbox(tx({id: 'shared', state: 'pending', timestamp: now}));
    const out = assembleActivity([
      stationRowToTransaction(row({id: 'shared', state: 'settled', timestamp: now})),
    ]);
    const matches = out.filter(t => t.id === 'shared');
    expect(matches).toHaveLength(1);
    expect(matches[0].state).toBe('settled');
  });

  test('a local decision overlays onto the assembled list', () => {
    recordDecision('p', {state: 'confirmed', confirmedAt: now});
    const out = assembleActivity([
      stationRowToTransaction(row({id: 'p', direction: 'in', state: 'pending'})),
    ]);
    expect(out.find(t => t.id === 'p')?.state).toBe('confirmed');
  });
});
