/**
 * @format
 *
 * Inquiries inbox (T1.7.4). Drives the real screen over a mocked `useMyInquiries`.
 * The point of interest is the status pill: a closed inquiry is not a flat
 * "Closed" — an agreed deal reads "Agreed", a declined one "Declined", so the
 * list tells the outcomes apart even when no amount is shown.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Inquiries} from '../src/screens/main/Inquiries';
import type {StationMyInquiryRow} from '../src/network/StationClient';

const mockRows: {data?: StationMyInquiryRow[]; isLoading: boolean; isError: boolean} = {
  isLoading: false,
  isError: false,
};
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useMyInquiries: () => mockRows,
  useRefreshMarketplace: () => async () => {},
}));

function row(overrides: Partial<StationMyInquiryRow> = {}): StationMyInquiryRow {
  return {
    inquiry_id: 'inq-1',
    listing_id: 'lst-1',
    listing_title: 'Seed potatoes',
    role: 'buyer',
    counterparty: 'rrn1qprovider',
    state: 'open',
    last_activity_at: Math.floor(Date.now() / 1000),
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
          <Inquiries navigation={navigation} route={{} as any} />
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
const cardFor = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
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
  mockRows.data = undefined;
  mockRows.isLoading = false;
  mockRows.isError = false;
});

test('a closed-agreed inquiry reads "Agreed", not "Closed"', async () => {
  mockRows.data = [
    row({inquiry_id: 'inq-agreed', listing_title: 'Seed potatoes', state: 'closed', outcome: 'agreed', latest_offer_centi: 500}),
  ];
  const r = await render();
  expect(hasText(r, 'Agreed')).toBe(true);
  expect(hasText(r, 'Closed')).toBe(false);
});

test('a declined inquiry reads "Declined" even with no amount on the table', async () => {
  mockRows.data = [
    row({inquiry_id: 'inq-declined', listing_title: 'Hand tool set', state: 'closed', outcome: 'declined_by_seller'}),
  ];
  const r = await render();
  expect(hasText(r, 'Declined')).toBe(true);
  expect(hasText(r, 'Closed')).toBe(false);
  // The distinction is the whole point: it survives with no offer shown.
  expect(hasText(r, 'Hand tool set')).toBe(true);
});

test('an open inquiry still reads "Open"', async () => {
  mockRows.data = [row({inquiry_id: 'inq-open', state: 'open'})];
  const r = await render();
  expect(hasText(r, 'Open')).toBe(true);
});

test('the outcome is carried into the accessibility label', async () => {
  mockRows.data = [
    row({inquiry_id: 'inq-declined', listing_title: 'Hand tool set', state: 'closed', outcome: 'declined_by_buyer'}),
  ];
  const r = await render();
  // cardFor throws if no button carries this exact label.
  expect(cardFor(r, 'Hand tool set, declined')).toBeTruthy();
});

test('tapping a row opens its thread', async () => {
  mockRows.data = [row({inquiry_id: 'inq-open', listing_title: 'Seed potatoes', state: 'open'})];
  const navigation = nav();
  const r = await render(navigation);
  await press(cardFor(r, 'Seed potatoes, open · just now'));
  expect(navigation.navigate).toHaveBeenCalledWith('Inquiry', {inquiryId: 'inq-open'});
});
