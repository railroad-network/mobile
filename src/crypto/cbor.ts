/**
 * The canonical-value model for signed payloads (M1.1 T1.1.7).
 *
 * Anything mobile signs must produce the *same* canonical dCBOR bytes the
 * station would produce for the same logical value (ADR-0002) — that is what
 * makes a mobile signature verify on the station. The app does **not** carry a
 * CBOR encoder: it builds a small tagged value tree with the helpers here, and
 * {@link canonicalBytes} ships it to Rust, where the one dCBOR encoder turns it
 * into bytes. One canonicalization, in Rust, reached through the FFI.
 *
 * # The type model
 *
 * dCBOR is stricter than JSON, and JSON cannot express two things dCBOR needs:
 * **byte strings** (addresses, hashes and keys encode as CBOR byte strings) and
 * **exact 64-bit integers** (JSON numbers are doubles and lose precision past
 * 2^53). So a payload is a {@link CborValue} built from these constructors:
 *
 * - {@link text} — a UTF-8 text string (normalized to NFC by the encoder)
 * - {@link int} — an integer (`bigint` or a safe integer `number`); the full
 *   i64/u64 range is preserved
 * - {@link bytes} — a byte string
 * - {@link bool}, {@link nul} — boolean / null
 * - {@link list} — an array of values
 * - {@link map} — a map with text keys (the encoder sorts them canonically)
 *
 * # Floats
 *
 * Floats are forbidden in signed payloads (project policy; amounts are integer
 * centicommons). There is deliberately no float constructor, and {@link int}
 * rejects a non-integer `number` before it ever reaches the FFI — so a float is
 * caught at the TS encoder, not just by Rust erroring out.
 */
import {getRrnCryptoFfi} from './ffi';

/**
 * A value that can be canonically serialized. Opaque by design — build one with
 * the constructors below; do not hand-write the tagged shape.
 */
export type CborValue =
  | {text: string}
  | {int: string}
  | {bytes: string}
  | {bool: boolean}
  | {null: null}
  | {array: CborValue[]}
  | {map: Array<[string, CborValue]>};

/** Raised when a value cannot be encoded — currently, a non-integer number. */
export class PayloadError extends Error {}

const toHex = (input: Uint8Array): string =>
  Array.from(input)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

/** A UTF-8 text string. */
export function text(value: string): CborValue {
  return {text: value};
}

/**
 * An integer. Accepts a `bigint` (any i64/u64 value) or a `number` that must be
 * a safe integer — a non-integer `number` is a float and is rejected here, at
 * the encoder, per the no-floats rule.
 */
export function int(value: bigint | number): CborValue {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new PayloadError(
      `floats are forbidden in signed payloads: ${value} is not an integer`,
    );
  }
  return {int: (typeof value === 'bigint' ? value : BigInt(value)).toString()};
}

/** A byte string (e.g. an address, hash, or key). */
export function bytes(value: Uint8Array): CborValue {
  return {bytes: toHex(value)};
}

/** A boolean. */
export function bool(value: boolean): CborValue {
  return {bool: value};
}

/** The null value. */
export function nul(): CborValue {
  return {null: null};
}

/** An array of values. */
export function list(items: CborValue[]): CborValue {
  return {array: items};
}

/** A map with text keys. The encoder emits the keys in canonical order. */
export function map(entries: Array<[string, CborValue]>): CborValue {
  return {map: entries};
}

/**
 * Serializes a {@link CborValue} to canonical dCBOR bytes via the Rust core.
 * Throws a payload error (from the FFI) if a node is malformed or contains a
 * float. The bytes match the station's byte-for-byte.
 */
export function canonicalBytes(value: CborValue): Uint8Array {
  return getRrnCryptoFfi().canonicalBytes(JSON.stringify(value));
}
