/**
 * @format
 *
 * Recovering an existing identity onto a device (ADR-0016), the mobile half.
 * Drives the real onboarding recovery screens over mocked seams — the FFI-backed
 * wallet import and reconstruction ceremony, address validation, the camera
 * scanner, and the onboarding context — and asserts the behaviours the flow
 * promises:
 *   - `RecoverFromExport`: a good export + passphrase opens the identity and
 *     carries it into the shared tail; a bad one shows an error and stores
 *     nothing.
 *   - `RecoverFromCircle`: showing the request + fingerprint, gathering holder
 *     responses, refusing a response from another ceremony, and rebuilding once
 *     enough shares are in.
 *
 * As elsewhere in this suite, the native crypto cannot load under Jest, so the
 * FFI-backed pieces (`importWalletFromExport`, `RecoverySession`) are mocked; the
 * pure wire helpers stay real.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {RecoverFromExport} from '../src/screens/onboarding/RecoverFromExport';
import {RecoverFromCircle} from '../src/screens/onboarding/RecoverFromCircle';
import type {AddResponseResult, ReconstructResult} from '../src/wallet/recoveryRequester';
import fingerprintFixture from './fixtures/recovery_fingerprint.json';

const FINGERPRINT = fingerprintFixture.vectors[0].fingerprint;

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

jest.mock('react-native-qrcode-svg', () => {
  const ReactActual = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: ({value}: {value: string}) =>
      ReactActual.createElement(View, {testID: 'qr-code', 'data-value': value}),
  };
});

const mockSetRecoveredWallet = jest.fn();
jest.mock('../src/screens/onboarding/OnboardingContext', () => ({
  ...jest.requireActual('../src/screens/onboarding/OnboardingContext'),
  useOnboarding: () => ({setRecoveredWallet: mockSetRecoveredWallet}),
}));

const mockImportWalletFromExport = jest.fn();
jest.mock('../src/wallet/Wallet', () => ({
  importWalletFromExport: (...args: unknown[]) => mockImportWalletFromExport(...args),
}));

let mockIsValid = (_address: string) => true;
jest.mock('../src/crypto/address', () => ({
  isValidAddress: (a: string) => mockIsValid(a),
}));

// A controllable stand-in for the Rust-backed reconstruction session.
interface FakeSession {
  requestQr: jest.Mock<string, []>;
  fingerprint: jest.Mock<string, []>;
  addResponseQr: jest.Mock<AddResponseResult, [string]>;
  reconstruct: jest.Mock<ReconstructResult, []>;
}
let mockSession: FakeSession;
const mockBegin = jest.fn((_addr: string) => mockSession);
jest.mock('../src/wallet/recoveryRequester', () => ({
  RecoverySession: {begin: (addr: string) => mockBegin(addr)},
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

async function render(ui: React.ReactElement): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>{ui}</ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await flush();
  return r;
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(
    n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text),
  ).length > 0;

const byLabel = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label);

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

beforeEach(() => {
  jest.clearAllMocks();
  mockOnScan = undefined;
  mockIsValid = () => true;
  mockSession = {
    requestQr: jest.fn(() => 'rrnrecover-req:AAAA'),
    fingerprint: jest.fn(() => FINGERPRINT),
    addResponseQr: jest.fn(),
    reconstruct: jest.fn(() => ({kind: 'need-more'})),
  };
});

// --- B1: restore from an export ---------------------------------------------

describe('RecoverFromExport', () => {
  test('a good export + passphrase opens it and carries it into the tail', async () => {
    const wallet = {address: 'rrn1recovered'} as any;
    mockImportWalletFromExport.mockResolvedValue(wallet);
    const navigation = nav();
    const r = await render(<RecoverFromExport navigation={navigation} route={{} as any} />);

    await type(byLabel(r, 'Wallet export'), 'BASE64WALLET');
    await type(byLabel(r, 'Export passphrase'), 'correct horse');
    await press(button(r, 'Continue'));

    expect(mockImportWalletFromExport).toHaveBeenCalledWith('BASE64WALLET', 'correct horse');
    expect(mockSetRecoveredWallet).toHaveBeenCalledWith(wallet);
    expect(navigation.navigate).toHaveBeenCalledWith('Passphrase');
  });

  test('a wrong passphrase / corrupt export shows an error and stores nothing', async () => {
    mockImportWalletFromExport.mockRejectedValue(new Error('decrypt'));
    const navigation = nav();
    const r = await render(<RecoverFromExport navigation={navigation} route={{} as any} />);

    await type(byLabel(r, 'Wallet export'), 'garbage');
    await type(byLabel(r, 'Export passphrase'), 'wrong');
    await press(button(r, 'Continue'));

    expect(hasText(r, "That didn't open")).toBe(true);
    expect(mockSetRecoveredWallet).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});

// --- B2: rebuild from the recovery circle -----------------------------------

describe('RecoverFromCircle', () => {
  async function startCeremony(navigation = nav()): Promise<Renderer> {
    const r = await render(<RecoverFromCircle navigation={navigation} route={{} as any} />);
    await type(byLabel(r, 'Your address'), 'rrn1lostidentity');
    await press(button(r, 'Start recovery'));
    return r;
  }

  test('shows the request QR and the fingerprint for holders to match', async () => {
    const r = await startCeremony();
    expect(mockBegin).toHaveBeenCalledWith('rrn1lostidentity');
    expect(r.root.findAll(n => n.props.testID === 'qr-code').length).toBeGreaterThan(0);
    expect(hasText(r, FINGERPRINT)).toBe(true);
    expect(hasText(r, 'must see this exact code')).toBe(true);
  });

  test('a malformed address does not start a ceremony', async () => {
    mockIsValid = () => false;
    const r = await render(<RecoverFromCircle navigation={nav()} route={{} as any} />);
    await type(byLabel(r, 'Your address'), 'not-an-address');
    await press(button(r, 'Start recovery'));

    expect(mockBegin).not.toHaveBeenCalled();
    expect(hasText(r, 'not a valid address')).toBe(true);
  });

  test('a response from another ceremony is refused, not counted', async () => {
    mockSession.addResponseQr.mockReturnValue({kind: 'wrong-ceremony'});
    const r = await startCeremony();
    await press(button(r, "Scan a holder's response"));
    await scan('rrnrecover-resp:OTHER');

    expect(hasText(r, 'different recovery')).toBe(true);
    expect(mockSession.reconstruct).not.toHaveBeenCalled();
    expect(mockSetRecoveredWallet).not.toHaveBeenCalled();
  });

  test('gathering enough responses rebuilds the identity and enters the tail', async () => {
    const wallet = {address: 'rrn1lostidentity'} as any;
    let count = 0;
    mockSession.addResponseQr.mockImplementation(() => {
      count += 1;
      return {kind: 'added', responses: count};
    });
    mockSession.reconstruct.mockImplementation(() =>
      count >= 3 ? {kind: 'recovered', wallet} : {kind: 'need-more'},
    );

    const navigation = nav();
    const r = await startCeremony(navigation);

    // The requester re-shows the request to each holder, then scans their reply.
    for (let i = 0; i < 3; i++) {
      await press(button(r, "Scan a holder's response"));
      await scan(`rrnrecover-resp:SHARE${i}`);
    }

    expect(mockSession.addResponseQr).toHaveBeenCalledTimes(3);
    expect(mockSetRecoveredWallet).toHaveBeenCalledWith(wallet);
    expect(navigation.navigate).toHaveBeenCalledWith('Passphrase');
  });
});
