/**
 * Address QR payloads (T1.4.2).
 *
 * An address travels between phones as a QR code — shown on {@link Receive} to
 * be paid, and shown by a vouch subject so a voucher can scan them (M1.4). The
 * canonical, shipped form of that QR is the **bare bech32 address** (`rrn1…`):
 * {@link Receive} renders `address` directly and {@link Send} scans it verbatim.
 *
 * This module is the parse/encode seam for that payload. It additionally accepts
 * an optional URI envelope `rrn:address?addr=<bech32>&n=<nickname>` — documented
 * in `station/docs/spec/qr-payloads.md` and blessed for forward use (deep links,
 * a nickname hint) — but generation stays bare bech32 for now, so no already
 * shared QR breaks. The address itself is the identity; a `n=` nickname is only a
 * display hint and is never trusted for routing.
 *
 * Validation delegates to {@link isValidAddress} (the one Rust bech32m impl via
 * the FFI, per ADR-0003) — this module carries no address logic of its own.
 */
import {isValidAddress} from '../crypto/address';

/** A scanned address QR, decoded. */
export interface ScannedAddress {
  /** The bech32m `rrn1…` address (validated). */
  address: string;
  /** Optional display-only nickname carried by a URI-form QR. */
  nickname?: string;
}

/** URI scheme+path marking a QR string as an address envelope. */
const ADDRESS_URI_PREFIX = 'rrn:address?';

/** A nickname hint is a display string; keep it bounded (matches the T1.4.1 cap). */
const MAX_NICKNAME_LEN = 200;

/**
 * Decodes a scanned QR string to an {@link ScannedAddress}, or returns `null`
 * if it is not a valid address QR (invalid/absent address, or a QR of another
 * kind — a recovery shard, a pairing code, garbage). Never throws; mirrors
 * {@link decodeShardQr}.
 *
 * Accepts both the bare bech32 form (`rrn1…`) and the URI envelope
 * (`rrn:address?addr=…&n=…`). The `n=` nickname is url-decoded, trimmed,
 * length-clamped, and dropped when empty.
 */
export function parseAddressQr(scanned: string): ScannedAddress | null {
  const trimmed = scanned.trim();

  if (trimmed.startsWith(ADDRESS_URI_PREFIX)) {
    const query = trimmed.slice(ADDRESS_URI_PREFIX.length);
    const params = parseQuery(query);
    const addr = params.get('addr');
    if (addr === undefined || !isValidAddress(addr)) {
      return null;
    }
    const nickname = cleanNickname(params.get('n'));
    return nickname === undefined ? {address: addr} : {address: addr, nickname};
  }

  // Bare bech32 form: the whole string is the candidate address.
  return isValidAddress(trimmed) ? {address: trimmed} : null;
}

/**
 * Encodes an address as the string to render in a QR code. Returns the **bare
 * bech32 address**, keeping generation byte-identical to {@link Receive}. Thin by
 * design — present so callers need not special-case — and validated so a caller
 * cannot accidentally emit a non-address QR.
 */
export function encodeAddressQr(address: string): string {
  if (!isValidAddress(address)) {
    throw new Error('encodeAddressQr: not a valid address');
  }
  return address;
}

/**
 * Hand-parses a `key=value&key=value` query string. Deliberately avoids the JS
 * engine's `URL`/`URLSearchParams`, whose presence and behaviour vary across
 * Hermes/JSC/Node-under-Jest (same reasoning as the hand-rolled base64 codec).
 * Last value wins on a repeated key; malformed percent-escapes fall back to the
 * raw substring rather than throwing.
 */
function parseQuery(query: string): Map<string, string> {
  const out = new Map<string, string>();
  if (query.length === 0) {
    return out;
  }
  for (const pair of query.split('&')) {
    if (pair.length === 0) {
      continue;
    }
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1);
    out.set(decodeComponent(rawKey), decodeComponent(rawVal));
  }
  return out;
}

function decodeComponent(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function cleanNickname(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim().slice(0, MAX_NICKNAME_LEN);
  return trimmed.length === 0 ? undefined : trimmed;
}
