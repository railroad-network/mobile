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

const mockLoadWallet = jest.fn();
jest.mock('../src/wallet/Wallet', () => ({
  loadWallet: (...args: unknown[]) => mockLoadWallet(...args),
}));

const mockCreateProposal = jest.fn();
jest.mock('../src/wallet/proposal', () => ({
  createSendProposal: (...args: unknown[]) => mockCreateProposal(...args),
}));

const mockIdentity: {data?: {address: string}} = {};
const mockBalance: {data?: {centi: number}} = {};
let mockOffline = false;
const mockEnqueue = jest.fn(async () => {});
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useIdentity: () => mockIdentity,
  useBalance: () => mockBalance,
  useConnectivity: () => ({level: 'mesh', isOffline: mockOffline}),
  useEnqueueTransaction: () => mockEnqueue,
  outboxCount: () => 0,
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
  mockLoadWallet.mockResolvedValue({address: 'rrn1qme'});
  mockCreateProposal.mockResolvedValue({
    id: 'deadbeefcafef00d',
    senderAddress: 'rrn1qme',
    receiverAddress: 'rrn1receiver',
    amountCenti: 350,
    memo: 'lunch',
    nonce: 0,
    proposedAt: 1000,
    expiresAt: 2000,
    signature: new Uint8Array([1, 2, 3]),
  });
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

test('the happy path signs, queues an outgoing pending tx, and shows success', async () => {
  const r = await renderSend();
  await toReview(r);
  await press(button(r, 'Propose payment'));
  await type(field(r, 'Passphrase'), 'correct horse battery staple');
  await press(button(r, 'Sign & propose'));

  // Signed with the positive (sender-pays) amount.
  expect(mockCreateProposal).toHaveBeenCalledWith(
    {address: 'rrn1qme'},
    'rrn1receiver',
    350,
    '',
    expect.objectContaining({nonce: 0}),
  );
  // Queued as an outgoing debit in the Pending state.
  expect(mockEnqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'deadbeefcafef00d',
      direction: 'out',
      amountCenti: -350,
      state: 'pending',
      counterpartyAddress: 'rrn1receiver',
    }),
  );
  expect(hasText(r, 'Payment proposed')).toBe(true);
});

test('a failed unlock keeps the user on the unlock step with an error', async () => {
  mockLoadWallet.mockRejectedValue(new Error('bad passphrase'));
  const r = await renderSend();
  await toReview(r);
  await press(button(r, 'Propose payment'));
  await type(field(r, 'Passphrase'), 'wrong');
  await press(button(r, 'Sign & propose'));
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(hasText(r, 'Could not unlock')).toBe(true);
});
