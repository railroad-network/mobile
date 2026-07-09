/**
 * @format
 *
 * Mobile address wrapper tests (T1.1.3), driven by the committed cross-platform
 * fixture that the station's Rust generates
 * (rrn-identity/tests/cross_platform_address.rs).
 *
 * Scope: the real bech32m correctness is proven on the Rust side, which *is* the
 * mobile implementation (reached via the uniffi FFI). The native bindings
 * cannot load under Jest, so here we register an in-memory FFI backed by the
 * Rust-generated fixture (a lookup over known-good vectors — not a second bech32
 * implementation) and verify that `address.ts` delegates correctly: success/
 * error shaping, the pubkey↔address round-trip glue, and that malformed strings
 * take the error branch. End-to-end execution of the real bindings on device is
 * covered once the RN wrapper is wired (and by the Rust test today).
 */
import {
  isValidAddress,
  parseAddress,
  publicKeyToAddress,
  type ParseError,
} from '../src/crypto/address';
import {
  registerRrnCryptoFfi,
  type PublicKey,
  type RrnCryptoFfi,
} from '../src/crypto/ffi';
import fixtureData from './fixtures/cross_platform_address.json';

interface Vector {
  seed: string;
  pubkey: string;
  address: string;
}
interface Fixture {
  hrp: string;
  vectors: Vector[];
  known_answer: Vector[];
  invalid_addresses: Array<{value: string; reason: string}>;
}

const fixture = fixtureData as Fixture;

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// In-memory FFI backed by the Rust-generated fixture: address -> pubkey bytes
// for every valid vector; everything else is unknown and rejected.
const validByAddress = new Map<string, Uint8Array>();
for (const v of [...fixture.vectors, ...fixture.known_answer]) {
  validByAddress.set(v.address, hexToBytes(v.pubkey));
}

class FakePublicKey implements PublicKey {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly address: string,
  ) {}
  toBytes(): Uint8Array {
    return this.bytes;
  }
  toAddress(): string {
    return this.address;
  }
  verify(): boolean {
    throw new Error('verify not exercised by address tests');
  }
}

const fakeFfi: RrnCryptoFfi = {
  Keypair: {generate: () => throwUnused()},
  Signature: {fromBytes: () => throwUnused()},
  Hash: {of: () => throwUnused()},
  PublicKey: {
    fromBytes: () => throwUnused(),
    fromAddress: (address: string): PublicKey => {
      const bytes = validByAddress.get(address);
      if (!bytes) {
        throw new Error('invalid address');
      }
      return new FakePublicKey(bytes, address);
    },
  },
  isValidAddress: (address: string): boolean => validByAddress.has(address),
  WalletContents: {createNew: () => throwUnused()},
  EncryptedWallet: {
    encrypt: () => throwUnused(),
    fromBytes: () => throwUnused(),
  },
};

function throwUnused(): never {
  throw new Error('not exercised by address tests');
}

const isError = (r: PublicKey | {error: ParseError}): r is {error: ParseError} =>
  'error' in r;

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('address', () => {
  test('the fixture has the expected shape', () => {
    expect(fixture.hrp).toBe('rrn');
    expect(fixture.vectors).toHaveLength(100);
    expect(fixture.known_answer.length).toBeGreaterThanOrEqual(2);
    expect(fixture.invalid_addresses.length).toBeGreaterThan(0);
  });

  test('every fixture address parses to its recorded public key', () => {
    for (const v of [...fixture.vectors, ...fixture.known_answer]) {
      const result = parseAddress(v.address);
      expect(isError(result)).toBe(false);
      expect(bytesToHex((result as PublicKey).toBytes())).toBe(v.pubkey);
    }
  });

  test('publicKeyToAddress(parseAddress(a)) round-trips back to a', () => {
    for (const v of [...fixture.vectors, ...fixture.known_answer]) {
      const pk = parseAddress(v.address) as PublicKey;
      expect(publicKeyToAddress(pk)).toBe(v.address);
    }
  });

  test('isValidAddress is true for every valid vector', () => {
    for (const v of fixture.vectors) {
      expect(isValidAddress(v.address)).toBe(true);
    }
  });

  test('the all-zero-seed known-answer address is the locked vector', () => {
    const zero = fixture.known_answer[0];
    expect(zero.seed).toBe('0'.repeat(64));
    expect(zero.address).toBe(
      'rrn18d4z00xwk6jz6c4r4rgz5mcdwdjny9thrh3y8f36cpy2rz6emg5scr4w0n',
    );
    // And it parses through the wrapper to the recorded key.
    const pk = parseAddress(zero.address) as PublicKey;
    expect(bytesToHex(pk.toBytes())).toBe(zero.pubkey);
  });

  test('malformed addresses return the error branch, not a throw', () => {
    for (const bad of fixture.invalid_addresses) {
      const result = parseAddress(bad.value);
      expect(isError(result)).toBe(true);
      expect((result as {error: ParseError}).error.kind).toBe('invalid-address');
      expect(isValidAddress(bad.value)).toBe(false);
    }
  });
});
