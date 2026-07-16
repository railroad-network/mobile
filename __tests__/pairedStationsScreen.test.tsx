/**
 * @format
 *
 * The Paired stations screen (T1.3.3). Drives the real screen with persistence
 * mocked, asserting: the empty state points to discovery; paired stations render
 * by their label and address; unpairing takes a confirm step and then calls
 * removePairedStation for the right address and refreshes the list.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {PairedStations} from '../src/screens/main/PairedStations';
import {
  loadPairedStations,
  removePairedStation,
  type PairedStation,
} from '../src/network/pairedStation';

jest.mock('@react-navigation/native', () => {
  const React2 = require('react');
  return {useFocusEffect: (cb: () => void | (() => void)) => React2.useEffect(cb, [])};
});

jest.mock('../src/network/pairedStation', () => ({
  loadPairedStations: jest.fn(),
  removePairedStation: jest.fn(),
}));

const mockLoad = loadPairedStations as jest.Mock;
const mockRemove = removePairedStation as jest.Mock;

const evening: PairedStation = {
  address: 'rrn1evening',
  host: 'evening.local',
  port: 7500,
  pairedAt: 1000,
  name: 'Railroad Station — Evening Ridge',
};
const forest: PairedStation = {
  address: 'rrn1forest',
  host: '192.168.1.20',
  port: 7500,
  pairedAt: 2000,
};

const mockNav = {navigate: jest.fn(), goBack: jest.fn()};

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue([]);
  mockRemove.mockResolvedValue(true);
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
          <PairedStations
            navigation={mockNav as never}
            route={{key: 'PairedStations', name: 'PairedStations'} as never}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAll(node => typeof node.type === 'string' && node.children.length > 0)
    .flatMap(node => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' ');
}

async function pressText(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  const target = tree.root.find(
    node => node.props.accessibilityLabel === label && node.props.onPress,
  );
  await act(async () => {
    await target.props.onPress();
  });
}

describe('Paired stations screen', () => {
  it('shows an empty state that points to discovery', async () => {
    const tree = await render();
    expect(textOf(tree)).toContain('haven’t paired');
    await pressText(tree, 'Find a station');
    expect(mockNav.navigate).toHaveBeenCalledWith('Discovery');
  });

  it('lists paired stations by label, host and address', async () => {
    mockLoad.mockResolvedValue([evening, forest]);
    const tree = await render();
    // `textOf` joins text children with spaces, so host/port land as separate
    // tokens (as the Discovery screen test also handles).
    const text = textOf(tree);
    expect(text).toContain('Railroad Station — Evening Ridge');
    expect(text).toContain('evening.local');
    expect(text).toContain('7500');
    expect(text).toContain('rrn1evening');
    // A station with no captured name falls back to its shortened address.
    expect(text).toContain('192.168.1.20');
    expect(text).toContain('rrn1forest');
  });

  it('unpairs only after a confirm step, targeting the address', async () => {
    mockLoad.mockResolvedValue([evening]);
    const tree = await render();

    // First tap reveals the confirmation, and does not remove anything.
    await pressText(tree, 'Unpair');
    expect(mockRemove).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Forget this station?');

    // After removal the list reloads empty.
    mockLoad.mockResolvedValue([]);
    await pressText(tree, 'Unpair');
    expect(mockRemove).toHaveBeenCalledWith('rrn1evening');
    expect(textOf(tree)).toContain('haven’t paired');
  });

  it('cancelling the confirm keeps the station', async () => {
    mockLoad.mockResolvedValue([evening]);
    const tree = await render();
    await pressText(tree, 'Unpair');
    await pressText(tree, 'Cancel');
    expect(mockRemove).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Railroad Station — Evening Ridge');
  });

  it('offers to pair another when some are paired', async () => {
    mockLoad.mockResolvedValue([evening]);
    const tree = await render();
    await pressText(tree, 'Pair with another station');
    expect(mockNav.navigate).toHaveBeenCalledWith('Discovery');
  });
});
