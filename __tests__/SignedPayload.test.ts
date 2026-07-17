/**
 * @format
 *
 * Signed-payload tests (T1.1.7), driven by the committed cross-platform fixture
 * the station's Rust generates
 * (rrn-ledger/tests/cross_platform_signed_payload.rs).
 *
 * Scope: canonicalization and Ed25519 live in Rust, which *is* the mobile
 * implementation (reached via the FFI). The native bindings cannot load under
 * Jest, so here we register an in-memory FFI backed by the Rust-generated
 * fixture — `canonicalBytes` returns the station's recorded bytes for each
 * proposal payload, and signing/verification are lookups over the station's
 * recorded (key, canonical-bytes, signature) triples, not a second crypto
 * implementation. We verify that `SignedPayload.ts` delegates correctly:
 *   - the payload the mobile app builds for a proposal canonicalizes to the
 *     station's exact bytes;
 *   - signing those bytes reproduces the station's signature (so a mobile
 *     signature verifies on the station and vice versa); and
 *   - a swapped signature or signer fails verification.
 * On-device execution of the real bindings is covered by the Rust test today.
 */
import {
  signPayload,
  verifyPayload,
  type SignedPayload,
} from '../src/crypto/SignedPayload';
import {bytes, int, map, nul, text, type CborValue} from '../src/crypto/cbor';
import {
  registerRrnCryptoFfi,
  type Keypair,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import fixtureData from './fixtures/cross_platform_signed_payload.json';

interface ProposalVector {
  seed: string;
  sender_pubkey: string;
  receiver_pubkey: string;
  amount_centi: string;
  memo: string | null;
  nonce: string;
  proposed_at: string;
  expires_at: string;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
}
interface Fixture {
  vectors: ProposalVector[];
}

const fixture = fixtureData as Fixture;

const hexToBytes = (hex: string): Uint8Array =>
  hex.length === 0
    ? new Uint8Array(0)
    : Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
const bytesToHex = (b: Uint8Array): string =>
  Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');

// The tagged payload the mobile app builds for a proposal — mirrors the station's
// `From<TransactionProposal> for CBOR` (byte-string sender/receiver, i64/u64
// integers, text-or-null memo).
const proposalPayload = (v: ProposalVector): CborValue =>
  map([
    ['kind', text('rrn.tx.proposal')],
    ['sender', bytes(hexToBytes(v.sender_pubkey))],
    ['receiver', bytes(hexToBytes(v.receiver_pubkey))],
    ['amount_centi', int(BigInt(v.amount_centi))],
    ['memo', v.memo === null ? nul() : text(v.memo)],
    ['nonce', int(BigInt(v.nonce))],
    ['proposed_at', int(BigInt(v.proposed_at))],
    ['expires_at', int(BigInt(v.expires_at))],
  ]);

// ---- In-memory FFI backed by the fixture. ----
// canonicalBytes: recorded payload (as JSON) -> canonical bytes.
const canonicalLookup = new Map<string, string>();
// signLookup: pubkey|canonicalHex -> signature; validTriples: what verifies.
const signLookup = new Map<string, string>();
const validTriples = new Set<string>();
for (const v of fixture.vectors) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  signLookup.set(`${v.sender_pubkey}|${v.canonical_hex}`, v.signature_hex);
  validTriples.add(`${v.sender_pubkey}|${v.canonical_hex}|${v.signature_hex}`);
}

class FakeSignature implements Signature {
  constructor(private readonly b: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.b;
  }
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('not exercised by SignedPayload tests');
  }
  verify(message: Uint8Array, signature: Signature): boolean {
    return validTriples.has(
      `${this.pubkeyHex}|${bytesToHex(message)}|${bytesToHex(
        signature.toBytes(),
      )}`,
    );
  }
  seal(): Uint8Array {
    throw new Error('seal not exercised by SignedPayload tests');
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
      throw new Error('fake FFI has no signature for this (key, canonical bytes)');
    }
    return new FakeSignature(hexToBytes(sig));
  }
  open(): Uint8Array {
    throw new Error('open not exercised by SignedPayload tests');
  }
}

const unused = (): never => {
  throw new Error('not exercised by SignedPayload tests');
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
  Signature: {fromBytes: (data: Uint8Array) => new FakeSignature(data)},
  Hash: {of: unused},
  PublicKey: {
    fromBytes: (data: Uint8Array) => new FakePublicKey(bytesToHex(data)),
    fromAddress: unused,
  },
  isValidAddress: unused,
  canonicalBytes: (json: string) => {
    const hex = canonicalLookup.get(json);
    if (hex === undefined) {
      throw new Error('fake FFI has no canonical bytes for this payload');
    }
    return hexToBytes(hex);
  },
  WalletContents: {createNew: unused},
  EncryptedWallet: {encrypt: unused, fromBytes: unused},
};

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('SignedPayload', () => {
  test('the fixture has the expected shape', () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(20);
  });

  test('the mobile proposal payload canonicalizes to the station bytes', () => {
    for (const v of fixture.vectors) {
      const bytes_ = fakeFfi.canonicalBytes(JSON.stringify(proposalPayload(v)));
      expect(bytesToHex(bytes_)).toBe(v.canonical_hex);
    }
  });

  test('signPayload reproduces the station signature and verifies', async () => {
    for (const v of fixture.vectors) {
      const kp = new FakeKeypair(v.sender_pubkey);
      const signed = await signPayload(proposalPayload(v), kp);
      expect(bytesToHex(signed.signer.toBytes())).toBe(v.sender_pubkey);
      // Deterministic Ed25519: the mobile signature equals the station's — the
      // exact bytes the Rust test verified station-side.
      expect(bytesToHex(signed.signature.toBytes())).toBe(v.signature_hex);
      await expect(verifyPayload(signed)).resolves.toBe(true);
    }
  });

  test('a swapped signature fails verification', async () => {
    const v0 = fixture.vectors[0];
    const v1 = fixture.vectors[1];
    const tampered: SignedPayload<CborValue> = {
      payload: proposalPayload(v0),
      signer: new FakePublicKey(v0.sender_pubkey),
      signature: new FakeSignature(hexToBytes(v1.signature_hex)),
    };
    await expect(verifyPayload(tampered)).resolves.toBe(false);
  });

  test('the wrong signer fails verification', async () => {
    const v0 = fixture.vectors[0];
    const v1 = fixture.vectors[1];
    const wrongSigner: SignedPayload<CborValue> = {
      payload: proposalPayload(v0),
      signer: new FakePublicKey(v1.sender_pubkey),
      signature: new FakeSignature(hexToBytes(v0.signature_hex)),
    };
    await expect(verifyPayload(wrongSigner)).resolves.toBe(false);
  });
});
