/**
 * @format
 *
 * Listing detail (T1.7.1). Drives the real screen over a mocked detail hook and
 * asserts the behaviours that matter: an active listing shows its description,
 * availability, provider band + vouching context, stated requirements, and the
 * Inquire CTA; a closed/expired listing keeps its detail but loses the CTA and
 * says why; and a load failure distinguishes a missing listing from an
 * unreachable station. When the viewer is the provider (T1.7.2), the CTA is
 * Close listing rather than Inquire.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {ListingDetail} from '../src/screens/main/ListingDetail';
import {StationClientError, type StationListingDetail} from '../src/network/StationClient';

const detail: {data?: StationListingDetail; isLoading: boolean; isError: boolean; error: Error | null} = {
  isLoading: false,
  isError: false,
  error: null,
};

const mockClose = jest.fn(async (_id: string) => ({ok: true}) as const);
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useListingDetail: () => detail,
  useCloseListing: () => mockClose,
}));

// The screen reads the session to tell whether the viewer is the provider.
const session: {wallet: {address: string} | null} = {wallet: null};
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => session,
}));

const PROVIDER = 'rrn1qprovideraaaaaaaaaaaaaaaaaaaa';

function listing(overrides: Partial<StationListingDetail> = {}): StationListingDetail {
  return {
    listing_id: 'abc123',
    provider: PROVIDER,
    surface: 'services',
    category: 'construction',
    title: 'Barn raising',
    amount_centi: 4500,
    pricing_model: 'negotiable',
    negotiable: true,
    availability: {status: 'available', capacity: null, next_slot: Math.floor(Date.now() / 1000) + 86400},
    provider_composite: 2.6,
    provider_band: 'Member',
    created_at: Math.floor(Date.now() / 1000) - 3600,
    expires_at: null,
    community: 'Cedar Valley',
    description: 'A full day of framing labour, tools included.',
    min_reputation: 1.5,
    community_member_only: true,
    oracle_tier: 2,
    state: 'active',
    close_reason: null,
    closed_at: null,
    provider_vouches_received: 3,
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

async function renderDetail(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ListingDetail navigation={navigation} route={{params: {listingId: 'abc123'}} as any} />
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
const findButton = (r: Renderer, name: string): Instance | undefined =>
  r.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  )[0];
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
  detail.data = listing();
  detail.isLoading = false;
  detail.isError = false;
  detail.error = null;
  session.wallet = null; // a non-provider viewer unless a test says otherwise
});

test('renders the full listing', async () => {
  const r = await renderDetail();
  expect(hasText(r, 'Barn raising')).toBe(true);
  expect(hasText(r, 'A full day of framing labour')).toBe(true);
  expect(hasText(r, '45.00')).toBe(true); // price
  expect(hasText(r, 'Negotiable')).toBe(true);
  expect(hasText(r, 'Construction')).toBe(true);
});

test('shows the provider band and vouching context', async () => {
  const r = await renderDetail();
  expect(hasText(r, 'Member')).toBe(true);
  expect(hasText(r, '3 members have vouched for them')).toBe(true);
  expect(hasText(r, 'Cedar Valley')).toBe(true);
});

test('shows the provider’s stated requirements', async () => {
  const r = await renderDetail();
  expect(hasText(r, 'at least 1.50')).toBe(true);
  expect(hasText(r, 'A member of Cedar Valley')).toBe(true);
});

test('an active listing offers the Inquire CTA, which points at the coming flow', async () => {
  const r = await renderDetail();
  const inquire = button(r, 'Inquire');
  await press(inquire);
  expect(hasText(r, 'Inquiries are coming next')).toBe(true);
});

test('the provider’s own listing offers Close listing instead of Inquire', async () => {
  session.wallet = {address: PROVIDER};
  const r = await renderDetail();
  expect(findButton(r, 'Inquire')).toBeUndefined();

  await press(button(r, 'Close listing')); // reveal the inline confirm
  expect(findButton(r, 'Keep it')).toBeDefined(); // the stacked way-out appears
  expect(findButton(r, 'Close listing')).toBeUndefined(); // trigger label gives way to the confirm label
  await press(button(r, 'Confirm close')); // commit
  expect(mockClose).toHaveBeenCalledWith('abc123');
});

test('another member’s active listing still offers Inquire, not Close', async () => {
  session.wallet = {address: 'rrn1qsomeoneelsebbbbbbbbbbbbbbbbbb'};
  const r = await renderDetail();
  expect(findButton(r, 'Close listing')).toBeUndefined();
  expect(findButton(r, 'Inquire')).toBeDefined();
});

test('a closed listing keeps its detail but withholds the CTA', async () => {
  detail.data = listing({state: 'closed', close_reason: 'provider_closed', closed_at: Math.floor(Date.now() / 1000)});
  const r = await renderDetail();
  expect(hasText(r, 'This listing is closed')).toBe(true);
  expect(hasText(r, 'no longer on offer')).toBe(true);
  expect(findButton(r, 'Inquire')).toBeUndefined();
});

test('an expired listing says so', async () => {
  detail.data = listing({state: 'expired'});
  const r = await renderDetail();
  expect(hasText(r, 'This listing has expired')).toBe(true);
  expect(findButton(r, 'Inquire')).toBeUndefined();
});

test('a Commons freebie reads as Free', async () => {
  detail.data = listing({surface: 'commons', amount_centi: 0, community_member_only: false, min_reputation: 0});
  const r = await renderDetail();
  expect(hasText(r, 'Free')).toBe(true);
});

test('a missing listing reads differently from an unreachable station', async () => {
  detail.data = undefined;
  detail.isError = true;
  detail.error = new StationClientError('method-error', 'no such listing on this station');
  const r = await renderDetail();
  expect(hasText(r, 'isn’t on your station')).toBe(true);
});

test('an offline station is named as offline, not as a missing listing', async () => {
  detail.data = undefined;
  detail.isError = true;
  detail.error = new StationClientError('unreachable', 'station unreachable');
  const r = await renderDetail();
  expect(hasText(r, 'Can’t reach your station')).toBe(true);
});
