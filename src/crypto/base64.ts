/**
 * Self-contained base64 codec for raw bytes.
 *
 * `react-native-keychain` stores strings, but the wallet secret is raw bytes,
 * so {@link SecureStore} base64-encodes at the boundary. We hand-roll this
 * rather than rely on `global.btoa`/`atob`, whose presence and binary-string
 * behaviour vary across JS engines (Hermes vs JSC vs Node under Jest) — a codec
 * that round-trips arbitrary bytes on every engine is one fewer thing to trust.
 *
 * Standard RFC 4648 alphabet with `=` padding.
 */
/* eslint-disable no-bitwise -- a byte codec is inherently bit manipulation */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Reverse map: char code -> 6-bit value, or -1 for non-alphabet characters.
const LOOKUP: Int8Array = (() => {
  const table = new Int8Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Encodes bytes as a base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      ALPHABET[n & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      '=';
  }
  return out;
}

/** Decodes a base64 string to bytes. Throws on malformed input. */
export function base64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/[\s]/g, '');
  if (s.length % 4 !== 0) {
    throw new Error('invalid base64: length is not a multiple of 4');
  }
  let pad = 0;
  if (s.length >= 1 && s[s.length - 1] === '=') pad++;
  if (s.length >= 2 && s[s.length - 2] === '=') pad++;

  const outLen = (s.length / 4) * 3 - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = LOOKUP[s.charCodeAt(i)];
    const b = LOOKUP[s.charCodeAt(i + 1)];
    const c = s[i + 2] === '=' ? 0 : LOOKUP[s.charCodeAt(i + 2)];
    const d = s[i + 3] === '=' ? 0 : LOOKUP[s.charCodeAt(i + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error('invalid base64: non-alphabet character');
    }
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < outLen) out[o++] = (n >> 16) & 0xff;
    if (o < outLen) out[o++] = (n >> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}
