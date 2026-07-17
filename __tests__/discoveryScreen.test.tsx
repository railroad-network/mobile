/**
 * @format
 *
 * The Discovery screen (T1.3.2). Drives the real screen over a fake native
 * browser registered into the seam, asserting: found stations render and
 * navigate to pairing, the searching/empty/error states each say the right
 * thing, and manual entry validates before navigating.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import type {DiscoveredStation, StationDiscovery} from 'rrn-discovery';

import {ThemeProvider} from '../src/theme';
import {Discovery} from '../src/screens/main/Discovery';
import {
  EMPTY_AFTER_MS,
  registerStationDiscovery,
} from '../src/network/Discovery';

class FakeDiscovery implements StationDiscovery {
  readonly name = 'StationDiscovery';
  readonly equals = () => false;
  readonly toString = () => '[FakeDiscovery]';
  readonly dispose = () => {};

  stopped = 0;
  onFound: ((station: DiscoveredStation) => void) | null = null;
  onLost: ((name: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  start(
    _serviceType: string,
    onFound: (station: DiscoveredStation) => void,
    onLost: (name: string) => void,
    onError: (message: string) => void,
  ): void {
    this.onFound = onFound;
    this.onLost = onLost;
    this.onError = onError;
  }

  stop(): void {
    this.stopped += 1;
  }
}

const mockNav = {navigate: jest.fn(), goBack: jest.fn()};

function reply(overrides: Partial<DiscoveredStation> = {}): DiscoveredStation {
  return {
    name: 'Railroad Station — Evening Ridge',
    host: 'railroad-station-evening-ridge.local.',
    port: 7500,
    txt: {address: 'rrn1evening', version: '0.1.0'},
    ...overrides,
  };
}

let fake: FakeDiscovery;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  fake = new FakeDiscovery();
  registerStationDiscovery(() => fake);
});

afterEach(() => {
  jest.useRealTimers();
});

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 390, height: 844},
          insets: {top: 47, left: 0, right: 0, bottom: 34},
        }}>
        <ThemeProvider>
          <Discovery
            navigation={mockNav as never}
            route={{key: 'Discovery', name: 'Discovery'} as never}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

/** All rendered text, flattened — enough to assert on copy without matching layout. */
function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAll(node => typeof node.type === 'string' && node.children.length > 0)
    .flatMap(node => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' ');
}

function pressLabelled(
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) {
  const target = tree.root.find(
    node => node.props.accessibilityLabel === label && node.props.onPress,
  );
  act(() => target.props.onPress());
}

describe('Discovery screen', () => {
  it('shows a found station with its host, port and version', () => {
    const tree = render();

    act(() => fake.onFound?.(reply()));

    const text = textOf(tree);
    expect(text).toContain('Railroad Station — Evening Ridge');
    expect(text).toContain('railroad-station-evening-ridge.local.');
    expect(text).toContain('7500');
    expect(text).toContain('v0.1.0');
    expect(text).toContain('1 station found');
    // The row leads with a station avatar (StarMark tile).
    const avatars = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === 'Station' &&
        node.props.accessibilityRole === 'image',
    );
    expect(avatars).toHaveLength(1);
  });

  it('pluralises the count', () => {
    const tree = render();

    act(() => {
      fake.onFound?.(reply({name: 'Alpha Junction'}));
      fake.onFound?.(reply({name: 'Zulu Yard'}));
    });

    expect(textOf(tree)).toContain('2 stations found');
  });

  it('navigates to pairing with the chosen station', () => {
    const tree = render();
    act(() => fake.onFound?.(reply()));

    pressLabelled(tree, 'Pair with Railroad Station — Evening Ridge');

    expect(mockNav.navigate).toHaveBeenCalledWith('Pairing', {
      station: {
        name: 'Railroad Station — Evening Ridge',
        host: 'railroad-station-evening-ridge.local.',
        port: 7500,
        origin: 'discovered',
        address: 'rrn1evening',
        version: '0.1.0',
      },
    });
  });

  it('says it is looking before anything turns up', () => {
    const tree = render();

    expect(textOf(tree)).toContain('Looking for stations');
  });

  it('offers both readings of silence once the search comes up empty', () => {
    const tree = render();

    act(() => jest.advanceTimersByTime(EMPTY_AFTER_MS));

    const text = textOf(tree);
    expect(text).toContain('No stations yet');
    // On iOS a denial and an empty network are indistinguishable, so the copy
    // must not assert either one happened.
    expect(text).toContain('same Wi-Fi');
    expect(text).toContain('local network');
    expect(text).not.toMatch(/you denied|permission was denied/i);
  });

  it('surfaces a browse error with a way to retry', () => {
    const tree = render();

    act(() => fake.onError?.('the mDNS daemon is not running'));

    expect(textOf(tree)).toContain('the mDNS daemon is not running');
    expect(textOf(tree)).toContain('Try again');
  });

  it('stops browsing on unmount', () => {
    const tree = render();

    act(() => tree.unmount());

    expect(fake.stopped).toBe(1);
  });

  describe('manual entry', () => {
    const openManual = (tree: ReactTestRenderer.ReactTestRenderer) =>
      pressLabelled(tree, 'Add by address');
    const submit = (tree: ReactTestRenderer.ReactTestRenderer) =>
      pressLabelled(tree, 'Continue');

    function setField(
      tree: ReactTestRenderer.ReactTestRenderer,
      label: string,
      value: string,
    ) {
      const field = tree.root.find(
        node =>
          node.props.accessibilityLabel === label &&
          node.props.onChangeText !== undefined,
      );
      act(() => field.props.onChangeText(value));
    }

    it('is reachable even while stations are listed', () => {
      const tree = render();
      act(() => fake.onFound?.(reply()));

      // Not a fallback buried behind failure: a typed station is worth as much
      // as a discovered one.
      expect(textOf(tree)).toContain('Add by address');
    });

    it('prefills the station default port', () => {
      const tree = render();

      openManual(tree);

      expect(textOf(tree)).toContain('7500');
    });

    it('navigates to pairing with a manual station', () => {
      const tree = render();
      openManual(tree);

      setField(tree, 'Address', '192.168.1.134');
      submit(tree);

      expect(mockNav.navigate).toHaveBeenCalledWith('Pairing', {
        station: {
          name: '192.168.1.134',
          host: '192.168.1.134',
          port: 7500,
          origin: 'manual',
        },
      });
    });

    it('rejects a bad host without navigating', () => {
      const tree = render();
      openManual(tree);

      setField(tree, 'Address', 'http://station.local');
      submit(tree);

      expect(mockNav.navigate).not.toHaveBeenCalled();
      expect(textOf(tree)).toContain('doesn’t look like a hostname');
    });

    it('rejects a bad port without navigating', () => {
      const tree = render();
      openManual(tree);

      setField(tree, 'Address', 'station.local');
      setField(tree, 'Port', 'abc');
      submit(tree);

      expect(mockNav.navigate).not.toHaveBeenCalled();
      expect(textOf(tree)).toContain('between 1 and 65535');
    });
  });
});
