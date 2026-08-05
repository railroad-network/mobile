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

test('skips the fixed-field steps and names them in a banner', async () => {
  const r = await render();
  // Editing walks only the patchable steps (4, not 7), and the first screen is
  // the description with a banner naming what's fixed — no surface/category steps.
  expect(hasText(r, 'Edit listing')).toBe(true);
  expect(hasText(r, 'Step 1 of 4')).toBe(true);
  expect(hasText(r, 'Some details are fixed after publishing')).toBe(true);

  // The title is fixed, so it isn't surfaced as a field; the description is
  // editable and pre-filled.
  expect(r.root.findAll(n => n.props.accessibilityLabel === 'Title')).toHaveLength(0);
  const description = r.root.find(n => n.props.accessibilityLabel === 'Description');
  expect(description.props.value).toBe('Picked this week.');
  expect(description.props.editable).not.toBe(false);

  // Next is pricing directly — the fixed category/surface steps are gone.
  await advance(r);
  expect(hasText(r, 'Price')).toBe(true);
});

test('changing the price saves a patch of just that field', async () => {
  const navigation = nav();
  const r = await render(navigation);
  await advance(r); // description → pricing
  await type(r, 'Amount', '10.00'); // change the amount
  await advance(r); // pricing → availability
  await advance(r); // availability → review
  expect(hasText(r, 'Review')).toBe(true);
  // The review card names the amount available (capacity 12 from the listing).
  expect(hasText(r, '12 in stock')).toBe(true);
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
  await advance(r); // description → pricing
  await advance(r); // pricing → availability
  await advance(r); // availability → review
  await press(pressable(r, 'Save changes'));

  expect(hasText(r, 'You haven’t changed anything yet.')).toBe(true);
  expect(mockEdit).not.toHaveBeenCalled();
});
