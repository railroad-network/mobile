/**
 * @format
 *
 * Mobile wallet-file wrapper tests (T1.1.5), driven by the committed
 * cross-platform fixture the station's Rust generates
 * (rrn-identity/tests/cross_platform_wallet.rs).
 *
 * Scope: the real `.rrnwallet` format (canonical CBOR + argon2id +
 * XChaCha20-Poly1305) lives in Rust, which *is* the mobile implementation
 * (reached via the uniffi FFI). The native bindings cannot load under Jest, so
 * here we register an in-memory FFI backed by the Rust-generated fixture — a
 * lookup that maps each committed `.rrnwallet` blob to the identity the station
 * sealed into it, not a second implementation of the format — and verify that
 * `Wallet.ts` delegates correctly: loading a station-sealed wallet yields the
 * recorded address/identity, the wrong passphrase and tampered bytes are
 * rejected, and create → persist → load round-trips through SecureStore. Real
 * cross-platform decryption on device is covered once the RN wrapper is wired
 * (and by the Rust test today).
 */
import {
  createWallet,
  hasWallet,
  loadWallet,
  loadWalletFromBytes,
  saveWalletToBytes,
  Wallet,
} from '../src/wallet/Wallet';
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore} from '../src/crypto/SecureStore';
import {
  registerRrnCryptoFfi,
  type EncryptedWallet,
  type Keypair,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
  type WalletContents,
} from '../src/crypto/ffi';
import fixtureData from './fixtures/cross_platform_wallet.json';

interface WalletVector {
  seed: string;
  passphrase: string;
  created_at: number;
  metadata: Record<string, string>;
  address: string;
  pubkey: string;
  encrypted: string;
}
interface Fixture {
  wrong_passphrase: string;
  wallets: WalletVector[];
}

const fixture = fixtureData as Fixture;

const hexToBytes = (hex: string): Uint8Array =>
  hex.length === 0
    ? new Uint8Array(0)
    : Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// A self-consistent, deterministic stand-in for Ed25519 — NOT real crypto, just
// enough that a fake keypair's signature verifies against its own public key so
// the wrapper's sign/verify plumbing can be exercised. Arithmetic only.
const deriveSig = (pubkeyHex: string, message: Uint8Array): Uint8Array => {
  const seed = `${pubkeyHex}|${bytesToHex(message)}`;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    out[i] = (seed.charCodeAt(i % seed.length) + i * 31 + seed.length) % 256;
  }
  return out;
};

class FakeSignature implements Signature {
  constructor(readonly bytes: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.bytes;
  }
}

class FakePublicKey implements PublicKey {
  constructor(private readonly pubkeyHex: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.pubkeyHex);
  }
  toAddress(): string {
    throw new Error('toAddress not exercised by wallet tests');
  }
  verify(message: Uint8Array, signature: Signature): boolean {
    return (
      bytesToHex(signature.toBytes()) ===
      bytesToHex(deriveSig(this.pubkeyHex, message))
    );
  }
}

class FakeKeypair implements Keypair {
  constructor(private readonly pubkeyHex: string) {}
  publicKey(): PublicKey {
    return new FakePublicKey(this.pubkeyHex);
  }
  sign(message: Uint8Array): Signature {
    return new FakeSignature(deriveSig(this.pubkeyHex, message));
  }
}

class FakeWalletContents implements WalletContents {
  constructor(
    private readonly pubkeyHex: string,
    private readonly addr: string,
    private readonly created: number,
    private readonly meta: Record<string, string>,
  ) {}
  publicKey(): PublicKey {
    return new FakePublicKey(this.pubkeyHex);
  }
  address(): string {
    return this.addr;
  }
  createdAt(): number {
    return this.created;
  }
  metadata(): Record<string, string> {
    return this.meta;
  }
  keypair(): Keypair {
    return new FakeKeypair(this.pubkeyHex);
  }
}

const contentsForVector = (v: WalletVector): FakeWalletContents =>
  new FakeWalletContents(v.pubkey, v.address, v.created_at, v.metadata);

// A wallet error, shaped like what the FFI throws for decrypt/parse failures.
class WalletError extends Error {}

// Committed .rrnwallet blob (hex) -> the identity the station sealed into it.
const fixtureByEncryptedHex = new Map<string, WalletVector>();
for (const v of fixture.wallets) {
  fixtureByEncryptedHex.set(v.encrypted, v);
}

// In-fake "encryption" for the create/save/load round-trip (no station bytes
// involved): a marker byte the real CBOR envelope never starts with, plus a
// token indexing a registry of sealed contents. This lets encrypt->toBytes->
// fromBytes->decrypt round-trip without reimplementing the real format.
const FAKE_MARKER = 0x00;
let tokenCounter = 0;
const fakeSealed = new Map<string, {contents: WalletContents; passphrase: string}>();

const encodeToken = (token: string): Uint8Array =>
  Uint8Array.from([FAKE_MARKER, ...Array.from(token).map(c => c.charCodeAt(0))]);
const decodeToken = (bytes: Uint8Array): string =>
  Array.from(bytes.slice(1))
    .map(b => String.fromCharCode(b))
    .join('');

class FakeEncryptedWallet implements EncryptedWallet {
  constructor(private readonly bytes: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.bytes;
  }
  decrypt(passphrase: string): WalletContents {
    if (this.bytes[0] === FAKE_MARKER) {
      const entry = fakeSealed.get(decodeToken(this.bytes));
      if (!entry) {
        throw new WalletError('corrupt wallet');
      }
      if (entry.passphrase !== passphrase) {
        throw new WalletError('wrong passphrase or corrupt wallet');
      }
      return entry.contents;
    }
    const v = fixtureByEncryptedHex.get(bytesToHex(this.bytes));
    if (!v) {
      throw new WalletError('corrupt wallet');
    }
    if (v.passphrase !== passphrase) {
      throw new WalletError('wrong passphrase or corrupt wallet');
    }
    return contentsForVector(v);
  }
}

const fakeFfi: RrnCryptoFfi = {
  Keypair: {
    generate: () => {
      throw new Error('not exercised by wallet tests');
    },
  },
  Signature: {fromBytes: (data: Uint8Array) => new FakeSignature(data)},
  Hash: {
    of: () => {
      throw new Error('not exercised by wallet tests');
    },
  },
  PublicKey: {
    fromBytes: () => {
      throw new Error('not exercised by wallet tests');
    },
    fromAddress: () => {
      throw new Error('not exercised by wallet tests');
    },
  },
  isValidAddress: () => {
    throw new Error('not exercised by wallet tests');
  },
  canonicalBytes: () => {
    throw new Error('not exercised by wallet tests');
  },
  WalletContents: {
    createNew: () => {
      // A fresh, unique fake identity.
      const n = tokenCounter;
      const pubkeyHex = n.toString(16).padStart(64, '0');
      return new FakeWalletContents(
        pubkeyHex,
        `rrn1fake${pubkeyHex.slice(0, 20)}`,
        1_700_000_000 + n,
        {},
      );
    },
  },
  EncryptedWallet: {
    encrypt: (contents: WalletContents, passphrase: string) => {
      const token = `tok-${tokenCounter++}`;
      fakeSealed.set(token, {contents, passphrase});
      return new FakeEncryptedWallet(encodeToken(token));
    },
    fromBytes: (data: Uint8Array) => {
      const isFake = data[0] === FAKE_MARKER;
      const isFixture = fixtureByEncryptedHex.has(bytesToHex(data));
      if (!isFake && !isFixture) {
        throw new WalletError('corrupt wallet file');
      }
      return new FakeEncryptedWallet(data);
    },
  },
};

// A minimal in-memory SecureStore for the persistence tests.
class MemoryStore implements SecureStore {
  private readonly map = new Map<string, Uint8Array>();
  async save(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value);
  }
  async load(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('Wallet', () => {
  test('the fixture has the expected shape', () => {
    expect(fixture.wallets.length).toBeGreaterThanOrEqual(8);
    expect(fixture.wrong_passphrase.length).toBeGreaterThan(0);
  });

  test('a station-sealed wallet loads to the recorded identity', async () => {
    for (const v of fixture.wallets) {
      const wallet = await loadWalletFromBytes(
        hexToBytes(v.encrypted),
        v.passphrase,
      );
      expect(wallet.address).toBe(v.address);
      expect(bytesToHex(wallet.publicKey().toBytes())).toBe(v.pubkey);
      expect(wallet.createdAt()).toBe(v.created_at);
      expect(wallet.metadata()).toEqual(v.metadata);
    }
  });

  test('a loaded wallet can sign, and its own public key verifies', async () => {
    const v = fixture.wallets[0];
    const wallet = await loadWalletFromBytes(
      hexToBytes(v.encrypted),
      v.passphrase,
    );
    const message = Uint8Array.from(
      'spend from this identity',
      c => c.charCodeAt(0),
    );
    const sig = await wallet.sign(message);
    expect(wallet.publicKey().verify(message, sig)).toBe(true);
  });

  test('the wrong passphrase is rejected', async () => {
    const v = fixture.wallets[0];
    await expect(
      loadWalletFromBytes(hexToBytes(v.encrypted), fixture.wrong_passphrase),
    ).rejects.toBeInstanceOf(WalletError);
  });

  test('tampered wallet bytes are rejected', async () => {
    const v = fixture.wallets[0];
    const bytes = hexToBytes(v.encrypted);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] + 1) % 256;
    await expect(
      loadWalletFromBytes(bytes, v.passphrase),
    ).rejects.toBeInstanceOf(WalletError);
  });

  test('garbage bytes are rejected at parse time', async () => {
    await expect(
      loadWalletFromBytes(Uint8Array.from([0xff, 0x01, 0x02]), 'whatever'),
    ).rejects.toBeInstanceOf(WalletError);
  });

  test('create → persist → load round-trips through SecureStore', async () => {
    const store = new MemoryStore();
    const passphrase = 'correct horse battery staple';

    expect(await hasWallet(store)).toBe(false);
    const created = await createWallet(passphrase, store);
    expect(await hasWallet(store)).toBe(true);
    // The encrypted bytes were stored under the WALLET_FILE key.
    expect(await store.load(SecureStoreKeys.WALLET_FILE)).not.toBeNull();

    const loaded = await loadWallet(passphrase, store);
    expect(loaded).not.toBeNull();
    expect(loaded!.address).toBe(created.address);
  });

  test('loadWallet returns null when no wallet has been created', async () => {
    expect(await loadWallet('anything', new MemoryStore())).toBeNull();
  });

  test('loadWallet with the wrong passphrase rejects', async () => {
    const store = new MemoryStore();
    await createWallet('right-passphrase', store);
    await expect(loadWallet('wrong-passphrase', store)).rejects.toBeInstanceOf(
      WalletError,
    );
  });

  test('saveWalletToBytes then loadWalletFromBytes round-trips', async () => {
    const store = new MemoryStore();
    const wallet = await createWallet('pw', store);
    const bytes = await saveWalletToBytes(wallet, 'pw');
    const reloaded = await loadWalletFromBytes(bytes, 'pw');
    expect(reloaded.address).toBe(wallet.address);
    expect(reloaded).toBeInstanceOf(Wallet);
  });
});
