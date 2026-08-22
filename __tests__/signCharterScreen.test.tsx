/**
 * @format
 *
 * Sign the founding charter (founding-charter). The tests pin the states a
 * founder's phone must tell apart: the charter body on offer, the one action
 * (sign) when this phone is an unsigned founder, the waiting state once it has
 * signed, the ratified state once the threshold is met, and the read-only state
 * for a non-founder or a station with no ceremony under way.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {SignCharter} from '../src/screens/main/SignCharter';
import type {StationPendingCharter} from '../src/network/StationClient';

type Query<T> = {data?: T; isLoading: boolean; isError: boolean; refetch: () => void};
let mockIdentity: {data?: {address?: string}} = {data: {address: 'rrn1self'}};
let mockPending: Query<StationPendingCharter> = {
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
const mockSign = jest.fn();

jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useIdentity: () => mockIdentity,
  usePendingCharter: () => mockPending,
  useSignFoundingCharter: () => mockSign,
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;
let current: Renderer | undefined;

function pending(overrides: Partial<StationPendingCharter> = {}): StationPendingCharter {
  return {
    exists: true,
    published: false,
    charter_hash: 'ab'.repeat(32),
    community_id: 'northern-forest',
    founding_principles: ['Mutual aid'],
    rights_floor: ['Right to leave'],
    founders: ['rrn1self', 'rrn1b', 'rrn1c'],
    signed_founders: ['rrn1b'],
    threshold: 3,
    created_at: Math.floor(Date.now() / 1000) - 600,
    version: 1,
    body_hex: 'cd'.repeat(8),
    ...overrides,
  };
}

async function renderScreen(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <SignCharter
            navigation={{goBack: jest.fn(), navigate: jest.fn()} as any}
            route={{} as any}
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
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text))
    .length > 0;
const findButton = (r: Renderer, label: string): Instance | undefined =>
  r.root.findAll(n => {
    const role = (n.props as {accessibilityRole?: string}).accessibilityRole;
    return role === 'button' && textOf(n).includes(label);
  })[0];

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
});

beforeEach(() => {
  mockIdentity = {data: {address: 'rrn1self'}};
  mockPending = {isLoading: false, isError: false, refetch: jest.fn(), data: pending()};
  mockSign.mockReset();
});

test('shows the charter body being ratified and the signing progress', async () => {
  const r = await renderScreen();
  expect(hasText(r, 'northern-forest')).toBe(true);
  expect(hasText(r, 'Mutual aid')).toBe(true);
  expect(hasText(r, 'Right to leave')).toBe(true);
  expect(hasText(r, '1 of 3 needed')).toBe(true);
});

test('offers the sign action to an unsigned founder', async () => {
  const r = await renderScreen();
  expect(hasText(r, 'Your signature is needed')).toBe(true);
  expect(findButton(r, 'Sign the founding charter')).toBeDefined();
});

test('signing calls through and then shows the waiting state', async () => {
  mockSign.mockResolvedValue({ok: true, pending: pending({signed_founders: ['rrn1self', 'rrn1b']})});
  const r = await renderScreen();
  await act(async () => {
    findButton(r, 'Sign the founding charter')!.props.onPress();
  });
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(hasText(r, 'Your signature is in')).toBe(true);
});

test('surfaces a signing failure', async () => {
  mockSign.mockResolvedValue({ok: false, error: 'unreachable', message: 'no route'});
  const r = await renderScreen();
  await act(async () => {
    findButton(r, 'Sign the founding charter')!.props.onPress();
  });
  expect(hasText(r, 'That didn’t go through')).toBe(true);
});

test('a founder who already signed sees the waiting state, no button', async () => {
  mockPending.data = pending({signed_founders: ['rrn1self', 'rrn1b']});
  const r = await renderScreen();
  expect(hasText(r, 'Your signature is in')).toBe(true);
  expect(findButton(r, 'Sign the founding charter')).toBeUndefined();
});

test('a published charter shows the ratified state', async () => {
  mockPending.data = pending({published: true, signed_founders: ['rrn1self', 'rrn1b', 'rrn1c']});
  const r = await renderScreen();
  expect(hasText(r, 'Charter ratified')).toBe(true);
  expect(findButton(r, 'Sign the founding charter')).toBeUndefined();
});

test('a non-founder sees a read-only explanation', async () => {
  mockPending.data = pending({founders: ['rrn1b', 'rrn1c', 'rrn1d'], signed_founders: []});
  const r = await renderScreen();
  expect(hasText(r, 'You’re not a founder of this charter')).toBe(true);
  expect(findButton(r, 'Sign the founding charter')).toBeUndefined();
});

test('no ceremony under way explains where it starts', async () => {
  mockPending.data = pending({exists: false});
  const r = await renderScreen();
  expect(hasText(r, 'No founding ceremony yet')).toBe(true);
});
