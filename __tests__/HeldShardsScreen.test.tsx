/**
 * @format
 *
 * The holder-receive screen (T1.2.3). Drives the real `HeldShards` screen over
 * mocked seams — the camera scanner, the shard-payload parser, and the held-shard
 * store — and asserts the behaviours the task calls out: a valid shard QR is
 * parsed and stored; a non-shard QR (a plain address) and a corrupt shard are
 * rejected without storing; held shards are listed on focus; and "Forget" removes
 * one. `decodeShardQr`/`encodeShardQr` stay real (pure, no native deps).
 *
 * Uses `react-test-renderer` directly (as the other screen tests do); the RN
 * testing libraries don't render cleanly against React 19 here.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {HeldShards as HeldShardsScreen} from '../src/screens/main/HeldShards';
import {encodeShardQr} from '../src/wallet/recoveryShard';
import type {HeldShard} from '../src/wallet/heldShards';

// --- Mocked seams -----------------------------------------------------------

// Capture the scanner's onScan so tests can drive a scan. `mock`-prefixed so the
// jest.mock factory may reference it.
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

// Keep decode/encode real; override only the FFI-backed parse.
const mockParseShardPayload = jest.fn();
jest.mock('../src/wallet/recoveryShard', () => ({
  ...jest.requireActual('../src/wallet/recoveryShard'),
  parseShardPayload: (...args: unknown[]) => mockParseShardPayload(...args),
}));

const mockLoadHeldShards = jest.fn();
const mockSaveHeldShard = jest.fn();
const mockDeleteHeldShard = jest.fn();
jest.mock('../src/wallet/heldShards', () => ({
  loadHeldShards: () => mockLoadHeldShards(),
  saveHeldShard: (...args: unknown[]) => mockSaveHeldShard(...args),
  deleteHeldShard: (...args: unknown[]) => mockDeleteHeldShard(...args),
}));

// Run focus effects immediately, like a screen coming into focus.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactActual = require('react');
    ReactActual.useEffect(cb, [cb]);
  },
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
          <HeldShardsScreen navigation={navigation} route={{} as any} />
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

async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
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

const SEALED = Uint8Array.from([1, 2, 3, 4]);
const info = {
  originalAddress: 'rrn1friend',
  holderAddress: 'rrn1me',
  threshold: 3,
  total: 5,
};

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
  mockLoadHeldShards.mockResolvedValue({});
  mockSaveHeldShard.mockResolvedValue(undefined);
  mockDeleteHeldShard.mockResolvedValue(undefined);
  mockParseShardPayload.mockReturnValue(info);
});

// --- Receiving --------------------------------------------------------------

test('a valid shard QR is parsed and stored', async () => {
  const r = await renderScreen();
  await press(button(r, 'Scan a shard'));
  await scan(encodeShardQr(SEALED));

  expect(mockSaveHeldShard).toHaveBeenCalledTimes(1);
  expect(mockSaveHeldShard).toHaveBeenCalledWith(
    expect.objectContaining({
      originalAddress: 'rrn1friend',
      holderAddress: 'rrn1me',
      threshold: 3,
      total: 5,
      payload: 'AQIDBA==', // base64 of SEALED
      receivedAt: expect.any(Number),
    }),
  );
  expect(hasText(r, 'Shard saved')).toBe(true);
});

test('a plain address QR is rejected without storing', async () => {
  const r = await renderScreen();
  await press(button(r, 'Scan a shard'));
  await scan('rrn1someplainaddress');

  expect(mockParseShardPayload).not.toHaveBeenCalled();
  expect(mockSaveHeldShard).not.toHaveBeenCalled();
  expect(hasText(r, "isn't a recovery shard")).toBe(true);
});

test('a shard whose payload will not parse is rejected without storing', async () => {
  mockParseShardPayload.mockImplementation(() => {
    throw new Error('corrupt');
  });
  const r = await renderScreen();
  await press(button(r, 'Scan a shard'));
  await scan(encodeShardQr(SEALED));

  expect(mockSaveHeldShard).not.toHaveBeenCalled();
  expect(hasText(r, "Couldn't read that shard")).toBe(true);
});

// --- Listing / forgetting ---------------------------------------------------

test('lists the shards held on this device', async () => {
  mockLoadHeldShards.mockResolvedValue({
    rrn1friend: heldShard('rrn1friend'),
  });
  const r = await renderScreen();

  expect(hasText(r, 'Holding 1 shard')).toBe(true);
  expect(hasText(r, 'rrn1friend')).toBe(true);
  expect(hasText(r, '3-of-5 recovery')).toBe(true);
});

test('shows the empty state when holding nothing', async () => {
  const r = await renderScreen();
  expect(hasText(r, 'not holding anything yet')).toBe(true);
});

test('“Forget” removes a held shard', async () => {
  mockLoadHeldShards.mockResolvedValue({
    rrn1friend: heldShard('rrn1friend'),
  });
  const r = await renderScreen();
  await press(button(r, 'Forget shard for rrn1friend'));

  expect(mockDeleteHeldShard).toHaveBeenCalledWith('rrn1friend');
});
