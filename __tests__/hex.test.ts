/**
 * @format
 *
 * Hex codec tests (T1.3.3 support). The pairing wire encodes the request nonce
 * and signatures as hex, so this must round-trip arbitrary bytes and reject
 * malformed input rather than silently truncating it.
 */
import {bytesToHex, hexToBytes} from '../src/crypto/hex';

describe('bytesToHex', () => {
  it('encodes bytes as lowercase, two chars each', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xff, 0xa0]))).toBe('000fffa0');
  });

  it('encodes the empty array as the empty string', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });
});

describe('hexToBytes', () => {
  it('decodes lowercase hex', () => {
    expect(Array.from(hexToBytes('000fffa0'))).toEqual([0x00, 0x0f, 0xff, 0xa0]);
  });

  it('accepts uppercase', () => {
    expect(Array.from(hexToBytes('FF00AB'))).toEqual([0xff, 0x00, 0xab]);
  });

  it('decodes the empty string to no bytes', () => {
    expect(hexToBytes('')).toHaveLength(0);
  });

  it('rejects an odd length', () => {
    expect(() => hexToBytes('abc')).toThrow(/odd length/);
  });

  it('rejects non-hex characters', () => {
    expect(() => hexToBytes('zz')).toThrow(/non-hex/);
    // A leading sign or whitespace would fool a bare parseInt — reject both.
    expect(() => hexToBytes('-1')).toThrow(/non-hex/);
    expect(() => hexToBytes(' a')).toThrow(/non-hex/);
  });
});

describe('round trip', () => {
  it('preserves 32 arbitrary bytes (a pairing token)', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 37 + 11) % 256;
    }
    expect(Array.from(hexToBytes(bytesToHex(bytes)))).toEqual(Array.from(bytes));
  });
});
