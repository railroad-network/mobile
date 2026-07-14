/**
 * @format
 *
 * Change passphrase (T1.2.8): the new passphrase is applied only when the
 * confirmation matches and the length is met, the change goes through
 * `changePassphrase` (which verifies the old one), and a wrong current
 * passphrase surfaces an error.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {ChangePassphrase} from '../src/screens/main/ChangePassphrase';

const mockChange = jest.fn();
jest.mock('../src/wallet/Wallet', () => ({
  changePassphrase: (...args: unknown[]) => mockChange(...args),
}));

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 47, left: 0, right: 0, bottom: 34}};

function nav() {
  return {goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function render(navigation = nav()): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ChangePassphrase navigation={navigation} route={{} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const hasText = (r: Renderer, t: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(t)).length > 0;
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

beforeEach(() => {
  jest.clearAllMocks();
  mockChange.mockResolvedValue(undefined);
});

test('applies a valid new passphrase and confirms success', async () => {
  const r = await render();
  await type(field(r, 'Current passphrase'), 'old-pass');
  await type(field(r, 'New passphrase'), 'new-passphrase-1');
  await type(field(r, 'Confirm new passphrase'), 'new-passphrase-1');
  await press(button(r, 'Change passphrase'));
  expect(mockChange).toHaveBeenCalledWith('old-pass', 'new-passphrase-1');
  expect(hasText(r, 'Passphrase changed')).toBe(true);
});

test('a mismatched confirmation blocks the change', async () => {
  const r = await render();
  await type(field(r, 'Current passphrase'), 'old-pass');
  await type(field(r, 'New passphrase'), 'new-passphrase-1');
  await type(field(r, 'Confirm new passphrase'), 'different-one-1');
  await press(button(r, 'Change passphrase'));
  expect(hasText(r, 'don’t match')).toBe(true);
  expect(mockChange).not.toHaveBeenCalled();
});

test('a too-short new passphrase blocks the change', async () => {
  const r = await render();
  await type(field(r, 'Current passphrase'), 'old-pass');
  await type(field(r, 'New passphrase'), 'short');
  await type(field(r, 'Confirm new passphrase'), 'short');
  await press(button(r, 'Change passphrase'));
  expect(mockChange).not.toHaveBeenCalled();
});

test('a wrong current passphrase surfaces an error', async () => {
  mockChange.mockRejectedValue(new Error('bad'));
  const r = await render();
  await type(field(r, 'Current passphrase'), 'wrong');
  await type(field(r, 'New passphrase'), 'new-passphrase-1');
  await type(field(r, 'Confirm new passphrase'), 'new-passphrase-1');
  await press(button(r, 'Change passphrase'));
  expect(hasText(r, 'Could not change it')).toBe(true);
});
