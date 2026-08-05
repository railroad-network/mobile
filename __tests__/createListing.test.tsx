/**
 * @format
 *
 * Create a listing (T1.7.2). Drives the real multi-step form over a mocked
 * `useCreateListing` and asserts the flow assembles the right draft: pick a
 * surface, fill the basics, choose a category, price it, and publish — with the
 * resulting {@link ListingDraft} matching what was entered (surface, category,
 * signed amount, negotiability). A second case pins the Commons subsidy path,
 * where the amount is negated.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {CreateListing} from '../src/screens/main/CreateListing';
import type {ListingDraft} from '../src/marketplace';

const mockCreate = jest.fn(async (_draft: ListingDraft) => ({ok: true, listingId: 'abc'}) as const);
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useCreateListing: () => mockCreate,
  // The form now also calls these unconditionally (edit mode); create mode never
  // reads their results, so no-op stubs keep the test off react-query/station.
  useEditListing: () => jest.fn(),
  useListingDetail: () => ({data: undefined, isError: false}),
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
          <CreateListing navigation={navigation} route={{} as any} />
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
const pressable = (r: Renderer, label: string): Instance =>
  r.root.find(
    n =>
      (n.props.accessibilityRole === 'button' ||
        n.props.accessibilityRole === 'radio') &&
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
async function toggle(r: Renderer, label: string, value: boolean): Promise<void> {
  const sw = r.root.find(
    n => typeof n.props.onValueChange === 'function' && n.props.accessibilityLabel === label,
  );
  await act(async () => {
    sw.props.onValueChange?.(value);
  });
}

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
  jest.clearAllMocks();
});

async function advance(r: Renderer): Promise<void> {
  await press(pressable(r, 'Continue'));
}

test('assembles a service listing draft and publishes it', async () => {
  const navigation = nav();
  const r = await render(navigation);
  expect(hasText(r, 'What are you offering?')).toBe(true);

  await press(pressable(r, 'Services')); // surface
  await advance(r);
  await type(r, 'Title', 'Maths tutoring');
  await advance(r);
  await press(pressable(r, 'Education')); // category
  await advance(r);
  await type(r, 'Amount', '8.00');
  await toggle(r, 'Invite offers', true);
  await advance(r); // pricing
  await advance(r); // availability (skipped)
  await advance(r); // requirements (skipped)

  expect(hasText(r, 'Review')).toBe(true);
  expect(hasText(r, 'Maths tutoring')).toBe(true);
  await press(pressable(r, 'Publish listing'));

  expect(mockCreate).toHaveBeenCalledTimes(1);
  const draft = mockCreate.mock.calls[0][0];
  expect(draft.surface).toBe('services');
  expect(draft.category).toBe('education');
  expect(draft.title).toBe('Maths tutoring');
  expect(draft.amountCenti).toBe(800);
  expect(draft.negotiable).toBe(true);
  expect(draft.pricingModel).toBe('negotiable');
  expect(navigation.goBack).toHaveBeenCalled();
});

test('a Commons subsidy negates the amount', async () => {
  const r = await render();
  await press(pressable(r, 'Commons'));
  await advance(r);
  await type(r, 'Title', 'Ride share');
  await advance(r);
  await press(pressable(r, 'Transportation'));
  await advance(r);
  await type(r, 'Amount', '3.00');
  await toggle(r, 'This is a subsidy', true);
  await advance(r); // pricing
  await advance(r); // availability
  await advance(r); // requirements
  await press(pressable(r, 'Publish listing'));

  const draft = mockCreate.mock.calls[0][0];
  expect(draft.surface).toBe('commons');
  expect(draft.amountCenti).toBe(-300);
});

test('blocks advancing past basics without a title', async () => {
  const r = await render();
  await advance(r); // leave surface (goods default)
  await advance(r); // try to leave basics with no title
  expect(hasText(r, 'Give your listing a title.')).toBe(true);
});
