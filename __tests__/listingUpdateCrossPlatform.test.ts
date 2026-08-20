/**
 * @format
 *
 * Cross-platform listing-update vectors (T1.7.2 Phase B), driven by the committed
 * fixture the station's Rust generates (`rrn-station/tests/cross_platform_listing_update.rs`).
 *
 * The load-bearing claim: an edit built and signed on the phone produces the
 * **same** canonical dCBOR and Ed25519 signature as the station's typed
 * `SignedPayload<ListingUpdated>`. The mobile builds the update's canonical form
 * in TypeScript ({@link createSignedListingUpdate}), so the risk is that
 * tagged-value tree drifting from the Rust encoder — and, specifically, the patch
 * rules the create path never exercises: an unchanged field is **omitted** (not
 * `null`), and `expires_at` is absent / `null` / an integer for unchanged / clear
 * / set. An in-memory FFI backed by the fixture lets the encoder run, and we
 * assert it emits the exact bytes and signature the station recorded.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {
  createSignedListingUpdate,
  type ListingAvailabilityStatus,
  type ListingPatch,
  type ListingPricingModel,
} from '../src/wallet/listing';
import type {Wallet} from '../src/wallet/Wallet';
import fixtureData from './fixtures/cross_platform_listing_update.json';

interface PricingJson {
  amount_centi: string;
  model: string;
  negotiable: boolean;
}
interface AvailabilityJson {
  status: string;
  capacity: string | null;
  next_slot: string | null;
}
interface Vector {
  provider_seed: string;
  provider_pubkey: string;
  provider_address: string;
  listing_id: string;
  patch_pricing: PricingJson | null;
  patch_description: string | null;
  patch_availability: AvailabilityJson | null;
  patch_expires: string; // 'unchanged' | 'clear' | decimal seconds
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
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
// sign: canonical bytes -> signature. (An update is not content-addressed, so
// Hash.of is never called here.)
const canonicalLookup = new Map<string, string>(); // payload JSON -> canonical hex
const signLookup = new Map<string, string>(); // canonical hex -> signature hex
for (const v of fixture.vectors) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  signLookup.set(v.canonical_hex, v.signature_hex);
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('not exercised by listing-update cross-platform tests');
  }
  verify(): boolean {
    throw new Error('not exercised by listing-update cross-platform tests');
  }
  seal(): Uint8Array {
    throw new Error('not exercised by listing-update cross-platform tests');
  }
}
class FakeSignature implements Signature {
  constructor(private readonly bytes: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.bytes;
  }
}

const unused = (): never => {
  throw new Error('not exercised by listing-update cross-platform tests');
};

const fakeFfi: RrnCryptoFfi = {
  Keypair: {generate: unused},
  PublicKey: {fromBytes: unused, fromAddress: unused},
  Signature: {fromBytes: (d: Uint8Array) => new FakeSignature(d)},
  Hash: {of: unused as unknown as (data: Uint8Array) => Hash},
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
  parseRecoveryRequest: unused,
  respondToRecovery: unused,
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

function patchFrom(v: Vector): ListingPatch {
  return {
    pricing:
      v.patch_pricing === null
        ? undefined
        : {
            amountCenti: Number(v.patch_pricing.amount_centi),
            model: v.patch_pricing.model as ListingPricingModel,
            negotiable: v.patch_pricing.negotiable,
          },
    description: v.patch_description === null ? undefined : v.patch_description,
    availability:
      v.patch_availability === null
        ? undefined
        : {
            status: v.patch_availability.status as ListingAvailabilityStatus,
            capacity:
              v.patch_availability.capacity === null
                ? null
                : Number(v.patch_availability.capacity),
            nextSlot:
              v.patch_availability.next_slot === null
                ? null
                : Number(v.patch_availability.next_slot),
          },
    expires:
      v.patch_expires === 'unchanged'
        ? 'unchanged'
        : v.patch_expires === 'clear'
          ? 'clear'
          : Number(v.patch_expires),
  };
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('listing update cross-platform', () => {
  test('the fixture spans the patch shapes and edges', () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(5);
    // A price-only edit, an availability edit, a set expiry, and a cleared expiry
    // are the shapes most likely to drift (omit-when-unset + the trichotomy).
    expect(fixture.vectors.some(v => v.patch_pricing !== null)).toBe(true);
    expect(fixture.vectors.some(v => v.patch_availability !== null)).toBe(true);
    expect(fixture.vectors.some(v => v.patch_expires === 'clear')).toBe(true);
    expect(
      fixture.vectors.some(
        v => v.patch_expires !== 'clear' && v.patch_expires !== 'unchanged',
      ),
    ).toBe(true);
  });

  test('createSignedListingUpdate reproduces the station canonical bytes and signature', async () => {
    for (const v of fixture.vectors) {
      const signed = await createSignedListingUpdate(
        fakeWallet(v.provider_address, v.provider_pubkey),
        v.listing_id,
        patchFrom(v),
      );

      expect(bytesToHex(signed.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(signed.signature)).toBe(v.signature_hex);
      expect(signed.listingId).toBe(v.listing_id);
    }
  });
});
