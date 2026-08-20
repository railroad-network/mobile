/**
 * @format
 *
 * The holder-contribute screen (T1.11.3 slice D). Drives the real `HelpRecover`
 * screen over mocked seams — the camera scanner, the request parser, the
 * held-shard store, and wallet unlock — and asserts the behaviours the task
 * calls out: scanning a valid request for an identity we hold a shard for moves
 * to the confirm step; unlocking then produces a response QR; a request for an
 * identity we hold nothing for is refused; a non-request QR is rejected; and a
 * failed unlock surfaces an error without emitting a response.
 *
 * `decodeRequestQr`/`encodeResponseQr` stay real (pure, no native deps); only
 * the FFI-backed `parseRecoveryRequest` is mocked.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {HelpRecover} from '../src/screens/main/HelpRecover';
import {bytesToBase64} from '../src/crypto/base64';
import {REQUEST_QR_PREFIX} from '../src/wallet/recoveryCeremony';
import type {HeldShard} from '../src/wallet/heldShards';

// --- Mocked seams -----------------------------------------------------------

let mockOnScan: ((value: string) => void) | undefined;
jest.mock('../src/components/QRScanner', () => {
  const ReactActual = require('react');
  const {View} = require('react-native');
  return {
    QRScanner: ({onScan}: {onScan: (value: string) => void}) => {
      mockOnScan = onScan;
      return ReactActual.createElement(View, {testID: 'qr-scanner'});
    },
  };
});

// Render the QR as an inert node — react-native-qrcode-svg pulls in native SVG.
jest.mock('react-native-qrcode-svg', () => {
  const ReactActual = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: ({value}: {value: string}) =>
      ReactActual.createElement(View, {testID: 'qr-code', 'data-value': value}),
  };
});

// Keep decode/encode real; override only the FFI-backed parse.
const mockParseRecoveryRequest = jest.fn();
jest.mock('../src/wallet/recoveryCeremony', () => ({
  ...jest.requireActual('../src/wallet/recoveryCeremony'),
  parseRecoveryRequest: (...args: unknown[]) => mockParseRecoveryRequest(...args),
}));

const mockLoadHeldShards = jest.fn();
jest.mock('../src/wallet/heldShards', () => ({
  ...jest.requireActual('../src/wallet/heldShards'),
  loadHeldShards: () => mockLoadHeldShards(),
}));

const mockLoadWallet = jest.fn();
const mockRespondToRecovery = jest.fn();
jest.mock('../src/wallet/Wallet', () => ({
  loadWallet: (...args: unknown[]) => mockLoadWallet(...args),
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

async function renderScreen(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <HelpRecover navigation={navigation} route={{} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await flush();
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

const passphraseInput = (r: Renderer): Instance =>
  r.root.find(
    n =>
      typeof n.props.onChangeText === 'function' &&
      'secureTextEntry' in n.props,
  );

async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
  await flush();
}

async function type(node: Instance, value: string): Promise<void> {
  await act(async () => {
    node.props.onChangeText?.(value);
  });
}

async function scan(value: string): Promise<void> {
  await act(async () => {
    mockOnScan?.(value);
  });
  await flush();
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const RESPONSE = Uint8Array.from([9, 8, 7]);
const requestQr = (bytes = Uint8Array.from([1, 2, 3])) =>
  REQUEST_QR_PREFIX + bytesToBase64(bytes);

function heldShard(originalAddress: string): HeldShard {
  return {
    originalAddress,
    holderAddress: 'rrn1me',
    threshold: 3,
    total: 5,
    payload: 'AQIDBA==',
    receivedAt: 1_700_000_000,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnScan = undefined;
  mockLoadHeldShards.mockResolvedValue({rrn1friend: heldShard('rrn1friend')});
  mockParseRecoveryRequest.mockReturnValue({targetAddress: 'rrn1friend'});
  mockRespondToRecovery.mockResolvedValue(RESPONSE);
  mockLoadWallet.mockResolvedValue({respondToRecovery: mockRespondToRecovery});
});

// --- Happy path -------------------------------------------------------------

test('scanning a request we hold a shard for moves to the confirm step', async () => {
  const r = await renderScreen();
  await scan(requestQr());

  expect(mockParseRecoveryRequest).toHaveBeenCalledTimes(1);
  expect(hasText(r, 'Recovering')).toBe(true);
  expect(hasText(r, 'rrn1friend')).toBe(true);
});

test('unlocking contributes the held shard and shows a response QR', async () => {
  const r = await renderScreen();
  await scan(requestQr());
  await type(passphraseInput(r), 'correct horse');
  await press(button(r, 'Contribute my piece'));

  // The shard bytes (decoded from base64) and request bytes are handed to Rust.
  expect(mockRespondToRecovery).toHaveBeenCalledTimes(1);
  const [shardBytes, requestBytes] = mockRespondToRecovery.mock.calls[0];
  expect(Array.from(shardBytes)).toEqual([1, 2, 3, 4]); // base64 'AQIDBA=='
  expect(Array.from(requestBytes)).toEqual([1, 2, 3]);

  expect(hasText(r, 'Show this to your friend')).toBe(true);
  expect(
    r.root.findAll(n => n.props.testID === 'qr-code').length,
  ).toBeGreaterThan(0);
});

// --- Refusals ---------------------------------------------------------------

test('a request for an identity we hold nothing for is refused', async () => {
  mockLoadHeldShards.mockResolvedValue({});
  const r = await renderScreen();
  await scan(requestQr());

  expect(hasText(r, "not holding a piece for them")).toBe(true);
  expect(hasText(r, 'Recovering')).toBe(false);
});

test('a non-request QR is rejected', async () => {
  const r = await renderScreen();
  await scan('rrn1someplainaddress');

  expect(mockParseRecoveryRequest).not.toHaveBeenCalled();
  expect(hasText(r, "isn't a recovery request")).toBe(true);
});

test('a failed unlock surfaces an error and emits no response', async () => {
  mockLoadWallet.mockRejectedValue(new Error('bad passphrase'));
  const r = await renderScreen();
  await scan(requestQr());
  await type(passphraseInput(r), 'wrong');
  await press(button(r, 'Contribute my piece'));

  expect(mockRespondToRecovery).not.toHaveBeenCalled();
  expect(hasText(r, 'Could not contribute')).toBe(true);
});
