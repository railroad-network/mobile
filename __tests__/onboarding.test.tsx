/**
 * @format
 *
 * Create-wallet onboarding flow (T1.2.2). Drives the real screens and asserts
 * the behaviours the task's acceptance criteria call out: passphrase mismatch
 * blocks continue, the generate step actually creates the wallet (with the
 * chosen biometric setting), and the final screen shows the new address.
 *
 * Uses `react-test-renderer` directly (as App.test does) with a few small
 * find/press/type helpers, rather than a component-testing library — the RN
 * testing libraries don't render cleanly against React 19 here.
 *
 * Seams: the onboarding context, the wallet module, and the wallet session are
 * mocked so each screen can be driven in isolation with controlled state. The
 * real `.rrnwallet` creation is covered by Wallet.test.ts; here `createWallet`
 * is a spy so we assert the wiring (arguments + navigation), not the crypto.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import * as Keychain from 'react-native-keychain';

import {ThemeProvider} from '../src/theme';
import {Welcome} from '../src/screens/onboarding/Welcome';
import {Passphrase} from '../src/screens/onboarding/Passphrase';
import {BiometricSetup} from '../src/screens/onboarding/BiometricSetup';
import {GenerateWallet} from '../src/screens/onboarding/GenerateWallet';
import {WalletReady} from '../src/screens/onboarding/WalletReady';

// --- Mocked seams -----------------------------------------------------------

interface MockOnboarding {
  passphrase: string;
  biometricEnabled: boolean;
  createdAddress: string | null;
  createdWallet: unknown;
  recoveredWallet: unknown;
  setPassphrase: jest.Mock;
  setBiometricEnabled: jest.Mock;
  setCreatedAddress: jest.Mock;
  setCreatedWallet: jest.Mock;
  setRecoveredWallet: jest.Mock;
  clearSecrets: jest.Mock;
}
const mockOnboarding: MockOnboarding = {
  passphrase: '',
  biometricEnabled: false,
  createdAddress: null,
  createdWallet: null,
  recoveredWallet: null,
  setPassphrase: jest.fn((v: string) => (mockOnboarding.passphrase = v)),
  setBiometricEnabled: jest.fn((v: boolean) => (mockOnboarding.biometricEnabled = v)),
  setCreatedAddress: jest.fn((v: string) => (mockOnboarding.createdAddress = v)),
  setCreatedWallet: jest.fn((v: unknown) => (mockOnboarding.createdWallet = v)),
  setRecoveredWallet: jest.fn((v: unknown) => (mockOnboarding.recoveredWallet = v)),
  clearSecrets: jest.fn(() => (mockOnboarding.passphrase = '')),
};
jest.mock('../src/screens/onboarding/OnboardingContext', () => ({
  useOnboarding: () => mockOnboarding,
  OnboardingProvider: ({children}: {children: React.ReactNode}) => children,
}));

const mockCreateWallet = jest.fn();
const mockPersistWallet = jest.fn();
const mockHasWallet = jest.fn();
jest.mock('../src/wallet/Wallet', () => {
  // The passphrase floor and the error class are the real ones; only the
  // writes and the existence check are spies. The floor must be forwarded:
  // passphraseStrength re-exports it from this module, so a mock without it
  // would silently disable the Passphrase screen's length check here.
  const actual = jest.requireActual('../src/wallet/Wallet');
  return {
    MIN_PASSPHRASE_LENGTH: actual.MIN_PASSPHRASE_LENGTH,
    WalletExistsError: actual.WalletExistsError,
    createWallet: (...args: unknown[]) => mockCreateWallet(...args),
    persistWallet: (...args: unknown[]) => mockPersistWallet(...args),
    hasWallet: (...args: unknown[]) => mockHasWallet(...args),
  };
});

// GenerateWallet blocks Back during the seal via usePreventRemove; outside a
// navigator it has no context, so capture its (preventRemove, callback) args.
const mockUsePreventRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args),
}));

const mockRefresh = jest.fn();
const mockAdopt = jest.fn();
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => ({
    hasWallet: false,
    wallet: null,
    refresh: mockRefresh,
    adopt: mockAdopt,
  }),
  WalletSessionProvider: ({children}: {children: React.ReactNode}) => children,
}));

jest.mock('react-native-keychain', () => ({
  BIOMETRY_TYPE: {
    FACE_ID: 'FaceID',
    TOUCH_ID: 'TouchID',
    OPTIC_ID: 'OpticID',
    FACE: 'Face',
    IRIS: 'Iris',
    FINGERPRINT: 'Fingerprint',
  },
  getSupportedBiometryType: jest.fn(),
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

// A permissive navigation stand-in; screens only touch navigate/replace/reset.
const nav = () =>
  ({
    navigate: jest.fn(),
    replace: jest.fn(),
    reset: jest.fn(),
    goBack: jest.fn(),
  }) as any;

const RESET_TO_READY = {index: 0, routes: [{name: 'WalletReady'}]};

// Whether GenerateWallet's Back guard is currently engaged (its last call).
const preventingRemove = (): boolean => {
  const calls = mockUsePreventRemove.mock.calls;
  return calls[calls.length - 1][0] as boolean;
};

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

/** Flattens a node's text children into a single string. */
function textOf(node: Instance): string {
  return node.children
    .map(c => (typeof c === 'string' ? c : textOf(c)))
    .join('');
}

const byLabel = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label);

const queryByLabel = (r: Renderer, label: string): Instance | null =>
  r.root.findAll(n => n.props.accessibilityLabel === label)[0] ?? null;

/** The Button host node (a Pressable) carrying the given visible text. */
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

beforeEach(() => {
  jest.clearAllMocks();
  mockOnboarding.passphrase = '';
  mockOnboarding.biometricEnabled = false;
  mockOnboarding.createdAddress = null;
  mockOnboarding.createdWallet = null;
  mockOnboarding.recoveredWallet = null;
  mockHasWallet.mockResolvedValue(false);
});

// --- Passphrase -------------------------------------------------------------

describe('Passphrase', () => {
  test('mismatched passphrases show an error and block continue', async () => {
    const navigation = nav();
    const r = await renderScreen(
      <Passphrase navigation={navigation} route={{} as any} />,
    );

    await type(byLabel(r, 'Passphrase'), 'correcthorse12');
    await type(byLabel(r, 'Confirm passphrase'), 'different99999');

    expect(hasText(r, "Passphrases don't match")).toBe(true);

    await press(button(r, 'Continue'));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('a too-short passphrase is rejected', async () => {
    const r = await renderScreen(<Passphrase navigation={nav()} route={{} as any} />);
    await type(byLabel(r, 'Passphrase'), 'short');
    expect(hasText(r, 'At least 12 characters')).toBe(true);
  });

  test('matching passphrases store the value and advance', async () => {
    const navigation = nav();
    const r = await renderScreen(
      <Passphrase navigation={navigation} route={{} as any} />,
    );

    await type(byLabel(r, 'Passphrase'), 'correcthorse12');
    await type(byLabel(r, 'Confirm passphrase'), 'correcthorse12');

    await press(button(r, 'Continue'));
    expect(mockOnboarding.setPassphrase).toHaveBeenCalledWith('correcthorse12');
    expect(navigation.navigate).toHaveBeenCalledWith('BiometricSetup');
  });
});

// --- BiometricSetup ---------------------------------------------------------

describe('BiometricSetup', () => {
  test('offers to enable the device biometric and records the choice', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(
      Keychain.BIOMETRY_TYPE.FACE_ID,
    );
    const navigation = nav();
    const r = await renderScreen(
      <BiometricSetup navigation={navigation} route={{} as any} />,
    );

    // Biometrics are a second lock on top of the passphrase, not a replacement:
    // the wallet is sealed under the passphrase, so it is always required. The
    // copy must not promise passphrase-free unlock.
    expect(hasText(r, 'Add a second lock')).toBe(true);
    expect(hasText(r, 'still enter your passphrase to unlock')).toBe(true);
    expect(hasText(r, 'Skip typing your passphrase')).toBe(false);

    await press(button(r, 'Enable Face ID'));
    expect(mockOnboarding.setBiometricEnabled).toHaveBeenCalledWith(true);
    expect(navigation.navigate).toHaveBeenCalledWith('GenerateWallet');
  });

  test('"Not now" advances without enabling biometrics', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(
      Keychain.BIOMETRY_TYPE.TOUCH_ID,
    );
    const navigation = nav();
    const r = await renderScreen(
      <BiometricSetup navigation={navigation} route={{} as any} />,
    );

    await press(button(r, 'Not now'));
    expect(mockOnboarding.setBiometricEnabled).toHaveBeenCalledWith(false);
    expect(navigation.navigate).toHaveBeenCalledWith('GenerateWallet');
  });

  test('degrades to a single Continue when no biometrics are enrolled', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValue(null);
    const navigation = nav();
    const r = await renderScreen(
      <BiometricSetup navigation={navigation} route={{} as any} />,
    );

    expect(hasText(r, 'Passphrase unlock')).toBe(true);
    await press(button(r, 'Continue'));
    expect(mockOnboarding.setBiometricEnabled).toHaveBeenCalledWith(false);
    expect(navigation.navigate).toHaveBeenCalledWith('GenerateWallet');
  });
});

// --- GenerateWallet ---------------------------------------------------------

describe('GenerateWallet', () => {
  // The screen pauses to paint before creation (PRE_PAINT_MS) and then holds for a
  // minimum duration after creation succeeds, so these tests drive the clock
  // rather than waiting it out.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // The pre-paint pause GenerateWallet waits before starting the blocking seal.
  const PRE_PAINT_MS = 700;

  /** Runs out every pending timer (pre-paint pause + min-visible hold), flushing
   * the promise chain scheduled between them. */
  async function settle() {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
    }
  }

  test('creates the wallet with the chosen biometric setting and advances', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockOnboarding.biometricEnabled = true;
    mockCreateWallet.mockResolvedValue({address: 'rrn1exampleaddress'});

    const navigation = nav();
    await renderScreen(<GenerateWallet navigation={navigation} route={{} as any} />);
    await settle();

    expect(mockCreateWallet).toHaveBeenCalledWith('correcthorsebattery', undefined, {
      requireBiometric: true,
    });
    expect(mockOnboarding.setCreatedAddress).toHaveBeenCalledWith('rrn1exampleaddress');
    expect(mockOnboarding.clearSecrets).toHaveBeenCalled();
    expect(navigation.reset).toHaveBeenCalledWith(RESET_TO_READY);
  });

  test('on the recover path it re-seals the recovered identity, never minting a new key', async () => {
    // The identity already exists (reconstructed from a circle / opened from an
    // export); the generate step must seal *that* under the new device
    // passphrase — the D3 "re-seal, never mint" invariant.
    const recovered = {address: 'rrn1recovered'};
    mockOnboarding.passphrase = 'a new device passphrase';
    mockOnboarding.biometricEnabled = false;
    mockOnboarding.recoveredWallet = recovered;
    mockPersistWallet.mockResolvedValue(undefined);

    const navigation = nav();
    const r = await renderScreen(
      <GenerateWallet navigation={navigation} route={{} as any} />,
    );
    await settle();

    expect(mockCreateWallet).not.toHaveBeenCalled();
    expect(mockPersistWallet).toHaveBeenCalledWith(
      recovered,
      'a new device passphrase',
      undefined,
      {requireBiometric: false},
    );
    expect(mockOnboarding.setCreatedAddress).toHaveBeenCalledWith('rrn1recovered');
    expect(mockOnboarding.setCreatedWallet).toHaveBeenCalledWith(recovered);
    expect(navigation.reset).toHaveBeenCalledWith(RESET_TO_READY);
    expect(hasText(r, 'Restoring your wallet')).toBe(true);
  });

  test('holds the progress screen when creation returns near-instantly', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockCreateWallet.mockResolvedValue({address: 'rrn1exampleaddress'});

    const navigation = nav();
    const r = await renderScreen(
      <GenerateWallet navigation={navigation} route={{} as any} />,
    );
    // Run out the pre-paint pause so creation starts and resolves.
    await act(async () => {
      jest.advanceTimersByTime(PRE_PAINT_MS);
      await Promise.resolve();
    });

    // Creation is already done, but the progress state stays up.
    expect(mockCreateWallet).toHaveBeenCalledTimes(1);
    expect(navigation.reset).not.toHaveBeenCalled();
    expect(hasText(r, 'Creating your identity')).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    expect(navigation.reset).toHaveBeenCalledWith(RESET_TO_READY);
  });

  test('paints this screen before the blocking seal starts, so it cannot flash by', async () => {
    // createWallet's passphrase seal is a synchronous FFI call that freezes the
    // JS thread. Starting it before this screen paints would freeze the *previous*
    // screen for the seal's duration and let "Creating your identity" flash past
    // afterward (the non-biometric-path bug). Creation must wait out the pre-paint
    // pause — long enough for the transition to finish and this screen to paint —
    // before it begins.
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockOnboarding.biometricEnabled = false;
    mockCreateWallet.mockResolvedValue({address: 'rrn1exampleaddress'});

    const navigation = nav();
    await renderScreen(<GenerateWallet navigation={navigation} route={{} as any} />);

    // The pre-paint pause has not elapsed: the blocking seal must not have started.
    expect(mockCreateWallet).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(PRE_PAINT_MS);
      await Promise.resolve();
    });
    expect(mockCreateWallet).toHaveBeenCalledTimes(1);
  });

  test('does not flash past when a biometric prompt ate the visible budget', async () => {
    // With biometric on, createWallet's keychain write shows an OS prompt that
    // hides this screen. Simulate the user taking longer to authenticate than
    // the whole minimum-visible window: the screen must still hold once the
    // prompt clears, not flash straight to WalletReady.
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockOnboarding.biometricEnabled = true;

    let resolveCreate!: (w: {address: string}) => void;
    mockCreateWallet.mockReturnValue(
      new Promise<{address: string}>(res => {
        resolveCreate = res;
      }),
    );

    const navigation = nav();
    const r = await renderScreen(
      <GenerateWallet navigation={navigation} route={{} as any} />,
    );

    // Run out the pre-paint pause so creation starts (and the prompt goes up).
    await act(async () => {
      jest.advanceTimersByTime(PRE_PAINT_MS);
      await Promise.resolve();
    });
    expect(mockCreateWallet).toHaveBeenCalledTimes(1);

    // 3s pass behind the prompt — longer than the min-visible budget — before
    // creation resolves.
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await act(async () => {
      resolveCreate({address: 'rrn1exampleaddress'});
      await Promise.resolve();
    });

    // The prompt consumed the wall clock, but the screen has not been seen yet,
    // so it must not have advanced.
    expect(navigation.reset).not.toHaveBeenCalled();
    expect(hasText(r, 'Creating your identity')).toBe(true);

    // It holds for the minimum-visible window measured from when the prompt
    // cleared, then advances.
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    expect(navigation.reset).toHaveBeenCalledWith(RESET_TO_READY);
  });

  test('shows an error with retry when creation fails', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockCreateWallet.mockRejectedValue(new Error('keystore unavailable'));

    const r = await renderScreen(
      <GenerateWallet navigation={nav()} route={{} as any} />,
    );
    await settle();

    expect(hasText(r, 'Something went wrong')).toBe(true);
    expect(hasText(r, 'keystore unavailable')).toBe(true);
    expect(button(r, 'Try again')).toBeTruthy();
    // The Back guard is released so the member can leave the error.
    expect(preventingRemove()).toBe(false);
  });

  test('success resets the stack to WalletReady', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockCreateWallet.mockResolvedValue({address: 'rrn1exampleaddress'});

    const navigation = nav();
    await renderScreen(<GenerateWallet navigation={navigation} route={{} as any} />);
    // Back is blocked while the seal runs…
    expect(preventingRemove()).toBe(true);
    await settle();

    // …and released before the reset, which replaces the whole onboarding stack
    // so the screens that held the passphrase cannot be revisited.
    expect(preventingRemove()).toBe(false);
    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith(RESET_TO_READY);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test('GenerateWallet never runs with a wiped passphrase', async () => {
    // Android Back from WalletReady used to reach BiometricSetup, whose either
    // choice opens a fresh GenerateWallet after the passphrase was wiped.
    mockOnboarding.passphrase = '';
    mockCreateWallet.mockResolvedValue({address: 'rrn1exampleaddress'});
    mockPersistWallet.mockResolvedValue(undefined);

    const navigation = nav();
    const r = await renderScreen(
      <GenerateWallet navigation={navigation} route={{} as any} />,
    );
    await settle();

    expect(mockCreateWallet).not.toHaveBeenCalled();
    expect(mockPersistWallet).not.toHaveBeenCalled();
    expect(mockHasWallet).not.toHaveBeenCalled();
    expect(hasText(r, 'Your passphrase is no longer in memory')).toBe(true);
    expect(hasText(r, 'Try again')).toBe(false);
    expect(preventingRemove()).toBe(false);

    // The way out starts onboarding over rather than re-running the seal.
    await press(button(r, 'Start over'));
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'Welcome'}],
    });
    await settle();
    expect(mockCreateWallet).not.toHaveBeenCalled();
  });

  test('a passphrase under the floor never reaches the wallet layer', async () => {
    mockOnboarding.passphrase = 'a'.repeat(11);
    mockOnboarding.recoveredWallet = {address: 'rrn1recovered'};

    const r = await renderScreen(
      <GenerateWallet navigation={nav()} route={{} as any} />,
    );
    await settle();

    expect(mockPersistWallet).not.toHaveBeenCalled();
    expect(mockCreateWallet).not.toHaveBeenCalled();
    expect(hasText(r, 'Your passphrase is no longer in memory')).toBe(true);
  });

  test('an existing wallet routes to the lock screen, no retry', async () => {
    const {WalletExistsError} = jest.requireActual('../src/wallet/Wallet');
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockCreateWallet.mockRejectedValue(new WalletExistsError());

    const navigation = nav();
    const r = await renderScreen(
      <GenerateWallet navigation={navigation} route={{} as any} />,
    );
    await settle();

    expect(hasText(r, 'A wallet already exists on this device.')).toBe(true);
    expect(hasText(r, 'Try again')).toBe(false);
    expect(preventingRemove()).toBe(false);
    // The wallet another write stored is there by the time the member taps.
    mockHasWallet.mockResolvedValue(true);
    await press(button(r, 'Open it'));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(navigation.reset).not.toHaveBeenCalled();
    expect(mockOnboarding.clearSecrets).not.toHaveBeenCalled();
  });

  test('a wallet found on the device stops the screen before any write', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockHasWallet.mockResolvedValue(true);

    const r = await renderScreen(
      <GenerateWallet navigation={nav()} route={{} as any} />,
    );
    await settle();

    expect(mockCreateWallet).not.toHaveBeenCalled();
    expect(mockPersistWallet).not.toHaveBeenCalled();
    expect(hasText(r, 'A wallet already exists on this device.')).toBe(true);
    await press(button(r, 'Open it'));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  test('"Open it" falls back to a retryable error when the keystore read fails', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockHasWallet.mockResolvedValue(true);

    const r = await renderScreen(
      <GenerateWallet navigation={nav()} route={{} as any} />,
    );
    await settle();
    mockHasWallet.mockRejectedValue(new Error('keystore unavailable'));
    await press(button(r, 'Open it'));

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(hasText(r, 'keystore unavailable')).toBe(true);
    expect(button(r, 'Try again')).toBeTruthy();
    expect(mockCreateWallet).not.toHaveBeenCalled();
  });

  test('creates only one wallet even if the effect re-runs', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockCreateWallet.mockResolvedValue({address: 'rrn1exampleaddress'});

    const r = await renderScreen(
      <GenerateWallet navigation={nav()} route={{} as any} />,
    );
    // Force a re-render; the ref guard must prevent a second createWallet.
    await act(async () => {
      r.update(
        <SafeAreaProvider initialMetrics={metrics}>
          <ThemeProvider>
            <GenerateWallet navigation={nav()} route={{} as any} />
          </ThemeProvider>
        </SafeAreaProvider>,
      );
      await Promise.resolve();
    });
    // Run out the pre-paint pause; creation still fires exactly once.
    await act(async () => {
      jest.advanceTimersByTime(PRE_PAINT_MS);
      await Promise.resolve();
    });
    expect(mockCreateWallet).toHaveBeenCalledTimes(1);
  });
});

// --- WalletReady ------------------------------------------------------------

describe('WalletReady', () => {
  test('shows the address as text and as a QR code', async () => {
    mockOnboarding.createdAddress = 'rrn1readyaddress';
    const r = await renderScreen(
      <WalletReady navigation={nav()} route={{} as any} />,
    );

    expect(hasText(r, 'rrn1readyaddress')).toBe(true);
    expect(queryByLabel(r, 'QR code for rrn1readyaddress')).not.toBeNull();
  });

  test('"Join your community" enters pairing (tagged as onboarding)', async () => {
    mockOnboarding.createdAddress = 'rrn1readyaddress';
    const navigation = nav();
    const r = await renderScreen(
      <WalletReady navigation={navigation} route={{} as any} />,
    );

    await press(button(r, 'Join your community'));
    expect(navigation.navigate).toHaveBeenCalledWith('Join', {
      origin: 'onboarding',
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test('"Set up recovery first" enters recovery setup (tagged as onboarding)', async () => {
    mockOnboarding.createdAddress = 'rrn1readyaddress';
    const navigation = nav();
    const r = await renderScreen(
      <WalletReady navigation={navigation} route={{} as any} />,
    );

    await press(button(r, 'Set up recovery first'));
    expect(navigation.navigate).toHaveBeenCalledWith('Recovery', {
      origin: 'onboarding',
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test('"Skip for now" adopts the created wallet (entering the app unlocked)', async () => {
    mockOnboarding.createdAddress = 'rrn1readyaddress';
    const created = {address: 'rrn1readyaddress'};
    mockOnboarding.createdWallet = created;
    const r = await renderScreen(
      <WalletReady navigation={nav()} route={{} as any} />,
    );

    await press(button(r, 'Skip for now'));
    expect(mockAdopt).toHaveBeenCalledWith(created);
    mockOnboarding.createdWallet = null;
  });
});

describe('Welcome', () => {
  test('"Create my wallet" clears any recovered identity before the create flow', async () => {
    // Guards the create path from silently sealing an identity a previous,
    // abandoned recovery left in the flow.
    mockOnboarding.recoveredWallet = {address: 'rrn1stale'};
    const navigation = nav();
    const r = await renderScreen(<Welcome navigation={navigation} route={{} as any} />);

    await press(button(r, 'Create my wallet'));
    expect(mockOnboarding.setRecoveredWallet).toHaveBeenCalledWith(null);
    expect(navigation.navigate).toHaveBeenCalledWith('Passphrase');
  });

  test('"Recover an existing identity" opens the recover chooser', async () => {
    const navigation = nav();
    const r = await renderScreen(<Welcome navigation={navigation} route={{} as any} />);

    await press(button(r, 'Recover an existing identity'));
    expect(navigation.navigate).toHaveBeenCalledWith('RecoverChoice');
    expect(mockOnboarding.setRecoveredWallet).not.toHaveBeenCalled();
  });
});
