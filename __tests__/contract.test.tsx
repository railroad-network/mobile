/**
 * @format
 *
 * The contract status screen (T1.7.7): rendering a recurring contract's cadence,
 * price, and progress, and the one write a party has — ending it early, behind a
 * two-step confirm. The hooks are mocked so the test drives the screen's own
 * reasoning (role, state, the confirm gate), not the network.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {Contract} from '../src/screens/main/Contract';
import {ThemeProvider} from '../src/theme';
import type {StationContractDetail} from '../src/network/StationClient';

const mockDetail: {
  data?: StationContractDetail;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = {data: undefined, isLoading: false, isError: false, error: null};

const mockTerminate = jest.fn(
  async (_args: {contractId: string; terminatedBy: 'buyer' | 'provider'}) => ({ok: true}) as const,
);
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useContractDetail: () => mockDetail,
  useTerminateContract: () => mockTerminate,
}));

const BUYER = 'rrn1qbuyeraaaaaaaaaaaaaaaaaaaaaaaa';
const PROVIDER = 'rrn1qproviderbbbbbbbbbbbbbbbbbbbb';
const mockSession: {wallet: {address: string} | null} = {wallet: {address: BUYER}};
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => mockSession,
}));

const NOW = 1_800_000_000;

function detail(overrides: Partial<StationContractDetail> = {}): StationContractDetail {
  return {
    contract_id: 'c1',
    inquiry_id: 'iq1',
    listing_id: 'l1',
    listing_title: 'Weekly lawn care',
    buyer: BUYER,
    provider: PROVIDER,
    frequency: 'weekly',
    period_secs: 604_800,
    duration_periods: 4,
    commons_per_period_centi: 500,
    notice_period_days: 7,
    early_termination_penalty_centi: 500,
    performance_metrics: {},
    started_at: NOW,
    state: 'active',
    periods_charged: 1,
    periods_remaining: 3,
    next_charge_due: NOW + 604_800,
    ...overrides,
  };
}

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;
let current: Renderer | undefined;

async function render(nav: Record<string, unknown> = {}): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Contract
            navigation={{navigate: jest.fn(), goBack: jest.fn(), ...nav} as any}
            route={{params: {contractId: 'c1'}} as any}
          />
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
const findButton = (r: Renderer, name: string): Instance | undefined =>
  r.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  )[0];
const button = (r: Renderer, name: string): Instance => {
  const found = findButton(r, name);
  if (found === undefined) {
    throw new Error(`no button matching ${name}`);
  }
  return found;
};
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockDetail.data = detail();
  mockDetail.isLoading = false;
  mockDetail.isError = false;
  mockDetail.error = null;
  mockSession.wallet = {address: BUYER};
});

test('renders the cadence, charge, and progress for the subscriber', async () => {
  const r = await render();
  expect(hasText(r, 'Weekly lawn care')).toBe(true);
  expect(hasText(r, 'You subscribe')).toBe(true);
  expect(hasText(r, 'Weekly service')).toBe(true);
  expect(hasText(r, '5.00 per week')).toBe(true);
  expect(hasText(r, '1 of 4')).toBe(true);
});

test('ending a contract is a two-step confirm that reports the notice and fee', async () => {
  const r = await render();
  // First tap only opens the confirm — no write yet.
  await press(button(r, 'End this contract'));
  expect(mockTerminate).not.toHaveBeenCalled();
  expect(hasText(r, '7 days of notice')).toBe(true);
  expect(hasText(r, '5.00 early-exit fee')).toBe(true);
  await press(button(r, 'Confirm end'));
  expect(mockTerminate).toHaveBeenCalledWith({contractId: 'c1', terminatedBy: 'buyer'});
});

test('the provider ends it from their own side', async () => {
  mockSession.wallet = {address: PROVIDER};
  const r = await render();
  await press(button(r, 'End this contract'));
  await press(button(r, 'Confirm end'));
  expect(mockTerminate).toHaveBeenCalledWith({contractId: 'c1', terminatedBy: 'provider'});
});

test('a terminating contract offers no further termination and says it is ending', async () => {
  mockDetail.data = detail({
    state: 'terminating',
    terminating_effective_at: NOW + 7 * 86_400,
    next_charge_due: undefined,
  });
  const r = await render();
  expect(findButton(r, 'End this contract')).toBeUndefined();
  expect(hasText(r, 'Ending soon')).toBe(true);
});

test('an ended contract offers no termination and says why it ended', async () => {
  mockDetail.data = detail({
    state: 'ended',
    ended_reason: 'completed',
    periods_charged: 4,
    periods_remaining: 0,
    next_charge_due: undefined,
    ended_at: NOW + 4 * 604_800,
  });
  const r = await render();
  expect(findButton(r, 'End this contract')).toBeUndefined();
  expect(hasText(r, 'Contract complete')).toBe(true);
});

test('performance notes are shown when the contract carries them', async () => {
  mockDetail.data = detail({performance_metrics: {tier: 'gold', note: 'mornings'}});
  const r = await render();
  expect(hasText(r, 'Performance notes')).toBe(true);
  expect(hasText(r, 'gold')).toBe(true);
  expect(hasText(r, 'mornings')).toBe(true);
});
