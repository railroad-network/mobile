/**
 * @format
 *
 * Signed governance ballots (T1.9.8). The real canonicalization + signing live
 * in Rust (via the FFI); here an in-memory FFI stands in — enough to capture the
 * tagged CBOR model the builder ships to Rust and hand back a signature. We
 * assert {@link createSignedCosign} and {@link createSignedVote} build the
 * station-matching records (the `rrn.gov.proposal_cosign` / `rrn.gov.vote` kinds,
 * the proposal id and signer as byte strings, the choice as a text string, the
 * timestamps as ints) and sign them.
 *
 * The field shapes here mirror the station's `From<ProposalCosign> for CBOR` and
 * `From<Vote> for CBOR` (rrn-governance) exactly; the shared canonicalization
 * machinery those bytes ride is proven byte-for-byte against Rust elsewhere
 * (`vouchCrossPlatform.test.ts` / `cross_platform_*`).
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {createSignedCosign, createSignedVote} from '../src/wallet/governance';
import type {Wallet} from '../src/wallet/Wallet';

let lastPayloadJson: string | null = null;

const enc = (s: string): Uint8Array =>
  Uint8Array.from(Array.from(s).map(c => c.charCodeAt(0)));
const hex = (b: Uint8Array): string =>
  Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');

class FakePublicKey implements PublicKey {
  constructor(private readonly addr: string) {}
  toBytes(): Uint8Array {
    return enc(this.addr);
  }
  toAddress(): string {
    return this.addr;
  }
  verify(): boolean {
    return true;
  }
  seal(): Uint8Array {
    throw new Error('seal not exercised by governance tests');
  }
}
class FakeHash implements Hash {
  constructor(private readonly data: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.data;
  }
  toHex(): string {
    return hex(this.data);
  }
}
class FakeSignature implements Signature {
  constructor(private readonly data: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.data;
  }
}

const unused = () => {
  throw new Error('not used in this test');
};

const fakeFfi: RrnCryptoFfi = {
  Keypair: {generate: unused},
  PublicKey: {fromBytes: unused, fromAddress: unused},
  Signature: {fromBytes: (d: Uint8Array) => new FakeSignature(d)},
  Hash: {of: (data: Uint8Array) => new FakeHash(data.slice(0, 4))},
  isValidAddress: (a: string) => a.startsWith('rrn1'),
  canonicalBytes: (json: string) => {
    lastPayloadJson = json;
    return enc(json);
  },
  WalletContents: {createNew: unused},
  EncryptedWallet: {encrypt: unused, fromBytes: unused},
  RecoveryPackage: {create: unused},
  parseShardPayload: unused,
  parseRecoveryRequest: unused,
  respondToRecovery: unused,
};

function fakeWallet(address: string): Wallet {
  return {
    address,
    publicKey: () => new FakePublicKey(address),
    sign: async (msg: Uint8Array) =>
      new FakeSignature(Uint8Array.from([...msg.slice(0, 2), 0xaa])),
  } as unknown as Wallet;
}

/** Reads the captured tagged-CBOR map back into `{key: value}` for assertions. */
function capturedEntries(): Record<string, unknown> {
  const model = JSON.parse(lastPayloadJson ?? '{}') as {map: [string, unknown][]};
  return Object.fromEntries(model.map);
}

/** A 32-byte proposal id as the station's read surface returns it (hex). */
const PROPOSAL_ID = 'aa'.repeat(32);

beforeAll(() => registerRrnCryptoFfi(fakeFfi));
beforeEach(() => {
  lastPayloadJson = null;
});

describe('createSignedCosign', () => {
  test('builds a station-matching co-signature and signs it', async () => {
    const c = await createSignedCosign(
      fakeWallet('rrn1cosigner'),
      PROPOSAL_ID,
      1_752_000_000,
    );

    expect(c.proposalId).toBe(PROPOSAL_ID);
    expect(c.cosignerAddress).toBe('rrn1cosigner');
    expect(c.cosignedAt).toBe(1_752_000_000);
    expect(c.signature.length).toBeGreaterThan(0);
    expect(c.payloadBytes.length).toBeGreaterThan(0);

    const e = capturedEntries();
    expect(e.kind).toEqual({text: 'rrn.gov.proposal_cosign'});
    // The proposal id encodes as a 32-byte CBOR byte string.
    expect(e.proposal_id).toEqual({bytes: PROPOSAL_ID});
    // The co-signer is the wallet's own key, as a CBOR byte string.
    expect(e.cosigner).toHaveProperty('bytes');
    expect(e.cosigned_at).toEqual({int: '1752000000'});
  });
});

describe('createSignedVote', () => {
  test.each(['yes', 'no', 'abstain'] as const)(
    'builds a station-matching %s vote and signs it',
    async choice => {
      const v = await createSignedVote(
        fakeWallet('rrn1voter'),
        PROPOSAL_ID,
        choice,
        1_752_000_500,
      );

      expect(v.proposalId).toBe(PROPOSAL_ID);
      expect(v.voterAddress).toBe('rrn1voter');
      expect(v.choice).toBe(choice);
      expect(v.castAt).toBe(1_752_000_500);
      expect(v.signature.length).toBeGreaterThan(0);

      const e = capturedEntries();
      expect(e.kind).toEqual({text: 'rrn.gov.vote'});
      expect(e.proposal_id).toEqual({bytes: PROPOSAL_ID});
      expect(e.voter).toHaveProperty('bytes');
      // The choice is a text string yes/no/abstain, matching VoteChoice.
      expect(e.choice).toEqual({text: choice});
      expect(e.cast_at).toEqual({int: '1752000500'});
    },
  );
});
