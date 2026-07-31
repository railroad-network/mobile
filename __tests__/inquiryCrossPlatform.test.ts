/**
 * @format
 *
 * Cross-platform inquiry vectors (T1.7.4), driven by the committed fixture the
 * station's Rust generates (`rrn-station/tests/cross_platform_inquiry.rs`).
 *
 * The load-bearing claim: each inquiry record built and signed on the phone
 * produces the **same** canonical dCBOR and Ed25519 signature as the station's
 * typed `SignedPayload<T>` — and, for an opening, the same content-addressed
 * `inquiry_id`. The mobile builds the canonical forms in TypeScript
 * (`wallet/inquiry.ts`), so the risk is that tagged-value tree drifting from the
 * Rust encoder: the int-or-null offer fields, a unicode message body, and the
 * nested `outcome` map (with the one price-carrying `agreed`). A fixture-backed
 * in-memory FFI (a lookup over Rust-generated vectors, not a second dCBOR/Ed25519
 * implementation) lets the builders run, and we assert they emit the exact bytes,
 * signature, and id the station recorded.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {
  createSignedInquiryClose,
  createSignedInquiryMessage,
  createSignedInquiryOpened,
  type InquiryCloseOutcome,
} from '../src/wallet/inquiry';
import type {Wallet} from '../src/wallet/Wallet';
import fixtureData from './fixtures/cross_platform_inquiry.json';

interface OpenedVector {
  buyer_seed: string;
  buyer_pubkey: string;
  buyer_address: string;
  listing_id: string;
  initial_message: string;
  initial_offer_centi: string | null;
  opened_at: string;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
  inquiry_id: string;
}
interface MessageVector {
  sender_seed: string;
  sender_pubkey: string;
  sender_address: string;
  inquiry_id: string;
  body: string;
  counter_offer_centi: string | null;
  sent_at: string;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
}
interface ClosedVector {
  signer_seed: string;
  signer_pubkey: string;
  signer_address: string;
  inquiry_id: string;
  outcome: string;
  final_price_centi: string | null;
  closed_at: string;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
}
interface Fixture {
  opened: OpenedVector[];
  messages: MessageVector[];
  closed: ClosedVector[];
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
// Hash.of: canonical bytes -> inquiry_id (openings only). sign: bytes -> sig.
const canonicalLookup = new Map<string, string>(); // payload JSON -> canonical hex
const inquiryIdLookup = new Map<string, string>(); // canonical hex -> inquiry_id
const signLookup = new Map<string, string>(); // canonical hex -> signature hex
for (const v of fixture.opened) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  inquiryIdLookup.set(v.canonical_hex, v.inquiry_id);
  signLookup.set(v.canonical_hex, v.signature_hex);
}
for (const v of [...fixture.messages, ...fixture.closed]) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  signLookup.set(v.canonical_hex, v.signature_hex);
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('not exercised by inquiry cross-platform tests');
  }
  verify(): boolean {
    throw new Error('not exercised by inquiry cross-platform tests');
  }
  seal(): Uint8Array {
    throw new Error('not exercised by inquiry cross-platform tests');
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
  constructor(private readonly sigBytes: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.sigBytes;
  }
}

const unused = (): never => {
  throw new Error('not exercised by inquiry cross-platform tests');
};

const fakeFfi: RrnCryptoFfi = {
  Keypair: {generate: unused},
  PublicKey: {fromBytes: unused, fromAddress: unused},
  Signature: {fromBytes: (d: Uint8Array) => new FakeSignature(d)},
  Hash: {
    of: (data: Uint8Array): Hash => {
      const id = inquiryIdLookup.get(bytesToHex(data));
      if (id === undefined) {
        throw new Error('fake FFI has no inquiry_id for these canonical bytes');
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

const num = (s: string | null): number | null => (s === null ? null : Number(s));

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('inquiry cross-platform', () => {
  test('the fixture spans the record kinds and edges', () => {
    expect(fixture.opened.length).toBeGreaterThanOrEqual(3);
    // A no-offer opening, a negative (subsidy-shaped) offer, and every close
    // outcome are the encodings most likely to drift.
    expect(fixture.opened.some(v => v.initial_offer_centi === null)).toBe(true);
    expect(fixture.opened.some(v => Number(v.initial_offer_centi) < 0)).toBe(true);
    expect(new Set(fixture.closed.map(v => v.outcome))).toEqual(
      new Set(['agreed', 'declined_by_buyer', 'declined_by_seller', 'expired']),
    );
  });

  test('createSignedInquiryOpened reproduces the station bytes, signature, and id', async () => {
    for (const v of fixture.opened) {
      const signed = await createSignedInquiryOpened(
        fakeWallet(v.buyer_address, v.buyer_pubkey),
        v.listing_id,
        v.initial_message,
        num(v.initial_offer_centi),
        Number(v.opened_at),
      );
      expect(bytesToHex(signed.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(signed.signature)).toBe(v.signature_hex);
      expect(signed.inquiryId).toBe(v.inquiry_id);
      expect(signed.buyerAddress).toBe(v.buyer_address);
    }
  });

  test('createSignedInquiryMessage reproduces the station bytes and signature', async () => {
    for (const v of fixture.messages) {
      const signed = await createSignedInquiryMessage(
        fakeWallet(v.sender_address, v.sender_pubkey),
        v.inquiry_id,
        v.body,
        num(v.counter_offer_centi),
        Number(v.sent_at),
      );
      expect(bytesToHex(signed.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(signed.signature)).toBe(v.signature_hex);
    }
  });

  test('createSignedInquiryClose reproduces the station bytes and signature', async () => {
    // Expired is the station's alone — the mobile never signs it — so only the
    // buyer/provider outcomes have a builder to exercise.
    for (const v of fixture.closed.filter(c => c.outcome !== 'expired')) {
      const outcome: InquiryCloseOutcome =
        v.outcome === 'agreed'
          ? {kind: 'agreed', finalPriceCenti: Number(v.final_price_centi)}
          : v.outcome === 'declined_by_buyer'
            ? {kind: 'declined_by_buyer'}
            : {kind: 'declined_by_seller'};
      const signed = await createSignedInquiryClose(
        fakeWallet(v.signer_address, v.signer_pubkey),
        v.inquiry_id,
        outcome,
        Number(v.closed_at),
      );
      expect(bytesToHex(signed.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(signed.signature)).toBe(v.signature_hex);
    }
  });
});
