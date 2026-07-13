/**
 * @format
 *
 * Canonical-value model tests (T1.1.7), driven by the committed cross-platform
 * fixture the station's Rust generates
 * (rrn-mobile-ffi/tests/cross_platform_canonical.rs).
 *
 * Scope: the real dCBOR canonicalization lives in Rust, which *is* the mobile
 * implementation (reached via the uniffi `canonical_bytes` FFI). The native
 * bindings cannot load under Jest, so here we register an in-memory FFI backed
 * by the Rust-generated fixture — a lookup from each recorded tagged value to
 * the canonical bytes the station produced, not a second CBOR encoder — and
 * verify that `cbor.ts` delegates correctly:
 *   - the builder helpers emit exactly the tagged shape the Rust parser expects;
 *   - every recorded value canonicalizes to the station's bytes;
 *   - malformed nodes and floats are rejected (floats at the TS builder, before
 *     the FFI is even called).
 * On-device execution of the real parser is covered by the Rust test today.
 */
import {
  bool,
  bytes,
  canonicalBytes,
  int,
  list,
  map,
  nul,
  PayloadError,
  text,
  type CborValue,
} from '../src/crypto/cbor';
import {registerRrnCryptoFfi, type RrnCryptoFfi} from '../src/crypto/ffi';
import fixtureData from './fixtures/cross_platform_canonical.json';

interface Vector {
  name: string;
  payload: unknown;
  canonical_hex: string;
}
interface Invalid {
  name: string;
  payload: unknown;
  error: string;
}
interface Fixture {
  vectors: Vector[];
  invalid: Invalid[];
}

const fixture = fixtureData as Fixture;

const hexToBytes = (hex: string): Uint8Array =>
  hex.length === 0
    ? new Uint8Array(0)
    : Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
const bytesToHex = (bytes_: Uint8Array): string =>
  Array.from(bytes_)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const byName = (name: string): Vector => {
  const v = fixture.vectors.find(x => x.name === name);
  if (!v) {
    throw new Error(`fixture vector not found: ${name}`);
  }
  return v;
};

// In-memory FFI backed by the fixture: each recorded value (as canonicalized
// JSON) maps to its bytes; anything else — including every `invalid` vector —
// throws, standing in for the Rust parser's rejection.
class FfiPayloadError extends Error {}
const lookup = new Map<string, string>();
for (const v of fixture.vectors) {
  lookup.set(JSON.stringify(v.payload), v.canonical_hex);
}

const unused = (): never => {
  throw new Error('not exercised by cbor tests');
};
const fakeFfi: RrnCryptoFfi = {
  RecoveryPackage: {
    create: () => {
      throw new Error('recovery not exercised by these tests');
    },
  },
  parseShardPayload: () => {
    throw new Error('recovery not exercised by these tests');
  },
  Keypair: {generate: unused},
  Signature: {fromBytes: unused},
  Hash: {of: unused},
  PublicKey: {fromBytes: unused, fromAddress: unused},
  isValidAddress: unused,
  canonicalBytes: (json: string) => {
    const hex = lookup.get(json);
    if (hex === undefined) {
      throw new FfiPayloadError('malformed payload or float');
    }
    return hexToBytes(hex);
  },
  WalletContents: {createNew: unused},
  EncryptedWallet: {encrypt: unused, fromBytes: unused},
};

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('cbor value model', () => {
  test('the fixture has the expected shape', () => {
    expect(fixture.vectors.length).toBeGreaterThan(0);
    expect(fixture.invalid.length).toBeGreaterThan(0);
  });

  test('builder helpers emit the exact tagged shape', () => {
    expect(text('x')).toEqual({text: 'x'});
    expect(int(300n)).toEqual({int: '300'});
    expect(int(300)).toEqual({int: '300'});
    expect(int(-42n)).toEqual({int: '-42'});
    expect(int(18446744073709551615n)).toEqual({int: '18446744073709551615'});
    expect(bytes(Uint8Array.from([0x00, 0xff]))).toEqual({bytes: '00ff'});
    expect(bytes(new Uint8Array(0))).toEqual({bytes: ''});
    expect(bool(true)).toEqual({bool: true});
    expect(nul()).toEqual({null: null});
    expect(list([int(1n), text('a')])).toEqual({
      array: [{int: '1'}, {text: 'a'}],
    });
    expect(map([['k', int(2n)]])).toEqual({map: [['k', {int: '2'}]]});
  });

  test('int rejects a non-integer number at the builder (no float reaches the FFI)', () => {
    expect(() => int(2.5)).toThrow(PayloadError);
    expect(() => int(0.1)).toThrow(PayloadError);
    // Integer-valued numbers and bigints are fine.
    expect(() => int(2)).not.toThrow();
    expect(() => int(2n)).not.toThrow();
  });

  test('every fixture value canonicalizes to the station bytes', () => {
    for (const v of fixture.vectors) {
      const bytes_ = canonicalBytes(v.payload as CborValue);
      expect(bytesToHex(bytes_)).toBe(v.canonical_hex);
    }
  });

  test('builder-constructed values match the recorded canonical bytes', () => {
    // Rebuilding a handful of vectors with the helpers must produce the identical
    // tagged shape (else the fake lookup misses) and thus the recorded bytes —
    // proving the builders feed the Rust parser exactly what it expects.
    const cases: Array<[string, CborValue]> = [
      ['int-u64-max', int(18446744073709551615n)],
      ['int-negative', int(-42n)],
      [
        'bytes-32',
        bytes(
          hexToBytes(
            '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
          ),
        ),
      ],
      ['null', nul()],
      [
        'map-unsorted-keys',
        map([
          ['b', int(2n)],
          ['a', int(1n)],
          ['c', int(3n)],
        ]),
      ],
      [
        'map-nested-proposal-like',
        map([
          ['kind', text('rrn.demo')],
          [
            'who',
            bytes(
              hexToBytes(
                '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
              ),
            ),
          ],
          ['amount_centi', int(-1500n)],
          ['memo', nul()],
          ['tags', list([text('a'), text('b')])],
        ]),
      ],
    ];
    for (const [name, built] of cases) {
      expect(bytesToHex(canonicalBytes(built))).toBe(byName(name).canonical_hex);
    }
  });

  test('malformed and float payloads are rejected', () => {
    for (const bad of fixture.invalid) {
      expect(() => canonicalBytes(bad.payload as CborValue)).toThrow();
    }
  });
});
