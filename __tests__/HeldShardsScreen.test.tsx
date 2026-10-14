/**
 * @format
 *
 * The holder-receive screen (T1.2.3). Drives the real `HeldShards` screen over
 * mocked seams — the camera scanner, the shard-payload parser, the held-shard
 * store, the wallet session, and the holder-key check — and asserts: a valid
 * shard QR addressed to this wallet is parsed and stored, and the notice names
 * its owner; a non-shard QR (a plain address), a corrupt shard, and a shard
 * addressed to another identity are rejected without storing; a different piece
 * for an owner already held asks before replacing, defaulting to keeping it;
 * held shards are listed on focus, with rows sealed elsewhere flagged; and
 * "Forget" removes one. `decodeShardQr`/`encodeShardQr` stay real (pure, no
 * native deps).
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
import {HeldShardExistsError, type HeldShard} from '../src/wallet/heldShards';

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

// Keep the real error class (the screen branches on `instanceof`); override the
// store and the FFI-backed holder-key check.
const mockLoadHeldShards = jest.fn();
const mockSaveHeldShard = jest.fn();
const mockDeleteHeldShard = jest.fn();
const mockShardIsForKey = jest.fn();
jest.mock('../src/wallet/heldShards', () => ({
  ...jest.requireActual('../src/wallet/heldShards'),
  loadHeldShards: () => mockLoadHeldShards(),
  saveHeldShard: (...args: unknown[]) => mockSaveHeldShard(...args),
  deleteHeldShard: (...args: unknown[]) => mockDeleteHeldShard(...args),
  shardIsForKey: (...args: unknown[]) => mockShardIsForKey(...args),
}));

const mockLoadVouchNicknames = jest.fn();
jest.mock('../src/wallet/vouchNicknames', () => ({
  loadVouchNicknames: () => mockLoadVouchNicknames(),
}));

// The unlocked wallet whose key every scanned shard is checked against.
const OWN_KEY = Uint8Array.from([7, 7, 7]);
const mockSession: {wallet: unknown} = {wallet: null};
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => mockSession,
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

const textNodes = (r: Renderer, text: string): Instance[] =>
  r.root.findAll(
    n => (n.type as unknown as string) === 'Text' && textOf(n) === text,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockOnScan = undefined;
  mockLoadHeldShards.mockResolvedValue({});
  mockSaveHeldShard.mockResolvedValue('saved');
  mockDeleteHeldShard.mockResolvedValue(undefined);
  mockParseShardPayload.mockReturnValue(info);
  mockLoadVouchNicknames.mockResolvedValue({});
  mockShardIsForKey.mockImplementation(
    (holderAddress: string, key: Uint8Array) =>
      holderAddress === 'rrn1me' && key === OWN_KEY,
  );
  mockSession.wallet = {publicKey: () => ({toBytes: () => OWN_KEY})};
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
  // A first piece for this owner is filed without asking to replace anything.
  expect(mockSaveHeldShard.mock.calls[0][2]).toBeUndefined();
  expect(mockShardIsForKey).toHaveBeenCalledWith('rrn1me', OWN_KEY);
});

test('the saved notice names the owner', async () => {
  mockLoadVouchNicknames.mockResolvedValue({rrn1friend: 'Sam'});
  const r = await renderScreen();
  await press(button(r, 'Scan a shard'));
  await scan(encodeShardQr(SEALED));

  expect(hasText(r, 'Piece saved for Sam')).toBe(true);
  expect(hasText(r, 'recovery piece for rrn1friend.')).toBe(true);
  expect(hasText(r, 'any 3 of their 5 holders')).toBe(true);
});

test('a shard addressed to another identity is refused', async () => {
  mockParseShardPayload.mockReturnValue({...info, holderAddress: 'rrn1someoneelse'});
  const r = await renderScreen();
  await press(button(r, 'Scan a shard'));
  await scan(encodeShardQr(SEALED));

  expect(mockSaveHeldShard).not.toHaveBeenCalled();
  expect(hasText(r, "This piece isn't addressed to you")).toBe(true);
  expect(hasText(r, 'Nothing was saved.')).toBe(true);
});

test('with no unlocked wallet the scan is refused', async () => {
  mockSession.wallet = null;
  const r = await renderScreen();
  await press(button(r, 'Scan a shard'));
  await scan(encodeShardQr(SEALED));

  expect(mockShardIsForKey).not.toHaveBeenCalled();
  expect(mockSaveHeldShard).not.toHaveBeenCalled();
  expect(hasText(r, 'Nothing was saved.')).toBe(true);
});

test('re-scanning the piece already held says so', async () => {
  mockSaveHeldShard.mockResolvedValue('unchanged');
  const r = await renderScreen();
  await press(button(r, 'Scan a shard'));
  await scan(encodeShardQr(SEALED));

  expect(hasText(r, 'You already hold this piece')).toBe(true);
  expect(hasText(r, 'Piece saved')).toBe(false);
});

describe('scanning a new piece for a held owner asks before replacing', () => {
  // A long, realistic-length address: the confirm step must show it whole.
  const OWNER = 'rrn1w7kqyvxunn5hptvgjfl825f2etac90hmt4vgg2aplfa2pftdp5yss3h85r';
  const held: HeldShard = {...heldShard(OWNER), receivedAt: 1_700_000_000};

  async function scanConflicting(): Promise<Renderer> {
    mockParseShardPayload.mockReturnValue({
      ...info,
      originalAddress: OWNER,
      threshold: 2,
      total: 4,
    });
    mockSaveHeldShard.mockImplementation(
      async (_shard: HeldShard, _store?: unknown, opts?: {replace?: boolean}) => {
        if (opts?.replace === true) {
          return 'saved';
        }
        throw new HeldShardExistsError(held);
      },
    );
    mockLoadVouchNicknames.mockResolvedValue({[OWNER]: 'Sam'});
    const r = await renderScreen();
    await press(button(r, 'Scan a shard'));
    await scan(encodeShardQr(SEALED));
    return r;
  }

  test('the confirm step shows the full owner address and both pieces', async () => {
    const r = await scanConflicting();

    const addressNodes = textNodes(r, OWNER);
    expect(addressNodes).toHaveLength(1);
    expect(addressNodes[0].props.numberOfLines).toBeUndefined();
    expect(addressNodes[0].props.ellipsizeMode).toBeUndefined();
    expect(addressNodes[0].props.selectable).toBe(true);
    expect(hasText(r, 'Sam')).toBe(true);
    expect(hasText(r, '3-of-5 recovery')).toBe(true);
    expect(hasText(r, 'New piece: 2-of-4')).toBe(true);
    expect(hasText(r, 'Anyone can make a code that claims to be theirs')).toBe(true);
    expect(hasText(r, 'Piece saved')).toBe(false);
    // Only the plain (no-replace) attempt has been made.
    expect(mockSaveHeldShard).toHaveBeenCalledTimes(1);
  });

  test('“Keep my current piece” is listed first and writes nothing', async () => {
    const r = await scanConflicting();

    const buttons = r.root.findAll(
      n => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string',
    );
    const labels = buttons.map(b => b.props.accessibilityLabel);
    expect(labels.indexOf('Keep my current piece')).toBeLessThan(
      labels.indexOf('Replace it'),
    );

    await press(button(r, 'Keep my current piece'));
    expect(mockSaveHeldShard).toHaveBeenCalledTimes(1);
    expect(hasText(r, 'Replace your piece?')).toBe(false);
  });

  test('“Replace it” saves with replace:true and names the owner', async () => {
    const r = await scanConflicting();
    await press(button(r, 'Replace it'));
    await flush();

    expect(mockSaveHeldShard).toHaveBeenCalledTimes(2);
    const [shard, , opts] = mockSaveHeldShard.mock.calls[1];
    expect(shard).toEqual(expect.objectContaining({originalAddress: OWNER, total: 4}));
    expect(opts).toEqual({replace: true});
    expect(hasText(r, 'Piece saved for Sam')).toBe(true);
  });
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

test('a row sealed to another identity is flagged', async () => {
  mockLoadHeldShards.mockResolvedValue({
    rrn1friend: heldShard('rrn1friend'),
    rrn1other: {...heldShard('rrn1other'), holderAddress: 'rrn1oldme'},
  });
  const r = await renderScreen();

  const flags = r.root.findAll(
    n =>
      (n.type as unknown as string) === 'Text' &&
      textOf(n) === 'Sealed to a different identity — this device can’t use it.',
  );
  expect(flags).toHaveLength(1);
  // Never auto-deleted.
  expect(mockDeleteHeldShard).not.toHaveBeenCalled();
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
