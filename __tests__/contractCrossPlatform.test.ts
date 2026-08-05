/**
 * @format
 *
 * Cross-platform service-contract vectors (T1.7.7 Stage 2), driven by the
 * committed fixture the station's Rust generates
 * (`rrn-station/tests/cross_platform_contract.rs`).
 *
 * The load-bearing claim: each contract record built and signed on the phone
 * produces the **same** canonical dCBOR and Ed25519 signature as the station's
 * typed `SignedPayload<T>` — and, for a contract, the same content-addressed
 * `contract_id`. The mobile builds the canonical forms in TypeScript
 * (`wallet/contract.ts`), so the risk is that tagged-value tree drifting from the
 * Rust encoder: the nested `frequency` map (incl. `custom` with `secs`), the
 * sorted `performance_metrics` map, and the foreign `provider` address the buyer
 * has to resolve to key bytes. A fixture-backed in-memory FFI (a lookup over
 * Rust-generated vectors, not a second dCBOR/Ed25519 implementation) lets the
 * builders run, and we assert they emit the exact bytes, signature, and id the
 * station recorded.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {
  createSignedContractTermination,
  createSignedServiceContract,
  type ContractTerminatedBy,
  type ContractTermsInput,
  type Frequency,
} from '../src/wallet/contract';
import type {Wallet} from '../src/wallet/Wallet';
import fixtureData from './fixtures/cross_platform_contract.json';

interface TermsVector {
  frequency: {unit: string; secs?: string};
  duration_periods: string;
  commons_per_period_centi: string;
  performance_metrics: Record<string, string>;
  notice_period_days: string;
  early_termination_penalty_centi: string;
}
interface ContractVector {
  buyer_seed: string;
  buyer_pubkey: string;
  buyer_address: string;
  provider_pubkey: string;
  provider_address: string;
  inquiry_id: string;
  listing_id: string;
  terms: TermsVector;
  started_at: string;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
  contract_id: string;
}
interface TerminationVector {
  signer_seed: string;
  signer_pubkey: string;
  signer_address: string;
  contract_id: string;
  terminated_by: string;
  requested_at: string;
  payload: unknown;
  canonical_hex: string;
  signature_hex: string;
}
interface Fixture {
  contracts: ContractVector[];
  terminations: TerminationVector[];
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
// Hash.of: canonical bytes -> contract_id (contracts only). sign: bytes -> sig.
// PublicKey.fromAddress: rrn1… address -> its key bytes (to encode `provider`).
const canonicalLookup = new Map<string, string>(); // payload JSON -> canonical hex
const contractIdLookup = new Map<string, string>(); // canonical hex -> contract_id
const signLookup = new Map<string, string>(); // canonical hex -> signature hex
const addressPubkey = new Map<string, string>(); // rrn1… address -> pubkey hex
for (const v of fixture.contracts) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  contractIdLookup.set(v.canonical_hex, v.contract_id);
  signLookup.set(v.canonical_hex, v.signature_hex);
  addressPubkey.set(v.buyer_address, v.buyer_pubkey);
  addressPubkey.set(v.provider_address, v.provider_pubkey);
}
for (const v of fixture.terminations) {
  canonicalLookup.set(JSON.stringify(v.payload), v.canonical_hex);
  signLookup.set(v.canonical_hex, v.signature_hex);
  addressPubkey.set(v.signer_address, v.signer_pubkey);
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('not exercised by contract cross-platform tests');
  }
  verify(): boolean {
    throw new Error('not exercised by contract cross-platform tests');
  }
  seal(): Uint8Array {
    throw new Error('not exercised by contract cross-platform tests');
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
  throw new Error('not exercised by contract cross-platform tests');
};

const fakeFfi: RrnCryptoFfi = {
  Keypair: {generate: unused},
  PublicKey: {
    fromBytes: unused,
    fromAddress: (address: string): PublicKey => {
      const pubkey = addressPubkey.get(address);
      if (pubkey === undefined) {
        throw new Error(`fake FFI has no key for address ${address}`);
      }
      return new FakePublicKey(pubkey);
    },
  },
  Signature: {fromBytes: (d: Uint8Array) => new FakeSignature(d)},
  Hash: {
    of: (data: Uint8Array): Hash => {
      const id = contractIdLookup.get(bytesToHex(data));
      if (id === undefined) {
        throw new Error('fake FFI has no contract_id for these canonical bytes');
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

function termsOf(v: TermsVector): ContractTermsInput {
  const frequency: Frequency =
    v.frequency.unit === 'custom'
      ? {unit: 'custom', secs: Number(v.frequency.secs)}
      : {unit: v.frequency.unit as 'daily' | 'weekly' | 'monthly'};
  return {
    frequency,
    durationPeriods: Number(v.duration_periods),
    commonsPerPeriodCenti: Number(v.commons_per_period_centi),
    performanceMetrics: v.performance_metrics,
    noticePeriodDays: Number(v.notice_period_days),
    earlyTerminationPenaltyCenti: Number(v.early_termination_penalty_centi),
  };
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('contract cross-platform', () => {
  test('the fixture spans the cadences, metrics, and termination sides', () => {
    // Weekly, monthly, and a custom-seconds cadence are the frequency encodings
    // most likely to drift; a with-metrics and a no-metrics contract cover the
    // sorted nested map; both termination sides cover the discriminant.
    const units = new Set(fixture.contracts.map(c => c.terms.frequency.unit));
    expect(units).toEqual(new Set(['weekly', 'monthly', 'custom']));
    expect(fixture.contracts.some(c => Object.keys(c.terms.performance_metrics).length === 0)).toBe(
      true,
    );
    expect(fixture.contracts.some(c => Object.keys(c.terms.performance_metrics).length >= 2)).toBe(
      true,
    );
    expect(new Set(fixture.terminations.map(t => t.terminated_by))).toEqual(
      new Set(['buyer', 'provider']),
    );
  });

  test('createSignedServiceContract reproduces the station bytes, signature, and id', async () => {
    for (const v of fixture.contracts) {
      const signed = await createSignedServiceContract(
        fakeWallet(v.buyer_address, v.buyer_pubkey),
        {
          inquiryId: v.inquiry_id,
          listingId: v.listing_id,
          providerAddress: v.provider_address,
          terms: termsOf(v.terms),
          startedAt: Number(v.started_at),
        },
      );
      expect(bytesToHex(signed.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(signed.signature)).toBe(v.signature_hex);
      expect(signed.contractId).toBe(v.contract_id);
      expect(signed.buyerAddress).toBe(v.buyer_address);
      expect(signed.providerAddress).toBe(v.provider_address);
    }
  });

  test('createSignedContractTermination reproduces the station bytes and signature', async () => {
    for (const v of fixture.terminations) {
      const signed = await createSignedContractTermination(
        fakeWallet(v.signer_address, v.signer_pubkey),
        v.contract_id,
        v.terminated_by as ContractTerminatedBy,
        Number(v.requested_at),
      );
      expect(bytesToHex(signed.payloadBytes)).toBe(v.canonical_hex);
      expect(bytesToHex(signed.signature)).toBe(v.signature_hex);
    }
  });
});
