/**
 * @format
 *
 * Confirm received payment flow (T1.2.6). Drives the real ConfirmReceived screen
 * over mocked ledger + wallet + confirmation-signing, asserting the acceptance
 * behaviours: confirming re-unlocks the wallet, signs a confirmation, records the
 * decision, and shows the settlement countdown; rejecting records a cancelled
 * decision with the right reason; and an expired proposal cannot be confirmed.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {ConfirmReceived} from '../src/screens/main/ConfirmReceived';
import type {Transaction} from '../src/ledger';

const PROPOSAL_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';

// --- Mocks ------------------------------------------------------------------

const mockActivity: {data?: Transaction[]} = {};
const mockRecord = jest.fn(async () => {});
// The confirm hook signs + transmits; the screen test asserts it's called with
// the proposal id and reacts to its typed result.
const mockConfirmProposal = jest.fn();
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useActivity: () => mockActivity,
  useRecordDecision: () => mockRecord,
  useConfirmProposal: () => mockConfirmProposal,
}));

// --- Harness ----------------------------------------------------------------

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {goBack: jest.fn(), navigate: jest.fn()} as any;
}

function proposal(overrides: Partial<Transaction> = {}): Transaction {
  const nowSecs = Math.floor(Date.now() / 1000);
  return {
    id: PROPOSAL_ID,
    counterparty: 'valley_farm',
    counterpartyAddress: 'rrn1qvalley',
    direction: 'in',
    amountCenti: 1500,
    memo: 'Split the seed order',
    state: 'pending',
    timestamp: nowSecs - 3600,
    expiresAt: nowSecs + 172800,
    ...overrides,
  };
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

let current: Renderer | undefined;

async function renderScreen(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ConfirmReceived navigation={navigation} route={{params: {id: PROPOSAL_ID}} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  current = r;
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text)).length > 0;
const buttons = (r: Renderer, name: string): Instance[] =>
  r.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  );
const button = (r: Renderer, name: string): Instance => buttons(r, name)[0];
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}

afterEach(() => {
  // Unmount so the Countdown's interval is cleared (no leaked timers).
  act(() => current?.unmount());
  current = undefined;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockActivity.data = [proposal()];
  mockConfirmProposal.mockResolvedValue({ok: true});
});

// --- Tests ------------------------------------------------------------------

test('shows the proposal detail', async () => {
  const r = await renderScreen();
  expect(hasText(r, 'valley_farm is paying you')).toBe(true);
  expect(hasText(r, 'Split the seed order')).toBe(true);
});

test('confirming signs + sends via the hook and shows the countdown — no re-prompt', async () => {
  const r = await renderScreen();
  // The wallet is unlocked for the session; one tap signs, sends, and advances.
  await press(button(r, 'Confirm — I received this'));

  expect(mockConfirmProposal).toHaveBeenCalledWith(PROPOSAL_ID);
  expect(hasText(r, 'You confirmed receipt')).toBe(true);
  expect(hasText(r, 'WILL SETTLE IN')).toBe(true);
});

test('rejecting records a cancelled decision with the right reason', async () => {
  const r = await renderScreen();
  await press(button(r, 'Reject'));
  expect(mockRecord).toHaveBeenCalledWith(PROPOSAL_ID, {
    state: 'cancelled',
    reason: 'rejected_by_receiver',
  });
  expect(mockConfirmProposal).not.toHaveBeenCalled();
  expect(hasText(r, 'Proposal rejected')).toBe(true);
});

test('an expired proposal cannot be confirmed', async () => {
  mockActivity.data = [proposal({expiresAt: Math.floor(Date.now() / 1000) - 3600})];
  const r = await renderScreen();
  expect(hasText(r, 'This proposal expired')).toBe(true);
  expect(buttons(r, 'Confirm — I received this')).toHaveLength(0);
});

test('a confirm that cannot reach the station surfaces a failure and stays on the detail', async () => {
  mockConfirmProposal.mockResolvedValue({
    ok: false,
    error: 'unreachable',
    message: 'ECONNREFUSED',
  });
  const r = await renderScreen();
  await press(button(r, 'Confirm — I received this'));
  expect(hasText(r, 'Not confirmed')).toBe(true);
  expect(hasText(r, 'Couldn’t reach your station')).toBe(true);
  expect(hasText(r, 'You confirmed receipt')).toBe(false);
});
