/**
 * @format
 *
 * Transaction history (T1.2.7). Drives the real History screen over a mocked
 * activity source, asserting the acceptance behaviours: it renders the seeded
 * transactions grouped under day headers, the filter chips narrow the list,
 * tapping a row opens its detail, and an empty filter shows a message.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {History} from '../src/screens/main/History';
import type {Transaction} from '../src/ledger';

const mockActivity: {data?: Transaction[]; isLoading: boolean} = {isLoading: false};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useActivity: () => mockActivity,
}));

const now = Math.floor(Date.now() / 1000);
function txns(): Transaction[] {
  return [
    {
      id: 'a', counterparty: 'dr_sarah', counterpartyAddress: 'rrn1qsarah',
      direction: 'out', amountCenti: -300, memo: 'Consultation',
      state: 'settled', timestamp: now - 3600,
    },
    {
      id: 'b', counterparty: 'valley_farm', counterpartyAddress: 'rrn1qvalley',
      direction: 'in', amountCenti: 800, memo: 'Grain delivery',
      state: 'pending', timestamp: now - 7200,
    },
    {
      id: 'c', counterparty: 'mill_co_op', counterpartyAddress: 'rrn1qmill',
      direction: 'out', amountCenti: -250, memo: 'Candles',
      state: 'cancelled', timestamp: now - 5 * 86400,
    },
  ];
}

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {navigate: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

let current: Renderer | undefined;

async function renderHistory(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <History navigation={navigation} route={{} as any} />
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
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}

afterEach(() => {
  // Unmount so the SectionList's async cell-render timers are cleared.
  act(() => current?.unmount());
  current = undefined;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockActivity.data = txns();
  mockActivity.isLoading = false;
});

test('renders transactions grouped by day', async () => {
  const r = await renderHistory();
  expect(hasText(r, 'Activity')).toBe(true);
  expect(hasText(r, 'Consultation')).toBe(true);
  expect(hasText(r, 'Grain delivery')).toBe(true);
  expect(hasText(r, 'TODAY')).toBe(true); // day header (uppercased)
});

test('the "Sent" filter shows only outgoing transactions', async () => {
  const r = await renderHistory();
  await press(button(r, 'Filter: Sent'));
  expect(hasText(r, 'Consultation')).toBe(true); // out
  expect(hasText(r, 'Grain delivery')).toBe(false); // in — filtered out
});

test('the "Received" filter shows only incoming transactions', async () => {
  const r = await renderHistory();
  await press(button(r, 'Filter: Received'));
  expect(hasText(r, 'Grain delivery')).toBe(true);
  expect(hasText(r, 'Consultation')).toBe(false);
});

test('tapping a row opens its transaction detail', async () => {
  const navigation = nav();
  const r = await renderHistory(navigation);
  await press(button(r, 'Consultation'));
  expect(navigation.navigate).toHaveBeenCalledWith('TransactionDetail', {id: 'a'});
});

test('a filter with no matches shows an empty message', async () => {
  mockActivity.data = txns().filter(t => t.direction === 'out');
  const r = await renderHistory();
  await press(button(r, 'Filter: Received'));
  expect(hasText(r, 'Nothing matches this filter')).toBe(true);
});
