/**
 * @format
 *
 * Signed vouch attestation (T1.4.3). The real canonicalization + signing live in
 * Rust (via the FFI); here an in-memory FFI stands in — enough to capture the
 * tagged CBOR model the builder ships to Rust and hand back a signature. We
 * assert {@link createSignedVouch} builds the station-matching attestation (the
 * `"vouch"` kind, a nested body map, the subject as a byte string, an explicit
 * null `expires_at`), signs it, and derives the content-address `vouchId` — and
 * that an invalid subject is rejected. Byte-for-byte agreement with Rust is
 * proven separately in `vouchCrossPlatform.test.ts`.
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
    throw new Error('seal not exercised by vouch tests');
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
  PublicKey: {
    fromBytes: unused,
    fromAddress: (address: string) => {
      if (!address.startsWith('rrn1')) throw new Error('bad address');
      return new FakePublicKey(address);
    },
  },
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

beforeAll(() => registerRrnCryptoFfi(fakeFfi));
beforeEach(() => {
  lastPayloadJson = null;
});

test('builds a station-matching vouch and signs it', async () => {
  const v = await createSignedVouch(
    fakeWallet('rrn1voucher'),
    'rrn1subject',
    'rrn-phase0',
    'I know this person',
    50,
    1_752_000_000,
  );

  expect(v.voucherAddress).toBe('rrn1voucher');
  expect(v.subjectAddress).toBe('rrn1subject');
  expect(v.community).toBe('rrn-phase0');
  expect(v.statement).toBe('I know this person');
  expect(v.stakeCenti).toBe(50);
  expect(v.issuedAt).toBe(1_752_000_000);
  expect(typeof v.vouchId).toBe('string');
  expect(v.vouchId.length).toBeGreaterThan(0);
  expect(v.signature.length).toBeGreaterThan(0);

  const e = capturedEntries();
  expect(e.kind).toEqual({text: 'vouch'});
  // The subject encodes as a CBOR byte string, matching the station.
  expect(e.subject).toHaveProperty('bytes');
  expect(e.issued_at).toEqual({int: '1752000000'});
  // A vouch never expires: explicit CBOR null.
  expect(e.expires_at).toEqual({null: null});
  // The body is a nested map with the community, statement, and stake.
  expect(e.body).toEqual({
    map: [
      ['community', {text: 'rrn-phase0'}],
      ['statement', {text: 'I know this person'}],
      ['reputation_stake_centi', {int: '50'}],
    ],
  });
});

test('accepts a bigint stake past 2^53', async () => {
  const v = await createSignedVouch(
    fakeWallet('rrn1voucher'),
    'rrn1subject',
    'rrn-phase0',
    'big stake',
    9_007_199_254_740_993n,
    1_752_000_000,
  );
  expect(capturedEntries().body).toEqual({
    map: [
      ['community', {text: 'rrn-phase0'}],
      ['statement', {text: 'big stake'}],
      ['reputation_stake_centi', {int: '9007199254740993'}],
    ],
  });
  expect(v.stakeCenti).toBe(9_007_199_254_740_993n);
});

test('rejects an invalid subject address', async () => {
  await expect(
    createSignedVouch(
      fakeWallet('rrn1voucher'),
      'not-an-address',
      'rrn-phase0',
      'x',
      50,
      1,
    ),
  ).rejects.toThrow(/invalid subject/);
});
