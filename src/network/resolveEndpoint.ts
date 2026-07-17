/**
 * Resolving *where* to reach a paired station (T1.3.4) — the carrier-agnostic
 * seam beneath {@link StationClient}.
 *
 * ADR-0008's sealed envelope is the security boundary, and it is indifferent to
 * the network it crosses: the same signed, sealed request is valid over LAN,
 * cellular, or a future relay. The only thing that changes between those is the
 * *address* to POST to. This module isolates that decision so the client never
 * hardcodes a LAN IP.
 *
 * **Today** an endpoint is the last-known host/port hint stored at pairing (a
 * LAN address, or a bare DHCP IP on Android). **Later** a relay resolver can
 * return a rendezvous address for a station that is not on this network —
 * without any change to how requests are built, signed, sealed, or verified.
 * The relay itself (a federated network of them, so no single point of failure)
 * is a separate milestone; this seam is the only forward-looking part of T1.3.4.
 */
import {getPairedStation, type PairedStation} from './pairedStation';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';

/** Where, and over what base URL, to reach a station right now. */
export interface StationEndpoint {
  /** The base URL to POST the sealed request to, e.g. `http://192.168.1.5:7500`. */
  baseUrl: string;
  /** The host this resolved to, for updating the reconnect hint after success. */
  host: string;
  /** The port this resolved to. */
  port: number;
}

/** Why an endpoint could not be resolved. */
export type ResolveError =
  /** This device is not paired with the requested station address. */
  | {error: 'not-paired'}
  /** Paired, but no reachable address is known (and, later, no relay). */
  | {error: 'no-endpoint'};

export type ResolveResult = StationEndpoint | ResolveError;

/**
 * Resolves the endpoint for the paired station at `address`.
 *
 * Today: the stored host/port hint from pairing. A paired station with no host
 * hint yields `no-endpoint` (nothing to dial yet — a relay resolver will fill
 * this gap). An unpaired address yields `not-paired`: the channel only talks to
 * stations this device has bonded with.
 */
export async function resolveEndpoint(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<ResolveResult> {
  const paired = await getPairedStation(address, store);
  if (paired === null) {
    return {error: 'not-paired'};
  }
  return endpointFor(paired);
}

/** Builds an endpoint from a paired station's stored host hint. */
export function endpointFor(paired: PairedStation): ResolveResult {
  if (paired.host.length === 0 || paired.port <= 0) {
    return {error: 'no-endpoint'};
  }
  return {
    baseUrl: `http://${paired.host}:${paired.port}`,
    host: paired.host,
    port: paired.port,
  };
}

/** Whether a resolve result is an error. */
export function isResolveError(result: ResolveResult): result is ResolveError {
  return 'error' in result;
}
