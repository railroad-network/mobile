/**
 * Tests for the discovery seam.
 *
 * The native browser is faked, which is the whole point of keeping the station
 * list in TypeScript: found/lost orderings that would need a real LAN and real
 * hardware to provoke are three lines here.
 */

import type {DiscoveredStation, StationDiscovery} from 'rrn-discovery';
import {
  DEFAULT_STATION_PORT,
  DiscoverySession,
  EMPTY_AFTER_MS,
  STATION_SERVICE_TYPE,
  parseManualStation,
  registerStationDiscovery,
  type DiscoveryState,
} from '../src/network/Discovery';

/** A fake native browser whose events the test drives by hand. */
class FakeDiscovery implements StationDiscovery {
  // Satisfies HybridObject's surface; nothing here reads them.
  readonly name = 'StationDiscovery';
  readonly equals = () => false;
  readonly toString = () => '[FakeDiscovery]';
  readonly dispose = () => {};

  serviceType: string | null = null;
  started = 0;
  stopped = 0;
  /** Set to throw from `start`, standing in for a native failure. */
  startError: Error | null = null;

  onFound: ((station: DiscoveredStation) => void) | null = null;
  onLost: ((name: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  start(
    serviceType: string,
    onFound: (station: DiscoveredStation) => void,
    onLost: (name: string) => void,
    onError: (message: string) => void,
  ): void {
    this.started += 1;
    if (this.startError) {
      throw this.startError;
    }
    this.serviceType = serviceType;
    this.onFound = onFound;
    this.onLost = onLost;
    this.onError = onError;
  }

  stop(): void {
    this.stopped += 1;
    this.onFound = null;
    this.onLost = null;
    this.onError = null;
  }
}

function reply(overrides: Partial<DiscoveredStation> = {}): DiscoveredStation {
  return {
    name: 'Railroad Station — Evening Ridge',
    host: 'railroad-station-evening-ridge.local.',
    port: 7500,
    txt: {address: 'rrn1qqqqqqqqqqqqqqqqqqqq', version: '0.1.0'},
    ...overrides,
  };
}

let fake: FakeDiscovery;

beforeEach(() => {
  jest.useFakeTimers();
  fake = new FakeDiscovery();
  registerStationDiscovery(() => fake);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DiscoverySession', () => {
  it('browses for the service type the station advertises', () => {
    new DiscoverySession().start();

    expect(fake.serviceType).toBe('_rrn-station._tcp');
  });

  it('starts idle and reports searching once started', () => {
    const session = new DiscoverySession();
    expect(session.getState().status).toBe('idle');

    session.start();

    expect(session.getState()).toEqual({
      status: 'searching',
      stations: [],
      error: null,
    });
  });

  it('surfaces a found station to subscribers', () => {
    const session = new DiscoverySession();
    const seen: DiscoveryState[] = [];
    session.subscribe(state => seen.push(state));
    session.start();

    fake.onFound?.(reply());

    expect(session.getState().status).toBe('found');
    expect(session.getState().stations).toEqual([
      {
        name: 'Railroad Station — Evening Ridge',
        host: 'railroad-station-evening-ridge.local.',
        port: 7500,
        origin: 'discovered',
        address: 'rrn1qqqqqqqqqqqqqqqqqqqq',
        version: '0.1.0',
      },
    ]);
    expect(seen[seen.length - 1]).toBe(session.getState());
  });

  it('sorts stations by name so the list does not jump around', () => {
    const session = new DiscoverySession();
    session.start();

    fake.onFound?.(reply({name: 'Zulu Yard'}));
    fake.onFound?.(reply({name: 'Alpha Junction'}));

    expect(session.getState().stations.map(s => s.name)).toEqual([
      'Alpha Junction',
      'Zulu Yard',
    ]);
  });

  it('replaces a station re-announced under the same name', () => {
    const session = new DiscoverySession();
    session.start();

    fake.onFound?.(reply({port: 7500}));
    fake.onFound?.(reply({port: 7600}));

    expect(session.getState().stations).toHaveLength(1);
    expect(session.getState().stations[0].port).toBe(7600);
  });

  it('removes a lost station', () => {
    const session = new DiscoverySession();
    session.start();
    fake.onFound?.(reply({name: 'Alpha Junction'}));
    fake.onFound?.(reply({name: 'Zulu Yard'}));

    fake.onLost?.('Alpha Junction');

    expect(session.getState().stations.map(s => s.name)).toEqual(['Zulu Yard']);
    expect(session.getState().status).toBe('found');
  });

  it('ignores a lost station it never found', () => {
    const session = new DiscoverySession();
    session.start();
    fake.onFound?.(reply({name: 'Zulu Yard'}));

    fake.onLost?.('Never Seen');

    expect(session.getState().stations.map(s => s.name)).toEqual(['Zulu Yard']);
  });

  it('returns to searching, not empty, when the last station goes away', () => {
    const session = new DiscoverySession();
    session.start();
    fake.onFound?.(reply());

    fake.onLost?.(reply().name);

    // The browse is still live and the station may come back; a spinner is a
    // truer story than "nothing found" to someone who just saw one.
    expect(session.getState().status).toBe('searching');
    expect(session.getState().stations).toEqual([]);
  });

  describe('empty', () => {
    it('reports empty after the grace period with nothing found', () => {
      const session = new DiscoverySession();
      session.start();

      expect(session.getState().status).toBe('searching');
      jest.advanceTimersByTime(EMPTY_AFTER_MS);

      expect(session.getState().status).toBe('empty');
    });

    it('does not report empty once a station has been found', () => {
      const session = new DiscoverySession();
      session.start();
      fake.onFound?.(reply());

      jest.advanceTimersByTime(EMPTY_AFTER_MS);

      expect(session.getState().status).toBe('found');
    });

    it('does not override an error with empty', () => {
      const session = new DiscoverySession();
      session.start();
      fake.onError?.('browse failed');

      jest.advanceTimersByTime(EMPTY_AFTER_MS);

      expect(session.getState().status).toBe('error');
    });

    it('does not fire after stop', () => {
      const session = new DiscoverySession();
      session.start();
      session.stop();

      jest.advanceTimersByTime(EMPTY_AFTER_MS);

      expect(session.getState().status).toBe('idle');
    });
  });

  describe('validation', () => {
    it.each([
      ['no address', reply({txt: {version: '0.1.0'}})],
      ['no version', reply({txt: {address: 'rrn1qqq'}})],
      ['empty address', reply({txt: {address: '', version: '0.1.0'}})],
      ['empty host', reply({host: ''})],
      ['port zero', reply({port: 0})],
      ['port above 65535', reply({port: 70000})],
      ['fractional port', reply({port: 7500.5})],
    ])('ignores an advertisement with %s', (_label, malformed) => {
      const session = new DiscoverySession();
      session.start();

      fake.onFound?.(malformed);

      // Something on the LAN is squatting our service type. It is not ours, so
      // it is not a station — and not an error worth showing anyone.
      expect(session.getState().stations).toEqual([]);
      expect(session.getState().status).toBe('searching');
      expect(session.getState().error).toBeNull();
    });
  });

  describe('errors', () => {
    it('reports a native error', () => {
      const session = new DiscoverySession();
      session.start();

      fake.onError?.('the mDNS daemon is not running');

      expect(session.getState().status).toBe('error');
      expect(session.getState().error).toBe('the mDNS daemon is not running');
    });

    it('reports a start that throws rather than propagating', () => {
      fake.startError = new Error('no network route');
      const session = new DiscoverySession();

      expect(() => session.start()).not.toThrow();
      expect(session.getState().status).toBe('error');
      expect(session.getState().error).toBe('no network route');
    });

    it('keeps stations already found when a later error arrives', () => {
      const session = new DiscoverySession();
      session.start();
      fake.onFound?.(reply());

      fake.onError?.('browsing stopped');

      expect(session.getState().stations).toHaveLength(1);
      expect(session.getState().status).toBe('error');
    });
  });

  describe('lifecycle', () => {
    it('stops the native browser', () => {
      const session = new DiscoverySession();
      session.start();

      session.stop();

      expect(fake.stopped).toBe(1);
      expect(session.getState().status).toBe('idle');
    });

    it('tolerates stop being called twice', () => {
      const session = new DiscoverySession();
      session.start();

      session.stop();

      expect(() => session.stop()).not.toThrow();
    });

    it('clears stale stations when restarted', () => {
      const session = new DiscoverySession();
      session.start();
      fake.onFound?.(reply());

      session.start();

      expect(session.getState().stations).toEqual([]);
      expect(session.getState().status).toBe('searching');
    });

    it('stops notifying an unsubscribed listener', () => {
      const session = new DiscoverySession();
      const seen: DiscoveryState[] = [];
      const unsubscribe = session.subscribe(state => seen.push(state));
      session.start();
      const count = seen.length;

      unsubscribe();
      fake.onFound?.(reply());

      expect(seen).toHaveLength(count);
    });

    it('throws a useful error when nothing is registered', () => {
      registerStationDiscovery(
        null as unknown as () => StationDiscovery,
      );

      expect(() => new DiscoverySession()).toThrow(/not registered/);
    });
  });
});

describe('parseManualStation', () => {
  it('accepts a hostname and port', () => {
    const result = parseManualStation('station.local', '7500');

    expect(result).toEqual({
      ok: true,
      station: {
        name: 'station.local',
        host: 'station.local',
        port: 7500,
        origin: 'manual',
      },
    });
  });

  it('carries no claims, because a typed station makes none', () => {
    const result = parseManualStation('station.local', '7500');

    // Pairing treats this identically to a discovered station: the TXT claims
    // were never trusted, so having none costs nothing.
    expect(result).toEqual({
      ok: true,
      station: expect.not.objectContaining({address: expect.anything()}),
    });
  });

  it.each([
    ['a trailing-dot .local name', 'evening-ridge.local.'],
    ['a bare IPv4 address', '192.168.1.134'],
    ['a plain hostname', 'station'],
  ])('accepts %s', (_label, host) => {
    expect(parseManualStation(host, '7500').ok).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const result = parseManualStation('  station.local  ', ' 7500 ');

    expect(result).toEqual({
      ok: true,
      station: expect.objectContaining({host: 'station.local', port: 7500}),
    });
  });

  it.each([
    ['empty', '', 'host-empty'],
    ['only whitespace', '   ', 'host-empty'],
    ['a URL', 'http://station.local', 'host-invalid'],
    ['an embedded port', 'station.local:7500', 'host-invalid'],
    ['a space inside', 'evening ridge', 'host-invalid'],
  ])('rejects a host that is %s', (_label, host, error) => {
    expect(parseManualStation(host, '7500')).toEqual({ok: false, error});
  });

  it.each([
    ['not a number', 'abc'],
    ['empty', ''],
    ['zero', '0'],
    ['above 65535', '70000'],
    ['fractional', '75.5'],
    ['negative', '-1'],
  ])('rejects a port that is %s', (_label, port) => {
    expect(parseManualStation('station.local', port)).toEqual({
      ok: false,
      error: 'port-invalid',
    });
  });

  it('defaults to the port the station listens on', () => {
    expect(DEFAULT_STATION_PORT).toBe(7500);
  });
});

describe('STATION_SERVICE_TYPE', () => {
  it('is a legal RFC 6763 service name', () => {
    // RFC 6763 §7 caps the name at 15 characters, and the station's responder
    // rejects an illegal one *asynchronously* — it logs that it is advertising
    // and then publishes nothing. The station has the mirror of this test.
    const name = STATION_SERVICE_TYPE.split('.')[0];

    expect(name.startsWith('_')).toBe(true);
    expect(name.length - 1).toBeLessThanOrEqual(15);
    expect(STATION_SERVICE_TYPE.endsWith('._tcp')).toBe(true);
  });
});
