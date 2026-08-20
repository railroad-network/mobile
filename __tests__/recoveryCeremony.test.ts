/**
 * @format
 *
 * The recovery-ceremony QR codecs must round-trip arbitrary bytes and cleanly
 * reject the wrong kind of QR (so a scanner can tell a recovery request from a
 * shard or plain address QR), and `parseRecoveryRequest` must delegate to the
 * registered FFI rather than decode the request itself.
 */
import {bytesToBase64} from '../src/crypto/base64';
import {registerRrnCryptoFfi, type RrnCryptoFfi} from '../src/crypto/ffi';
import {
  REQUEST_QR_PREFIX,
  RESPONSE_QR_PREFIX,
  decodeRequestQr,
  encodeResponseQr,
  parseRecoveryRequest,
} from '../src/wallet/recoveryCeremony';
import {SHARD_QR_PREFIX} from '../src/wallet/recoveryShard';

describe('recovery ceremony QR codecs', () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 128, 64, 255]);

  // The station emits a request as `rrnrecover-req:<base64>` (rrn-station's
  // recovery module); the phone only decodes it.
  const requestQr = REQUEST_QR_PREFIX + bytesToBase64(bytes);

  test('decodeRequestQr recovers the request bytes', () => {
    const decoded = decodeRequestQr(requestQr);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!)).toEqual(Array.from(bytes));
  });

  test('a response encodes behind its own scheme prefix', () => {
    expect(encodeResponseQr(bytes).startsWith(RESPONSE_QR_PREFIX)).toBe(true);
  });

  test('decodeRequestQr rejects a response QR (wrong prefix)', () => {
    expect(decodeRequestQr(encodeResponseQr(bytes))).toBeNull();
  });

  test('decodeRequestQr rejects a shard QR (wrong prefix)', () => {
    expect(decodeRequestQr(SHARD_QR_PREFIX + 'AAAA')).toBeNull();
  });

  test('decodeRequestQr rejects a plain address QR', () => {
    expect(decodeRequestQr('rrn1qexampleaddress')).toBeNull();
  });

  test('decodeRequestQr rejects a corrupt payload', () => {
    expect(decodeRequestQr(REQUEST_QR_PREFIX + 'not valid base64 %%%')).toBeNull();
  });

  test('parseRecoveryRequest delegates to the FFI', () => {
    const seen: Uint8Array[] = [];
    registerRrnCryptoFfi({
      parseRecoveryRequest: (request: Uint8Array) => {
        seen.push(request);
        return {targetAddress: 'rrn1target'};
      },
    } as unknown as RrnCryptoFfi);

    const info = parseRecoveryRequest(bytes);
    expect(info.targetAddress).toBe('rrn1target');
    expect(Array.from(seen[0])).toEqual(Array.from(bytes));
  });
});
