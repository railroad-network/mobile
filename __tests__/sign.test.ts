/**
 * @format
 *
 * Mobile signing wrapper tests (T1.1.4), driven by the committed cross-platform
 * fixture that the station's Rust generates
 * (rrn-crypto/tests/cross_platform_sign.rs).
 *
 * Scope: the real Ed25519 correctness is proven on the Rust side, which *is* the
 * mobile implementation (reached via the uniffi FFI). The native bindings
 * cannot load under Jest, so here we register an in-memory FFI backed by the
 * Rust-generated fixture — a lookup over known-good (seed, message, signature)
 * vectors, not a second Ed25519 implementation — and verify that `sign.ts`
 * delegates correctly: sign returns the exact signature bytes the station
 * produced, verify accepts good triples and rejects tampered ones, and the
 * async surface resolves as expected. End-to-end execution of the real bindings
 * on device is covered once the RN wrapper is wired (and by the Rust test
 * today).
 */
import {generateKeypair, sign, verify} from '../src/crypto/sign';
import {
  registerRrnCryptoFfi,
  type Keypair,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import fixtureData from './fixtures/cross_platform_sign.json';

interface Vector {
  seed: string;
  pubkey: string;
  message: string;
  signature: string;
}
interface Fixture {
  vectors: Vector[];
  known_answer: Vector[];
  tampered: Array<{
    pubkey: string;
    message: string;
    signature: string;
    reason: string;
  }>;
}

const fixture = fixtureData as Fixture;
const allValid = [...fixture.vectors, ...fixture.known_answer];

const hexToBytes = (hex: string): Uint8Array =>
  hex.length === 0
    ? new Uint8Array(0)
    : Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// In-memory FFI backed by the Rust-generated fixture. Two lookup tables:
//   signLookup:  pubkey|message  -> the one deterministic signature
//   validTriples: pubkey|message|signature that the station proved verifies
const signLookup = new Map<string, string>();
const validTriples = new Set<string>();
for (const v of allValid) {
  signLookup.set(`${v.pubkey}|${v.message}`, v.signature);
  validTriples.add(`${v.pubkey}|${v.message}|${v.signature}`);
}

class FakeSignature implements Signature {
  constructor(private readonly bytes: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.bytes;
  }
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('toAddress not exercised by sign tests');
  }
  verify(message: Uint8Array, signature: Signature): boolean {
    const key = `${this.pubkeyHex}|${bytesToHex(message)}|${bytesToHex(
      signature.toBytes(),
    )}`;
    return validTriples.has(key);
  }
}

class FakeKeypair implements Keypair {
  constructor(private readonly pubkeyHex: string) {}
  publicKey(): PublicKey {
    return new FakePublicKey(this.pubkeyHex);
  }
  sign(message: Uint8Array): Signature {
    const sig = signLookup.get(`${this.pubkeyHex}|${bytesToHex(message)}`);
    if (sig === undefined) {
      // The fake can only sign messages the station pre-signed; the tests only
      // ever sign fixture messages.
      throw new Error('fake FFI has no signature for this (key, message)');
    }
    return new FakeSignature(hexToBytes(sig));
  }
}

const keypairForRow = (v: Vector): FakeKeypair => new FakeKeypair(v.pubkey);

const fakeFfi: RrnCryptoFfi = {
  // generate() hands back a keypair for a fixed fixture row so the generate →
  // sign → verify path is exercised without a real CSPRNG.
  Keypair: {generate: () => keypairForRow(fixture.vectors[0])},
  Signature: {fromBytes: (data: Uint8Array) => new FakeSignature(data)},
  Hash: {
    of: () => {
      throw new Error('not exercised by sign tests');
    },
  },
  PublicKey: {
    fromBytes: (data: Uint8Array) => new FakePublicKey(bytesToHex(data)),
    fromAddress: () => {
      throw new Error('not exercised by sign tests');
    },
  },
  isValidAddress: () => {
    throw new Error('not exercised by sign tests');
  },
};

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('sign', () => {
  test('the fixture has the expected shape', () => {
    expect(fixture.vectors).toHaveLength(100);
    expect(fixture.known_answer.length).toBeGreaterThanOrEqual(2);
    expect(fixture.tampered).toHaveLength(3);
  });

  test('sign produces the exact signature bytes the station produced', async () => {
    for (const v of allValid) {
      const kp = keypairForRow(v);
      const sig = await sign(kp, hexToBytes(v.message));
      expect(bytesToHex(sig.toBytes())).toBe(v.signature);
    }
  });

  test('sign then verify round-trips for every vector', async () => {
    for (const v of allValid) {
      const kp = keypairForRow(v);
      const message = hexToBytes(v.message);
      const sig = await sign(kp, message);
      await expect(verify(kp.publicKey(), message, sig)).resolves.toBe(true);
    }
  });

  test('the empty-message vector signs and verifies', async () => {
    // vectors[0] has a zero-length message — a real edge case worth pinning.
    const v = fixture.vectors[0];
    expect(v.message).toBe('');
    const kp = keypairForRow(v);
    const sig = await sign(kp, new Uint8Array(0));
    expect(bytesToHex(sig.toBytes())).toBe(v.signature);
    await expect(verify(kp.publicKey(), new Uint8Array(0), sig)).resolves.toBe(
      true,
    );
  });

  test('the all-zero-seed known-answer signature is locked', async () => {
    const zero = fixture.known_answer[0];
    expect(zero.seed).toBe('0'.repeat(64));
    const kp = keypairForRow(zero);
    const sig = await sign(kp, hexToBytes(zero.message));
    expect(bytesToHex(sig.toBytes())).toBe(zero.signature);
  });

  test('generateKeypair → sign → verify works through the FFI seam', async () => {
    const kp = generateKeypair();
    const message = hexToBytes(fixture.vectors[0].message);
    const sig = await sign(kp, message);
    await expect(verify(kp.publicKey(), message, sig)).resolves.toBe(true);
  });

  test('tampered triples from the fixture fail verification', async () => {
    for (const t of fixture.tampered) {
      const pk = fakeFfi.PublicKey.fromBytes(hexToBytes(t.pubkey));
      const sig = fakeFfi.Signature.fromBytes(hexToBytes(t.signature));
      await expect(verify(pk, hexToBytes(t.message), sig)).resolves.toBe(false);
    }
  });

  test('a locally bit-flipped signature fails verification', async () => {
    const v = fixture.vectors[1];
    const pk = fakeFfi.PublicKey.fromBytes(hexToBytes(v.pubkey));
    const bad = hexToBytes(v.signature);
    // eslint-disable-next-line no-bitwise -- flipping one bit to tamper the sig
    bad[bad.length - 1] ^= 0x01;
    await expect(
      verify(pk, hexToBytes(v.message), fakeFfi.Signature.fromBytes(bad)),
    ).resolves.toBe(false);
  });

  test('a valid signature over a different message fails verification', async () => {
    const v = fixture.vectors[2];
    const other = fixture.vectors[3];
    const pk = fakeFfi.PublicKey.fromBytes(hexToBytes(v.pubkey));
    const sig = fakeFfi.Signature.fromBytes(hexToBytes(v.signature));
    // v's signature does not cover other's message.
    await expect(verify(pk, hexToBytes(other.message), sig)).resolves.toBe(
      false,
    );
  });
});
