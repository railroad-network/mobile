/**
 * @format
 *
 * Governance proposal detail (T1.9.8). The assertions here pin the phase→action
 * matrix — the whole point of the screen — so it can never offer the wrong action
 * for a proposal's state: co-sign only while deliberating-and-unpublished, vote
 * only while voting-and-published, read-only once concluded. It also checks that
 * a cast ballot is a deliberate two-tap action and that the station's rejection
 * of a duplicate is surfaced as plain language.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {GovProposalDetail} from '../src/screens/main/GovProposalDetail';
import type {StationProposalDetail} from '../src/network/StationClient';

const mockProposal: {
  data?: StationProposalDetail;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
} = {isLoading: false, isError: false, refetch: jest.fn()};

const mockCosignFn = jest.fn();
const mockCastVoteFn = jest.fn();

// Member context feeding ADR-0015 vote eligibility. Default: an established
// member not in grace, so the phase→action tests below see the ballot as before.
const mockIdentity: {data?: any} = {};
const mockReputation: {data?: any} = {};
const mockCharter: {data?: any} = {};

jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useProposal: () => mockProposal,
  useCharter: () => mockCharter,
  useCosignProposal: () => mockCosignFn,
  useCastVote: () => mockCastVoteFn,
  useIdentity: () => mockIdentity,
  useReputation: () => mockReputation,
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

function detail(overrides: Partial<StationProposalDetail> = {}): StationProposalDetail {
  return {
    proposal_id: 'aa'.repeat(32),
    author: 'rrn1qauthorabcdefghijklmnop',
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
    body: 'The full text of the proposal.',
    cosigners: ['rrn1a', 'rrn1b', 'rrn1c'],
    ...overrides,
  };
}

let current: Renderer | undefined;

function element(): React.ReactElement {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <GovProposalDetail
          navigation={{goBack: jest.fn()} as any}
          route={{params: {proposalId: 'aa'.repeat(32)}} as any}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

async function renderDetail(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(element());
  });
  current = r;
  return r;
}

/** Re-render with the current `mockProposal.data`, standing in for a poll tick. */
async function poll(r: Renderer): Promise<void> {
  await act(async () => {
    r.update(element());
  });
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text))
    .length > 0;

/** Finds a pressable by accessibility label and returns its (maybe-undefined) onPress. */
function pressableByLabel(r: Renderer, label: string): {onPress?: () => void} {
  const nodes = r.root.findAll(
    n => typeof n.props?.onPress !== 'undefined' && n.props?.accessibilityLabel === label,
  );
  return nodes[0]?.props ?? {};
}
async function press(fn?: () => void): Promise<void> {
  await act(async () => {
    fn?.();
  });
}

afterEach(() => {
  // Unmount so the Countdown's interval is cleared (no leaked timers).
  act(() => current?.unmount());
  current = undefined;
});

beforeEach(() => {
  mockProposal.data = detail();
  mockProposal.isLoading = false;
  mockProposal.isError = false;
  mockProposal.refetch = jest.fn();
  mockCosignFn.mockReset();
  mockCastVoteFn.mockReset();
  // Default member: established, community out of grace → eligible to vote.
  mockCharter.data = {cosign_threshold: 3, founders: []};
  mockIdentity.data = {
    address: 'rrn1self',
    bootstrap: {inGrace: false, established: 5, threshold: 3},
  };
  mockReputation.data = {band: 'Member'};
});

test('a deliberating, unpublished proposal offers co-sign — not voting', async () => {
  mockProposal.data = detail({phase: 'deliberation', published: false, cosigner_count: 1});
  const r = await renderDetail();
  expect(hasText(r, 'Co-sign this proposal')).toBe(true);
  expect(hasText(r, 'Cast your vote')).toBe(false);
  // The co-signer progress is shown against the charter threshold.
  expect(hasText(r, '1 of 3')).toBe(true);
});

test('a published, voting proposal offers the three choices — not co-sign', async () => {
  const r = await renderDetail();
  expect(hasText(r, 'Cast your vote')).toBe(true);
  expect(hasText(r, 'Co-sign this proposal')).toBe(false);
  expect(hasText(r, 'Yes')).toBe(true);
  expect(hasText(r, 'Abstain')).toBe(true);
});

test('a concluded proposal is read-only and shows the outcome', async () => {
  mockProposal.data = detail({
    phase: 'concluded',
    tally: {
      yes: 4,
      no: 1,
      abstain: 0,
      eligible_voters: 5,
      quorum_met: true,
      approval_met: true,
      outcome: 'passed',
    },
  });
  const r = await renderDetail();
  expect(hasText(r, 'Passed')).toBe(true);
  expect(hasText(r, 'Cast your vote')).toBe(false);
  expect(hasText(r, 'Co-sign this proposal')).toBe(false);
});

test('casting a vote takes two taps and records success', async () => {
  mockCastVoteFn.mockResolvedValue({ok: true});
  const r = await renderDetail();

  // The cast button is disabled until a choice is picked.
  expect(pressableByLabel(r, 'Pick a choice').onPress).toBeUndefined();

  await press(pressableByLabel(r, 'Yes').onPress);
  await press(pressableByLabel(r, 'Cast “Yes”').onPress);

  expect(mockCastVoteFn).toHaveBeenCalledWith('aa'.repeat(32), 'yes');
  expect(hasText(r, 'Vote cast')).toBe(true);
});

test('a duplicate vote is surfaced in plain language', async () => {
  mockCastVoteFn.mockResolvedValue({
    ok: false,
    error: 'rejected',
    message: 'voter has already voted on this proposal',
  });
  const r = await renderDetail();
  await press(pressableByLabel(r, 'No').onPress);
  await press(pressableByLabel(r, 'Cast “No”').onPress);
  expect(hasText(r, 'You’ve already voted on this')).toBe(true);
});

test('co-signing calls the hook and confirms', async () => {
  mockProposal.data = detail({phase: 'deliberation', published: false});
  mockCosignFn.mockResolvedValue({ok: true, cosignerCount: 2});
  const r = await renderDetail();
  await press(pressableByLabel(r, 'Co-sign this proposal').onPress);
  expect(mockCosignFn).toHaveBeenCalledWith('aa'.repeat(32));
  expect(hasText(r, 'Co-signed')).toBe(true);
});

test('after co-signing, a poll into voting reveals the ballot without leaving', async () => {
  mockProposal.data = detail({phase: 'deliberation', published: false, cosigner_count: 0});
  mockCosignFn.mockResolvedValue({ok: true, cosignerCount: 1});
  const r = await renderDetail();

  await press(pressableByLabel(r, 'Co-sign this proposal').onPress);
  // Immediately after, the confirmation shows and no ballot yet.
  expect(hasText(r, 'Co-signed')).toBe(true);
  expect(hasText(r, 'Cast your vote')).toBe(false);

  // The co-sign opened voting; the next poll observes it.
  mockProposal.data = detail({phase: 'voting', published: true, cosigner_count: 1});
  await poll(r);

  // The confirmation yields to the ballot in place — no back-and-forth.
  expect(hasText(r, 'Cast your vote')).toBe(true);
  expect(hasText(r, 'Co-signed')).toBe(false);
});

test('a cast ballot stays confirmed even as the tally keeps polling', async () => {
  mockCastVoteFn.mockResolvedValue({ok: true});
  const r = await renderDetail();
  await press(pressableByLabel(r, 'Yes').onPress);
  await press(pressableByLabel(r, 'Cast “Yes”').onPress);
  expect(hasText(r, 'Vote cast')).toBe(true);

  // A later poll brings a moved tally but must not re-offer the ballot.
  mockProposal.data = detail({
    tally: {yes: 3, no: 1, abstain: 0, eligible_voters: 5, quorum_met: true, approval_met: true},
  });
  await poll(r);
  expect(hasText(r, 'Vote cast')).toBe(true);
  expect(hasText(r, 'Cast your vote')).toBe(false);
});

test('a New non-founder in grace is not offered a ballot, but told why (ADR-0015)', async () => {
  // Under grace the electorate is the founders; this member is neither a founder
  // nor established, so the ballot must not appear.
  mockIdentity.data = {
    address: 'rrn1self',
    bootstrap: {inGrace: true, established: 0, threshold: 3},
  };
  mockReputation.data = {band: 'New'};
  mockCharter.data = {cosign_threshold: 3, founders: ['rrn1founderA', 'rrn1founderB']};

  const r = await renderDetail();
  expect(hasText(r, 'Cast your vote')).toBe(false);
  expect(hasText(r, 'Founders decide for now')).toBe(true);
});

test('a founder in grace is offered the ballot even while still New', async () => {
  // Grace lets a founder stand in for the empty established electorate.
  mockIdentity.data = {
    address: 'rrn1self',
    bootstrap: {inGrace: true, established: 0, threshold: 3},
  };
  mockReputation.data = {band: 'New'};
  mockCharter.data = {cosign_threshold: 3, founders: ['rrn1self', 'rrn1founderB']};

  const r = await renderDetail();
  expect(hasText(r, 'Cast your vote')).toBe(true);
});

test('a New member is not offered a co-sign under grace either', async () => {
  mockProposal.data = detail({phase: 'deliberation', published: false, cosigner_count: 1});
  mockIdentity.data = {
    address: 'rrn1self',
    bootstrap: {inGrace: true, established: 0, threshold: 3},
  };
  mockReputation.data = {band: 'New'};
  mockCharter.data = {cosign_threshold: 3, founders: ['rrn1founderA']};

  const r = await renderDetail();
  expect(hasText(r, 'Co-sign this proposal')).toBe(false);
  expect(hasText(r, 'Founders decide for now')).toBe(true);
});
