/**
 * @format
 *
 * The vouching browser (T1.4.5). Drives the real VouchList screen over a mocked
 * `useVouches` and nickname store, asserting: the "made" tab labels a subject
 * with the local nickname and shows its statement; the "received" tab shows the
 * other set; search filters the visible rows; and an empty tab shows its empty
 * state. Uses `react-test-renderer` directly, as the other screen tests do.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {VouchList} from '../src/screens/main/VouchList';
import type {StationVouchLists} from '../src/network/StationClient';

// --- Mocks ------------------------------------------------------------------

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactActual = require('react');
    ReactActual.useEffect(cb, [cb]);
  },
}));

let mockVouches: {data?: StationVouchLists; isLoading: boolean};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useVouches: () => mockVouches,
}));

jest.mock('../src/wallet/vouchNicknames', () => ({
  loadVouchNicknames: async () => ({rrn1subjectaaaaaaaaaaaaaaaa: 'Maria'}),
}));

// --- Harness ----------------------------------------------------------------

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {navigate: jest.fn(), goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderList(
  initial: 'given' | 'received' = 'given',
  navigation = nav(),
): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <VouchList navigation={navigation} route={{params: {initial}} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text)).length > 0;
const tab = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityRole === 'tab' && textOf(n).includes(label));
const search = (r: Renderer): Instance =>
  r.root.find(
    n => n.props.placeholder === 'Search name, address, or statement' && typeof n.props.onChangeText === 'function',
  );

async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}
async function type(node: Instance, text: string): Promise<void> {
  await act(async () => {
    node.props.onChangeText?.(text);
  });
}

const LISTS: StationVouchLists = {
  given: [
    {
      vouch_id: 'a'.repeat(64),
      voucher_address: 'rrn1me',
      subject_address: 'rrn1subjectaaaaaaaaaaaaaaaa',
      community: 'rrn-phase0',
      statement: 'trusted neighbor',
      stake_centi: 150,
      issued_at: 1_700_000_000,
    },
  ],
  received: [
    {
      vouch_id: 'b'.repeat(64),
      voucher_address: 'rrn1voucherbbbbbbbbbbbbbbbb',
      subject_address: 'rrn1me',
      community: 'rrn-phase0',
      statement: 'known for years',
      stake_centi: 0,
      issued_at: 1_700_000_500,
    },
  ],
};

beforeEach(() => {
  mockVouches = {data: LISTS, isLoading: false};
});

test('the made tab labels the subject with the local nickname and its statement', async () => {
  const r = await renderList('given');
  expect(hasText(r, 'Maria')).toBe(true);
  expect(hasText(r, 'trusted neighbor')).toBe(true);
});

test('the received tab shows the other set, not the made rows', async () => {
  const r = await renderList('received');
  expect(hasText(r, 'known for years')).toBe(true);
  expect(hasText(r, 'Maria')).toBe(false);
});

test('switching tabs swaps which vouches are shown', async () => {
  const r = await renderList('given');
  expect(hasText(r, 'trusted neighbor')).toBe(true);
  await press(tab(r, 'received'));
  expect(hasText(r, 'known for years')).toBe(true);
  expect(hasText(r, 'trusted neighbor')).toBe(false);
});

test('search filters the visible rows', async () => {
  const r = await renderList('given');
  await type(search(r), 'maria');
  expect(hasText(r, 'trusted neighbor')).toBe(true);
  await type(search(r), 'no such person');
  expect(hasText(r, 'Nothing matches your search')).toBe(true);
});

test('an empty tab shows its empty state', async () => {
  mockVouches = {data: {given: [], received: []}, isLoading: false};
  const r = await renderList('given');
  expect(hasText(r, 'You’ve vouched for')).toBe(false);
  expect(hasText(r, 'haven’t vouched for anyone yet')).toBe(true);
});
