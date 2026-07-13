/**
 * @format
 *
 * Social-recovery setup flow (T1.2.3). Drives the real screens over mocked
 * seams — the recovery context, the wallet module (unlock + split), address
 * validation, config persistence, and the wallet session — and asserts the
 * behaviours the task calls out: a re-unlock gate, holder validation (invalid /
 * self / duplicate), the threshold floor before continuing, the actual key
 * split, per-holder shard QRs with a delivery floor, and config persistence on
 * completion.
 *
 * Uses `react-test-renderer` directly, like onboarding.test — the RN testing
 * libraries don't render cleanly against React 19 here. The camera scanner and
 * QR generator are auto-mocked from `__mocks__/`.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {RecoveryUnlock} from '../src/screens/recovery/RecoveryUnlock';
import {ChooseHolders} from '../src/screens/recovery/ChooseHolders';
import {RecoverySplit} from '../src/screens/recovery/RecoverySplit';
import {DistributeShards} from '../src/screens/recovery/DistributeShards';
import {RecoveryComplete} from '../src/screens/recovery/RecoveryComplete';

// --- Mocked seams -----------------------------------------------------------

interface MockWallet {
  address: string;
  createRecoveryPackage: jest.Mock;
}

interface MockRecovery {
  origin: 'onboarding' | 'settings';
  wallet: MockWallet | null;
  setWallet: jest.Mock;
  holders: Array<{address: string; nickname?: string}>;
  setHolders: jest.Mock;
  threshold: number;
  recoveryPackage: {shardPayload: jest.Mock} | null;
  setRecoveryPackage: jest.Mock;
  delivered: Set<number>;
  markDelivered: jest.Mock;
  clear: jest.Mock;
}

function freshWallet(): MockWallet {
  return {address: 'rrn1owneraddress', createRecoveryPackage: jest.fn()};
}

const mockRecovery: MockRecovery = {} as MockRecovery;

jest.mock('../src/screens/recovery/RecoveryContext', () => ({
  ...jest.requireActual('../src/screens/recovery/RecoveryContext'),
  useRecovery: () => mockRecovery,
}));

const mockLoadWallet = jest.fn();
jest.mock('../src/wallet/Wallet', () => ({
  loadWallet: (...args: unknown[]) => mockLoadWallet(...args),
}));

let mockIsValid = (_address: string) => true;
jest.mock('../src/crypto/address', () => ({
  isValidAddress: (a: string) => mockIsValid(a),
}));

const mockSaveConfig = jest.fn();
jest.mock('../src/wallet/recoveryConfig', () => ({
  saveRecoveryConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

const mockRefresh = jest.fn();
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => ({hasWallet: true, refresh: mockRefresh}),
}));

// --- Harness ----------------------------------------------------------------

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

/** Navigation stand-in with a distinct, inspectable parent navigator. */
function nav() {
  const parent = {navigate: jest.fn(), goBack: jest.fn()};
  return {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
    getParent: () => parent,
  } as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderScreen(ui: React.ReactElement): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>{ui}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

const byLabel = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label);

const button = (r: Renderer, name: string): Instance =>
  r.root.find(
    n =>
      n.props.accessibilityRole === 'button' &&
      (n.props.accessibilityLabel === name || textOf(n).includes(name)),
  );

const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(
    n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text),
  ).length > 0;

const hasQrFor = (r: Renderer, prefix: string): boolean =>
  r.root.findAll(
    n =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith(`QR code for ${prefix}`),
  ).length > 0;

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

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockIsValid = () => true;
  mockSaveConfig.mockResolvedValue(undefined);
  Object.assign(mockRecovery, {
    origin: 'onboarding',
    wallet: freshWallet(),
    setWallet: jest.fn(),
    holders: [],
    setHolders: jest.fn(),
    threshold: 3,
    recoveryPackage: null,
    setRecoveryPackage: jest.fn(),
    delivered: new Set<number>(),
    markDelivered: jest.fn((i: number) => mockRecovery.delivered.add(i)),
    clear: jest.fn(),
  });
});

// --- RecoveryUnlock ---------------------------------------------------------

describe('RecoveryUnlock', () => {
  test('unlocks the wallet and advances to the intro', async () => {
    const wallet = freshWallet();
    mockLoadWallet.mockResolvedValue(wallet);
    const navigation = nav();
    const r = await renderScreen(
      <RecoveryUnlock navigation={navigation} route={{} as any} />,
    );

    await type(byLabel(r, 'Passphrase'), 'correcthorse12');
    await press(button(r, 'Unlock'));
    await flush();

    expect(mockLoadWallet).toHaveBeenCalledWith('correcthorse12');
    expect(mockRecovery.setWallet).toHaveBeenCalledWith(wallet);
    expect(navigation.navigate).toHaveBeenCalledWith('RecoveryIntro');
  });

  test('a failed unlock shows an error and does not advance', async () => {
    mockLoadWallet.mockRejectedValue(new Error('bad passphrase'));
    const navigation = nav();
    const r = await renderScreen(
      <RecoveryUnlock navigation={navigation} route={{} as any} />,
    );

    await type(byLabel(r, 'Passphrase'), 'wrongpassword1');
    await press(button(r, 'Unlock'));
    await flush();

    expect(hasText(r, 'Could not unlock')).toBe(true);
    expect(mockRecovery.setWallet).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});

// --- ChooseHolders ----------------------------------------------------------

describe('ChooseHolders', () => {
  test('adds a valid holder with a nickname', async () => {
    const r = await renderScreen(
      <ChooseHolders navigation={nav()} route={{} as any} />,
    );

    await type(byLabel(r, 'Or paste their address'), 'rrn1friendaddress');
    await type(byLabel(r, 'Nickname (optional)'), 'Alex');
    await press(button(r, 'Add holder'));

    expect(mockRecovery.setHolders).toHaveBeenCalledWith([
      {address: 'rrn1friendaddress', nickname: 'Alex'},
    ]);
  });

  test('rejects an invalid address', async () => {
    mockIsValid = () => false;
    const r = await renderScreen(
      <ChooseHolders navigation={nav()} route={{} as any} />,
    );

    await type(byLabel(r, 'Or paste their address'), 'not-an-address');
    await press(button(r, 'Add holder'));

    expect(hasText(r, "doesn't look like a valid address")).toBe(true);
    expect(mockRecovery.setHolders).not.toHaveBeenCalled();
  });

  test('rejects the owner adding their own address', async () => {
    const r = await renderScreen(
      <ChooseHolders navigation={nav()} route={{} as any} />,
    );

    await type(byLabel(r, 'Or paste their address'), 'rrn1owneraddress');
    await press(button(r, 'Add holder'));

    expect(hasText(r, "can't be your own recovery holder")).toBe(true);
    expect(mockRecovery.setHolders).not.toHaveBeenCalled();
  });

  test('rejects a duplicate holder', async () => {
    mockRecovery.holders = [{address: 'rrn1dupe'}];
    const r = await renderScreen(
      <ChooseHolders navigation={nav()} route={{} as any} />,
    );

    await type(byLabel(r, 'Or paste their address'), 'rrn1dupe');
    await press(button(r, 'Add holder'));

    expect(hasText(r, 'already in your circle')).toBe(true);
    expect(mockRecovery.setHolders).not.toHaveBeenCalled();
  });

  test('warns when the circle is exactly the threshold size', async () => {
    mockRecovery.holders = [{address: 'a'}, {address: 'b'}, {address: 'c'}];
    const r = await renderScreen(
      <ChooseHolders navigation={nav()} route={{} as any} />,
    );
    expect(hasText(r, 'Every holder will be essential')).toBe(true);
  });

  test('continue is blocked below the threshold and advances at/above it', async () => {
    mockRecovery.holders = [{address: 'a'}, {address: 'b'}];
    const navigation = nav();
    const r = await renderScreen(
      <ChooseHolders navigation={navigation} route={{} as any} />,
    );
    await press(button(r, 'Add at least 3'));
    expect(navigation.navigate).not.toHaveBeenCalled();

    mockRecovery.holders = [{address: 'a'}, {address: 'b'}, {address: 'c'}];
    const navigation2 = nav();
    const r2 = await renderScreen(
      <ChooseHolders navigation={navigation2} route={{} as any} />,
    );
    await press(button(r2, 'Split my key into 3 pieces'));
    expect(navigation2.navigate).toHaveBeenCalledWith('RecoverySplit');
  });
});

// --- RecoverySplit ----------------------------------------------------------

describe('RecoverySplit', () => {
  test('splits the key across the chosen holders and stores the package', async () => {
    mockRecovery.holders = [{address: 'a'}, {address: 'b'}, {address: 'c'}];
    const pkg = {shardPayload: jest.fn()};
    mockRecovery.wallet!.createRecoveryPackage.mockResolvedValue(pkg);

    await renderScreen(<RecoverySplit navigation={nav()} route={{} as any} />);
    await flush();

    expect(mockRecovery.wallet!.createRecoveryPackage).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      3,
    );
    expect(mockRecovery.setRecoveryPackage).toHaveBeenCalledWith(pkg);
  });

  test('shows the confirmation and advances once the package exists', async () => {
    mockRecovery.holders = [{address: 'a'}, {address: 'b'}, {address: 'c'}];
    mockRecovery.recoveryPackage = {shardPayload: jest.fn()};
    const navigation = nav();
    const r = await renderScreen(
      <RecoverySplit navigation={navigation} route={{} as any} />,
    );

    // The effect must not re-split when a package already exists.
    expect(mockRecovery.wallet!.createRecoveryPackage).not.toHaveBeenCalled();
    expect(hasText(r, 'Your key is now 3 shards')).toBe(true);

    await press(button(r, 'Distribute the shards'));
    expect(navigation.navigate).toHaveBeenCalledWith('DistributeShards');
  });

  test('shows an error with retry when the split fails', async () => {
    mockRecovery.holders = [{address: 'a'}, {address: 'b'}, {address: 'c'}];
    mockRecovery.wallet!.createRecoveryPackage.mockRejectedValue(
      new Error('split failed'),
    );

    const r = await renderScreen(
      <RecoverySplit navigation={nav()} route={{} as any} />,
    );
    await flush();

    expect(hasText(r, "Couldn't split your key")).toBe(true);
    expect(button(r, 'Try again')).toBeTruthy();
  });
});

// --- DistributeShards -------------------------------------------------------

describe('DistributeShards', () => {
  function withPackage() {
    mockRecovery.holders = [
      {address: 'a', nickname: 'Alex'},
      {address: 'b'},
      {address: 'c'},
    ];
    mockRecovery.recoveryPackage = {
      shardPayload: jest.fn((i: number) => Uint8Array.from([i, 9, 9])),
    };
  }

  test('renders the current holder’s shard as a QR code', async () => {
    withPackage();
    const r = await renderScreen(
      <DistributeShards navigation={nav()} route={{} as any} />,
    );
    // Shard payload is base64-wrapped behind the recovery scheme.
    expect(hasQrFor(r, 'rrnrecovery:')).toBe(true);
    expect(hasText(r, 'Alex')).toBe(true);
  });

  test('“Scanned” marks the holder delivered', async () => {
    withPackage();
    const r = await renderScreen(
      <DistributeShards navigation={nav()} route={{} as any} />,
    );
    await press(button(r, 'Scanned'));
    expect(mockRecovery.markDelivered).toHaveBeenCalledWith(0);
  });

  test('finishing is blocked until the threshold is delivered', async () => {
    withPackage();
    mockRecovery.delivered = new Set([0]); // 1 of 3, threshold 3
    const navigation = nav();
    const r = await renderScreen(
      <DistributeShards navigation={navigation} route={{} as any} />,
    );
    await press(button(r, 'Deliver at least 3'));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('finishing advances once enough are delivered', async () => {
    withPackage();
    mockRecovery.delivered = new Set([0, 1, 2]);
    const navigation = nav();
    const r = await renderScreen(
      <DistributeShards navigation={navigation} route={{} as any} />,
    );
    await press(button(r, 'Finish setup'));
    expect(navigation.navigate).toHaveBeenCalledWith('RecoveryComplete');
  });
});

// --- RecoveryComplete -------------------------------------------------------

describe('RecoveryComplete', () => {
  test('persists the recovery config with per-holder delivery state', async () => {
    mockRecovery.holders = [
      {address: 'a'},
      {address: 'b', nickname: 'Bee'},
      {address: 'c'},
    ];
    mockRecovery.delivered = new Set([0, 2]);

    await renderScreen(<RecoveryComplete navigation={nav()} route={{} as any} />);
    await flush();

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        originalAddress: 'rrn1owneraddress',
        threshold: 3,
        total: 3,
        holders: [
          {address: 'a', nickname: undefined, delivered: true},
          {address: 'b', nickname: 'Bee', delivered: false},
          {address: 'c', nickname: undefined, delivered: true},
        ],
        createdAt: expect.any(Number),
      }),
    );
  });

  test('Done enters the app when launched from onboarding', async () => {
    mockRecovery.origin = 'onboarding';
    const navigation = nav();
    const r = await renderScreen(
      <RecoveryComplete navigation={navigation} route={{} as any} />,
    );
    await press(button(r, 'Done'));

    expect(mockRecovery.clear).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
    expect(navigation.getParent().goBack).not.toHaveBeenCalled();
  });

  test('Done returns to Settings when launched from there', async () => {
    mockRecovery.origin = 'settings';
    const navigation = nav();
    const r = await renderScreen(
      <RecoveryComplete navigation={navigation} route={{} as any} />,
    );
    await press(button(r, 'Done'));

    expect(mockRecovery.clear).toHaveBeenCalled();
    expect(navigation.getParent().goBack).toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
