/**
 * @format
 *
 * The Pairing screen (T1.3.3). Drives the real screen with the wallet, the
 * handshake, and persistence mocked (all reach native, which cannot load under
 * Jest), asserting: unlocking runs the handshake and shows the code; confirming
 * persists the station and lands on the paired step; a rejected/unverified
 * handshake shows the right warning and persists nothing; and "they don't match"
 * backs out without saving.
 *
 * Uses `react-test-renderer` directly (as the other screen tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Pairing} from '../src/screens/main/Pairing';
import type {Station} from '../src/network/Discovery';
import {loadWallet} from '../src/wallet/Wallet';
import {requestPairing} from '../src/network/Pairing';
import {addPairedStation} from '../src/network/pairedStation';

jest.mock('../src/wallet/Wallet', () => ({loadWallet: jest.fn()}));
jest.mock('../src/network/Pairing', () => ({requestPairing: jest.fn()}));
jest.mock('../src/network/pairedStation', () => ({addPairedStation: jest.fn()}));

const mockLoadWallet = loadWallet as jest.Mock;
const mockRequestPairing = requestPairing as jest.Mock;
const mockAddPairedStation = addPairedStation as jest.Mock;

const station: Station = {
  name: 'Railroad Station — Evening Ridge',
  host: 'railroad-station-evening-ridge.local.',
  port: 7500,
  origin: 'discovered',
  address: 'rrn1evening',
  version: '0.1.0',
};

const mockNav = {navigate: jest.fn(), goBack: jest.fn()};

/** A wallet stand-in — the screen only passes it through to requestPairing. */
const fakeWallet = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadWallet.mockResolvedValue(fakeWallet);
  mockRequestPairing.mockResolvedValue({
    ok: true,
    stationAddress: 'rrn1evening',
    sas: 'a1b2c3d4',
    host: station.host,
    port: station.port,
  });
  mockAddPairedStation.mockResolvedValue(undefined);
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
          <Pairing
            navigation={mockNav as never}
            route={{key: 'Pairing', name: 'Pairing', params: {station}} as never}
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

function setText(
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  value: string,
) {
  const input = tree.root.find(
    node => node.props.accessibilityLabel === label && node.props.onChangeText,
  );
  act(() => input.props.onChangeText(value));
}

async function pressLabelled(
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) {
  const target = tree.root.find(
    node => node.props.accessibilityLabel === label && node.props.onPress,
  );
  await act(async () => {
    await target.props.onPress();
  });
}

/** Enter the passphrase and run the handshake to the confirm step. */
async function unlock(tree: ReactTestRenderer.ReactTestRenderer) {
  setText(tree, 'Passphrase', 'correct horse');
  await pressLabelled(tree, 'Contact station');
}

describe('Pairing screen', () => {
  it('shows which station it will pair with', () => {
    const tree = render();
    expect(textOf(tree)).toContain('Railroad Station — Evening Ridge');
    expect(textOf(tree)).toContain('railroad-station-evening-ridge.local.');
  });

  it('runs the handshake and shows the confirmation code', async () => {
    const tree = render();
    await unlock(tree);

    expect(mockLoadWallet).toHaveBeenCalledWith('correct horse');
    expect(mockRequestPairing).toHaveBeenCalledWith(station, fakeWallet);
    const text = textOf(tree);
    expect(text).toContain('Check the code');
    expect(text).toContain('a1b2c3d4');
    // Nothing is persisted until the user confirms.
    expect(mockAddPairedStation).not.toHaveBeenCalled();
  });

  it('persists the station on confirm and lands on the paired step', async () => {
    const tree = render();
    await unlock(tree);
    await pressLabelled(tree, 'Codes match — pair');

    expect(mockAddPairedStation).toHaveBeenCalledTimes(1);
    const saved = mockAddPairedStation.mock.calls[0][0];
    expect(saved).toMatchObject({
      address: 'rrn1evening',
      host: station.host,
      port: station.port,
    });
    expect(typeof saved.pairedAt).toBe('number');
    expect(textOf(tree)).toContain('Paired');
  });

  it('does not persist and backs out when the codes do not match', async () => {
    const tree = render();
    await unlock(tree);
    await pressLabelled(tree, 'They don’t match');

    expect(mockAddPairedStation).not.toHaveBeenCalled();
    expect(mockNav.goBack).toHaveBeenCalled();
  });

  it('warns and stays put when the station cannot be verified', async () => {
    mockRequestPairing.mockResolvedValue({ok: false, error: 'unverified'});
    const tree = render();
    await unlock(tree);

    const text = textOf(tree);
    expect(text).toContain('didn’t prove it holds its identity key');
    expect(text).not.toContain('Check the code');
    expect(mockAddPairedStation).not.toHaveBeenCalled();
  });

  it('surfaces the station’s rejection reason', async () => {
    mockRequestPairing.mockResolvedValue({
      ok: false,
      error: 'rejected',
      detail: 'requested_at outside allowed clock skew',
    });
    const tree = render();
    await unlock(tree);

    expect(textOf(tree)).toContain('requested_at outside allowed clock skew');
  });

  it('reports when no wallet is on the device', async () => {
    mockLoadWallet.mockResolvedValue(null);
    const tree = render();
    await unlock(tree);

    expect(textOf(tree)).toContain('No wallet found on this device.');
    expect(mockRequestPairing).not.toHaveBeenCalled();
  });

  it('reports a failed unlock without leaking why', async () => {
    mockLoadWallet.mockRejectedValue(new Error('biometric cancelled'));
    const tree = render();
    await unlock(tree);

    const text = textOf(tree);
    expect(text).toContain('Could not unlock');
    expect(text).not.toContain('biometric cancelled');
  });
});
