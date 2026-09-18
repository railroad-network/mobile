/**
 * Wire format for a key-recovery ceremony (ADR-0016).
 *
 * When someone has lost the key to their identity, they run a recovery ceremony
 * on a device they control — a new phone, a laptop, or (for a station's own key)
 * the station: the recovering device mints an ephemeral recovery key and
 * publishes a *request* naming the identity to recover; each holder of a shard
 * turns their sealed piece into a raw Shamir share re-sealed to that ephemeral
 * key and hands back a *response*; the recovering device opens any `K` responses
 * and reconstructs the key. Reconstruction never happens on the station for a
 * *member's* key — it runs on the member's own device (ADR-0006).
 *
 * This module carries both halves of the exchange as QR strings: the *holder*
 * side reads a scanned request ({@link decodeRequestQr},
 * {@link parseRecoveryRequest}) and renders a response ({@link encodeResponseQr},
 * {@link Wallet.respondToRecovery}); the *recovering* side renders its request
 * ({@link encodeRequestQr}) and reads scanned responses ({@link decodeResponseQr},
 * fed to {@link wallet/recoveryRequester.RecoverySession}). The crypto lives in
 * Rust throughout.
 *
 * Two QR schemes carry the exchange, mirrored byte-for-byte on the station side
 * (`rrn-station::recovery`): a `rrnrecover-req:` request and a
 * `rrnrecover-resp:` response. Both wrap raw bytes as base64 behind a scheme
 * prefix — the same shape as the `rrnrecovery:` shard scheme
 * ({@link wallet/recoveryShard}) — so a scanner can reject the wrong kind of QR
 * instead of mis-parsing it. The raw Shamir share is never in the clear on this
 * path: it is sealed to the recovering device's ephemeral key inside the
 * response bytes.
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

/** Encodes request bytes as the `rrnrecover-req:<base64>` string to render as a
 * QR — the recovering device's half, shown for holders to scan. */
export function encodeRequestQr(request: Uint8Array): string {
  return REQUEST_QR_PREFIX + bytesToBase64(request);
}

/** Encodes response bytes as the `rrnrecover-resp:<base64>` string to render as a QR. */
export function encodeResponseQr(response: Uint8Array): string {
  return RESPONSE_QR_PREFIX + bytesToBase64(response);
}

/**
 * Decodes a scanned response QR string back to response bytes, or returns `null`
 * if the string is not a recovery-response QR (wrong prefix or corrupt base64) —
 * the recovering device's counterpart to {@link decodeRequestQr}.
 */
export function decodeResponseQr(value: string): Uint8Array | null {
  if (!value.startsWith(RESPONSE_QR_PREFIX)) {
    return null;
  }
  try {
    return base64ToBytes(value.slice(RESPONSE_QR_PREFIX.length));
  } catch {
    return null;
  }
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
