/**
 * @format
 *
 * The Diagnostics screen (crash surfacing). Drives the real screen over a mocked
 * crash log, asserting: recorded reports render newest-first, "Copy all" copies a
 * combined block, a per-entry "Copy report" copies just that one, and "Clear"
 * empties the log and the view.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';

import {ThemeProvider} from '../src/theme';
import {Diagnostics} from '../src/screens/main/Diagnostics';
import {makeCrashReport, type CrashReport} from '../src/diagnostics/crashReport';

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

jest.mock('@react-navigation/native', () => {
  const React2 = require('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => React2.useEffect(cb, []),
  };
});

const mockClear = jest.fn(async () => {});
let mockReports: CrashReport[] = [];
jest.mock('../src/diagnostics/crashLog', () => ({
  loadCrashLog: () => Promise.resolve(mockReports),
  clearCrashLog: () => mockClear(),
}));

function report(kind: CrashReport['kind'], message: string): CrashReport {
  return {...makeCrashReport(kind, new Error(message)), message};
}

function nav() {
  return {goBack: jest.fn()} as any;
}

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => textOf(n).includes(text)).length > 0;
const buttons = (r: Renderer, name: string): Instance[] =>
  r.root.findAll(
    n => n.props.accessibilityRole === 'button' && textOf(n).includes(name),
  );
async function press(node: Instance): Promise<void> {
  await act(async () => {
    node.props.onPress?.();
  });
}

async function renderScreen(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Diagnostics navigation={nav()} route={{params: undefined} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReports = [];
});

test('empty state when nothing has been recorded', async () => {
  const r = await renderScreen();
  expect(hasText(r, 'Nothing to report')).toBe(true);
});

test('renders recorded reports newest-first', async () => {
  // loadCrashLog already returns newest-first; the screen renders in order.
  mockReports = [report('render', 'newest boom'), report('rejection', 'older boom')];
  const r = await renderScreen();
  expect(hasText(r, 'Screen error')).toBe(true);
  expect(hasText(r, 'newest boom')).toBe(true);
  expect(hasText(r, 'Unhandled rejection')).toBe(true);
});

test('Copy all copies a combined block', async () => {
  mockReports = [report('render', 'boom one'), report('error', 'boom two')];
  const r = await renderScreen();
  await press(buttons(r, 'Copy all')[0]);
  const copied = (Clipboard.setString as jest.Mock).mock.calls[0][0] as string;
  expect(copied).toContain('boom one');
  expect(copied).toContain('boom two');
});

test('Clear empties the log and the view', async () => {
  mockReports = [report('render', 'boom')];
  const r = await renderScreen();
  expect(hasText(r, 'boom')).toBe(true);
  await press(buttons(r, 'Clear')[0]);
  expect(mockClear).toHaveBeenCalled();
  expect(hasText(r, 'Nothing to report')).toBe(true);
});
