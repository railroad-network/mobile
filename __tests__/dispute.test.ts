/**
 * @format
 *
 * Signed dispute records (T1.10.6, Slice A). The real canonicalization + signing
 * live in Rust (via the FFI); here an in-memory FFI stands in — enough to
 * capture the tagged CBOR model the builder ships to Rust and hand back a
 * signature. We assert {@link createSignedDispute}, {@link createSignedDisputeResponse}
 * and {@link createSignedVerdict} build the station-matching records (the
 * `rrn.tx.dispute` / `rrn.tx.dispute.response` / `rrn.dispute.verdict` kinds, the
 * transaction id and signer as byte strings, the free text as text strings, the
 * verdict as a `ruling` text field, the timestamps as ints) and sign them.
 *
 * The field shapes here mirror the station's `From<DisputeRecord> for CBOR` /
 * `From<DisputeResponse> for CBOR` (rrn-ledger `dispute.rs`) and
 * `From<JurorVerdict> for CBOR` (rrn-dispute `verdict.rs`) exactly; the shared
 * canonicalization machinery those bytes ride is proven byte-for-byte against
 * Rust elsewhere (`vouchCrossPlatform.test.ts` / `cross_platform_*`).
 *
 * Evidence is text-only in v1: the builders never emit `evidence_hash`, so the
 * captured maps must not carry that key.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {
  createSignedDispute,
  createSignedDisputeResponse,
  createSignedVerdict,
} from '../src/wallet/dispute';
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
    throw new Error('seal not exercised by dispute tests');
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

/** A 32-byte transaction id as the station's read surface returns it (hex). */
const TX_ID = 'aa'.repeat(32);

beforeAll(() => registerRrnCryptoFfi(fakeFfi));
beforeEach(() => {
  lastPayloadJson = null;
});

describe('createSignedDispute', () => {
  test('builds a station-matching dispute and signs it', async () => {
    const d = await createSignedDispute(
      fakeWallet('rrn1raiser'),
      TX_ID,
      'goods never arrived',
      1_754_000_000,
    );

    expect(d.txId).toBe(TX_ID);
    expect(d.raiserAddress).toBe('rrn1raiser');
    expect(d.reason).toBe('goods never arrived');
    expect(d.openedAt).toBe(1_754_000_000);
    expect(d.signature.length).toBeGreaterThan(0);
    expect(d.payloadBytes.length).toBeGreaterThan(0);

    const e = capturedEntries();
    expect(e.kind).toEqual({text: 'rrn.tx.dispute'});
    // The transaction id encodes as a 32-byte CBOR byte string.
    expect(e.proposal_id).toEqual({bytes: TX_ID});
    // The raiser is the wallet's own key, as a CBOR byte string.
    expect(e.raiser).toHaveProperty('bytes');
    expect(e.reason).toEqual({text: 'goods never arrived'});
    expect(e.opened_at).toEqual({int: '1754000000'});
    // Text-only v1: no evidence hash is ever emitted.
    expect(e).not.toHaveProperty('evidence_hash');
  });
});

describe('createSignedDisputeResponse', () => {
  test('builds a station-matching response and signs it', async () => {
    const r = await createSignedDisputeResponse(
      fakeWallet('rrn1responder'),
      TX_ID,
      'tracking shows delivered',
      1_754_000_500,
    );

    expect(r.txId).toBe(TX_ID);
    expect(r.responderAddress).toBe('rrn1responder');
    expect(r.statement).toBe('tracking shows delivered');
    expect(r.respondedAt).toBe(1_754_000_500);
    expect(r.signature.length).toBeGreaterThan(0);

    const e = capturedEntries();
    expect(e.kind).toEqual({text: 'rrn.tx.dispute.response'});
    expect(e.proposal_id).toEqual({bytes: TX_ID});
    expect(e.responder).toHaveProperty('bytes');
    expect(e.statement).toEqual({text: 'tracking shows delivered'});
    expect(e.responded_at).toEqual({int: '1754000500'});
    expect(e).not.toHaveProperty('evidence_hash');
  });
});

describe('createSignedVerdict', () => {
  test.each([
    [true, 'uphold'],
    [false, 'reject'],
  ] as const)(
    'builds a station-matching verdict (uphold=%s → ruling=%s) and signs it',
    async (uphold, ruling) => {
      const v = await createSignedVerdict(
        fakeWallet('rrn1juror'),
        TX_ID,
        uphold,
        1_754_001_000,
      );

      expect(v.txId).toBe(TX_ID);
      expect(v.jurorAddress).toBe('rrn1juror');
      expect(v.uphold).toBe(uphold);
      expect(v.castAt).toBe(1_754_001_000);
      expect(v.signature.length).toBeGreaterThan(0);

      const e = capturedEntries();
      expect(e.kind).toEqual({text: 'rrn.dispute.verdict'});
      expect(e.proposal_id).toEqual({bytes: TX_ID});
      expect(e.juror).toHaveProperty('bytes');
      // The boolean verdict encodes as a text `ruling` field, not a bool.
      expect(e.ruling).toEqual({text: ruling});
      expect(e.cast_at).toEqual({int: '1754001000'});
    },
  );
});
