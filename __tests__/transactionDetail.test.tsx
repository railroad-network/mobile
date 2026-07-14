/**
 * @format
 *
 * Transaction detail (T1.2.7). Drives the real TransactionDetail screen over a
 * mocked activity source, asserting: it shows the full field set, copy-to-
 * clipboard puts the address on the clipboard and confirms it, the signatures
 * render as verified checkmarks, and "View on station log" shows its placeholder.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';

import {ThemeProvider} from '../src/theme';
import {TransactionDetail} from '../src/screens/main/TransactionDetail';
import type {Transaction} from '../src/ledger';

const ADDR = 'rrn1qvalleyfarm000000000000000000000000000';

const mockActivity: {data?: Transaction[]} = {};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useActivity: () => mockActivity,
}));

function tx(overrides: Partial<Transaction> = {}): Transaction {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: 'deadbeefcafef00d1122334455667788',
    counterparty: 'valley_farm',
    counterpartyAddress: ADDR,
    direction: 'out',
    amountCenti: -1500,
    memo: 'Seed order',
    state: 'pending',
    timestamp: now - 3600,
    expiresAt: now + 86400,
    nonce: 4,
    ...overrides,
  };
}

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderDetail(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <TransactionDetail navigation={nav()} route={{params: {id: tx().id}} as any} />
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
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActivity.data = [tx()];
});

test('shows the full field set', async () => {
  const r = await renderDetail();
  expect(hasText(r, 'Sent to valley_farm')).toBe(true);
  expect(hasText(r, 'Seed order')).toBe(true);
  expect(hasText(r, 'Outgoing debit')).toBe(true);
  expect(hasText(r, '4')).toBe(true); // nonce
  expect(hasText(r, ADDR)).toBe(true);
  expect(hasText(r, 'Signatures')).toBe(true);
  expect(hasText(r, 'b3:deadbeef…')).toBe(true); // short content-address
});

test('copy-to-clipboard copies the address and confirms', async () => {
  const r = await renderDetail();
  await press(button(r, 'Copy address'));
  expect(Clipboard.setString).toHaveBeenCalledWith(ADDR);
  expect(hasText(r, 'Copied ✓')).toBe(true);
});

test('the receiver signature is unverified while pending, verified once confirmed', async () => {
  const r = await renderDetail();
  expect(hasText(r, 'Awaiting')).toBe(true); // receiver, still pending

  mockActivity.data = [tx({state: 'settled'})];
  const r2 = await renderDetail();
  expect(hasText(r2, 'Awaiting')).toBe(false);
  expect(hasText(r2, 'Verified')).toBe(true);
});

test('"View on station log" shows a placeholder', async () => {
  const r = await renderDetail();
  await press(button(r, 'View on station log'));
  expect(hasText(r, 'Not available yet')).toBe(true);
});

test('shows a not-available message for an unknown id', async () => {
  mockActivity.data = [];
  const r = await renderDetail();
  expect(hasText(r, 'isn’t available')).toBe(true);
});
