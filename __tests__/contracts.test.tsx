/**
 * @format
 *
 * The contracts inbox (T1.7.7): the member's own recurring contracts as a list of
 * tappable cards with a state badge, and the empty state. Mirrors the inquiries
 * inbox test in shape. The hooks are mocked so the test drives the screen.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {Contracts} from '../src/screens/main/Contracts';
import {ThemeProvider} from '../src/theme';
import type {StationContractRow} from '../src/network/StationClient';

const mockList: {data?: StationContractRow[]; isLoading: boolean; isError: boolean} = {
  data: [],
  isLoading: false,
  isError: false,
};
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useMyContracts: () => mockList,
  useRefreshMarketplace: () => async () => {},
}));

const PROVIDER = 'rrn1qproviderbbbbbbbbbbbbbbbbbbbb';
const NOW = 1_800_000_000;

function row(overrides: Partial<StationContractRow> = {}): StationContractRow {
  return {
    contract_id: 'c1',
    inquiry_id: 'iq1',
    listing_title: 'Weekly lawn care',
    role: 'buyer',
    counterparty: PROVIDER,
    state: 'active',
    commons_per_period_centi: 500,
    periods_charged: 1,
    periods_remaining: 3,
    next_charge_due: NOW + 604_800,
    started_at: NOW,
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

async function render(navigate: jest.Mock): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Contracts navigation={{navigate, goBack: jest.fn()} as any} route={{} as any} />
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

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockList.data = [];
  mockList.isLoading = false;
  mockList.isError = false;
});

test('lists contracts with their per-period price, progress, and state', async () => {
  mockList.data = [
    row(),
    row({contract_id: 'c2', state: 'terminating', role: 'provider', listing_title: 'Snow clearing'}),
    row({contract_id: 'c3', state: 'ended', listing_title: 'Bread box'}),
  ];
  const r = await render(jest.fn());
  expect(hasText(r, 'Weekly lawn care')).toBe(true);
  expect(hasText(r, 'You subscribe')).toBe(true);
  expect(hasText(r, 'You provide')).toBe(true);
  expect(hasText(r, '5.00 per period · 1 of 4 charged')).toBe(true);
  expect(hasText(r, 'Active')).toBe(true);
  expect(hasText(r, 'Ending')).toBe(true);
  expect(hasText(r, 'Ended')).toBe(true);
});

test('a row opens its contract', async () => {
  mockList.data = [row({contract_id: 'c7'})];
  const navigate = jest.fn();
  const r = await render(navigate);
  const card = r.root.find(
    n => n.props.accessibilityRole === 'button' && textOf(n).includes('Weekly lawn care'),
  );
  await act(async () => {
    card.props.onPress?.();
  });
  expect(navigate).toHaveBeenCalledWith('Contract', {contractId: 'c7'});
});

test('shows an empty state when there are no contracts', async () => {
  const r = await render(jest.fn());
  expect(hasText(r, 'No contracts yet')).toBe(true);
});
