/**
 * @format
 *
 * The inquiry thread screen (T1.7.4): rendering the conversation and offers, and
 * the moves with real logic behind them. The model is "the provider grants the
 * inquiry": only the provider accepts, and only the buyer's standing offer — so
 * the buyer never sees Accept, and a provider who has countered waits for the
 * buyer to re-offer. Declining is scoped to the viewer's side (the buyer
 * withdraws, the provider declines). The hooks are mocked so the test drives the
 * screen's own reasoning, not the network.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {Inquiry} from '../src/screens/main/Inquiry';
import {ThemeProvider} from '../src/theme';
import type {StationInquiryThread} from '../src/network/StationClient';

const mockThread: {data?: StationInquiryThread; isLoading: boolean; isError: boolean; error: Error | null} = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
};

const mockSend = jest.fn(
  async (_args: {inquiryId: string; body: string; counterOfferCenti: number | null}) =>
    ({ok: true}) as const,
);
const mockClose = jest.fn(
  async (_args: {inquiryId: string; outcome: unknown}) => ({ok: true}) as const,
);
jest.mock('../src/marketplace', () => ({
  ...jest.requireActual('../src/marketplace'),
  useInquiryThread: () => mockThread,
  useSendInquiryMessage: () => mockSend,
  useCloseInquiry: () => mockClose,
}));

const BUYER = 'rrn1qbuyeraaaaaaaaaaaaaaaaaaaaaaaa';
const PROVIDER = 'rrn1qproviderbbbbbbbbbbbbbbbbbbbb';
const mockSession: {wallet: {address: string} | null} = {wallet: {address: BUYER}};
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => mockSession,
}));

// The Agreed settle action reaches into the ledger to send the payment and to
// check (by the inquiry's memo) whether one already exists. Real `inquiryMemo`
// and formatters come through; the two hooks are stubbed.
const mockSettle = jest.fn(
  async (_args: {
    inquiryId: string;
    listingTitle: string;
    providerAddress: string;
    amountCenti: number;
    listingIdHex: string;
  }) => ({ok: true, id: 'tx1'}) as const,
);
const mockActivity: {data: {memo?: string; state: string}[]} = {data: []};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useSettleAgreement: () => mockSettle,
  useActivity: () => mockActivity,
}));

const NOW = 1_800_000_000;

function thread(overrides: Partial<StationInquiryThread> = {}): StationInquiryThread {
  return {
    inquiry_id: 'iq1',
    listing_id: 'l1',
    listing_title: 'Barn raising',
    listed_amount_centi: 4500,
    negotiable: true,
    buyer: BUYER,
    provider: PROVIDER,
    initial_message: 'Interested — could you do it next week?',
    initial_offer_centi: 4000,
    opened_at: NOW,
    messages: [{sender: PROVIDER, body: 'I can do 43', counter_offer_centi: 4300, sent_at: NOW + 5}],
    state: 'open',
    last_activity_at: NOW + 5,
    ...overrides,
  };
}

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;
let current: Renderer | undefined;

async function render(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Inquiry
            navigation={{navigate: jest.fn(), goBack: jest.fn()} as any}
            route={{params: {inquiryId: 'iq1'}} as any}
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
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text)).length > 0;
const button = (r: Renderer, name: string): Instance =>
  r.root.find(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  );
const findButton = (r: Renderer, name: string): Instance | undefined =>
  r.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  )[0];
const input = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label && n.props.onChangeText !== undefined);
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}
async function type(node: Instance, value: string): Promise<void> {
  await act(async () => {
    node.props.onChangeText?.(value);
  });
}

afterEach(() => {
  act(() => current?.unmount());
  current = undefined;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockThread.data = thread();
  mockThread.isLoading = false;
  mockThread.isError = false;
  mockThread.error = null;
  mockSession.wallet = {address: BUYER};
  mockActivity.data = [];
});

test('renders the conversation and the offers on the table', async () => {
  const r = await render();
  expect(hasText(r, 'Barn raising')).toBe(true);
  expect(hasText(r, 'Interested — could you do it next week?')).toBe(true);
  expect(hasText(r, 'I can do 43')).toBe(true);
  // Opening offer and the counter both appear in the stepped bar.
  expect(hasText(r, '40.00')).toBe(true);
  expect(hasText(r, '43.00')).toBe(true);
});

test('the provider accepts the buyer’s standing offer', async () => {
  mockSession.wallet = {address: PROVIDER};
  // The buyer's opening 40.00 is on the table (no provider counter).
  mockThread.data = thread({messages: []});
  const r = await render();
  await press(button(r, 'Accept 40.00'));
  expect(mockClose).toHaveBeenCalledWith({
    inquiryId: 'iq1',
    outcome: {kind: 'agreed', finalPriceCenti: 4000},
  });
});

test('the provider accepts a fixed-price inquiry at the listed price', async () => {
  mockSession.wallet = {address: PROVIDER};
  mockThread.data = thread({negotiable: false, initial_offer_centi: undefined, messages: []});
  const r = await render();
  await press(button(r, 'Accept 45.00'));
  expect(mockClose).toHaveBeenCalledWith({
    inquiryId: 'iq1',
    outcome: {kind: 'agreed', finalPriceCenti: 4500},
  });
});

test('the buyer never sees Accept — the provider grants the inquiry', async () => {
  mockSession.wallet = {address: BUYER};
  // The buyer's own offer is on the table; still no Accept for them.
  mockThread.data = thread({messages: []});
  const r = await render();
  expect(findButton(r, 'Accept')).toBeUndefined();
  expect(hasText(r, 'The provider will accept or decline your inquiry')).toBe(true);
});

test('the provider cannot accept their own counter — they wait for the buyer', async () => {
  mockSession.wallet = {address: PROVIDER};
  // Default thread: the last offer on the table is the provider's 43.00 counter.
  const r = await render();
  expect(findButton(r, 'Accept')).toBeUndefined();
  expect(hasText(r, 'Waiting for the buyer')).toBe(true);
});

test('declining is scoped to the viewer’s side — the buyer withdraws, the provider declines', async () => {
  mockSession.wallet = {address: BUYER};
  const r = await render();
  await press(button(r, 'Withdraw'));
  expect(mockClose).toHaveBeenCalledWith({
    inquiryId: 'iq1',
    outcome: {kind: 'declined_by_buyer'},
  });

  jest.clearAllMocks();
  mockSession.wallet = {address: PROVIDER};
  const r2 = await render();
  await press(button(r2, 'Decline'));
  expect(mockClose).toHaveBeenCalledWith({
    inquiryId: 'iq1',
    outcome: {kind: 'declined_by_seller'},
  });
});

test('sending a message forwards the body and parsed counter-offer', async () => {
  const r = await render();
  await type(input(r, 'Message'), 'How about a Tuesday?');
  await type(input(r, 'Counter-offer (optional)'), '4.20');
  await press(button(r, 'Send'));
  expect(mockSend).toHaveBeenCalledWith({
    inquiryId: 'iq1',
    body: 'How about a Tuesday?',
    counterOfferCenti: 420,
  });
});

test('the buyer settles an agreed inquiry with a one-tap payment', async () => {
  mockSession.wallet = {address: BUYER};
  mockThread.data = thread({state: 'closed', outcome: 'agreed', final_price_centi: 4300, closed_at: NOW + 100});
  const r = await render();
  await press(button(r, 'Send 43.00 payment'));
  expect(mockSettle).toHaveBeenCalledWith({
    inquiryId: 'iq1',
    listingTitle: 'Barn raising',
    providerAddress: PROVIDER,
    amountCenti: 4300,
    listingIdHex: 'l1',
  });
});

test('the settle button is withheld once a payment for the inquiry exists', async () => {
  mockSession.wallet = {address: BUYER};
  mockActivity.data = [{memo: 'Barn raising · #iq1', state: 'pending'}]; // matches inquiryMemo('iq1','Barn raising')
  mockThread.data = thread({state: 'closed', outcome: 'agreed', final_price_centi: 4300});
  const r = await render();
  expect(findButton(r, 'Send 43.00 payment')).toBeUndefined();
  expect(hasText(r, 'Payment sent')).toBe(true);
});

test('the provider is not asked to pay on an agreed inquiry', async () => {
  mockSession.wallet = {address: PROVIDER};
  mockThread.data = thread({state: 'closed', outcome: 'agreed', final_price_centi: 4300});
  const r = await render();
  expect(findButton(r, 'Send 43.00 payment')).toBeUndefined();
});

test('a closed inquiry shows the outcome and no composer', async () => {
  mockThread.data = thread({
    state: 'closed',
    outcome: 'agreed',
    final_price_centi: 4300,
    closed_at: NOW + 100,
  });
  const r = await render();
  expect(hasText(r, 'You agreed on a price')).toBe(true);
  // No composer on a closed thread: no reply field and no decline/withdraw. (The
  // buyer's "Send … payment" settle action is a separate, expected control.)
  const replyFields = r.root.findAll(
    n => n.props.accessibilityLabel === 'Message' && n.props.onChangeText !== undefined,
  );
  expect(replyFields).toHaveLength(0);
  expect(findButton(r, 'Decline')).toBeUndefined();
  expect(findButton(r, 'Withdraw')).toBeUndefined();
});
