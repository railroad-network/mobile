/**
 * @format
 *
 * Cross-platform listing vectors (T1.7.2), driven by the committed fixture the
 * station's Rust generates (`rrn-station/tests/cross_platform_listing.rs`).
 *
 * The load-bearing claim: a listing built and signed on the phone produces the
 * **same** canonical dCBOR, Ed25519 signature, and content-addressed
 * `listing_id` as the station's typed `SignedPayload<Listing>`. The mobile builds
 * the listing's canonical form in TypeScript (`wallet/listing.ts`), so the risk
 * is that tagged-value tree drifting from the Rust encoder — and, specifically,
 * that a whole-number `f32` reputation floor reduces to the same integer bytes.
 * An in-memory FFI backed by the fixture (a lookup over Rust-generated vectors,
 * not a second dCBOR/Ed25519 implementation) lets {@link createSignedListing}
 * run, and we assert it emits the exact bytes, signature, and id the station
 * recorded.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {
  createSignedListing,
  type ListingAvailabilityStatus,
  type ListingDraft,
  type ListingPricingModel,
  type ListingSurface,
} from '../src/wallet/listing';
import type {Wallet} from '../src/wallet/Wallet';
import fixtureData from './fixtures/cross_platform_listing.json';

interface Vector {
  provider_seed: string;
  provider_pubkey: string;
  provider_address: string;
  community: string;
  surface: string;
  category: string;
  title: string;
  description: string;
  amount_centi: string;
  pricing_model: string;
  negotiable: boolean;
  availability_status: string;
  capacity: string | null;
  next_slot: string | null;
  min_reputation: number;
  community_member_only: boolean;
  oracle_tier: number;
  created_at: string;
  expires_at: string | null;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
  listing_id: string;
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
// Hash.of: canonical bytes -> listing_id. sign: canonical bytes -> signature.
const canonicalLookup = new Map<string, string>(); // payload JSON -> canonical hex
const listingIdLookup = new Map<string, string>(); // canonical hex -> listing_id
const signLookup = new Map<string, string>(); // canonical hex -> signature hex
for (const v of fixture.vectors) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  listingIdLookup.set(v.canonical_hex, v.listing_id);
  signLookup.set(v.canonical_hex, v.signature_hex);
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('not exercised by listing cross-platform tests');
  }
  verify(): boolean {
    throw new Error('not exercised by listing cross-platform tests');
  }
  seal(): Uint8Array {
    throw new Error('not exercised by listing cross-platform tests');
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
  throw new Error('not exercised by listing cross-platform tests');
};

const fakeFfi: RrnCryptoFfi = {
  Keypair: {generate: unused},
  PublicKey: {fromBytes: unused, fromAddress: unused},
  Signature: {fromBytes: (d: Uint8Array) => new FakeSignature(d)},
  Hash: {
    of: (data: Uint8Array): Hash => {
      const id = listingIdLookup.get(bytesToHex(data));
      if (id === undefined) {
        throw new Error('fake FFI has no listing_id for these canonical bytes');
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

function fakeWallet(address: string, pubkeyHex: string): Wallet {
  return {
    address,
    publicKey: () => new FakePublicKey(pubkeyHex),
    sign: async (msg: Uint8Array): Promise<Signature> => {
      const sig = signLookup.get(bytesToHex(msg));
      if (sig === undefined) {
        throw new Error('fake FFI has no signature for these canonical bytes');
      }
      return new FakeSignature(hexToBytes(sig));
    },
  } as unknown as Wallet;
}

function draftFrom(v: Vector): ListingDraft {
  return {
    surface: v.surface as ListingSurface,
    category: v.category,
    title: v.title,
    description: v.description,
    amountCenti: Number(v.amount_centi),
    pricingModel: v.pricing_model as ListingPricingModel,
    negotiable: v.negotiable,
    availabilityStatus: v.availability_status as ListingAvailabilityStatus,
    capacity: v.capacity === null ? null : Number(v.capacity),
    nextSlot: v.next_slot === null ? null : Number(v.next_slot),
    minReputation: v.min_reputation,
    communityMemberOnly: v.community_member_only,
    oracleTier: v.oracle_tier,
    expiresAt: v.expires_at === null ? null : Number(v.expires_at),
  };
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('listing cross-platform', () => {
  test('the fixture spans the surfaces and edges', () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(5);
    const surfaces = new Set(fixture.vectors.map(v => v.surface));
    expect(surfaces).toEqual(new Set(['goods', 'services', 'commons']));
    // A subsidy (negative Commons amount) and a whole-number reputation floor
    // are the two encodings most likely to drift.
    expect(fixture.vectors.some(v => Number(v.amount_centi) < 0)).toBe(true);
    expect(fixture.vectors.some(v => v.min_reputation > 0)).toBe(true);
  });

  test('createSignedListing reproduces the station canonical bytes, signature, and id', async () => {
    for (const v of fixture.vectors) {
      const signed = await createSignedListing(
        fakeWallet(v.provider_address, v.provider_pubkey),
        v.community,
        draftFrom(v),
        Number(v.created_at),
      );

      expect(bytesToHex(signed.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(signed.signature)).toBe(v.signature_hex);
      expect(signed.listingId).toBe(v.listing_id);
      expect(signed.providerAddress).toBe(v.provider_address);
    }
  });
});
