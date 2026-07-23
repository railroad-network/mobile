/**
 * @format
 *
 * Vouch flow (T1.4.1). Drives the real Vouch screen over mocked ledger hooks and
 * wallet session, asserting the acceptance behaviours: an invalid address
 * blocks; vouching for yourself blocks; both QR payload forms are accepted and a
 * QR-carried nickname pre-fills (but is editable); a malformed stake is
 * rejected while an empty one means zero; and the happy path submits the vouch
 * with the entered statement + stake and lands on the success screen.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do); the RN
 * testing libraries don't render cleanly against React 19 here.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Vouch} from '../src/screens/main/Vouch';

// --- Mocks ------------------------------------------------------------------

const mockIsValid = jest.fn<boolean, [string]>();
jest.mock('../src/crypto/address', () => ({
  isValidAddress: (a: string) => mockIsValid(a),
}));

jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => ({wallet: {address: 'rrn1qme'}}),
}));

const mockIdentity: {data?: {address: string}} = {};
let mockOffline = false;
// The submit hook is the seam under test at the screen level: assert the screen
// calls it with the right args and reacts to its typed result.
const mockSubmitVouch = jest.fn();
// The success screen's truthful "vouching chain" counts (T1.4.4). Controllable
// per test so we can exercise the loaded / errored states.
let mockVouchCounts: {
  data?: {given: number; received: number};
  isError: boolean;
} = {data: {given: 1, received: 0}, isError: false};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useIdentity: () => mockIdentity,
  useConnectivity: () => ({level: 'mesh', isOffline: mockOffline}),
  useSubmitVouch: () => mockSubmitVouch,
  useVouchCounts: () => mockVouchCounts,
}));

// --- Harness ----------------------------------------------------------------

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {navigate: jest.fn(), goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderVouch(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Vouch navigation={navigation} route={{} as any} />
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

/** Advances from the subject step through review with the given inputs. */
async function toReview(
  r: Renderer,
  {address = 'rrn1subject', statement = 'I know them', stake = '1.50'} = {},
): Promise<void> {
  await type(field(r, 'Vouch for'), address);
  await press(button(r, 'Continue'));
  await type(field(r, 'Your statement'), statement);
  await type(field(r, 'Reputation to stake'), stake);
  await press(button(r, 'Review vouch'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsValid.mockReturnValue(true);
  mockIdentity.data = {address: 'rrn1qme'};
  mockOffline = false;
  mockVouchCounts = {data: {given: 1, received: 0}, isError: false};
  mockSubmitVouch.mockResolvedValue({
    ok: true,
    vouchId: 'ab'.repeat(32),
    community: 'rrn-phase0',
  });
});

// --- Tests ------------------------------------------------------------------

test('an invalid address blocks continuing', async () => {
  mockIsValid.mockReturnValue(false);
  const r = await renderVouch();
  await type(field(r, 'Vouch for'), 'garbage');
  await press(button(r, 'Continue'));
  expect(hasText(r, 'valid rrn1')).toBe(true);
  // Still on the subject step.
  expect(button(r, 'Continue')).toBeTruthy();
});

test('vouching for your own address is blocked', async () => {
  const r = await renderVouch();
  await type(field(r, 'Vouch for'), 'rrn1qme');
  await press(button(r, 'Continue'));
  expect(hasText(r, 'your own address')).toBe(true);
});

test('the URI envelope form is accepted and its nickname pre-fills, editable', async () => {
  const r = await renderVouch();
  await type(field(r, 'Vouch for'), 'rrn:address?addr=rrn1subject&n=Maria');
  await press(button(r, 'Continue'));
  // On the details step, with the QR's display hint pre-filled.
  const nick = field(r, 'Their name (kept on your phone)');
  expect(nick.props.value).toBe('Maria');
  await type(nick, 'Maria from the mill');
  expect(field(r, 'Their name (kept on your phone)').props.value).toBe('Maria from the mill');
});

test('a malformed stake is rejected; an empty stake means zero', async () => {
  const r = await renderVouch();
  await type(field(r, 'Vouch for'), 'rrn1subject');
  await press(button(r, 'Continue'));
  await type(field(r, 'Reputation to stake'), '1.005');
  await press(button(r, 'Review vouch'));
  expect(hasText(r, 'two decimal')).toBe(true);
  // Clearing it is allowed: review shows a zero stake.
  await type(field(r, 'Reputation to stake'), '');
  await press(button(r, 'Review vouch'));
  expect(hasText(r, '0.00 points')).toBe(true);
  await press(button(r, 'Sign & vouch'));
  expect(mockSubmitVouch).toHaveBeenCalledWith('rrn1subject', '', 0);
});

test('the happy path submits the vouch and shows success with the community', async () => {
  const r = await renderVouch();
  await toReview(r);
  await press(button(r, 'Sign & vouch'));
  expect(mockSubmitVouch).toHaveBeenCalledWith('rrn1subject', 'I know them', 150);
  expect(hasText(r, 'Vouch recorded')).toBe(true);
  expect(hasText(r, 'rrn-phase0')).toBe(true);
});

test('the success screen shows the truthful vouching-chain counts', async () => {
  mockVouchCounts = {data: {given: 3, received: 1}, isError: false};
  const r = await renderVouch();
  await toReview(r);
  await press(button(r, 'Sign & vouch'));
  expect(hasText(r, 'Your vouching chain')).toBe(true);
  // Given uses the plural; received (1) uses the singular.
  expect(hasText(r, '3 people')).toBe(true);
  expect(hasText(r, '1 person')).toBe(true);
});

test('a singular given count is not pluralised', async () => {
  mockVouchCounts = {data: {given: 1, received: 0}, isError: false};
  const r = await renderVouch();
  await toReview(r);
  await press(button(r, 'Sign & vouch'));
  expect(hasText(r, '1 person')).toBe(true);
  expect(hasText(r, '0 people')).toBe(true);
});

test('a failed counts read hides the chain line rather than faking a number', async () => {
  mockVouchCounts = {isError: true};
  const r = await renderVouch();
  await toReview(r);
  await press(button(r, 'Sign & vouch'));
  // The vouch still succeeded — the celebratory screen shows — but no chain line.
  expect(hasText(r, 'Vouch recorded')).toBe(true);
  expect(hasText(r, 'Your vouching chain')).toBe(false);
});

test('a vouch that cannot reach the station surfaces a failure and stays on review', async () => {
  mockSubmitVouch.mockResolvedValue({
    ok: false,
    error: 'unreachable',
    message: 'ECONNREFUSED',
  });
  const r = await renderVouch();
  await toReview(r);
  await press(button(r, 'Sign & vouch'));
  expect(hasText(r, 'Vouch not sent')).toBe(true);
  expect(hasText(r, 'Couldn’t reach your station')).toBe(true);
  // Still on the review step (not the success screen).
  expect(hasText(r, 'Vouch recorded')).toBe(false);
});
