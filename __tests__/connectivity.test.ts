/**
 * @format
 *
 * The three-way connectivity mapping behind the header pill: online / connecting
 * / offline, derived from whether a station is active and the reachability
 * verdict. Pure, so it's checked without a renderer.
 */
import {connectivityFrom} from '../src/ledger/useLedger';

test('no active station reads as online-optimistic (nothing to connect to)', () => {
  // Locked or unpaired: any verdict is irrelevant — never offline, never connecting.
  for (const r of ['unknown', 'reachable', 'unreachable'] as const) {
    expect(connectivityFrom(false, r)).toEqual({
      level: 'mesh',
      isOffline: false,
      isConnecting: false,
    });
  }
});

test('active + unknown reads as connecting (establishing, not yet confirmed)', () => {
  expect(connectivityFrom(true, 'unknown')).toEqual({
    level: 'connecting',
    isOffline: false,
    isConnecting: true,
  });
});

test('active + reachable reads as online (mesh)', () => {
  expect(connectivityFrom(true, 'reachable')).toEqual({
    level: 'mesh',
    isOffline: false,
    isConnecting: false,
  });
});

test('active + unreachable reads as offline', () => {
  expect(connectivityFrom(true, 'unreachable')).toEqual({
    level: 'offline',
    isOffline: true,
    isConnecting: false,
  });
});

test('connecting and offline are mutually exclusive', () => {
  const connecting = connectivityFrom(true, 'unknown');
  const offline = connectivityFrom(true, 'unreachable');
  expect(connecting.isConnecting && connecting.isOffline).toBe(false);
  expect(offline.isConnecting && offline.isOffline).toBe(false);
});
