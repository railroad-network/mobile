/**
 * Wire format for a station key-recovery ceremony (T1.11.3 slice D).
 *
 * When a station operator has lost their passphrase, they run a recovery
 * ceremony: the station mints an ephemeral recovery key and publishes a
 * *request* naming the identity to recover; each holder of a shard turns their
 * sealed piece into a raw Shamir share re-sealed to that ephemeral key and hands
 * back a *response*; the operator opens any `K` responses and reconstructs the
 * key. This module is the phone's half of the exchange — reading a scanned
 * request and encoding the response — and the crypto lives in Rust (reached via
 * {@link parseRecoveryRequest} and {@link Wallet.respondToRecovery}).
 *
 * Two QR schemes carry the exchange, mirrored byte-for-byte on the station side
 * (`rrn-station::recovery`): the phone scans a `rrnrecover-req:` request and
 * renders a `rrnrecover-resp:` response. Both wrap raw bytes as base64 behind a
 * scheme prefix — the same shape as the `rrnrecovery:` shard scheme
 * ({@link wallet/recoveryShard}) — so a scanner can reject the wrong kind of QR
 * instead of mis-parsing it. The raw Shamir share is never in the clear on this
 * path: it is sealed to the operator's ephemeral key inside the response bytes.
 */
import {base64ToBytes, bytesToBase64} from '../crypto/base64';
import {getRrnCryptoFfi, type RecoveryRequestInfo} from '../crypto/ffi';

export type {RecoveryRequestInfo};

/** URI-style scheme marking a QR string as a recovery *request* (station→phone). */
export const REQUEST_QR_PREFIX = 'rrnrecover-req:';

/** URI-style scheme marking a QR string as a recovery *response* (phone→station). */
export const RESPONSE_QR_PREFIX = 'rrnrecover-resp:';

/**
 * Decodes a scanned request QR string back to request bytes, or returns `null`
 * if the string is not a recovery-request QR (wrong prefix or corrupt base64).
 */
export function decodeRequestQr(value: string): Uint8Array | null {
  if (!value.startsWith(REQUEST_QR_PREFIX)) {
    return null;
  }
  try {
    return base64ToBytes(value.slice(REQUEST_QR_PREFIX.length));
  } catch {
    return null;
  }
}

/** Encodes response bytes as the `rrnrecover-resp:<base64>` string to render as a QR. */
export function encodeResponseQr(response: Uint8Array): string {
  return RESPONSE_QR_PREFIX + bytesToBase64(response);
}

/**
 * Reads which identity a recovery request targets (its `rrn1…` address), off
 * the request bytes from {@link decodeRequestQr}. Delegates to the Rust FFI —
 * mobile does not decode the request's CBOR itself. Throws (recovery error) if
 * the bytes are not a valid request.
 */
export function parseRecoveryRequest(request: Uint8Array): RecoveryRequestInfo {
  return getRrnCryptoFfi().parseRecoveryRequest(request);
}
