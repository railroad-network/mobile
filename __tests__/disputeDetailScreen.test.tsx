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

jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useDispute: () => mockDispute,
  useIdentity: () => ({data: {address: SELF}}),
  useRespondToDispute: () => mockRespondFn,
  useCastVerdict: () => mockCastVerdictFn,
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
});

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
