/**
 * @format
 *
 * Signed transaction confirmation (T1.2.6). Like the proposal builder, the real
 * canonicalization + signing live in Rust (via the FFI); an in-memory FFI stands
 * in to capture the tagged CBOR model and hand back a signature. We assert that
 * {@link createConfirmation} builds the station-matching payload (the
 * `rrn.tx.confirmation` kind, the proposal id + confirmer as byte strings, the
 * confirmed_at integer), signs it, and rejects a non-hex proposal id.
 */
import {
  registerRrnCryptoFfi,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {createConfirmation} from '../src/wallet/confirmation';
import type {Wallet} from '../src/wallet/Wallet';

let lastPayloadJson: string | null = null;

const enc = (s: string): Uint8Array => Uint8Array.from(Array.from(s).map(c => c.charCodeAt(0) & 0xff));

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
    throw new Error('seal not exercised by confirmation tests');
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
  Hash: {of: unused},
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
    sign: async (msg: Uint8Array) => new FakeSignature(Uint8Array.from([...msg.slice(0, 2), 0xbb])),
  } as unknown as Wallet;
}

function capturedEntries(): Record<string, unknown> {
  const model = JSON.parse(lastPayloadJson ?? '{}') as {map: [string, unknown][]};
  return Object.fromEntries(model.map);
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));
beforeEach(() => {
  lastPayloadJson = null;
});

const PROPOSAL_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';

test('builds a station-matching confirmation and signs it', async () => {
  const c = await createConfirmation(fakeWallet('rrn1qme'), PROPOSAL_ID, 1_700_000_100);

  expect(c.proposalId).toBe(PROPOSAL_ID);
  expect(c.confirmerAddress).toBe('rrn1qme');
  expect(c.confirmedAt).toBe(1_700_000_100);
  expect(c.signature.length).toBeGreaterThan(0);

  const e = capturedEntries();
  expect(e.kind).toEqual({text: 'rrn.tx.confirmation'});
  expect(e.confirmed_at).toEqual({int: '1700000100'});
  // The proposal id and confirmer both encode as CBOR byte strings.
  expect(e.proposal_id).toHaveProperty('bytes');
  expect(e.confirmer).toHaveProperty('bytes');
  // proposal_id is the raw bytes of the hex id (32 bytes → 64 hex chars).
  expect((e.proposal_id as {bytes: string}).bytes).toBe(PROPOSAL_ID);
});

test('rejects a non-hex proposal id', async () => {
  await expect(createConfirmation(fakeWallet('rrn1qme'), 'not-hex!!', 1)).rejects.toThrow(/hex/);
});
