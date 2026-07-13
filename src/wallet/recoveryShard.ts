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
import {getRrnCryptoFfi, type ShardInfo} from '../crypto/ffi';

export type {ShardInfo};

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

/**
 * Reads the non-secret routing metadata off a shard payload (the bytes from
 * {@link decodeShardQr}), for a holder's receive flow. Delegates to the Rust
 * FFI — mobile does not decode the shard's CBOR itself — and does **not**
 * decrypt the sealed shard. Throws (recovery error) if the bytes are not a
 * valid payload. Keeps the FFI call in the wallet layer, like
 * {@link Wallet.createRecoveryPackage}.
 */
export function parseShardPayload(payload: Uint8Array): ShardInfo {
  return getRrnCryptoFfi().parseShardPayload(payload);
}
