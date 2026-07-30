/**
 * @format
 *
 * Marketplace browse (T1.7.1). Drives the real screen over a mocked search hook
 * and asserts the acceptance behaviours: it renders the seeded listing cards
 * with price and provider band, the surface segment and filter chips feed the
 * query, the search field debounces into the query text, tapping a card opens
 * its detail, and empty / offline states explain themselves rather than showing
 * a blank list.
 *
 * `useDebouncedValue` is mocked to the identity so typed text reaches the query
 * synchronously (no fake timers needed), and the search hook is a plain object
 * whose last-received filters the test inspects.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Marketplace} from '../src/screens/main/Marketplace';
import type {MarketplaceFilters} from '../src/marketplace';
import type {StationListingCard} from '../src/network/StationClient';

let mockLastFilters: MarketplaceFilters | undefined;
const mockSearchResult: {
  data?: {pages: {listings: StationListingCard[]; offset: number}[]};
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: jest.Mock;
} = {
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: jest.fn(),
};

jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useMarketplaceSearch: (filters: MarketplaceFilters) => {
    mockLastFilters = filters;
    return mockSearchResult;
  },
  useRefreshMarketplace: () => async () => {},
  useDebouncedValue: <T,>(v: T) => v,
}));

function card(overrides: Partial<StationListingCard> = {}): StationListingCard {
  return {
    listing_id: 'abc123',
    provider: 'rrn1qprovideraaaaaaaaaaaaaaaaaaaa',
    surface: 'goods',
    category: 'food',
    title: 'Sourdough loaves',
    amount_centi: 350,
    pricing_model: 'fixed',
    negotiable: false,
    availability: {status: 'available', capacity: 6, next_slot: null},
    provider_composite: 2.4,
    provider_band: 'Member',
    created_at: Math.floor(Date.now() / 1000) - 3600,
    expires_at: null,
    ...overrides,
  };
}

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {navigate: jest.fn(), goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

let current: Renderer | undefined;

async function renderMarketplace(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Marketplace navigation={navigation} route={{} as any} />
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
const button = (r: Renderer, name: string): Instance =>
  r.root.find(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  );
/** A surface segment — a `tab`-role pressable, matched by its label. */
const tab = (r: Renderer, name: string): Instance =>
  r.root.find(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === name);
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
  mockLastFilters = undefined;
  mockSearchResult.data = {pages: [{listings: [card()], offset: 0}]};
  mockSearchResult.isLoading = false;
  mockSearchResult.isError = false;
  mockSearchResult.hasNextPage = false;
  mockSearchResult.isFetchingNextPage = false;
});

test('renders a listing card with its price and provider band', async () => {
  const r = await renderMarketplace();
  expect(hasText(r, 'Marketplace')).toBe(true);
  expect(hasText(r, 'Sourdough loaves')).toBe(true);
  expect(hasText(r, '3.50')).toBe(true); // price, formatted Commons
  expect(hasText(r, 'Member')).toBe(true); // provider band chip
  expect(hasText(r, '6 left')).toBe(true); // goods fulfillment indicator
});

test('the browse defaults to the goods surface', async () => {
  await renderMarketplace();
  expect(mockLastFilters?.surface).toBe('goods');
});

test('choosing a surface refines the query to it', async () => {
  const r = await renderMarketplace();
  await press(tab(r, 'Services'));
  expect(mockLastFilters?.surface).toBe('services');
});

test('a category chip sets the category filter', async () => {
  const r = await renderMarketplace();
  await press(button(r, 'Filter: Food'));
  expect(mockLastFilters?.category).toBe('food');
});

test('a price ceiling chip sets max_price_centi', async () => {
  const r = await renderMarketplace();
  await press(button(r, 'Filter: ≤ 20'));
  expect(mockLastFilters?.maxPriceCenti).toBe(2000);
});

test('a provider-reputation chip sets the composite floor', async () => {
  const r = await renderMarketplace();
  await press(button(r, 'Filter: Member +'));
  expect(mockLastFilters?.minProviderReputation).toBe(2.0);
});

test('typing in the search field feeds the query text', async () => {
  const r = await renderMarketplace();
  const input = r.root.find(n => n.props.accessibilityLabel === 'Search the marketplace');
  await act(async () => {
    input.props.onChangeText?.('grain');
  });
  expect(mockLastFilters?.text).toBe('grain');
});

test('tapping a card opens its detail by id', async () => {
  const navigation = nav();
  const r = await renderMarketplace(navigation);
  await press(button(r, 'Sourdough loaves'));
  expect(navigation.navigate).toHaveBeenCalledWith('ListingDetail', {listingId: 'abc123'});
});

test('a service’s next slot shows a future date, never a past-relative "just now"', async () => {
  mockSearchResult.data = {
    pages: [
      {
        listings: [
          card({
            surface: 'services',
            category: 'education',
            title: 'Maths tutoring',
            availability: {status: 'available', capacity: null, next_slot: Math.floor(Date.now() / 1000) + 5 * 86400},
          }),
        ],
        offset: 0,
      },
    ],
  };
  const r = await renderMarketplace();
  // The bug this guards: relativeTime() reads a future timestamp as "just now".
  expect(hasText(r, 'just now')).toBe(false);
  expect(hasText(r, 'Next')).toBe(true);
});

test('a Commons subsidy reads as a subsidy, not a loss', async () => {
  mockSearchResult.data = {
    pages: [{listings: [card({surface: 'commons', category: 'education', amount_centi: -300, title: 'Free tutoring'})], offset: 0}],
  };
  const r = await renderMarketplace();
  expect(hasText(r, 'Subsidy')).toBe(true);
});

test('no results, unfiltered, invites the first listing rather than showing blank', async () => {
  mockSearchResult.data = {pages: [{listings: [], offset: 0}]};
  const r = await renderMarketplace();
  expect(hasText(r, 'No goods on offer yet')).toBe(true);
});

test('no results with filters set suggests widening', async () => {
  mockSearchResult.data = {pages: [{listings: [], offset: 0}]};
  const r = await renderMarketplace();
  await press(button(r, 'Filter: Tools'));
  expect(hasText(r, 'Nothing matches those filters')).toBe(true);
});

test('an unreachable station says so rather than showing an empty catalogue', async () => {
  mockSearchResult.data = undefined;
  mockSearchResult.isError = true;
  const r = await renderMarketplace();
  expect(hasText(r, 'Can’t reach your station')).toBe(true);
});
