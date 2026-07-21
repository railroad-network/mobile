/**
 * @format
 *
 * The opt-in background signing credential (T1.3.6). Verifies that provisioning
 * re-encrypts the wallet under a fresh secret, stores both parts without a
 * biometric gate, reconstructs the same identity, and clears cleanly.
 */
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore, SaveOptions} from '../src/crypto/SecureStore';
import {
  registerRrnCryptoFfi,
  type EncryptedWallet,
  type Keypair,
  type PublicKey,
  type RrnCryptoFfi,
  type WalletContents,
} from '../src/crypto/ffi';
import {createWallet, type Wallet} from '../src/wallet/Wallet';
import {
  clearBackgroundCredential,
  hasBackgroundCredential,
  loadBackgroundCredential,
  provisionBackgroundCredential,
} from '../src/network/backgroundCredential';

// --- a compact fake FFI covering only what the credential path touches --------

let counter = 0;
const sealed = new Map<string, {contents: WalletContents; passphrase: string}>();

class FakeContents implements WalletContents {
  constructor(private readonly addr: string) {}
  publicKey(): PublicKey {
    throw new Error('not used');
  }
  address(): string {
    return this.addr;
  }
  createdAt(): number {
    return 0;
  }
  metadata(): Record<string, string> {
    return {};
  }
  keypair(): Keypair {
    throw new Error('not used');
  }
}

const MARKER = 0x00;
const encode = (t: string) => Uint8Array.from([MARKER, ...Array.from(t).map(c => c.charCodeAt(0))]);
const decode = (b: Uint8Array) =>
  Array.from(b.slice(1))
    .map(n => String.fromCharCode(n))
    .join('');

class FakeEncrypted implements EncryptedWallet {
  constructor(private readonly bytes: Uint8Array) {}
  toBytes(): Uint8Array {
    return this.bytes;
  }
  decrypt(passphrase: string): WalletContents {
    const entry = sealed.get(decode(this.bytes));
    if (!entry) throw new Error('corrupt wallet');
    if (entry.passphrase !== passphrase) throw new Error('wrong passphrase');
    return entry.contents;
  }
}

const fakeFfi = {
  Keypair: {
    // 32 unique bytes per call, so each provisioned secret differs.
    generate: () => {
      const seed = counter++;
      const bytes = Uint8Array.from({length: 32}, (_, i) => (seed + i) % 256);
      return {publicKey: () => ({toBytes: () => bytes})} as unknown as Keypair;
    },
  },
  WalletContents: {
    createNew: () => new FakeContents(`rrn1fake${counter++}`),
  },
  EncryptedWallet: {
    encrypt: (contents: WalletContents, passphrase: string) => {
      const token = `tok-${counter++}`;
      sealed.set(token, {contents, passphrase});
      return new FakeEncrypted(encode(token));
    },
    fromBytes: (data: Uint8Array) => {
      if (data[0] !== MARKER) throw new Error('corrupt');
      return new FakeEncrypted(data);
    },
  },
} as unknown as RrnCryptoFfi;

class MemStore implements SecureStore {
  readonly map = new Map<string, Uint8Array>();
  readonly opts = new Map<string, SaveOptions | undefined>();
  async save(key: string, value: Uint8Array, options?: SaveOptions): Promise<void> {
    this.map.set(key, value);
    this.opts.set(key, options);
  }
  async load(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
    this.opts.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

async function freshWallet(store: SecureStore): Promise<Wallet> {
  return createWallet('user-passphrase', store, {requireBiometric: false});
}

describe('backgroundCredential', () => {
  test('load returns null when nothing is provisioned', async () => {
    expect(await loadBackgroundCredential(new MemStore())).toBeNull();
    expect(await hasBackgroundCredential(new MemStore())).toBe(false);
  });

  test('provision stores blob + secret without a biometric gate', async () => {
    const store = new MemStore();
    const wallet = await freshWallet(store);
    await provisionBackgroundCredential(wallet, store);
    expect(await store.has(SecureStoreKeys.BG_SYNC_BLOB)).toBe(true);
    expect(await store.has(SecureStoreKeys.BG_SYNC_SECRET)).toBe(true);
    expect(store.opts.get(SecureStoreKeys.BG_SYNC_BLOB)).toEqual({requireBiometric: false});
    expect(store.opts.get(SecureStoreKeys.BG_SYNC_SECRET)).toEqual({requireBiometric: false});
    expect(await hasBackgroundCredential(store)).toBe(true);
  });

  test('load reconstructs the same identity', async () => {
    const store = new MemStore();
    const wallet = await freshWallet(store);
    await provisionBackgroundCredential(wallet, store);
    const bg = await loadBackgroundCredential(store);
    expect(bg).not.toBeNull();
    expect(bg!.address).toBe(wallet.address);
  });

  test('the background blob is not the primary wallet blob (re-encrypted)', async () => {
    const store = new MemStore();
    const wallet = await freshWallet(store);
    await provisionBackgroundCredential(wallet, store);
    const primary = await store.load(SecureStoreKeys.WALLET_FILE);
    const bg = await store.load(SecureStoreKeys.BG_SYNC_BLOB);
    expect(bg).not.toBeNull();
    expect(Array.from(bg!)).not.toEqual(Array.from(primary!));
  });

  test('clear removes both parts and load returns null after', async () => {
    const store = new MemStore();
    const wallet = await freshWallet(store);
    await provisionBackgroundCredential(wallet, store);
    await clearBackgroundCredential(store);
    expect(await store.has(SecureStoreKeys.BG_SYNC_BLOB)).toBe(false);
    expect(await store.has(SecureStoreKeys.BG_SYNC_SECRET)).toBe(false);
    expect(await loadBackgroundCredential(store)).toBeNull();
  });

  test('a missing secret (only blob) loads as null, not a throw', async () => {
    const store = new MemStore();
    const wallet = await freshWallet(store);
    await provisionBackgroundCredential(wallet, store);
    await store.delete(SecureStoreKeys.BG_SYNC_SECRET);
    expect(await loadBackgroundCredential(store)).toBeNull();
  });
});
