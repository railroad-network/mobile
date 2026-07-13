/**
 * @format
 *
 * The camera seam (T1.2.3 Phase 1). Drives the real `QRScanner` component with
 * a controllable `react-native-vision-camera` mock to cover the permission
 * gate, the no-device fallback, and the scan → `onScan` de-duplication — the
 * behaviours screens depend on. The native camera itself is out of scope.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do); the RN
 * testing libraries don't render cleanly against React 19 here.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import {ThemeProvider} from '../src/theme';
import {QRScanner} from '../src/components/QRScanner';

// A controllable stand-in for the native camera library. `mock`-prefixed so the
// jest.mock factory may reference it.
const mockCamera: {
  permission: {
    hasPermission: boolean;
    requestPermission: jest.Mock;
    canRequestPermission: boolean;
    status: string;
  };
  device: unknown;
  onScanned?: (objects: Array<{value?: string}>) => void;
} = {
  permission: {
    hasPermission: true,
    requestPermission: jest.fn(async () => true),
    canRequestPermission: true,
    status: 'authorized',
  },
  device: {id: 'mock-back-camera', position: 'back'},
  onScanned: undefined,
};

jest.mock('react-native-vision-camera', () => {
  const ReactActual = require('react');
  const {View} = require('react-native');
  return {
    useCameraPermission: () => mockCamera.permission,
    useCameraDevice: () => mockCamera.device,
    useObjectOutput: ({
      onObjectsScanned,
    }: {
      onObjectsScanned: (objects: Array<{value?: string}>) => void;
    }) => {
      mockCamera.onScanned = onObjectsScanned;
      return {};
    },
    isScannedCode: (object: unknown) =>
      object != null && typeof object === 'object' && 'value' in object,
    Camera: () => ReactActual.createElement(View, {testID: 'qr-camera'}),
  };
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function render(ui: React.ReactElement): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<ThemeProvider>{ui}</ThemeProvider>);
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children
    .map(c => (typeof c === 'string' ? c : textOf(c)))
    .join('');
}

const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(
    n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text),
  ).length > 0;

const queryCamera = (r: Renderer): Instance | null =>
  r.root.findAll(n => n.props.testID === 'qr-camera')[0] ?? null;

const enableButton = (r: Renderer): Instance | null =>
  r.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      textOf(n).includes('Enable camera'),
  )[0] ?? null;

beforeEach(() => {
  jest.clearAllMocks();
  mockCamera.permission = {
    hasPermission: true,
    requestPermission: jest.fn(async () => true),
    canRequestPermission: true,
    status: 'authorized',
  };
  mockCamera.device = {id: 'mock-back-camera', position: 'back'};
  mockCamera.onScanned = undefined;
});

test('prompts for permission and requests it when not yet granted', async () => {
  mockCamera.permission.hasPermission = false;
  mockCamera.permission.canRequestPermission = true;
  const r = await render(<QRScanner onScan={jest.fn()} />);

  expect(hasText(r, 'Camera access is needed')).toBe(true);
  expect(queryCamera(r)).toBeNull();

  const button = enableButton(r);
  expect(button).not.toBeNull();
  await act(async () => {
    button!.props.onPress();
  });
  expect(mockCamera.permission.requestPermission).toHaveBeenCalledTimes(1);
});

test('directs to Settings (no request button) when permission is blocked', async () => {
  mockCamera.permission.hasPermission = false;
  mockCamera.permission.canRequestPermission = false;
  const r = await render(<QRScanner onScan={jest.fn()} />);

  expect(hasText(r, 'Enable it in Settings')).toBe(true);
  expect(enableButton(r)).toBeNull();
});

test('shows a fallback when there is no camera device', async () => {
  mockCamera.device = null;
  const r = await render(<QRScanner onScan={jest.fn()} />);

  expect(hasText(r, 'No camera is available')).toBe(true);
  expect(queryCamera(r)).toBeNull();
});

test('renders the camera once permission is granted and a device exists', async () => {
  const r = await render(<QRScanner onScan={jest.fn()} />);
  expect(queryCamera(r)).not.toBeNull();
});

test('reports a scanned QR value once, de-duplicating repeats', async () => {
  const onScan = jest.fn();
  await render(<QRScanner onScan={onScan} />);

  // The output fires continuously while a code is in frame.
  await act(async () => {
    mockCamera.onScanned?.([{value: 'rrn1holder'}]);
  });
  await act(async () => {
    mockCamera.onScanned?.([{value: 'rrn1holder'}]);
  });
  expect(onScan).toHaveBeenCalledTimes(1);
  expect(onScan).toHaveBeenCalledWith('rrn1holder');

  // A different value is reported.
  await act(async () => {
    mockCamera.onScanned?.([{value: 'rrn1other'}]);
  });
  expect(onScan).toHaveBeenCalledTimes(2);
  expect(onScan).toHaveBeenLastCalledWith('rrn1other');
});

test('ignores scanned objects that carry no decodable value', async () => {
  const onScan = jest.fn();
  await render(<QRScanner onScan={onScan} />);
  await act(async () => {
    mockCamera.onScanned?.([{}]);
  });
  expect(onScan).not.toHaveBeenCalled();
});
