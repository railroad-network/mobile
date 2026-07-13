/**
 * Encoding for a social-recovery shard as it travels between phones (T1.2.3).
 *
 * A shard payload is raw bytes (canonical CBOR of the sealed shard plus routing
 * metadata — produced by the Rust FFI's `RecoveryPackage.shardPayload`). A QR
 * code carries a string, so the distributing wallet base64-encodes the bytes
 * behind a short scheme prefix; the holder's wallet recognizes the prefix and
 * decodes back to the bytes it feeds to `parseShardPayload` / stores.
 *
 * The prefix disambiguates a shard QR from a plain address QR (`rrn1…`) so a
 * scanner can reject the wrong kind of code instead of mis-parsing it.
 */
import {base64ToBytes, bytesToBase64} from '../crypto/base64';

/** URI-style scheme marking a QR string as a recovery shard payload. */
export const SHARD_QR_PREFIX = 'rrnrecovery:';

/** Encodes shard payload bytes as the string to render in a QR code. */
export function encodeShardQr(payload: Uint8Array): string {
  return SHARD_QR_PREFIX + bytesToBase64(payload);
}

/**
 * Decodes a scanned QR string back to shard payload bytes, or returns `null`
 * if the string is not a recovery-shard QR (wrong prefix or corrupt base64).
 */
export function decodeShardQr(value: string): Uint8Array | null {
  if (!value.startsWith(SHARD_QR_PREFIX)) {
    return null;
  }
  try {
    return base64ToBytes(value.slice(SHARD_QR_PREFIX.length));
  } catch {
    return null;
  }
}
