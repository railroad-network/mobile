/**
 * @format
 *
 * Dispute detail (T1.10.6, Slice A). The assertions here pin the role→action
 * matrix — the whole point of the screen — so it can never offer the wrong action
 * for the viewer's role in a dispute: the counterparty may respond, a seated
 * juror may rule, and the raiser or an onlooker is read-only. It also checks that
 * a verdict is a deliberate two-tap action, that the station's rejection of a
 * duplicate is surfaced as plain language, and that a terminal outcome closes the
 * actions off entirely.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {DisputeDetail} from '../src/screens/main/DisputeDetail';
import type {DisputeDetail as DisputeDetailData} from '../src/network/StationClient';

const SELF = 'rrn1self0000000000000000000000000000000';
const OTHER = 'rrn1other000000000000000000000000000000';
const JUROR2 = 'rrn1juror2000000000000000000000000000000';

const mockDispute: {
  data?: DisputeDetailData;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
} = {isLoading: false, isError: false, refetch: jest.fn()};

const mockRespondFn = jest.fn();
const mockCastVerdictFn = jest.fn();
const mockOpenEscalationFn = jest.fn();
const mockCastBallotFn = jest.fn();

jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useDispute: () => mockDispute,
  useIdentity: () => ({data: {address: SELF}}),
  useRespondToDispute: () => mockRespondFn,
  useCastVerdict: () => mockCastVerdictFn,
  useOpenEscalation: () => mockOpenEscalationFn,
  useCastEscalationBallot: () => mockCastBallotFn,
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

const TX_ID = 'bb'.repeat(32);

function detail(overrides: Partial<DisputeDetailData> = {}): DisputeDetailData {
  const now = Math.floor(Date.now() / 1000);
  return {
    tx_id: TX_ID,
    sender: OTHER,
    receiver: SELF,
    raiser: OTHER,
    reason: 'goods never arrived',
    opened_at: now - 3600,
    window_ends_at: now + 3600,
    tally: {uphold: 0, reject: 0, awaiting: 3, panel_size: 3},
    resolution: 'pending',
    responses: [],
    panel: [],
    eligible_pool_size: 8,
    ...overrides,
  };
}

let current: Renderer | undefined;

function element(): React.ReactElement {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <DisputeDetail
          navigation={{goBack: jest.fn()} as any}
          route={{params: {txId: TX_ID}} as any}
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
/** Types into the first (multiline) TextInput on screen. */
async function type(r: Renderer, value: string): Promise<void> {
  const input = r.root.findAll(n => (n.type as unknown as string) === 'TextInput')[0];
  await act(async () => {
    input.props.onChangeText?.(value);
  });
}

afterEach(() => {
  // Unmount so the Countdown's interval is cleared (no leaked timers).
  act(() => current?.unmount());
  current = undefined;
});

beforeEach(() => {
  mockDispute.data = detail();
  mockDispute.isLoading = false;
  mockDispute.isError = false;
  mockDispute.refetch = jest.fn();
  mockRespondFn.mockReset();
  mockCastVerdictFn.mockReset();
  mockOpenEscalationFn.mockReset();
  mockCastBallotFn.mockReset();
});

/** An open escalation view, as the station's read surface returns it. */
function escalation(
  overrides: Partial<NonNullable<DisputeDetailData['escalation']>> = {},
): NonNullable<DisputeDetailData['escalation']> {
  const now = Math.floor(Date.now() / 1000);
  return {
    reason: 'appeal',
    initiator: OTHER,
    opened_at: now - 600,
    closes_at: now + 3600,
    uphold: 1,
    reject: 0,
    eligible: 5,
    quorum_met: false,
    approval_met: true,
    ...overrides,
  };
}

test('the counterparty (a party who did not raise it) is offered a response', async () => {
  // SELF is the receiver; OTHER raised it — so SELF is the counterparty.
  const r = await renderDetail();
  expect(hasText(r, 'Respond to this dispute')).toBe(true);
  expect(hasText(r, 'You’ve been drawn onto the jury')).toBe(false);
});

test('filing a response types, submits, and confirms', async () => {
  mockRespondFn.mockResolvedValue({ok: true});
  const r = await renderDetail();

  // Disabled until a statement is entered.
  expect(pressableByLabel(r, 'File response').onPress).toBeUndefined();

  await type(r, 'tracking shows delivered');
  await press(pressableByLabel(r, 'File response').onPress);

  expect(mockRespondFn).toHaveBeenCalledWith(TX_ID, 'tracking shows delivered');
  expect(hasText(r, 'Response filed')).toBe(true);
});

test('a party who already responded sees no response form', async () => {
  mockDispute.data = detail({
    responses: [{responder: SELF, statement: 'my side', responded_at: 1}],
  });
  const r = await renderDetail();
  expect(hasText(r, 'Respond to this dispute')).toBe(false);
  expect(hasText(r, 'Response filed')).toBe(true);
});

test('a seated juror is offered a verdict — not a response', async () => {
  // Neither party; drawn onto the panel with the seat still awaiting.
  mockDispute.data = detail({
    sender: OTHER,
    receiver: JUROR2,
    raiser: OTHER,
    panel: [
      {juror: SELF, seated_at: 1, verdict: 'awaiting'},
      {juror: JUROR2, seated_at: 1, verdict: 'uphold'},
    ],
  });
  const r = await renderDetail();
  expect(hasText(r, 'You’ve been drawn onto the jury')).toBe(true);
  expect(hasText(r, 'Respond to this dispute')).toBe(false);
});

test('casting a verdict takes two taps and records success', async () => {
  mockCastVerdictFn.mockResolvedValue({ok: true});
  mockDispute.data = detail({
    sender: OTHER,
    receiver: JUROR2,
    raiser: OTHER,
    panel: [{juror: SELF, seated_at: 1, verdict: 'awaiting'}],
  });
  const r = await renderDetail();

  // Disabled until a ruling is picked.
  expect(pressableByLabel(r, 'Pick a verdict').onPress).toBeUndefined();

  await press(pressableByLabel(r, 'Uphold').onPress);
  await press(pressableByLabel(r, 'Cast “Uphold”').onPress);

  expect(mockCastVerdictFn).toHaveBeenCalledWith(TX_ID, true);
  expect(hasText(r, 'Verdict cast')).toBe(true);
});

test('a duplicate verdict is surfaced in plain language', async () => {
  mockCastVerdictFn.mockResolvedValue({
    ok: false,
    error: 'rejected',
    message: 'juror has already voted on this dispute',
  });
  mockDispute.data = detail({
    sender: OTHER,
    receiver: JUROR2,
    raiser: OTHER,
    panel: [{juror: SELF, seated_at: 1, verdict: 'awaiting'}],
  });
  const r = await renderDetail();
  await press(pressableByLabel(r, 'Reject').onPress);
  await press(pressableByLabel(r, 'Cast “Reject”').onPress);
  expect(hasText(r, 'You’ve already cast your verdict')).toBe(true);
});

test('the raiser is read-only — no response, no verdict', async () => {
  mockDispute.data = detail({sender: SELF, receiver: OTHER, raiser: SELF});
  const r = await renderDetail();
  expect(hasText(r, 'Now with the jury')).toBe(true);
  expect(hasText(r, 'Respond to this dispute')).toBe(false);
  expect(hasText(r, 'You’ve been drawn onto the jury')).toBe(false);
});

test('a terminal outcome closes the actions and shows the result', async () => {
  // Even a seated juror gets no action once the dispute is upheld.
  mockDispute.data = detail({
    resolution: 'upheld',
    tally: {uphold: 2, reject: 1, awaiting: 0, panel_size: 3},
    panel: [{juror: SELF, seated_at: 1, verdict: 'awaiting'}],
    sender: OTHER,
    receiver: JUROR2,
    raiser: OTHER,
  });
  const r = await renderDetail();
  expect(hasText(r, 'This dispute has reached an outcome')).toBe(true);
  expect(hasText(r, 'You’ve been drawn onto the jury')).toBe(false);
  expect(hasText(r, 'Upheld')).toBe(true);
});

test('a party can appeal a jury ruling in its appeal window', async () => {
  // SELF is a party; the jury has ruled and the appeal window is open.
  mockOpenEscalationFn.mockResolvedValue({ok: true});
  mockDispute.data = detail({resolution: 'awaiting_appeal'});
  const r = await renderDetail();
  expect(hasText(r, 'The jury has ruled')).toBe(true);

  await press(pressableByLabel(r, 'Appeal to the community').onPress);
  expect(mockOpenEscalationFn).toHaveBeenCalledWith(TX_ID, 'appeal');
  expect(hasText(r, 'Put to the community')).toBe(true);
});

test('a party can escalate when the jury pool is too small to seat a panel', async () => {
  // Pending, with a pool of 1 — below the majority of a 3-seat panel.
  mockOpenEscalationFn.mockResolvedValue({ok: true});
  mockDispute.data = detail({resolution: 'pending', eligible_pool_size: 1});
  const r = await renderDetail();
  expect(hasText(r, 'The jury pool is too small')).toBe(true);

  await press(pressableByLabel(r, 'Escalate to the community').onPress);
  expect(mockOpenEscalationFn).toHaveBeenCalledWith(TX_ID, 'cannot_seat');
});

test('an eligible non-party member is offered an escalation ballot', async () => {
  mockCastBallotFn.mockResolvedValue({ok: true});
  // SELF is neither party; an escalation is open and the sub-window is running.
  mockDispute.data = detail({
    sender: OTHER,
    receiver: JUROR2,
    raiser: OTHER,
    resolution: 'escalation_pending',
    escalation: escalation({reason: 'cannot_seat'}),
  });
  const r = await renderDetail();
  expect(hasText(r, 'Cast your ballot')).toBe(true);

  // Two taps, like a juror verdict.
  expect(pressableByLabel(r, 'Pick a ballot').onPress).toBeUndefined();
  await press(pressableByLabel(r, 'Uphold').onPress);
  await press(pressableByLabel(r, 'Cast “Uphold”').onPress);

  expect(mockCastBallotFn).toHaveBeenCalledWith(TX_ID, true);
  expect(hasText(r, 'Ballot cast')).toBe(true);
});

test('a party is recused from voting in an open escalation', async () => {
  // SELF is the receiver — a party — so no ballot, just a recusal note.
  mockDispute.data = detail({
    resolution: 'escalation_pending',
    escalation: escalation(),
  });
  const r = await renderDetail();
  expect(hasText(r, 'You’re a party — recused')).toBe(true);
  expect(hasText(r, 'Cast your ballot')).toBe(false);
});

/** A seated panel with the given verdicts, one juror each. */
function panel(...verdicts: Array<'uphold' | 'reject' | 'awaiting'>) {
  const now = Math.floor(Date.now() / 1000);
  return verdicts.map((verdict, i) => ({
    juror: `rrn1juror${i}00000000000000000000000000000`,
    seated_at: now - 1200,
    verdict,
  }));
}

test('a decided escalation is read-only and shows the outcome', async () => {
  mockDispute.data = detail({
    sender: OTHER,
    receiver: JUROR2,
    raiser: OTHER,
    resolution: 'escalation_upheld',
    panel: panel('uphold', 'uphold', 'reject'),
    escalation: escalation({uphold: 4, reject: 1, quorum_met: true}),
  });
  const r = await renderDetail();
  expect(hasText(r, 'Cast your ballot')).toBe(false);
});

test('an appeal that overturns the jury reads as won', async () => {
  // Jury rejected (2–1); the community upheld the dispute — the appeal overturned it.
  mockDispute.data = detail({
    resolution: 'escalation_upheld',
    panel: panel('reject', 'reject', 'uphold'),
    escalation: escalation({reason: 'appeal', uphold: 3, reject: 1, quorum_met: true}),
  });
  const r = await renderDetail();
  expect(hasText(r, 'Appeal won — the community overturned the jury')).toBe(true);
});

test('an appeal the community agrees with reads as lost', async () => {
  // Jury rejected; the community also rejected — the appeal did not change the ruling.
  mockDispute.data = detail({
    resolution: 'escalation_rejected',
    panel: panel('reject', 'reject', 'uphold'),
    escalation: escalation({reason: 'appeal', uphold: 1, reject: 3, quorum_met: true}),
  });
  const r = await renderDetail();
  expect(hasText(r, 'Appeal lost — the jury’s ruling stands')).toBe(true);
});

test('a lapsed appeal reads as lost', async () => {
  mockDispute.data = detail({
    resolution: 'escalation_lapsed',
    panel: panel('uphold', 'uphold', 'reject'),
    escalation: escalation({reason: 'appeal', uphold: 0, reject: 0, quorum_met: false}),
  });
  const r = await renderDetail();
  expect(hasText(r, 'Appeal lapsed — no community majority, the jury’s ruling gives way')).toBe(true);
});

test('an open escalation shows its live standing at a glance', async () => {
  // SELF is a party, so recused — but the standing badge still shows the leaning.
  mockDispute.data = detail({
    resolution: 'escalation_pending',
    escalation: escalation({uphold: 3, reject: 1, quorum_met: true, approval_met: true}),
  });
  const r = await renderDetail();
  expect(hasText(r, 'Leaning: uphold')).toBe(true);
});
