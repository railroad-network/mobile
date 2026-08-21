/**
 * @format
 *
 * A founder's signature over a genesis Charter body in the distributed founding
 * ceremony (founding-charter). The real canonicalization + signing live in Rust
 * (via the FFI); here an in-memory FFI stands in — it captures the tagged CBOR
 * model the builder ships to Rust and returns a fixed "canonical body" so the
 * builder's `body_hex` gate can be exercised independently of the byte layout.
 *
 * The field shapes asserted here mirror the station's `From<Charter> for CBOR`
 * (rrn-governance `charter.rs`) exactly — version, community id, the two string
 * lists, the two default rule blocks, `created_at`, and founders as byte strings
 * of each raw public key. The gate itself — reconstructed body must hash to the
 * ceremony's `body_hex` — is what protects a founder from signing a body that
 * differs from the one being ratified, so it gets its own tests.
 */
import {
  registerRrnCryptoFfi,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {
  createSignedCharterSignature,
  CharterBodyMismatchError,
} from '../src/wallet/governance';
import type {StationPendingCharter} from '../src/network/StationClient';
import type {Wallet} from '../src/wallet/Wallet';

let lastPayloadJson: string | null = null;

const enc = (s: string): Uint8Array =>
  Uint8Array.from(Array.from(s).map(c => c.charCodeAt(0)));
const hex = (b: Uint8Array): string =>
  Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');

/** The fixed "canonical body" the fake FFI returns for any input. */
const BODY = enc('CANONICAL_CHARTER_BODY');
const BODY_HEX = hex(BODY);

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
    throw new Error('seal not exercised by charter tests');
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
    // A founding address decodes to a key whose bytes are the address text — the
    // ceremony's founders are decoded through this path.
    fromAddress: (addr: string) => {
      if (!addr.startsWith('rrn1')) {
        throw new Error('bad address');
      }
      return new FakePublicKey(addr);
    },
  },
  Signature: {fromBytes: (d: Uint8Array) => new FakeSignature(d)},
  Hash: {of: unused},
  isValidAddress: (a: string) => a.startsWith('rrn1'),
  canonicalBytes: (json: string) => {
    lastPayloadJson = json;
    return BODY;
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

function pendingCharter(overrides: Partial<StationPendingCharter> = {}): StationPendingCharter {
  return {
    exists: true,
    published: false,
    charter_hash: 'cc'.repeat(32),
    community_id: 'northern-forest',
    founding_principles: ['Mutual aid', 'Fair dealing'],
    rights_floor: ['Right to leave'],
    founders: ['rrn1alice', 'rrn1bob', 'rrn1carol'],
    signed_founders: ['rrn1alice'],
    threshold: 3,
    created_at: 1_754_000_000,
    version: 1,
    body_hex: BODY_HEX,
    ...overrides,
  };
}

beforeAll(() => registerRrnCryptoFfi(fakeFfi));
beforeEach(() => {
  lastPayloadJson = null;
});

describe('createSignedCharterSignature', () => {
  test('reconstructs a station-matching charter body and signs it', async () => {
    const signed = await createSignedCharterSignature(
      fakeWallet('rrn1bob'),
      pendingCharter(),
    );

    expect(signed.signerAddress).toBe('rrn1bob');
    expect(signed.signature.length).toBeGreaterThan(0);
    expect(signed.payloadBytes).toEqual(BODY);

    const e = capturedEntries();
    expect(e.version).toEqual({int: '1'});
    expect(e.community_id).toEqual({text: 'northern-forest'});
    expect(e.founding_principles).toEqual({
      array: [{text: 'Mutual aid'}, {text: 'Fair dealing'}],
    });
    expect(e.rights_floor).toEqual({array: [{text: 'Right to leave'}]});
    expect(e.created_at).toEqual({int: '1754000000'});
    // `previous_hash` is omitted at genesis.
    expect(e).not.toHaveProperty('previous_hash');

    // Governance defaults mirror GovernanceStructure::default() on the station.
    expect(e.governance_structure).toEqual({
      map: [
        ['voting_mechanism', {text: 'direct'}],
        ['statute_quorum_pct', {int: '30'}],
        ['statute_approval_pct', {int: '50'}],
        ['deliberation_window_days', {int: '7'}],
        ['implementation_delay_days', {int: '7'}],
        ['emergency_threshold_pct', {int: '67'}],
      ],
    });
    // Amendment defaults mirror AmendmentRules::default() on the station.
    expect(e.amendment_rules).toEqual({
      map: [
        ['charter_quorum_pct', {int: '50'}],
        ['charter_approval_pct', {int: '75'}],
        ['charter_deliberation_window_days', {int: '30'}],
      ],
    });

    // Each founder is a byte string of its raw public key (address text here).
    expect(e.founders).toEqual({
      array: [
        {bytes: hex(enc('rrn1alice'))},
        {bytes: hex(enc('rrn1bob'))},
        {bytes: hex(enc('rrn1carol'))},
      ],
    });
  });

  test('signs the exact canonical bytes (payload === signed message)', async () => {
    const signed = await createSignedCharterSignature(
      fakeWallet('rrn1bob'),
      pendingCharter(),
    );
    // The fake wallet echoes the first two bytes of what it signed, so this
    // proves it signed the canonical body, not some other buffer.
    expect(Array.from(signed.signature.slice(0, 2))).toEqual(
      Array.from(BODY.slice(0, 2)),
    );
  });

  test('refuses to sign when the reconstructed body drifts from body_hex', async () => {
    await expect(
      createSignedCharterSignature(
        fakeWallet('rrn1bob'),
        pendingCharter({body_hex: 'de'.repeat(16)}),
      ),
    ).rejects.toBeInstanceOf(CharterBodyMismatchError);
  });

  test('refuses to sign when a founder address is malformed', async () => {
    await expect(
      createSignedCharterSignature(
        fakeWallet('rrn1bob'),
        pendingCharter({founders: ['rrn1alice', 'not-an-address', 'rrn1carol']}),
      ),
    ).rejects.toBeInstanceOf(CharterBodyMismatchError);
  });
});
