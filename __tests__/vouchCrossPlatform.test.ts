/**
 * @format
 *
 * Cross-platform vouch vectors (T1.4.3), driven by the committed fixture the
 * station's Rust generates (`rrn-station/tests/cross_platform_vouch.rs`).
 *
 * The load-bearing claim: a vouch built and signed on the phone produces the
 * **same** canonical dCBOR and Ed25519 signature as the station's typed
 * `SignedVouch`. The mobile builds the attestation's canonical form in
 * TypeScript (`wallet/vouch.ts`), so the risk is that tagged-value tree drifting
 * from the Rust encoder. Here an in-memory FFI backed by the fixture (a lookup
 * over Rust-generated vectors — not a second dCBOR/Ed25519 implementation) lets
 * {@link createSignedVouch} run, and we assert it emits the exact canonical
 * bytes, signature, and `vouchId` the station recorded.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {createSignedVouch} from '../src/wallet/vouch';
import type {Wallet} from '../src/wallet/Wallet';
import fixtureData from './fixtures/cross_platform_vouch.json';

interface Vector {
  voucher_seed: string;
  voucher_pubkey: string;
  voucher_address: string;
  subject_pubkey: string;
  subject_address: string;
  community: string;
  statement: string;
  reputation_stake_centi: string;
  issued_at: string;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
  vouch_id: string;
}
interface Fixture {
  vectors: Vector[];
}

const fixture = fixtureData as unknown as Fixture;

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// --- Fixture-backed FFI -----------------------------------------------------
// canonicalBytes: recorded payload tree (as JSON) -> canonical bytes.
// Hash.of: canonical bytes -> vouch_id. sign: canonical bytes -> signature.
const canonicalLookup = new Map<string, string>(); // payload JSON -> canonical hex
const vouchIdLookup = new Map<string, string>(); // canonical hex -> vouch_id
const signLookup = new Map<string, string>(); // canonical hex -> signature hex
const pubkeyByAddress = new Map<string, string>(); // subject address -> pubkey hex
for (const v of fixture.vectors) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  vouchIdLookup.set(v.canonical_hex, v.vouch_id);
  signLookup.set(v.canonical_hex, v.signature_hex);
  pubkeyByAddress.set(v.subject_address, v.subject_pubkey);
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('not exercised by vouch cross-platform tests');
  }
  verify(): boolean {
    throw new Error('not exercised by vouch cross-platform tests');
  }
  seal(): Uint8Array {
    throw new Error('not exercised by vouch cross-platform tests');
  }
}
class FakeHash implements Hash {
  constructor(private readonly hexValue: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.hexValue);
  }
  toHex(): string {
    return this.hexValue;
  }
}
class FakeSignature implements Signature {
  constructor(private readonly bytes: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.bytes;
  }
}

const unused = (): never => {
  throw new Error('not exercised by vouch cross-platform tests');
};

const fakeFfi: RrnCryptoFfi = {
  Keypair: {generate: unused},
  PublicKey: {
    fromBytes: unused,
    fromAddress: (address: string): PublicKey => {
      const pubkey = pubkeyByAddress.get(address);
      if (pubkey === undefined) {
        throw new Error('unknown subject address');
      }
      return new FakePublicKey(pubkey);
    },
  },
  Signature: {fromBytes: (d: Uint8Array) => new FakeSignature(d)},
  Hash: {
    of: (data: Uint8Array): Hash => {
      const id = vouchIdLookup.get(bytesToHex(data));
      if (id === undefined) {
        throw new Error('fake FFI has no vouch_id for these canonical bytes');
      }
      return new FakeHash(id);
    },
  },
  isValidAddress: unused,
  canonicalBytes: (json: string): Uint8Array => {
    const hex = canonicalLookup.get(json);
    if (hex === undefined) {
      throw new Error('fake FFI has no canonical bytes for this payload tree');
    }
    return hexToBytes(hex);
  },
  WalletContents: {createNew: unused},
  EncryptedWallet: {encrypt: unused, fromBytes: unused},
  RecoveryPackage: {create: unused},
  parseShardPayload: unused,
};

function fakeWallet(address: string): Wallet {
  return {
    address,
    publicKey: () => {
      throw new Error('voucher pubkey is not part of the vouch payload');
    },
    sign: async (msg: Uint8Array): Promise<Signature> => {
      const sig = signLookup.get(bytesToHex(msg));
      if (sig === undefined) {
        throw new Error('fake FFI has no signature for these canonical bytes');
      }
      return new FakeSignature(hexToBytes(sig));
    },
  } as unknown as Wallet;
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('vouch cross-platform', () => {
  test('the fixture has the expected shape', () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(6);
  });

  test('createSignedVouch reproduces the station canonical bytes, signature, and id', async () => {
    for (const v of fixture.vectors) {
      const vouch = await createSignedVouch(
        fakeWallet(v.voucher_address),
        v.subject_address,
        v.community,
        v.statement,
        BigInt(v.reputation_stake_centi),
        Number(v.issued_at),
      );

      expect(bytesToHex(vouch.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(vouch.signature)).toBe(v.signature_hex);
      expect(vouch.vouchId).toBe(v.vouch_id);
      expect(vouch.voucherAddress).toBe(v.voucher_address);
      expect(vouch.subjectAddress).toBe(v.subject_address);
    }
  });
});
