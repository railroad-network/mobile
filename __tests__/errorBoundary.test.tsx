/**
 * @format
 *
 * The top-level ErrorBoundary (crash surfacing). Drives the real boundary around
 * a child that throws on render, asserting: the calm fallback replaces the dead
 * screen (no white screen), the crash is persisted to the log, "Copy details"
 * puts a report on the clipboard, and "Try again" re-mounts the tree — recovering
 * when the underlying error has cleared.
 */
import React from 'react';
import {Text as RNText} from 'react-native';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';

import {ErrorBoundary} from '../src/components/ErrorBoundary';
import * as secureStore from '../src/crypto/SecureStore';
import {SecureStoreKeys} from '../src/crypto/constants';
import {bytesToUtf8} from '../src/crypto/utf8';
import {ThemeProvider} from '../src/theme';

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

class MemStore implements secureStore.SecureStore {
  readonly map = new Map<string, Uint8Array>();
  async save(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value);
  }
  async load(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

// A child whose throwing is controlled from the test, so "Try again" can be
// shown recovering once the underlying fault clears.
let shouldThrow = true;
function Bomb() {
  if (shouldThrow) {
    throw new Error('render kaboom');
  }
  return <RNText>All good now</RNText>;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => textOf(n).includes(text)).length > 0;
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

async function renderBoundary(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ErrorBoundary>
            <Bomb />
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

let mem: MemStore;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  shouldThrow = true;
  mem = new MemStore();
  jest.spyOn(secureStore, 'getSecureStore').mockReturnValue(mem);
  // React logs caught render errors to console.error; keep the test output clean.
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  jest.restoreAllMocks();
});

const flush = () => act(async () => {
  await new Promise(res => setImmediate(res));
});

test('renders the fallback instead of a white screen when a child throws', async () => {
  const r = await renderBoundary();
  expect(hasText(r, 'Something went wrong')).toBe(true);
  expect(hasText(r, 'render kaboom')).toBe(true);
});

test('persists the crash to the log', async () => {
  await renderBoundary();
  await flush();
  const bytes = mem.map.get(SecureStoreKeys.CRASH_LOG);
  expect(bytes).toBeDefined();
  const log = JSON.parse(bytesToUtf8(bytes!));
  expect(log[0].kind).toBe('render');
  expect(log[0].message).toBe('render kaboom');
});

test('Copy details puts a report on the clipboard', async () => {
  const r = await renderBoundary();
  await press(button(r, 'Copy details'));
  expect(Clipboard.setString).toHaveBeenCalledWith(
    expect.stringContaining('render kaboom'),
  );
  expect(hasText(r, 'Copied ✓')).toBe(true);
});

test('Try again re-mounts the tree and recovers once the fault clears', async () => {
  const r = await renderBoundary();
  expect(hasText(r, 'Something went wrong')).toBe(true);
  // The underlying fault is gone now; retrying should show the child.
  shouldThrow = false;
  await press(button(r, 'Try again'));
  expect(hasText(r, 'All good now')).toBe(true);
  expect(hasText(r, 'Something went wrong')).toBe(false);
});
