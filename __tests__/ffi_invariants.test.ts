/**
 * @format
 *
 * Consolidated cross-platform FFI invariant tests (T1.1.6), driven by the single
 * committed fixture the station's Rust generates
 * (rrn-identity/tests/ffi_invariants.rs).
 *
 * Scope: the real crypto correctness is proven on the Rust side, which *is* the
 * mobile implementation (reached via the uniffi FFI). The native bindings cannot
 * load under Jest, so here we register one in-memory FFI backed by the
 * Rust-generated fixture — lookups over known-good vectors, not a second
 * implementation of any primitive — and assert the same invariants the Rust test
 * asserts, through the real mobile wrappers (`address.ts`, `sign.ts`, `hash.ts`,
 * `Wallet.ts`):
 *   1. Address roundtrip   — pubkey → address → pubkey (bytes identical)
 *   2. Signature roundtrip — sign → verify (succeeds), bytes reproducible
 *   3. Signature tamper    — a bad sig / message / key fails verification
 *   4. Hash determinism    — same input → same Blake3 hash (bytes + hex)
 *   5. Wallet roundtrip     — sealed bytes → decrypt → recorded identity
 *
 * dcbor canonical-bytes determinism is deferred to T1.1.7, which builds its FFI
 * surface. End-to-end execution of the real bindings on device is covered once
 * the RN wrapper is wired (and by the Rust test today).
 */
import {
  isValidAddress,
  parseAddress,
  publicKeyToAddress,
} from '../src/crypto/address';
import {sign, verify} from '../src/crypto/sign';
import {hashBytes, hashHex} from '../src/crypto/hash';
import {loadWalletFromBytes} from '../src/wallet/Wallet';
import {
  registerRrnCryptoFfi,
  type EncryptedWallet,
  type Hash,
  type Keypair,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
  type WalletContents,
} from '../src/crypto/ffi';
import fixtureData from './fixtures/ffi_invariants.json';

interface AddressVector {
  seed: string;
  pubkey: string;
  address: string;
}
interface SignVector {
  seed: string;
  pubkey: string;
  message: string;
  signature: string;
}
interface Tampered {
  pubkey: string;
  message: string;
  signature: string;
  reason: string;
}
interface HashVector {
  input: string;
  hash: string;
}
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
  address_roundtrip: AddressVector[];
  signing: SignVector[];
  signing_tamper: Tampered[];
  hashing: HashVector[];
  hashing_known_answer: HashVector[];
  wrong_passphrase: string;
  wallet_roundtrip: WalletVector[];
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

// ---- Lookups backing the in-memory FFI, all from the committed fixture. ----
const addressToPubkey = new Map<string, string>();
const pubkeyToAddress = new Map<string, string>();
for (const v of fixture.address_roundtrip) {
  addressToPubkey.set(v.address, v.pubkey);
  pubkeyToAddress.set(v.pubkey, v.address);
}
// Wallet identities carry an address too — fold those in so a wallet's public
// key resolves to its address through the same maps.
for (const w of fixture.wallet_roundtrip) {
  addressToPubkey.set(w.address, w.pubkey);
  pubkeyToAddress.set(w.pubkey, w.address);
}

const signLookup = new Map<string, string>();
const validTriples = new Set<string>();
for (const v of fixture.signing) {
  signLookup.set(`${v.pubkey}|${v.message}`, v.signature);
  validTriples.add(`${v.pubkey}|${v.message}|${v.signature}`);
}

const hashLookup = new Map<string, string>();
for (const h of [...fixture.hashing, ...fixture.hashing_known_answer]) {
  hashLookup.set(h.input, h.hash);
}

const fixtureByEncryptedHex = new Map<string, WalletVector>();
for (const w of fixture.wallet_roundtrip) {
  fixtureByEncryptedHex.set(w.encrypted, w);
}

// A wallet error, shaped like what the FFI throws for decrypt/parse failures.
class WalletError extends Error {}

class FakeSignature implements Signature {
  constructor(private readonly bytes: Uint8Array) {}
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
    const address = pubkeyToAddress.get(this.pubkeyHex);
    if (address === undefined) {
      throw new Error('fake FFI has no address for this public key');
    }
    return address;
  }
  verify(message: Uint8Array, signature: Signature): boolean {
    return validTriples.has(
      `${this.pubkeyHex}|${bytesToHex(message)}|${bytesToHex(
        signature.toBytes(),
      )}`,
    );
  }
}

class FakeKeypair implements Keypair {
  constructor(private readonly pubkeyHex: string) {}
  publicKey(): PublicKey {
    return new FakePublicKey(this.pubkeyHex);
  }
  sign(message: Uint8Array): Signature {
    const sig = signLookup.get(`${this.pubkeyHex}|${bytesToHex(message)}`);
    if (sig === undefined) {
      throw new Error('fake FFI has no signature for this (key, message)');
    }
    return new FakeSignature(hexToBytes(sig));
  }
}

class FakeHash implements Hash {
  constructor(private readonly hashHexValue: string) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.hashHexValue);
  }
  toHex(): string {
    return this.hashHexValue;
  }
}

class FakeWalletContents implements WalletContents {
  constructor(private readonly v: WalletVector) {}
  publicKey(): PublicKey {
    return new FakePublicKey(this.v.pubkey);
  }
  address(): string {
    return this.v.address;
  }
  createdAt(): number {
    return this.v.created_at;
  }
  metadata(): Record<string, string> {
    return this.v.metadata;
  }
  keypair(): Keypair {
    return new FakeKeypair(this.v.pubkey);
  }
}

class FakeEncryptedWallet implements EncryptedWallet {
  constructor(private readonly v: WalletVector) {}
  toBytes(): Uint8Array {
    return hexToBytes(this.v.encrypted);
  }
  decrypt(passphrase: string): WalletContents {
    if (passphrase !== this.v.passphrase) {
      throw new WalletError('wrong passphrase or corrupt wallet');
    }
    return new FakeWalletContents(this.v);
  }
}

const keypairForRow = (v: SignVector): FakeKeypair => new FakeKeypair(v.pubkey);

const fakeFfi: RrnCryptoFfi = {
  Keypair: {
    generate: () => {
      throw new Error('not exercised by ffi_invariants tests');
    },
  },
  Signature: {fromBytes: (data: Uint8Array) => new FakeSignature(data)},
  Hash: {
    of: (data: Uint8Array) => {
      const h = hashLookup.get(bytesToHex(data));
      if (h === undefined) {
        throw new Error('fake FFI has no hash for this input');
      }
      return new FakeHash(h);
    },
  },
  PublicKey: {
    fromBytes: (data: Uint8Array) => new FakePublicKey(bytesToHex(data)),
    fromAddress: (address: string) => {
      const pubkey = addressToPubkey.get(address);
      if (pubkey === undefined) {
        throw new Error('invalid address');
      }
      return new FakePublicKey(pubkey);
    },
  },
  isValidAddress: (address: string) => addressToPubkey.has(address),
  WalletContents: {
    createNew: () => {
      throw new Error('not exercised by ffi_invariants tests');
    },
  },
  EncryptedWallet: {
    encrypt: () => {
      throw new Error('not exercised by ffi_invariants tests');
    },
    fromBytes: (data: Uint8Array) => {
      const v = fixtureByEncryptedHex.get(bytesToHex(data));
      if (!v) {
        throw new WalletError('corrupt wallet file');
      }
      return new FakeEncryptedWallet(v);
    },
  },
};

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('ffi invariants', () => {
  test('the consolidated fixture has the expected shape', () => {
    expect(fixture.address_roundtrip).toHaveLength(100);
    expect(fixture.signing).toHaveLength(100);
    expect(fixture.signing_tamper.length).toBeGreaterThan(0);
    expect(fixture.hashing).toHaveLength(100);
    expect(fixture.hashing_known_answer.length).toBeGreaterThanOrEqual(2);
    expect(fixture.wallet_roundtrip.length).toBeGreaterThanOrEqual(8);
    expect(fixture.wrong_passphrase.length).toBeGreaterThan(0);
  });

  test('invariant 1: addresses round-trip pubkey → address → pubkey', () => {
    for (const v of fixture.address_roundtrip) {
      // address → pubkey → address.
      const parsed = parseAddress(v.address);
      expect('error' in parsed).toBe(false);
      const pk = parsed as PublicKey;
      expect(bytesToHex(pk.toBytes())).toBe(v.pubkey);
      expect(publicKeyToAddress(pk)).toBe(v.address);
      // pubkey → address, byte-for-byte equal to the recorded address.
      expect(publicKeyToAddress(fakeFfi.PublicKey.fromBytes(hexToBytes(v.pubkey)))).toBe(
        v.address,
      );
      expect(isValidAddress(v.address)).toBe(true);
    }
  });

  test('invariant 2: signatures are reproducible and verify', async () => {
    for (const v of fixture.signing) {
      const kp = keypairForRow(v);
      const message = hexToBytes(v.message);
      const sig = await sign(kp, message);
      expect(bytesToHex(sig.toBytes())).toBe(v.signature);
      await expect(verify(kp.publicKey(), message, sig)).resolves.toBe(true);
    }
  });

  test('invariant 3: tampered signatures fail verification', async () => {
    for (const t of fixture.signing_tamper) {
      const pk = fakeFfi.PublicKey.fromBytes(hexToBytes(t.pubkey));
      const sig = fakeFfi.Signature.fromBytes(hexToBytes(t.signature));
      await expect(verify(pk, hexToBytes(t.message), sig)).resolves.toBe(false);
    }
  });

  test('invariant 3: a locally bit-flipped signature fails verification', async () => {
    const v = fixture.signing[1];
    const pk = fakeFfi.PublicKey.fromBytes(hexToBytes(v.pubkey));
    const bad = hexToBytes(v.signature);
    // eslint-disable-next-line no-bitwise -- flipping one bit to tamper the sig
    bad[bad.length - 1] ^= 0x01;
    await expect(
      verify(pk, hexToBytes(v.message), fakeFfi.Signature.fromBytes(bad)),
    ).resolves.toBe(false);
  });

  test('invariant 4: hashes are deterministic (bytes and hex)', () => {
    for (const h of [...fixture.hashing, ...fixture.hashing_known_answer]) {
      const input = hexToBytes(h.input);
      expect(hashHex(input)).toBe(h.hash);
      expect(bytesToHex(hashBytes(input))).toBe(h.hash);
    }
  });

  test('invariant 4: the empty-input Blake3 hash is locked', () => {
    const empty = fixture.hashing_known_answer[0];
    expect(empty.input).toBe('');
    expect(empty.hash).toBe(
      'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
    );
    expect(hashHex(new Uint8Array(0))).toBe(empty.hash);
  });

  test('invariant 5: sealed wallets decrypt to the recorded identity', async () => {
    for (const w of fixture.wallet_roundtrip) {
      const wallet = await loadWalletFromBytes(
        hexToBytes(w.encrypted),
        w.passphrase,
      );
      expect(wallet.address).toBe(w.address);
      expect(bytesToHex(wallet.publicKey().toBytes())).toBe(w.pubkey);
      expect(wallet.createdAt()).toBe(w.created_at);
      expect(wallet.metadata()).toEqual(w.metadata);
    }
  });

  test('invariant 5: the wrong passphrase and tampered bytes are rejected', async () => {
    const w = fixture.wallet_roundtrip[0];
    await expect(
      loadWalletFromBytes(hexToBytes(w.encrypted), fixture.wrong_passphrase),
    ).rejects.toBeInstanceOf(WalletError);

    const tampered = hexToBytes(w.encrypted);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] + 1) % 256;
    await expect(
      loadWalletFromBytes(tampered, w.passphrase),
    ).rejects.toBeInstanceOf(WalletError);
  });
});
