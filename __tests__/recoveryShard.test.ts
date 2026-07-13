/**
 * @format
 *
 * The shard-QR codec must round-trip arbitrary payload bytes and cleanly reject
 * strings that aren't recovery-shard QRs (so a scanner can tell a shard from a
 * plain address QR).
 */
import {
  SHARD_QR_PREFIX,
  decodeShardQr,
  encodeShardQr,
} from '../src/wallet/recoveryShard';

describe('recovery shard QR codec', () => {
  const payload = Uint8Array.from([0, 1, 2, 250, 251, 252, 128, 64, 255]);

  test('encodes behind the scheme prefix', () => {
    expect(encodeShardQr(payload).startsWith(SHARD_QR_PREFIX)).toBe(true);
  });

  test('round-trips payload bytes', () => {
    const decoded = decodeShardQr(encodeShardQr(payload));
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!)).toEqual(Array.from(payload));
  });

  test('rejects a plain address QR (wrong prefix)', () => {
    expect(decodeShardQr('rrn1qexampleaddress')).toBeNull();
  });

  test('rejects a corrupt payload', () => {
    expect(decodeShardQr(SHARD_QR_PREFIX + 'not valid base64 %%%')).toBeNull();
  });
});
