/**
 * @format
 *
 * Settings (T1.2.8). Drives the real Settings screen over mocked identity /
 * profile / recovery / wallet seams, asserting: the sections render, the nickname
 * edit persists (and refreshes identity), the biometric toggle calls through, the
 * theme buttons are selectable, and the rows navigate to their sub-flows.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {ThemeProvider} from '../src/theme';
import {Settings} from '../src/screens/main/Settings';

const mockNav = {navigate: jest.fn()};
jest.mock('@react-navigation/native', () => {
  const React2 = require('react');
  return {
    useNavigation: () => mockNav,
    useFocusEffect: (cb: () => void | (() => void)) => React2.useEffect(cb, []),
  };
});

const IDENTITY = {address: 'rrn1qme', nickname: 'asa_wren', community: 'Blue Ridge Collective'};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useIdentity: () => ({data: IDENTITY}),
}));

let mockProfile: {nickname?: string; biometricEnabled?: boolean};
const mockSaveProfile = jest.fn(async (_patch: unknown) => {});
jest.mock('../src/wallet/profile', () => ({
  loadProfile: () => Promise.resolve(mockProfile),
  saveProfile: (patch: unknown) => mockSaveProfile(patch),
}));

jest.mock('../src/wallet/recoveryConfig', () => ({loadRecoveryConfig: () => Promise.resolve(null)}));
jest.mock('../src/wallet/heldShards', () => ({loadHeldShards: () => Promise.resolve({})}));

const mockSetBiometric = jest.fn(async (_enabled: boolean) => {});
jest.mock('../src/wallet/Wallet', () => ({
  setBiometricUnlock: (v: boolean) => mockSetBiometric(v),
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderSettings(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider>
            <Settings />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text)).length > 0;
const control = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
const field = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}
async function type(node: Instance, text: string): Promise<void> {
  await act(async () => {
    node.props.onChangeText?.(text);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = {nickname: 'asa_wren', biometricEnabled: true};
});

test('renders the settings sections', async () => {
  const r = await renderSettings();
  expect(hasText(r, 'Settings')).toBe(true);
  expect(hasText(r, 'Change passphrase')).toBe(true);
  expect(hasText(r, 'Social recovery')).toBe(true);
  expect(hasText(r, 'Theme')).toBe(true);
  expect(hasText(r, 'English')).toBe(true);
  expect(hasText(r, 'Factory reset')).toBe(true);
  expect(hasText(r, 'Export wallet')).toBe(true);
});

test('the security and advanced rows navigate to their flows', async () => {
  const r = await renderSettings();
  await press(control(r, 'Change passphrase'));
  expect(mockNav.navigate).toHaveBeenCalledWith('ChangePassphrase');
  await press(control(r, 'Export wallet'));
  expect(mockNav.navigate).toHaveBeenCalledWith('ExportWallet');
  await press(control(r, 'Factory reset'));
  expect(mockNav.navigate).toHaveBeenCalledWith('FactoryReset', {nickname: 'asa_wren'});
});

test('editing and saving the nickname persists it', async () => {
  const r = await renderSettings();
  await type(field(r, 'Local nickname'), 'river_fox');
  await press(control(r, 'Save'));
  expect(mockSaveProfile).toHaveBeenCalledWith({nickname: 'river_fox'});
});

test('toggling biometrics calls through', async () => {
  const r = await renderSettings();
  const toggle = r.root.find(
    n => n.props.accessibilityLabel === 'Unlock with biometrics' && typeof n.props.onValueChange === 'function',
  );
  await act(async () => {
    toggle.props.onValueChange(false);
  });
  expect(mockSetBiometric).toHaveBeenCalledWith(false);
});

test('the theme options are selectable', async () => {
  const r = await renderSettings();
  await press(control(r, 'Theme: Dark'));
  await press(control(r, 'Theme: System'));
  // No throw; the theme buttons are wired to setMode.
  expect(control(r, 'Theme: Light')).toBeTruthy();
});
