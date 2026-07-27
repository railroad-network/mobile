/**
 * @format
 *
 * Standing screen (T1.5.9). The assertions here are mostly about *honesty*
 * rather than layout: ADR-0009 requires the app not to imply a score is worse
 * than it is, nor a scale more reachable than it is, so the tests pin the
 * Phase-1 ceiling copy, the dormant-vs-poor distinction, and the anchoring
 * explanation that makes a capped score legible.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Standing} from '../src/screens/main/Standing';
import type {StationReputation} from '../src/network/StationClient';

const mockReputation: {
  data?: StationReputation;
  isLoading: boolean;
  isError: boolean;
} = {isLoading: false, isError: false};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useReputation: () => mockReputation,
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

/** A profile as the station sends it: two live dimensions, three dormant. */
function profile(overrides: Partial<StationReputation> = {}): StationReputation {
  return {
    address: 'rrn1qme',
    composite: 2.1,
    band: 'Member',
    dimensions: [
      {name: 'trade_reliability', value: 4.5, weight: 0.3, live: true},
      {name: 'attestation_accuracy', value: 2.0, weight: 0.25, live: true},
      {name: 'governance_participation', value: 0, weight: 0.15, live: false},
      {name: 'community_contribution', value: 0, weight: 0.15, live: false},
      {name: 'domain_competence', value: 0, weight: 0.15, live: false},
    ],
    domain_competence: [],
    scale_max: 5.0,
    max_composite_now: 2.75,
    anchored: true,
    anchoring_voucher_address: 'rrn1qanchorabcdefghijklmnop',
    anchor_dimension_cap: 1.0,
    computed_at: Math.floor(Date.now() / 1000) - 120,
    ...overrides,
  };
}

async function renderStanding(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Standing navigation={{goBack: jest.fn()} as any} route={{} as any} />
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
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text))
    .length > 0;

beforeEach(() => {
  mockReputation.data = profile();
  mockReputation.isLoading = false;
  mockReputation.isError = false;
});

test('shows the composite against the real scale, not a flattering one', async () => {
  const r = await renderStanding();
  expect(hasText(r, '2.10 / 5.00')).toBe(true);
  expect(hasText(r, 'Member')).toBe(true);
});

test('says what is actually reachable today (ADR-0009)', async () => {
  const r = await renderStanding();
  expect(hasText(r, 'most anyone can reach today is 2.75')).toBe(true);
  // The unreachable bands are named, so a member does not read the ceiling as
  // their own shortcoming.
  expect(hasText(r, 'Trusted')).toBe(true);
  expect(hasText(r, 'Senior')).toBe(true);
});

test('a dormant dimension reads as unmeasured, not as a zero score', async () => {
  const r = await renderStanding();
  expect(hasText(r, 'Governance participation')).toBe(true);
  expect(hasText(r, 'Opens in a later release')).toBe(true);
  // A live dimension prints its number; a dormant one prints no score at all.
  expect(hasText(r, '4.50')).toBe(true);
  expect(hasText(r, '0.00')).toBe(false);
});

test('an anchored member is told who vouched for them', async () => {
  const r = await renderStanding();
  expect(hasText(r, 'Anchored')).toBe(true);
  expect(hasText(r, 'vouched for you')).toBe(true);
});

test('an unanchored member is told why their score is held down and what lifts it', async () => {
  mockReputation.data = profile({
    composite: 0.55,
    band: 'New',
    anchored: false,
    anchoring_voucher_address: null,
    dimensions: [
      // Ten settled trades, still pinned at the cap — the confusing state.
      {name: 'trade_reliability', value: 1.0, weight: 0.3, live: true},
      {name: 'attestation_accuracy', value: 1.0, weight: 0.25, live: true},
      {name: 'governance_participation', value: 0, weight: 0.15, live: false},
      {name: 'community_contribution', value: 0, weight: 0.15, live: false},
      {name: 'domain_competence', value: 0, weight: 0.15, live: false},
    ],
  });
  const r = await renderStanding();
  expect(hasText(r, 'Not anchored yet')).toBe(true);
  expect(hasText(r, 'every dimension is held at 1.00')).toBe(true);
  expect(hasText(r, 'Member-band member')).toBe(true);
  // The reassurance that matters: the history is not being thrown away.
  expect(hasText(r, 'keeps building underneath')).toBe(true);
  expect(hasText(r, 'At the newcomer limit')).toBe(true);
});

test('does not imply the score is tunable', async () => {
  const r = await renderStanding();
  expect(hasText(r, 'no community can change it')).toBe(true);
});

test('an unreachable station says so rather than showing a zero score', async () => {
  mockReputation.data = undefined;
  mockReputation.isError = true;
  const r = await renderStanding();
  expect(hasText(r, 'Can’t reach your station')).toBe(true);
  expect(hasText(r, '/ 5.00')).toBe(false);
});

test('an unpaired member gets an explanation, not an empty screen', async () => {
  // The query is disabled without a station, so it neither loads nor errors.
  mockReputation.data = undefined;
  const r = await renderStanding();
  expect(hasText(r, 'No standing yet')).toBe(true);
  expect(hasText(r, 'Pair with one')).toBe(true);
});
