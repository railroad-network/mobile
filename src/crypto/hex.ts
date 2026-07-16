/**
 * Lowercase hex codec for raw bytes.
 *
 * The mobile↔station pairing wire (T1.3.3) carries the request nonce and the
 * Ed25519 signatures as hex strings, matching the station's `core::hex` /
 * `core::unhex` — so this is the counterpart to {@link ./base64}, which the
 * keychain layer uses. Hand-rolled for the same reason base64 is: a codec that
 * round-trips arbitrary bytes identically on Hermes, JSC, and Node-under-Jest is
 * one fewer engine quirk to trust.
 *
 * The alphabet is lowercase `0-9a-f`; decoding also accepts uppercase so a
 * hand-pasted value is not rejected for its case alone.
 */

/** Encodes bytes as a lowercase hex string (two chars per byte, no separator). */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Decodes a hex string to bytes. Throws on an odd length or a non-hex
 * character — the wire fields have fixed lengths the caller checks separately,
 * so a malformed value here is a hard error, not something to paper over.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('invalid hex: odd length');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    // parseInt is far too lenient (it stops at the first bad char and ignores
    // whitespace/sign), so validate the pair itself rather than trusting NaN
    // alone to catch every malformation.
    if (!/^[0-9a-fA-F]{2}$/.test(hex.slice(i * 2, i * 2 + 2))) {
      throw new Error('invalid hex: non-hex character');
    }
    out[i] = byte;
  }
  return out;
}
