/**
 * @format
 *
 * Edit a listing (T1.7.2 Phase B). Drives the real form in edit mode over a
 * mocked `useEditListing` and a `useListingDetail` that returns a fixed listing.
 * Asserts: the form pre-fills and locks the fields a patch can't change (surface,
 * title, category, requirements read-only); changing the price and saving signs a
 * patch of just the changed field; and saving with nothing changed is refused
 * without a round trip.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {CreateListing} from '../src/screens/main/CreateListing';

const mockListing = {
  listing_id: 'a'.repeat(64),
  provider: 'rrn1provider',
  surface: 'goods',
  category: 'food',
  title: 'Squash',
  description: 'Picked this week.',
  amount_centi: 350,
  pricing_model: 'fixed',
  negotiable: false,
  availability: {status: 'available', capacity: 12, next_slot: null},
  provider_composite: 1,
  provider_band: 'Member',
  created_at: 1_752_000_000,
  expires_at: null,
  community: 'rrn-phase0',
  min_reputation: 0,
  community_member_only: false,
  oracle_tier: 1,
  state: 'active',
  close_reason: null,
  closed_at: null,
  provider_vouches_received: 0,
};

const mockEdit = jest.fn(async () => ({ok: true}) as const);
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useCreateListing: () => jest.fn(),
  useEditListing: () => mockEdit,
  useListingDetail: () => ({data: mockListing, isError: false}),
}));

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

async function render(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <CreateListing
            navigation={navigation}
            route={{params: {editListingId: mockListing.listing_id}} as any}
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
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text)).length >
  0;
const pressable = (r: Renderer, label: string): Instance =>
  r.root.find(
    n =>
      (n.props.accessibilityRole === 'button' || n.props.accessibilityRole === 'radio') &&
      (n.props.accessibilityLabel === label || textOf(n).includes(label)),
  );
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}
async function type(r: Renderer, label: string, value: string): Promise<void> {
  const input = r.root.find(n => n.props.accessibilityLabel === label);
  await act(async () => {
    input.props.onChangeText?.(value);
  });
}
async function advance(r: Renderer): Promise<void> {
  await press(pressable(r, 'Continue'));
}

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
  jest.clearAllMocks();
});

test('pre-fills and locks the fields a patch cannot change', async () => {
  const r = await render();
  // Header reads Edit, and the surface step is read-only (no "Pick the
  // marketplace" chooser, just the fixed value and the reason).
  expect(hasText(r, 'Edit listing')).toBe(true);
  expect(hasText(r, 'The surface is fixed once a listing is published.')).toBe(true);
  expect(hasText(r, 'Goods')).toBe(true);

  await advance(r); // to basics
  // The title field is present but not editable; the description stays editable.
  const title = r.root.find(n => n.props.accessibilityLabel === 'Title');
  expect(title.props.editable).toBe(false);
  expect(title.props.value).toBe('Squash');
  const description = r.root.find(n => n.props.accessibilityLabel === 'Description');
  expect(description.props.editable).not.toBe(false);

  await advance(r); // to category — locked
  expect(hasText(r, 'the reputation domain')).toBe(true);
});

test('changing the price saves a patch of just that field', async () => {
  const navigation = nav();
  const r = await render(navigation);
  await advance(r); // surface → basics
  await advance(r); // basics → category
  await advance(r); // category → pricing
  await type(r, 'Amount', '10.00'); // change the amount
  await advance(r); // pricing → availability
  await advance(r); // availability → requirements
  await advance(r); // requirements → review
  expect(hasText(r, 'Review')).toBe(true);
  await press(pressable(r, 'Save changes'));

  expect(mockEdit).toHaveBeenCalledTimes(1);
  const [listingId, patch] = mockEdit.mock.calls[0] as unknown as [string, any];
  expect(listingId).toBe(mockListing.listing_id);
  expect(patch.pricing.amountCenti).toBe(1000);
  expect(patch.description).toBeUndefined(); // unchanged
  expect(patch.availability).toBeUndefined(); // unchanged
  expect(patch.expires).toBe('unchanged');
  expect(navigation.goBack).toHaveBeenCalled();
});

test('saving with nothing changed is refused without a round trip', async () => {
  const r = await render();
  await advance(r); // surface → basics
  await advance(r); // basics → category
  await advance(r); // category → pricing
  await advance(r); // pricing → availability
  await advance(r); // availability → requirements
  await advance(r); // requirements → review
  await press(pressable(r, 'Save changes'));

  expect(hasText(r, 'You haven’t changed anything yet.')).toBe(true);
  expect(mockEdit).not.toHaveBeenCalled();
});
