/**
 * @format
 */
import {base64ToBytes, bytesToBase64} from '../src/crypto/base64';

const KNOWN: Array<[number[], string]> = [
  [[], ''],
  [[0x66], 'Zg=='],
  [[0x66, 0x6f], 'Zm8='],
  [[0x66, 0x6f, 0x6f], 'Zm9v'],
  [[0x66, 0x6f, 0x6f, 0x62], 'Zm9vYg=='],
  [[0x66, 0x6f, 0x6f, 0x62, 0x61], 'Zm9vYmE='],
  [[0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], 'Zm9vYmFy'],
  [[0x00, 0x00, 0x00], 'AAAA'],
  [[0xff, 0xff, 0xff], '////'],
];

describe('base64', () => {
  test.each(KNOWN)('encodes %j to the known vector', (bytes, expected) => {
    expect(bytesToBase64(Uint8Array.from(bytes))).toBe(expected);
  });

  test.each(KNOWN)('decodes the known vector back to %j', (bytes, encoded) => {
    expect(Array.from(base64ToBytes(encoded))).toEqual(bytes);
  });

  test('round-trips every byte length up to 260 with all byte values', () => {
    for (let len = 0; len <= 260; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (i * 7 + 13) % 256;
      }
      const roundtripped = base64ToBytes(bytesToBase64(bytes));
      expect(Array.from(roundtripped)).toEqual(Array.from(bytes));
    }
  });

  test('rejects malformed input', () => {
    expect(() => base64ToBytes('Zg=')).toThrow(); // bad length
    expect(() => base64ToBytes('Zg@=')).toThrow(); // non-alphabet char
  });
});
