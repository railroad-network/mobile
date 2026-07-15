import type { HybridObject } from 'react-native-nitro-modules';

/**
 * A station seen on the local network.
 *
 * Every field here is **untrusted**. Anything on the LAN can publish this
 * service type and put whatever it likes in the TXT records, so `txt.address`
 * is a *claim*, not a proof. A discovered station is nothing more than a
 * `(host, port, claimed address)` tuple until pairing (T1.3.3) binds its static
 * public key out-of-band. See ADR-0008 — discovery is not a security boundary.
 */
export interface DiscoveredStation {
  /**
   * The DNS-SD instance name, e.g. `"Railroad Station — Evening Ridge"`.
   *
   * Also the identity used by {@linkcode StationDiscovery.start}'s `onLost`,
   * since that is all the platform reports on removal.
   */
  name: string;
  /**
   * The resolved host, e.g. `"railroad-station-evening-ridge.local."`.
   *
   * A `.local.` name rather than an IP: it survives the station's DHCP lease
   * changing, and iOS resolves it via Bonjour. This is the host the transport
   * (T1.3.4) builds its URL from.
   */
  host: string;
  /** The advertised port of the mobile↔station listener. */
  port: number;
  /**
   * The raw TXT records, as published. Parsed and validated in JS (the seam),
   * never trusted here — the station publishes `address` and `version`.
   */
  txt: Record<string, string>;
}

/**
 * Browses for Railroad Network stations over mDNS.
 *
 * Wraps the platform's Bonjour stack — `<dns_sd.h>` on iOS, `NsdManager` on
 * Android — rather than speaking mDNS ourselves. That is deliberate: doing our
 * own multicast on iOS would require Apple's restricted
 * `com.apple.developer.networking.multicast` entitlement (an application to
 * Apple), and it is only enforced on physical hardware, so the Simulator would
 * hide the failure. Leaning on the platform costs nothing, because nothing
 * learned here is trusted anyway.
 */
export interface StationDiscovery
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Starts browsing. Calling this while already browsing restarts the browse.
   *
   * On iOS the first call is what triggers the OS local-network permission
   * prompt — there is no API to request it ahead of time, nor to read its
   * status, so a browse that returns nothing is indistinguishable from a denied
   * permission. The seam handles that ambiguity.
   *
   * @param serviceType The DNS-SD type, e.g. `_rrn-station._tcp`. Must be
   * declared in `NSBonjourServices` on iOS or the browse returns nothing.
   * @param onFound Called once per station, after it resolves to a host/port.
   * @param onLost Called with the instance name when a station goes away.
   * @param onError Called with a human-readable message; browsing continues
   * where the platform allows it.
   */
  start(
    serviceType: string,
    onFound: (station: DiscoveredStation) => void,
    onLost: (name: string) => void,
    onError: (message: string) => void,
  ): void;

  /** Stops browsing and releases the platform resources. Safe to call twice. */
  stop(): void;
}
