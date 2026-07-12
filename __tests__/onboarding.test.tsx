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
import {Passphrase} from '../src/screens/onboarding/Passphrase';
import {BiometricSetup} from '../src/screens/onboarding/BiometricSetup';
import {GenerateWallet} from '../src/screens/onboarding/GenerateWallet';
import {WalletReady} from '../src/screens/onboarding/WalletReady';

// --- Mocked seams -----------------------------------------------------------

interface MockOnboarding {
  passphrase: string;
  biometricEnabled: boolean;
  createdAddress: string | null;
  setPassphrase: jest.Mock;
  setBiometricEnabled: jest.Mock;
  setCreatedAddress: jest.Mock;
  clearSecrets: jest.Mock;
}
const mockOnboarding: MockOnboarding = {
  passphrase: '',
  biometricEnabled: false,
  createdAddress: null,
  setPassphrase: jest.fn((v: string) => (mockOnboarding.passphrase = v)),
  setBiometricEnabled: jest.fn((v: boolean) => (mockOnboarding.biometricEnabled = v)),
  setCreatedAddress: jest.fn((v: string) => (mockOnboarding.createdAddress = v)),
  clearSecrets: jest.fn(() => (mockOnboarding.passphrase = '')),
};
jest.mock('../src/screens/onboarding/OnboardingContext', () => ({
  useOnboarding: () => mockOnboarding,
  OnboardingProvider: ({children}: {children: React.ReactNode}) => children,
}));

const mockCreateWallet = jest.fn();
jest.mock('../src/wallet/Wallet', () => ({
  createWallet: (...args: unknown[]) => mockCreateWallet(...args),
}));

const mockRefresh = jest.fn();
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => ({hasWallet: false, refresh: mockRefresh}),
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

// A permissive navigation stand-in; screens only touch navigate/replace.
const nav = () =>
  ({navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn()}) as any;

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
  test('creates the wallet with the chosen biometric setting and advances', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockOnboarding.biometricEnabled = true;
    mockCreateWallet.mockResolvedValue({address: 'rrn1exampleaddress'});

    const navigation = nav();
    await renderScreen(<GenerateWallet navigation={navigation} route={{} as any} />);
    // Let the creation promise settle inside act.
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCreateWallet).toHaveBeenCalledWith('correcthorsebattery', undefined, {
      requireBiometric: true,
    });
    expect(mockOnboarding.setCreatedAddress).toHaveBeenCalledWith('rrn1exampleaddress');
    expect(mockOnboarding.clearSecrets).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('WalletReady');
  });

  test('shows an error with retry when creation fails', async () => {
    mockOnboarding.passphrase = 'correcthorsebattery';
    mockCreateWallet.mockRejectedValue(new Error('keystore unavailable'));

    const r = await renderScreen(
      <GenerateWallet navigation={nav()} route={{} as any} />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(hasText(r, 'Something went wrong')).toBe(true);
    expect(hasText(r, 'keystore unavailable')).toBe(true);
    expect(button(r, 'Try again')).toBeTruthy();
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
    expect(mockCreateWallet).toHaveBeenCalledTimes(1);
  });
});

// --- WalletReady ------------------------------------------------------------

describe('WalletReady', () => {
  test('shows the address as text and as a QR code', async () => {
    mockOnboarding.createdAddress = 'rrn1readyaddress';
    const r = await renderScreen(<WalletReady />);

    expect(hasText(r, 'rrn1readyaddress')).toBe(true);
    expect(queryByLabel(r, 'QR code for rrn1readyaddress')).not.toBeNull();
  });

  test('Continue refreshes the wallet session (entering the app)', async () => {
    mockOnboarding.createdAddress = 'rrn1readyaddress';
    const r = await renderScreen(<WalletReady />);

    await press(button(r, 'Continue to recovery setup'));
    expect(mockRefresh).toHaveBeenCalled();
  });
});
