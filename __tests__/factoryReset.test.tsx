/**
 * @format
 *
 * Factory reset (T1.2.8): the erase is gated behind typing the exact nickname,
 * and once confirmed it clears the store and refreshes the wallet session (which
 * returns the app to onboarding).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {FactoryReset} from '../src/screens/main/FactoryReset';

const mockReset = jest.fn(async () => {});
jest.mock('../src/wallet/Wallet', () => ({factoryReset: () => mockReset()}));

const mockRefresh = jest.fn(async () => {});
jest.mock('../src/wallet/WalletSession', () => ({
  useWalletSession: () => ({hasWallet: true, refresh: mockRefresh}),
}));

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 47, left: 0, right: 0, bottom: 34}};

function nav() {
  return {goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function render(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <FactoryReset navigation={nav()} route={{params: {nickname: 'asa_wren'}} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const button = (r: Renderer, name: string): Instance =>
  r.root.find(n => n.props.accessibilityRole === 'button' && (n.props.accessibilityLabel === name || textOf(n).includes(name)));
const field = (r: Renderer, label: string): Instance =>
  r.root.find(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
async function press(node: Instance): Promise<void> {
  await act(async () => node.props.onPress?.());
}
async function type(node: Instance, t: string): Promise<void> {
  await act(async () => node.props.onChangeText?.(t));
}

beforeEach(() => jest.clearAllMocks());

test('the erase is blocked until the nickname matches', async () => {
  const r = await render();
  await type(field(r, 'Nickname'), 'wrong');
  await press(button(r, 'Erase this wallet'));
  expect(mockReset).not.toHaveBeenCalled();
});

test('typing the exact nickname erases and refreshes the session', async () => {
  const r = await render();
  await type(field(r, 'Nickname'), 'asa_wren');
  await press(button(r, 'Erase this wallet'));
  expect(mockReset).toHaveBeenCalled();
  expect(mockRefresh).toHaveBeenCalled();
});
