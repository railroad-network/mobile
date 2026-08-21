/**
 * @format
 *
 * Governance hub (T1.9.8). The tests pin the states a member must be able to
 * tell apart at a glance: a community still bootstrapping (no Charter), a
 * published Charter with its decision rules, the proposals list with its phase
 * badges and the "needs you" hint, and the unpaired empty state.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Governance} from '../src/screens/main/Governance';
import type {
  StationCharter,
  StationPendingCharter,
  StationProposalSummary,
} from '../src/network/StationClient';

type Query<T> = {data?: T; isLoading: boolean; isError: boolean};
const mockCharter: Query<StationCharter> = {isLoading: false, isError: false};
const mockProposals: Query<StationProposalSummary[]> = {isLoading: false, isError: false};
const mockStatutes: Query<unknown[]> = {isLoading: false, isError: false, data: []};
// The founding ceremony state; default to none (no charter nudge), per test.
let mockPendingCharter: Query<StationPendingCharter> = {isLoading: false, isError: false};
// Identity carries the bootstrap-grace flag the hub's grace note reads; default
// to no bootstrap (note hidden), overridden per test.
let mockIdentity: Query<{
  address?: string;
  bootstrap?: {inGrace: boolean; established: number; threshold: number};
}> = {
  isLoading: false,
  isError: false,
};
// Standing feeds the ADR-0015 "needs you" eligibility gate; default established.
let mockReputation: Query<{band: string}> = {isLoading: false, isError: false};

jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useCharter: () => mockCharter,
  useProposals: () => mockProposals,
  useStatutes: () => mockStatutes,
  useIdentity: () => mockIdentity,
  useReputation: () => mockReputation,
  usePendingCharter: () => mockPendingCharter,
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;
let current: Renderer | undefined;

function charter(overrides: Partial<StationCharter> = {}): StationCharter {
  return {
    published: true,
    version: 1,
    charter_hash: 'ab'.repeat(32),
    community_id: 'rrn-phase0',
    founding_principles: ['Be kind to each other'],
    rights_floor: ['Everyone has a voice'],
    founders: ['rrn1a', 'rrn1b'],
    statute_quorum_pct: 30,
    statute_approval_pct: 50,
    deliberation_window_days: 7,
    implementation_delay_days: 7,
    emergency_threshold_pct: 67,
    charter_quorum_pct: 50,
    charter_approval_pct: 75,
    charter_deliberation_window_days: 30,
    cosign_threshold: 3,
    ...overrides,
  };
}

function proposal(overrides: Partial<StationProposalSummary> = {}): StationProposalSummary {
  return {
    proposal_id: 'aa'.repeat(32),
    author: 'rrn1qauthor',
    title: 'Adopt a quiet-hours norm',
    kind: 'statute',
    created_at: Math.floor(Date.now() / 1000) - 3600,
    voting_ends_at: Math.floor(Date.now() / 1000) + 3600,
    implementation_at: Math.floor(Date.now() / 1000) + 90000,
    phase: 'voting',
    published: true,
    cosigner_count: 3,
    tally: {
      yes: 2,
      no: 1,
      abstain: 0,
      eligible_voters: 5,
      quorum_met: false,
      approval_met: true,
    },
    enacted: false,
    ...overrides,
  };
}

async function renderHub(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Governance navigation={{goBack: jest.fn(), navigate: jest.fn()} as any} route={{} as any} />
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

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
});

beforeEach(() => {
  mockCharter.data = charter();
  mockCharter.isLoading = false;
  mockCharter.isError = false;
  mockProposals.data = [proposal()];
  mockProposals.isLoading = false;
  mockProposals.isError = false;
  mockStatutes.data = [];
  mockIdentity = {isLoading: false, isError: false, data: {address: 'rrn1self'}};
  mockReputation = {isLoading: false, isError: false, data: {band: 'Member'}};
  mockPendingCharter = {isLoading: false, isError: false, data: pendingCharter({exists: false})};
});

function pendingCharter(
  overrides: Partial<StationPendingCharter> = {},
): StationPendingCharter {
  return {
    exists: true,
    published: false,
    charter_hash: 'ab'.repeat(32),
    community_id: 'rrn-phase0',
    founding_principles: ['Be kind to each other'],
    rights_floor: ['Everyone has a voice'],
    founders: ['rrn1self', 'rrn1b', 'rrn1c'],
    signed_founders: ['rrn1b'],
    threshold: 3,
    created_at: Math.floor(Date.now() / 1000) - 600,
    version: 1,
    body_hex: 'cd'.repeat(8),
    ...overrides,
  };
}

test('a bootstrapping community says its Charter is not ratified yet', async () => {
  mockCharter.data = charter({published: false, community_id: '', founders: []});
  const r = await renderHub();
  expect(hasText(r, 'No Charter yet')).toBe(true);
});

test('a published Charter shows its principles and decision rules', async () => {
  const r = await renderHub();
  expect(hasText(r, 'rrn-phase0')).toBe(true);
  expect(hasText(r, 'Be kind to each other')).toBe(true);
  expect(hasText(r, 'Everyone has a voice')).toBe(true);
  // The rules that let a member read a tally honestly.
  expect(hasText(r, '30%')).toBe(true);
  expect(hasText(r, '3 co-signers')).toBe(true);
});

test('shows a founders-decide note while the community is in bootstrap grace', async () => {
  mockIdentity = {
    isLoading: false,
    isError: false,
    data: {bootstrap: {inGrace: true, established: 1, threshold: 3}},
  };
  const r = await renderHub();
  expect(hasText(r, 'Founders decide for now')).toBe(true);
  expect(hasText(r, 'stand in as the voters and jurors')).toBe(true);
});

test('hides the grace note once the community has left grace', async () => {
  mockIdentity = {
    isLoading: false,
    isError: false,
    data: {bootstrap: {inGrace: false, established: 3, threshold: 3}},
  };
  const r = await renderHub();
  expect(hasText(r, 'Founders decide for now')).toBe(false);
});

test('a voting proposal shows its kind, phase, and that it needs the member', async () => {
  const r = await renderHub();
  expect(hasText(r, 'Statute')).toBe(true);
  expect(hasText(r, 'Voting open')).toBe(true);
  expect(hasText(r, 'Needs you')).toBe(true);
  expect(hasText(r, 'Adopt a quiet-hours norm')).toBe(true);
});

test('a concluded proposal is not flagged as needing the member', async () => {
  mockProposals.data = [
    proposal({
      phase: 'concluded',
      tally: {
        yes: 4,
        no: 0,
        abstain: 0,
        eligible_voters: 5,
        quorum_met: true,
        approval_met: true,
        outcome: 'passed',
      },
    }),
  ];
  const r = await renderHub();
  expect(hasText(r, 'Passed')).toBe(true);
  expect(hasText(r, 'Needs you')).toBe(false);
});

test('does not flag a voting proposal as needing a New non-founder in grace', async () => {
  // The electorate under grace is the founders; a New non-founder is not one, so
  // the hub must not nudge them to act (ADR-0015).
  mockIdentity = {
    isLoading: false,
    isError: false,
    data: {address: 'rrn1self', bootstrap: {inGrace: true, established: 0, threshold: 3}},
  };
  mockReputation = {isLoading: false, isError: false, data: {band: 'New'}};
  mockCharter.data = charter({founders: ['rrn1a', 'rrn1b']});
  const r = await renderHub();
  expect(hasText(r, 'Voting open')).toBe(true);
  expect(hasText(r, 'Needs you')).toBe(false);
});

test('an empty proposals list explains where proposals come from', async () => {
  mockProposals.data = [];
  const r = await renderHub();
  expect(hasText(r, 'No proposals yet')).toBe(true);
});

test('nudges an unsigned founder to sign the founding charter', async () => {
  mockPendingCharter = {
    isLoading: false,
    isError: false,
    // This phone is a declared founder who has not signed the pending charter.
    data: pendingCharter({founders: ['rrn1self', 'rrn1b', 'rrn1c'], signed_founders: []}),
  };
  const r = await renderHub();
  expect(hasText(r, 'Sign the founding charter')).toBe(true);
});

test('does not nudge a founder who has already signed the charter', async () => {
  mockPendingCharter = {
    isLoading: false,
    isError: false,
    data: pendingCharter({signed_founders: ['rrn1self']}),
  };
  const r = await renderHub();
  expect(hasText(r, 'Sign the founding charter')).toBe(false);
});

test('does not nudge a non-founder about the founding charter', async () => {
  mockPendingCharter = {
    isLoading: false,
    isError: false,
    data: pendingCharter({founders: ['rrn1b', 'rrn1c', 'rrn1d'], signed_founders: []}),
  };
  const r = await renderHub();
  expect(hasText(r, 'Sign the founding charter')).toBe(false);
});

test('an unpaired member gets an explanation, not an empty screen', async () => {
  mockCharter.data = undefined;
  mockProposals.data = undefined;
  const r = await renderHub();
  expect(hasText(r, 'No governance yet')).toBe(true);
});
