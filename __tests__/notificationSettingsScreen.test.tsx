/**
 * @format
 *
 * The Notification settings screen (T1.3.6). Drives the real screen with prefs,
 * the notifier seam, the background credential, and the wallet session mocked.
 * Asserts: the master + per-kind toggles reflect and persist prefs; enabling
 * background sync requests permission and provisions the credential; disabling it
 * clears the credential; and a locked wallet disables the background-sync toggle.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {NotificationSettings} from '../src/screens/main/NotificationSettings';
import {
  getPrefs,
  setBackgroundSyncEnabled,
  setKindEnabled,
  setNotificationsEnabled,
  type NotificationPrefs,
} from '../src/notifications/notificationPrefs';
import {getNotifier} from '../src/notifications/Notifications';
import {
  clearBackgroundCredential,
  provisionBackgroundCredential,
} from '../src/network/backgroundCredential';
import {requestBatteryExemption} from '../src/notifications/batteryOptimization';
import {useWalletSession} from '../src/wallet/WalletSession';

jest.mock('@react-navigation/native', () => {
  const React2 = require('react');
  return {useFocusEffect: (cb: () => void | (() => void)) => React2.useEffect(cb, [])};
});

jest.mock('../src/notifications/notificationPrefs', () => {
  const actual = jest.requireActual('../src/notifications/notificationPrefs');
  return {
    ...actual,
    getPrefs: jest.fn(),
    setNotificationsEnabled: jest.fn(),
    setKindEnabled: jest.fn(),
    setBackgroundSyncEnabled: jest.fn(),
  };
});

jest.mock('../src/notifications/Notifications', () => ({getNotifier: jest.fn()}));

jest.mock('../src/network/backgroundCredential', () => ({
  provisionBackgroundCredential: jest.fn(),
  clearBackgroundCredential: jest.fn(),
}));

jest.mock('../src/wallet/WalletSession', () => ({useWalletSession: jest.fn()}));

jest.mock('../src/notifications/batteryOptimization', () => ({
  requestBatteryExemption: jest.fn().mockResolvedValue(true),
}));

const mockGetPrefs = getPrefs as jest.Mock;
const mockSetMaster = setNotificationsEnabled as jest.Mock;
const mockSetKind = setKindEnabled as jest.Mock;
const mockSetBg = setBackgroundSyncEnabled as jest.Mock;
const mockGetNotifier = getNotifier as jest.Mock;
const mockProvision = provisionBackgroundCredential as jest.Mock;
const mockClear = clearBackgroundCredential as jest.Mock;
const mockSession = useWalletSession as jest.Mock;

const PREFS: NotificationPrefs = {
  notificationsEnabled: true,
  backgroundSyncEnabled: false,
  kinds: {},
};

const requestPermission = jest.fn().mockResolvedValue(true);
const fakeWallet = {address: 'rrn1self'} as never;
const mockNav = {navigate: jest.fn(), goBack: jest.fn()};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPrefs.mockResolvedValue(PREFS);
  mockSetMaster.mockImplementation(async (v: boolean) => ({...PREFS, notificationsEnabled: v}));
  mockSetKind.mockImplementation(async () => PREFS);
  mockSetBg.mockImplementation(async (v: boolean) => ({...PREFS, backgroundSyncEnabled: v}));
  mockGetNotifier.mockReturnValue({requestPermission, ensureChannel: jest.fn(), display: jest.fn()});
  mockProvision.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
  mockSession.mockReturnValue({wallet: fakeWallet});
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 390, height: 844},
          insets: {top: 47, left: 0, right: 0, bottom: 34},
        }}>
        <ThemeProvider>
          <NotificationSettings
            navigation={mockNav as never}
            route={{key: 'NotificationSettings', name: 'NotificationSettings'} as never}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

function switchFor(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  return tree.root.find(
    node =>
      node.props.accessibilityLabel === label && typeof node.props.onValueChange === 'function',
  );
}

async function toggle(tree: ReactTestRenderer.ReactTestRenderer, label: string, next: boolean) {
  await act(async () => {
    await switchFor(tree, label).props.onValueChange(next);
  });
}

describe('Notification settings screen', () => {
  it('renders the master and per-kind toggles', async () => {
    const tree = await render();
    expect(switchFor(tree, 'Local notifications')).toBeTruthy();
    expect(switchFor(tree, 'Incoming payments')).toBeTruthy();
    expect(switchFor(tree, 'Payments settled')).toBeTruthy();
  });

  it('turning the master on requests permission and persists', async () => {
    mockGetPrefs.mockResolvedValue({...PREFS, notificationsEnabled: false});
    const tree = await render();
    await toggle(tree, 'Local notifications', true);
    expect(requestPermission).toHaveBeenCalled();
    expect(mockSetMaster).toHaveBeenCalledWith(true);
  });

  it('toggling a kind persists that kind', async () => {
    const tree = await render();
    await toggle(tree, 'Payments confirmed', true);
    expect(mockSetKind).toHaveBeenCalledWith('confirmation_received', true);
  });

  it('enabling background sync provisions the credential and requests battery exemption', async () => {
    const tree = await render();
    await toggle(tree, 'Sync while the app is closed', true);
    expect(mockProvision).toHaveBeenCalledWith(fakeWallet);
    expect(mockSetBg).toHaveBeenCalledWith(true);
    expect(requestBatteryExemption as jest.Mock).toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('disabling background sync clears the credential', async () => {
    mockGetPrefs.mockResolvedValue({...PREFS, backgroundSyncEnabled: true});
    const tree = await render();
    await toggle(tree, 'Sync while the app is closed', false);
    expect(mockClear).toHaveBeenCalled();
    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockSetBg).toHaveBeenCalledWith(false);
  });

  it('a locked wallet disables background sync and shows the unlock hint', async () => {
    mockSession.mockReturnValue({wallet: null});
    const tree = await render();
    expect(switchFor(tree, 'Sync while the app is closed').props.disabled).toBe(true);
    const text = tree.root
      .findAll(node => typeof node.type === 'string' && node.children.length > 0)
      .flatMap(node => node.children)
      .filter((c): c is string => typeof c === 'string')
      .join(' ');
    expect(text).toContain('Unlock to change this');
  });
});
