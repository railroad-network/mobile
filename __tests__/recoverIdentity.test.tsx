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
import {Alert} from 'react-native';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {RecoverChoice} from '../src/screens/onboarding/RecoverChoice';
import {RecoverFromExport} from '../src/screens/onboarding/RecoverFromExport';
import {RecoverFromCircle} from '../src/screens/onboarding/RecoverFromCircle';
import type {AddResponseResult, ReconstructResult} from '../src/wallet/recoveryRequester';
import fingerprintFixture from './fixtures/recovery_fingerprint.json';

const FINGERPRINT = fingerprintFixture.vectors[0].fingerprint;

// --- Mocked seams -----------------------------------------------------------

// RecoverFromCircle pauses its scanner via useIsFocused and guards a
// partly-gathered ceremony via usePreventRemove; outside a navigator neither has
// context, so stub useIsFocused to "focused" and capture usePreventRemove's
// (preventRemove, callback) args so tests can drive the confirm.
const mockUsePreventRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args),
}));

// The address-scan path parses a scanned QR through this seam.
const mockParseAddressQr = jest.fn();
jest.mock('../src/ledger/addressQr', () => ({
  parseAddressQr: (v: string) => mockParseAddressQr(v),
}));

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
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
    // Returns an unsubscribe, like the real navigation prop.
    addListener: jest.fn(() => jest.fn()),
  } as any;
}

// The (preventRemove, callback) the screen last passed to usePreventRemove.
function lastPreventRemove(): [boolean, (o: {data: {action: unknown}}) => void] {
  const calls = mockUsePreventRemove.mock.calls;
  return calls[calls.length - 1] as [
    boolean,
    (o: {data: {action: unknown}}) => void,
  ];
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
  mockParseAddressQr.mockReturnValue(null);
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

  test('a non-response QR shows guidance and is not counted', async () => {
    mockSession.addResponseQr.mockReturnValue({kind: 'not-a-response'});
    const r = await startCeremony();
    await press(button(r, "Scan a holder's response"));
    await scan('rrn1someplainaddress');

    expect(hasText(r, "isn't a recovery response")).toBe(true);
    expect(mockSession.reconstruct).not.toHaveBeenCalled();
  });

  test('once a full circle is gathered but it will not rebuild, it offers a fresh start (not a wrong verdict)', async () => {
    // K is unknown to the requester; reaching the common threshold without a
    // rebuild must read as "still rebuilding", never "these pieces are bad".
    let count = 0;
    mockSession.addResponseQr.mockImplementation(() => ({
      kind: 'added',
      responses: ++count,
    }));
    mockSession.reconstruct.mockReturnValue({kind: 'need-more'});

    const r = await startCeremony();
    for (let i = 0; i < 3; i++) {
      await press(button(r, "Scan a holder's response"));
      await scan(`rrnrecover-resp:SHARE${i}`);
    }

    expect(hasText(r, 'Still rebuilding')).toBe(true);
    expect(hasText(r, "don't rebuild your key")).toBe(false);
    expect(mockSetRecoveredWallet).not.toHaveBeenCalled();
  });

  test('start over mints a fresh ceremony', async () => {
    mockSession.addResponseQr.mockReturnValue({kind: 'added', responses: 1});
    mockSession.reconstruct.mockReturnValue({kind: 'need-more'});
    const r = await startCeremony();
    await press(button(r, "Scan a holder's response"));
    await scan('rrnrecover-resp:SHARE0');
    // One piece gathered → the start-over affordance appears on the request step.
    await press(button(r, 'Start over with a new request'));

    // begin() once at ceremony start, once for the fresh request.
    expect(mockBegin).toHaveBeenCalledTimes(2);
    expect(mockBegin).toHaveBeenLastCalledWith('rrn1lostidentity');
  });

  test('the address scan accepts an address QR and starts the ceremony with it', async () => {
    mockParseAddressQr.mockReturnValue({address: 'rrn1scannedidentity'});
    const navigation = nav();
    const r = await render(<RecoverFromCircle navigation={navigation} route={{} as any} />);
    await press(button(r, 'Scan your address instead'));
    await scan('rrn1scannedidentity');
    await press(button(r, 'Start recovery'));

    expect(mockBegin).toHaveBeenCalledWith('rrn1scannedidentity');
  });

  test('the address scan rejects a non-address QR', async () => {
    mockParseAddressQr.mockReturnValue(null);
    const r = await render(<RecoverFromCircle navigation={nav()} route={{} as any} />);
    await press(button(r, 'Scan your address instead'));
    await scan('rrnrecover-resp:NOTANADDRESS');

    expect(hasText(r, "isn't an address")).toBe(true);
    expect(mockBegin).not.toHaveBeenCalled();
  });

  test('leaving with pieces gathered confirms before discarding them', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSession.addResponseQr.mockReturnValue({kind: 'added', responses: 1});
    mockSession.reconstruct.mockReturnValue({kind: 'need-more'});

    const navigation = nav();
    const r = await startCeremony(navigation);
    await press(button(r, "Scan a holder's response"));
    await scan('rrnrecover-resp:SHARE0'); // one piece in → the guard arms

    // The screen asks navigation to prevent removal while pieces are held.
    const [prevent, onConfirm] = lastPreventRemove();
    expect(prevent).toBe(true);

    // A prevented exit shows a confirm rather than leaving; only choosing to
    // discard replays the original navigation action.
    onConfirm({data: {action: {type: 'GO_BACK'}}});
    expect(alertSpy).toHaveBeenCalled();
    expect(navigation.dispatch).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as any[];
    buttons.find(b => b.style === 'destructive')!.onPress();
    expect(navigation.dispatch).toHaveBeenCalledWith({type: 'GO_BACK'});

    alertSpy.mockRestore();
  });

  test('leaving before any piece is gathered does not arm the confirm', async () => {
    await startCeremony(); // request step, zero responses
    expect(lastPreventRemove()[0]).toBe(false);
  });

  test('the confirm is disarmed once a rebuild is carried into the tail', async () => {
    const wallet = {address: 'rrn1lostidentity'} as any;
    let count = 0;
    mockSession.addResponseQr.mockImplementation(() => ({
      kind: 'added',
      responses: ++count,
    }));
    mockSession.reconstruct.mockImplementation(() =>
      count >= 3 ? {kind: 'recovered', wallet} : {kind: 'need-more'},
    );

    const navigation = nav();
    const r = await startCeremony(navigation);
    for (let i = 0; i < 3; i++) {
      await press(button(r, "Scan a holder's response"));
      await scan(`rrnrecover-resp:SHARE${i}`);
    }

    expect(navigation.navigate).toHaveBeenCalledWith('Passphrase');
    // Rebuilt and moved to the tail — nothing left to lose, so leaving is free.
    expect(lastPreventRemove()[0]).toBe(false);
  });

  test('cancel recovery leaves the ceremony', async () => {
    const navigation = nav();
    const r = await startCeremony(navigation);
    await press(button(r, 'Cancel recovery'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('RecoverChoice', () => {
  test('create-instead drops any half-recovered identity and starts fresh', async () => {
    const navigation = nav();
    const r = await render(
      <RecoverChoice navigation={navigation} route={{} as any} />,
    );
    await press(button(r, 'Create a new wallet instead'));

    expect(mockSetRecoveredWallet).toHaveBeenCalledWith(null);
    expect(navigation.navigate).toHaveBeenCalledWith('Passphrase');
  });
});

describe('recovery fingerprint fixture', () => {
  // The byte-identical VALUE contract is enforced on the station side
  // (rrn-mobile-ffi's recovery_ceremony.rs). Here we only pin the copied file's
  // shape, so a hand-copy drift is visible on this side too.
  test('has the cross-platform shape the station contract produces', () => {
    expect(fingerprintFixture.vectors).toHaveLength(3);
    for (const v of fingerprintFixture.vectors) {
      expect(v.recovery_pubkey_hex).toMatch(/^[0-9a-f]{64}$/);
      expect(v.fingerprint).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    }
  });
});
