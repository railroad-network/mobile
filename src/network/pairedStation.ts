/**
 * Which stations this device has paired with (T1.3.3).
 *
 * A pairing must outlast both processes (the M1.3 exit criterion), so the record
 * is persisted here, mirroring the station, which persists its paired mobiles.
 * What is stored is deliberately minimal and follows ADR-0008: the station's
 * bech32 **identity address is the durable key** — there is no certificate to
 * pin — and the host is only a *hint* for reconnecting. That split matters
 * because a station's address is stable while its host is not: Android learns a
 * station as a bare DHCP-assigned IP, which changes on lease renewal, so the
 * transport (T1.3.4) re-discovers a paired station by matching its address when
 * the stored host stops answering.
 *
 * The record carries no key material — the address is public and there is no
 * shared secret in this design — so it is stored as plain JSON through
 * {@link SecureStore} (the app's one persistence backend) without a biometric
 * gate, exactly like the device {@link wallet/profile}. Keyed by address so
 * re-pairing the same station updates rather than duplicates.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** A station this device trusts, established by an in-person pairing. */
export interface PairedStation {
  /** The station's bech32m `rrn1…` identity address — the durable key. */
  address: string;
  /** Last-known host the station answered on. A reconnect hint, not identity. */
  host: string;
  /** The port the station answered on. */
  port: number;
  /** Unix seconds when this device confirmed the pair. */
  pairedAt: number;
  /**
   * A human label captured at pairing (the discovered instance name, or the
   * host for a manual station). Purely cosmetic — it makes the paired list
   * recognisable when the station is offline and no longer announcing — and
   * deliberately *not* identity: only {@link address} is trusted, so this is
   * never matched on. Optional because it carries no security weight.
   */
  name?: string;
}

/**
 * Loads the paired stations, or `[]` if none (or the stored blob is
 * unreadable — a corrupt record should not wedge the app; the user can pair
 * again). Sorted by address for a stable list.
 */
export async function loadPairedStations(
  store: SecureStore = getSecureStore(),
): Promise<PairedStation[]> {
  const bytes = await store.load(SecureStoreKeys.PAIRED_STATIONS);
  if (bytes === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(bytesToUtf8(bytes)) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isPairedStation).sort((a, b) => a.address.localeCompare(b.address));
  } catch {
    return [];
  }
}

/** The paired station with `address`, or `null` if this device isn't paired to it. */
export async function getPairedStation(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<PairedStation | null> {
  const stations = await loadPairedStations(store);
  return stations.find(s => s.address === address) ?? null;
}

/** Whether this device is paired with the station at `address`. */
export async function isPaired(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<boolean> {
  return (await getPairedStation(address, store)) !== null;
}

/**
 * Records `station` as paired, replacing any prior record for the same address
 * (a re-pair, or a host that has since moved). The caller persists only after
 * the user has compared the confirmation code — this is the "remember it" step.
 */
export async function addPairedStation(
  station: PairedStation,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const others = (await loadPairedStations(store)).filter(
    s => s.address !== station.address,
  );
  await persist([...others, station], store);
}

/**
 * Updates just the host/port hint for an already-paired station, e.g. after
 * re-discovering it at a new DHCP address. A no-op if the station isn't paired
 * (there is nothing to re-point). Returns whether it updated anything.
 */
export async function updatePairedStationHost(
  address: string,
  host: string,
  port: number,
  store: SecureStore = getSecureStore(),
): Promise<boolean> {
  const stations = await loadPairedStations(store);
  const existing = stations.find(s => s.address === address);
  if (existing === undefined) {
    return false;
  }
  await persist(
    stations.map(s => (s.address === address ? {...s, host, port} : s)),
    store,
  );
  return true;
}

/**
 * Forgets the station at `address` (the mobile's side of unpairing — the
 * operator revokes independently on the station). Returns whether it was paired.
 */
export async function removePairedStation(
  address: string,
  store: SecureStore = getSecureStore(),
): Promise<boolean> {
  const stations = await loadPairedStations(store);
  const remaining = stations.filter(s => s.address !== address);
  if (remaining.length === stations.length) {
    return false;
  }
  await persist(remaining, store);
  return true;
}

async function persist(
  stations: PairedStation[],
  store: SecureStore,
): Promise<void> {
  await store.save(
    SecureStoreKeys.PAIRED_STATIONS,
    utf8ToBytes(JSON.stringify(stations)),
    {requireBiometric: false},
  );
}

/** Whether an unknown value has the shape of a {@link PairedStation}. */
function isPairedStation(value: unknown): value is PairedStation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.address === 'string' &&
    typeof v.host === 'string' &&
    typeof v.port === 'number' &&
    typeof v.pairedAt === 'number' &&
    (v.name === undefined || typeof v.name === 'string')
  );
}
