/**
 * @format
 *
 * My Listings (T1.7.2). Drives the real screen over a mocked `useMyListings` and
 * `useCloseListing`: it renders the member's own listings with their state, and
 * closing one goes through the inline confirm before the signed close fires.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {MyListings} from '../src/screens/main/MyListings';
import type {StationMyListingRow} from '../src/network/StationClient';

const mockRows: {data?: StationMyListingRow[]; isLoading: boolean; isError: boolean} = {
  isLoading: false,
  isError: false,
};
const mockClose = jest.fn(async () => ({ok: true}) as const);
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useMyListings: () => mockRows,
  useCloseListing: () => mockClose,
  useRefreshMarketplace: () => async () => {},
}));

function row(overrides: Partial<StationMyListingRow> = {}): StationMyListingRow {
  return {
    listing_id: 'id-active',
    provider: 'rrn1qprovider',
    surface: 'goods',
    category: 'food',
    title: 'Sourdough loaves',
    amount_centi: 350,
    pricing_model: 'fixed',
    negotiable: false,
    availability: {status: 'available', capacity: 6, next_slot: null},
    provider_composite: 2,
    provider_band: 'Member',
    created_at: Math.floor(Date.now() / 1000),
    expires_at: null,
    state: 'active',
    close_reason: null,
    closed_at: null,
    ...overrides,
  };
}

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 47, left: 0, right: 0, bottom: 34}};
function nav() {
  return {navigate: jest.fn(), goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;
let current: Renderer | undefined;

async function render(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <MyListings navigation={navigation} route={{} as any} />
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
const buttons = (r: Renderer, label: string): Instance[] =>
  r.root.findAll(
    n => n.props.accessibilityRole === 'button' && (n.props.accessibilityLabel === label || textOf(n).includes(label)),
  );
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
  jest.clearAllMocks();
});

beforeEach(() => {
  mockRows.data = [row(), row({listing_id: 'id-closed', title: 'Old chairs', state: 'closed', close_reason: 'provider_closed', closed_at: Math.floor(Date.now() / 1000) - 3600})];
  mockRows.isLoading = false;
  mockRows.isError = false;
});

test('renders own listings with their state', async () => {
  const r = await render();
  expect(hasText(r, 'My listings')).toBe(true);
  expect(hasText(r, 'Sourdough loaves')).toBe(true);
  expect(hasText(r, 'Active')).toBe(true);
  expect(hasText(r, 'Old chairs')).toBe(true);
  expect(hasText(r, 'Closed')).toBe(true);
});

test('closing a listing confirms before signing', async () => {
  const r = await render();
  // First tap reveals the confirm; the close does not fire yet.
  await press(buttons(r, 'Close listing')[0]);
  expect(mockClose).not.toHaveBeenCalled();
  expect(hasText(r, 'Take this listing off offer?')).toBe(true);
  // Confirm.
  await press(buttons(r, 'Close listing')[0]);
  expect(mockClose).toHaveBeenCalledWith('id-active');
});

test('an empty list invites the first listing', async () => {
  mockRows.data = [];
  const r = await render();
  expect(hasText(r, 'Nothing listed yet')).toBe(true);
});
