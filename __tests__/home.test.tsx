/**
 * @format
 *
 * Wallet home (T1.2.4). Drives the real Home screen over mocked ledger hooks and
 * asserts the acceptance behaviours: it renders balance + recent activity,
 * tapping an activity row opens the transaction detail, the empty state shows
 * when there is no activity, the offline banner + indicator appear when the
 * station is unreachable, and the quick actions / "See all" navigate.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do); the RN
 * testing libraries don't render cleanly against React 19 here.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Home} from '../src/screens/main/Home';
import type {Transaction} from '../src/ledger';

// --- Mocked ledger hooks (keep format/stateBadge/types real) ----------------

interface Query<T> {
  data: T | undefined;
  isLoading: boolean;
}

const mockIdentity: Query<{address: string; nickname?: string; community?: string}> = {} as any;
const mockBalance: Query<{centi: number}> = {} as any;
const mockActivity: Query<Transaction[]> = {} as any;
const mockInbox: Query<Transaction[]> = {} as any;
let mockConnectivity: {level: string; isOffline: boolean};
const mockRefresh = jest.fn(async () => {});

jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useIdentity: () => mockIdentity,
  useBalance: () => mockBalance,
  useActivity: () => mockActivity,
  useInbox: () => mockInbox,
  useConnectivity: () => mockConnectivity,
  useRefreshLedger: () => mockRefresh,
}));

// --- Fixtures ---------------------------------------------------------------

const IDENTITY = {
  address: 'rrn1q9f2c8x7v3k0p4m6w2j5h8n1d4s7a0zqr',
  nickname: 'asa_wren',
  community: 'Blue Ridge Collective',
};

function txns(): Transaction[] {
  return [
    {
      id: 'tx_7b21', counterparty: 'dr_sarah', counterpartyAddress: 'rrn1qsarah',
      direction: 'out', amountCenti: -300, memo: 'General consultation',
      state: 'window', timestamp: Math.floor(Date.now() / 1000) - 7200,
    },
    {
      id: 'tx_8f3a', counterparty: 'valley_farm', counterpartyAddress: 'rrn1qvalley',
      direction: 'in', amountCenti: 800, memo: 'Grain — 2 sacks',
      state: 'settled', timestamp: Math.floor(Date.now() / 1000) - 72000,
    },
  ];
}

// --- Harness ----------------------------------------------------------------

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function nav() {
  return {navigate: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderHome(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Home navigation={navigation} route={{} as any} />
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
  r.root.findAll(
    n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text),
  ).length > 0;

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

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockIdentity, {data: IDENTITY, isLoading: false});
  Object.assign(mockBalance, {data: {centi: 2400}, isLoading: false});
  Object.assign(mockActivity, {data: txns(), isLoading: false});
  Object.assign(mockInbox, {data: [], isLoading: false});
  mockConnectivity = {level: 'mesh', isOffline: false};
});

test('renders the member, balance, and recent activity', async () => {
  const r = await renderHome();
  expect(hasText(r, 'asa_wren')).toBe(true);
  expect(hasText(r, 'Blue Ridge Collective')).toBe(true);
  expect(hasText(r, '24.00')).toBe(true); // balance, no leading sign
  expect(hasText(r, 'General consultation')).toBe(true);
  expect(hasText(r, 'Grain — 2 sacks')).toBe(true);
  // Signed activity amounts.
  expect(hasText(r, '−3.00')).toBe(true);
  expect(hasText(r, '+8.00')).toBe(true);
});

test('tapping an activity row opens its transaction detail', async () => {
  const navigation = nav();
  const r = await renderHome(navigation);
  await press(button(r, 'General consultation'));
  expect(navigation.navigate).toHaveBeenCalledWith('TransactionDetail', {id: 'tx_7b21'});
});

test('the quick actions navigate to Send and Receive', async () => {
  const navigation = nav();
  const r = await renderHome(navigation);
  await press(button(r, 'Send'));
  await press(button(r, 'Request'));
  expect(navigation.navigate).toHaveBeenCalledWith('Send');
  expect(navigation.navigate).toHaveBeenCalledWith('Receive');
});

test('"See all" jumps to the History tab', async () => {
  const navigation = nav();
  const r = await renderHome(navigation);
  await press(button(r, 'See all activity'));
  expect(navigation.navigate).toHaveBeenCalledWith('History');
});

test('shows the empty state when there is no activity', async () => {
  Object.assign(mockActivity, {data: [], isLoading: false});
  const r = await renderHome();
  expect(hasText(r, 'No transactions yet')).toBe(true);
  expect(hasText(r, 'Send or receive Commons to get started')).toBe(true);
});

test('shows a loading state while activity is fetching', async () => {
  Object.assign(mockActivity, {data: undefined, isLoading: true});
  const r = await renderHome();
  expect(hasText(r, 'Loading your activity')).toBe(true);
});

test('shows the offline banner and indicator when the station is unreachable', async () => {
  mockConnectivity = {level: 'offline', isOffline: true};
  const r = await renderHome();
  expect(hasText(r, 'You’re offline')).toBe(true);
  expect(hasText(r, 'Offline')).toBe(true); // connectivity pill label
});

test('shows a placeholder balance until it loads', async () => {
  Object.assign(mockBalance, {data: undefined, isLoading: true});
  const r = await renderHome();
  expect(hasText(r, '—')).toBe(true);
});

test('surfaces the confirmation inbox and opens a proposal', async () => {
  Object.assign(mockInbox, {
    data: [
      {
        id: 'p1', counterparty: 'valley_farm', counterpartyAddress: 'rrn1qvalley',
        direction: 'in', amountCenti: 1500, memo: 'Split the seed order',
        state: 'pending', timestamp: Math.floor(Date.now() / 1000) - 3600,
        expiresAt: Math.floor(Date.now() / 1000) + 172800,
      },
    ],
    isLoading: false,
  });
  const navigation = nav();
  const r = await renderHome(navigation);
  expect(hasText(r, 'To confirm')).toBe(true);
  expect(hasText(r, 'Split the seed order')).toBe(true);
  await press(button(r, 'Split the seed order'));
  expect(navigation.navigate).toHaveBeenCalledWith('ConfirmReceived', {id: 'p1'});
});
