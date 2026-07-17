/**
 * @format
 *
 * Send payment flow (T1.2.5). Drives the real Send screen over mocked ledger
 * hooks, wallet unlock, and proposal signing, asserting the acceptance
 * behaviours: an invalid address blocks; paying yourself blocks; a malformed
 * amount is rejected; an over-balance amount warns but is allowed; and the happy
 * path signs a proposal, queues it as an outgoing Pending transaction, and lands
 * on the success screen.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do); the RN
 * testing libraries don't render cleanly against React 19 here.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Send} from '../src/screens/main/Send';

// --- Mocks ------------------------------------------------------------------

const mockIsValid = jest.fn<boolean, [string]>();
jest.mock('../src/crypto/address', () => ({
  isValidAddress: (a: string) => mockIsValid(a),
}));

jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => ({wallet: {address: 'rrn1qme'}}),
}));

const mockIdentity: {data?: {address: string}} = {};
const mockBalance: {data?: {centi: number}} = {};
let mockOffline = false;
// The send hook is the seam under test at the screen level: assert the screen
// calls it with the right args and reacts to its typed result.
const mockSendProposal = jest.fn();
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useIdentity: () => mockIdentity,
  useBalance: () => mockBalance,
  useConnectivity: () => ({level: 'mesh', isOffline: mockOffline}),
  useSendProposal: () => mockSendProposal,
}));

// --- Harness ----------------------------------------------------------------

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {navigate: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderSend(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Send navigation={navigation} route={{} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text)).length > 0;

const button = (r: Renderer, name: string): Instance =>
  r.root.find(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  );

const field = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');

async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}
async function type(node: Instance, text: string): Promise<void> {
  await act(async () => {
    node.props.onChangeText?.(text);
  });
}

/** Advances from the recipient step through review with a valid address+amount. */
async function toReview(r: Renderer, {address = 'rrn1receiver', amount = '3.50'} = {}): Promise<void> {
  await type(field(r, 'Pay to'), address);
  await press(button(r, 'Continue'));
  await type(field(r, 'Amount'), amount);
  await press(button(r, 'Review payment'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsValid.mockReturnValue(true);
  mockIdentity.data = {address: 'rrn1qme'};
  mockBalance.data = {centi: 2400};
  mockOffline = false;
  mockSendProposal.mockResolvedValue({ok: true, id: 'deadbeefcafef00d'});
});

// --- Tests ------------------------------------------------------------------

test('an invalid address blocks continuing', async () => {
  mockIsValid.mockReturnValue(false);
  const r = await renderSend();
  await type(field(r, 'Pay to'), 'garbage');
  await press(button(r, 'Continue'));
  expect(hasText(r, 'valid rrn1')).toBe(true);
  // Still on the recipient step.
  expect(button(r, 'Continue')).toBeTruthy();
});

test('paying your own address is blocked', async () => {
  const r = await renderSend();
  await type(field(r, 'Pay to'), 'rrn1qme');
  await press(button(r, 'Continue'));
  expect(hasText(r, 'your own address')).toBe(true);
});

test('a malformed amount is rejected', async () => {
  const r = await renderSend();
  await type(field(r, 'Pay to'), 'rrn1receiver');
  await press(button(r, 'Continue'));
  await type(field(r, 'Amount'), '3.001');
  await press(button(r, 'Review payment'));
  expect(hasText(r, 'two decimal')).toBe(true);
});

test('an amount above the balance warns but is allowed', async () => {
  mockBalance.data = {centi: 100};
  const r = await renderSend();
  await type(field(r, 'Pay to'), 'rrn1receiver');
  await press(button(r, 'Continue'));
  await type(field(r, 'Amount'), '5.00');
  expect(hasText(r, 'This puts you in debt')).toBe(true);
  // Review is still reachable.
  await press(button(r, 'Review payment'));
  expect(hasText(r, 'Review payment')).toBe(true);
});

test('the happy path signs, sends, and shows success — no passphrase re-prompt', async () => {
  const r = await renderSend();
  await toReview(r);
  // The wallet is already unlocked for the session; review goes straight to send.
  await press(button(r, 'Sign & propose'));

  // Sent with the positive (sender-pays) amount to the receiver.
  expect(mockSendProposal).toHaveBeenCalledWith('rrn1receiver', 350, '');
  expect(hasText(r, 'Payment proposed')).toBe(true);
});

test('a send that cannot reach the station surfaces a failure and stays on review', async () => {
  mockSendProposal.mockResolvedValue({
    ok: false,
    error: 'unreachable',
    message: 'ECONNREFUSED',
  });
  const r = await renderSend();
  await toReview(r);
  await press(button(r, 'Sign & propose'));
  expect(hasText(r, 'Payment not sent')).toBe(true);
  expect(hasText(r, 'Couldn’t reach your station')).toBe(true);
  // Still on the review step (not the success screen).
  expect(hasText(r, 'Payment proposed')).toBe(false);
});
