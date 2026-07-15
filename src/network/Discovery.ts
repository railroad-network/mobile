/**
 * The seam between the app's TypeScript and the platform's mDNS browser.
 *
 * The native module (`rrn-discovery`, a Nitro module wrapping `<dns_sd.h>` on
 * iOS and `NsdManager` on Android) is deliberately dumb: it emits found/lost
 * events and holds no state. All accumulation, validation and interpretation
 * happens here, because state in TypeScript is far easier to test than state in
 * Swift and Kotlin — and this file's logic is identical on both platforms,
 * which is exactly the part we do not want written twice.
 *
 * Nothing learned here is trusted. Anything on the LAN can publish this service
 * type with any TXT records it likes, so a {@link Station} is a *claim*, not a
 * proof — see ADR-0008. Pairing (T1.3.3) is what binds a station's static
 * public key, and it is the only security boundary in this flow.
 */

import type { DiscoveredStation, StationDiscovery } from 'rrn-discovery';

/**
 * The DNS-SD service type stations advertise.
 *
 * **Changing this string breaks every paired mobile**, and it is duplicated in
 * three places that must move together: here, `NSBonjourServices` in the iOS
 * `Info.plist`, and `SERVICE_TYPE` in the station's `mdns.rs`.
 *
 * Note the 11 characters before `._tcp`: RFC 6763 §7 caps a service name at 15,
 * which is why this is not `_railroad-station._tcp`. That name is illegal, and
 * its failure mode is silent — the responder rejects it asynchronously and
 * advertises nothing.
 */
export const STATION_SERVICE_TYPE = '_rrn-station._tcp';

/** How the app came to know about a station. */
export type StationOrigin =
  /** Found by mDNS; carries the claims from its TXT records. */
  | 'discovered'
  /** Typed in by hand, because mDNS found nothing. Carries no claims. */
  | 'manual';

/**
 * A station the app can try to pair with.
 *
 * The claims ({@link address}, {@link version}) are optional because a
 * hand-typed station has none — the user knows a host and a port, nothing more.
 * That costs nothing: the claims were never trusted anyway, so pairing (T1.3.3)
 * treats a discovered station and a manual one identically. All discovery buys
 * is not having to type an address in.
 */
export interface Station {
  /**
   * The DNS-SD instance name, e.g. `"Railroad Station — Evening Ridge"`; for a
   * manual station, the host the user typed. Display only.
   */
  name: string;
  /** The resolved `.local.` host — what the transport (T1.3.4) builds a URL from. */
  host: string;
  port: number;
  origin: StationOrigin;
  /**
   * The station's *claimed* bech32m `rrn1…` address, from its TXT records.
   * Unverified: pairing proves it, discovery cannot. Absent when `manual`.
   */
  address?: string;
  /** The station's claimed software version, from its TXT records. Absent when `manual`. */
  version?: string;
}

/**
 * What the UI needs to render, including the cases where nothing was found.
 *
 * `searching` and `empty` are separated because they need different UI, and
 * time is the only thing that tells them apart.
 */
export type DiscoveryStatus =
  | 'idle'
  | 'searching'
  /** Browsing, and at least one station has been found. */
  | 'found'
  /**
   * Browsing, but nothing has turned up for {@link EMPTY_AFTER_MS}.
   *
   * On iOS this is ambiguous and cannot be disambiguated: there is no API to
   * request local-network permission ahead of time and none to read its status,
   * so a denied prompt and an empty network are indistinguishable — both are
   * just silence. The UI must offer both readings (and a manual-add escape
   * hatch), rather than accusing the user of denying a prompt they may never
   * have seen.
   */
  | 'empty'
  /** The browse itself failed to start; {@link DiscoveryState.error} says why. */
  | 'error';

export interface DiscoveryState {
  status: DiscoveryStatus;
  /** Found stations, sorted by name for a stable list. */
  stations: Station[];
  error: string | null;
}

/**
 * How long to browse with no results before reporting `empty`.
 *
 * The station's responder was measured answering Apple's `dns-sd` in ~2.7s on a
 * real network, against a <5s acceptance target. 5s therefore reports "nothing
 * here" only well after a healthy station would have answered, while still
 * being short enough that a user staring at a spinner gets an answer.
 */
export const EMPTY_AFTER_MS = 5_000;

export type DiscoveryListener = (state: DiscoveryState) => void;

let factory: (() => StationDiscovery) | null = null;

/**
 * Registers how to construct the native browser. Called once at app startup
 * with `createStationDiscovery` from `rrn-discovery`, and in tests with a fake.
 *
 * The indirection exists because the native module cannot load under Jest
 * (Node), and because it lets tests drive found/lost events by hand.
 */
export function registerStationDiscovery(create: () => StationDiscovery): void {
  factory = create;
}

/**
 * A single browse, accumulating what it finds.
 *
 * Construct one per Discovery screen mount and {@link stop} it on unmount: on
 * iOS a live browse holds a socket and keeps the radio busy, and there is no
 * reason to keep listening for stations nobody is looking at.
 */
export class DiscoverySession {
  private readonly native: StationDiscovery;
  private readonly listeners = new Set<DiscoveryListener>();
  /** Keyed by instance name — that is all `onLost` gives us to match on. */
  private readonly found = new Map<string, Station>();
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;
  private state: DiscoveryState = {
    status: 'idle',
    stations: [],
    error: null,
  };

  constructor() {
    if (factory === null) {
      throw new Error(
        'station discovery not registered — call registerStationDiscovery() ' +
          "with rrn-discovery's createStationDiscovery at startup (or a fake " +
          'in tests)',
      );
    }
    this.native = factory();
  }

  getState(): DiscoveryState {
    return this.state;
  }

  /** Subscribes to state changes. Returns an unsubscribe function. */
  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts browsing. On iOS this is what triggers the permission prompt. */
  start(): void {
    this.found.clear();
    this.setState({ status: 'searching', stations: [], error: null });

    this.emptyTimer = setTimeout(() => {
      this.emptyTimer = null;
      if (this.state.status === 'searching') {
        this.setState({ status: 'empty' });
      }
    }, EMPTY_AFTER_MS);

    try {
      this.native.start(
        STATION_SERVICE_TYPE,
        station => this.onFound(station),
        name => this.onLost(name),
        message => this.onError(message),
      );
    } catch (error) {
      this.onError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Stops browsing and releases native resources. Safe to call twice. */
  stop(): void {
    this.clearEmptyTimer();
    try {
      this.native.stop();
    } catch {
      // Nothing useful to tell the user: they are leaving the screen, and the
      // session is being discarded either way.
    }
    this.setState({ status: 'idle' });
  }

  private onFound(discovered: DiscoveredStation): void {
    const station = validate(discovered);
    if (station === null) {
      // Something on the LAN is advertising our service type without the TXT
      // records a station must publish. Not an error to show the user — it is
      // not ours, so it simply is not a station.
      return;
    }

    this.clearEmptyTimer();
    this.found.set(station.name, station);
    this.setState({ status: 'found', stations: this.sorted(), error: null });
  }

  private onLost(name: string): void {
    if (!this.found.delete(name)) {
      return;
    }
    const stations = this.sorted();
    // Losing the last station drops back to `searching`, not `empty`: the
    // browse is still live and the station may well come back. The empty timer
    // is deliberately not restarted — the user has seen a station here, so a
    // spinner is a truer story than "nothing found".
    this.setState({
      status: stations.length > 0 ? 'found' : 'searching',
      stations,
    });
  }

  private onError(message: string): void {
    this.clearEmptyTimer();
    this.setState({ status: 'error', error: message });
  }

  private sorted(): Station[] {
    return [...this.found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimer !== null) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = null;
    }
  }

  private setState(next: Partial<DiscoveryState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

/**
 * Turns an untrusted native reply into a {@link Station}, or `null` if it is
 * not shaped like one.
 *
 * This rejects malformed advertisements; it does not authenticate them. A
 * well-formed lie passes, by design — see ADR-0008.
 */
function validate(station: DiscoveredStation): Station | null {
  const address = station.txt.address;
  const version = station.txt.version;

  if (typeof address !== 'string' || address.length === 0) {
    return null;
  }
  if (typeof version !== 'string' || version.length === 0) {
    return null;
  }
  if (station.host.length === 0) {
    return null;
  }
  // A port is a positive 16-bit integer. Nitro types this as a `double`, so
  // guard the range rather than trusting the type.
  if (
    !Number.isInteger(station.port) ||
    station.port <= 0 ||
    station.port > 65535
  ) {
    return null;
  }

  return {
    name: station.name,
    host: station.host,
    port: station.port,
    origin: 'discovered',
    address,
    version,
  };
}

/** The station port to prefill a manual entry with — the station's default. */
export const DEFAULT_STATION_PORT = 7500;

/** Why a hand-typed station was rejected. */
export type ManualEntryError =
  | 'host-empty'
  | 'host-invalid'
  | 'port-invalid';

export type ManualEntryResult =
  | {ok: true; station: Station}
  | {ok: false; error: ManualEntryError};

/**
 * Parses a hand-typed host and port into a {@link Station}.
 *
 * Lives here rather than in the screen so the rules are testable without a
 * renderer. This only rejects input that cannot be a host — it does not check
 * that anything answers there. The user finds that out at pairing, which is the
 * only step that can actually prove a station is real.
 */
export function parseManualStation(
  hostInput: string,
  portInput: string,
): ManualEntryResult {
  const host = hostInput.trim();
  if (host.length === 0) {
    return {ok: false, error: 'host-empty'};
  }
  // Hostnames, `.local.` names and bare IPv4 all fit this; a URL, a scheme, an
  // embedded port or a space does not. Deliberately permissive — a typo that
  // gets this far simply fails to connect, which is a clearer error than a
  // regex quibbling about a hostname the user can see is fine.
  if (!/^[A-Za-z0-9._-]+$/.test(host)) {
    return {ok: false, error: 'host-invalid'};
  }

  const port = Number(portInput.trim());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return {ok: false, error: 'port-invalid'};
  }

  return {
    ok: true,
    station: {name: host, host, port, origin: 'manual'},
  };
}
