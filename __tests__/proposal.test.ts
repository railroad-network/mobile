/**
 * @format
 *
 * Signed transaction proposal (T1.2.5). The real canonicalization + signing live
 * in Rust (via the FFI); here an in-memory FFI stands in — not a second
 * implementation, just enough to capture the tagged CBOR model the builder ships
 * to Rust and to hand back a signature. We assert that {@link createSendProposal}
 * builds the station-matching payload (the `rrn.tx.proposal` kind, addresses as
 * byte strings, the positive-pays-receiver amount, memo-or-null), signs it, and
 * derives a content-address id — and that an invalid receiver is rejected.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {createSendProposal} from '../src/wallet/proposal';
import type {Wallet} from '../src/wallet/Wallet';

// --- In-memory FFI ----------------------------------------------------------

let lastPayloadJson: string | null = null;

const enc = (s: string): Uint8Array => Uint8Array.from(Array.from(s).map(c => c.charCodeAt(0) & 0xff));
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
    throw new Error('seal not exercised by proposal tests');
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
    sign: async (msg: Uint8Array) => new FakeSignature(Uint8Array.from([...msg.slice(0, 2), 0xaa])),
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

// --- Tests ------------------------------------------------------------------

test('builds a station-matching proposal and signs it', async () => {
  const p = await createSendProposal(fakeWallet('rrn1sender'), 'rrn1receiver', 300, 'lunch', {
    nonce: 2,
    proposedAt: 100,
    expiresAt: 200,
  });

  expect(p.senderAddress).toBe('rrn1sender');
  expect(p.receiverAddress).toBe('rrn1receiver');
  expect(p.amountCenti).toBe(300);
  expect(p.memo).toBe('lunch');
  expect(p.nonce).toBe(2);
  expect(p.proposedAt).toBe(100);
  expect(p.expiresAt).toBe(200);
  expect(typeof p.id).toBe('string');
  expect(p.id.length).toBeGreaterThan(0);
  expect(p.signature.length).toBeGreaterThan(0);

  const e = capturedEntries();
  expect(e.kind).toEqual({text: 'rrn.tx.proposal'});
  expect(e.amount_centi).toEqual({int: '300'});
  expect(e.memo).toEqual({text: 'lunch'});
  expect(e.nonce).toEqual({int: '2'});
  // Addresses encode as CBOR byte strings, matching the station.
  expect(e.sender).toHaveProperty('bytes');
  expect(e.receiver).toHaveProperty('bytes');
});

test('a blank memo encodes as null and is dropped from the result', async () => {
  const p = await createSendProposal(fakeWallet('rrn1sender'), 'rrn1receiver', 500, '   ', {
    nonce: 0,
    proposedAt: 1,
    expiresAt: 2,
  });
  expect(p.memo).toBeUndefined();
  expect(capturedEntries().memo).toEqual({null: null});
});

test('rejects an invalid receiver address', async () => {
  await expect(
    createSendProposal(fakeWallet('rrn1sender'), 'not-an-address', 300, undefined, {
      nonce: 0,
      proposedAt: 1,
      expiresAt: 2,
    }),
  ).rejects.toThrow(/invalid receiver/);
});
