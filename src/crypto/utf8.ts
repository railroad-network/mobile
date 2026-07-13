/**
 * Self-contained UTF-8 codec for text ↔ bytes.
 *
 * Like {@link ./base64}, this is hand-rolled rather than relying on
 * `TextEncoder`/`TextDecoder`, whose availability varies across JS engines
 * (Hermes vs. JSC vs. Node under Jest). A codec that round-trips arbitrary
 * strings — including non-BMP characters (emoji) — on every engine is one fewer
 * thing to trust. Used to persist small JSON blobs (e.g. the recovery config)
 * through {@link SecureStore}, which stores raw bytes.
 */
/* eslint-disable no-bitwise -- a UTF-8 codec is inherently bit manipulation */

/** Encodes a string as UTF-8 bytes. */
export function utf8ToBytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    // Combine a surrogate pair into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Decodes UTF-8 bytes to a string. Malformed sequences yield U+FFFD. */
export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    let code: number;
    let extra: number;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      continue;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      code = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      code = b0 & 0x07;
      extra = 3;
    } else {
      out += '�';
      continue;
    }
    for (let k = 0; k < extra; k++) {
      const bk = bytes[i];
      if (bk === undefined || (bk & 0xc0) !== 0x80) {
        code = -1;
        break;
      }
      code = (code << 6) | (bk & 0x3f);
      i++;
    }
    if (code < 0) {
      out += '�';
    } else if (code >= 0x10000) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}
