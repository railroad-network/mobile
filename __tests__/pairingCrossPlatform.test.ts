/**
 * @format
 *
 * Cross-platform pairing vectors (T1.3.3): the mobile's `Pairing` seam must
 * produce byte-identical request/response signed bytes and the same
 * station-first SAS as the station's Rust (`pairing`/`paired`), which is the
 * source of truth for the wire layout (ADR-0008).
 *
 * The fixture is generated and committed by the station
 * (`rrn-station/tests/cross_platform_pairing.rs`), so this needs no Rust
 * toolchain. As in `sign.test.ts`, the native crypto cannot load under Jest, so
 * the FFI is backed by the fixture — real blake3 digests and real Ed25519
 * verifications are *looked up* from the Rust-generated vectors, not
 * re-implemented — which turns "does the mobile agree with Rust?" into a table
 * lookup. The byte-layout functions are pure and are checked directly.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {bytesToHex, hexToBytes} from '../src/crypto/hex';
import type {Station} from '../src/network/Discovery';
import {
  confirmationCode,
  requestPairing,
  requestSignedBytes,
  responseSignedBytes,
} from '../src/network/Pairing';
import type {Wallet} from '../src/wallet/Wallet';
import fixtureData from './fixtures/cross_platform_pairing.json';

interface Handshake {
  station_pubkey: string;
  station_address: string;
  mobile_pubkey: string;
  mobile_address: string;
  token: string;
  requested_at: number;
  request_signed_bytes: string;
  mobile_signature: string;
  response_signed_bytes: string;
  station_signature: string;
  sas: string;
}
interface SasVector {
  station_pubkey: string;
  mobile_pubkey: string;
  sas_input: string;
  sas_full_hash: string;
  sas: string;
}
interface RequestLayout {
  mobile_pubkey: string;
  token: string;
  requested_at: number;
  signed_bytes: string;
}
interface ResponseLayout {
  station_pubkey: string;
  token: string;
  signed_bytes: string;
}
interface Fixture {
  handshake: Handshake;
  sas_vectors: SasVector[];
  request_layout_vectors: RequestLayout[];
  response_layout_vectors: ResponseLayout[];
}

const fixture = fixtureData as Fixture;

// --- fixture-backed FFI ------------------------------------------------------

// blake3: sas_input hex -> full digest hex, from every SAS vector.
const hashLookup = new Map<string, string>(
  fixture.sas_vectors.map(v => [v.sas_input, v.sas_full_hash]),
);
// Ed25519 verify: only the station's real reply signature is a valid triple.
const validTriples = new Set<string>([
  [
    fixture.handshake.station_pubkey,
    fixture.handshake.response_signed_bytes,
    fixture.handshake.station_signature,
  ].join('|'),
]);
// bech32 address -> raw public-key hex, for the keys the fixture names.
const addressToPubkey = new Map<string, string>([
  [fixture.handshake.station_address, fixture.handshake.station_pubkey],
  [fixture.handshake.mobile_address, fixture.handshake.mobile_pubkey],
]);

function makeSignature(bytes: Uint8Array): Signature {
  if (bytes.length !== 64) throw new Error('bad signature length');
  return {toBytes: () => bytes};
}

function makePublicKey(bytes: Uint8Array, address: string): PublicKey {
  return {
    toBytes: () => bytes,
    toAddress: () => address,
    verify: (message, signature) =>
      validTriples.has(
        [bytesToHex(bytes), bytesToHex(message), bytesToHex(signature.toBytes())].join('|'),
      ),
  };
}

function makeHash(bytes: Uint8Array): Hash {
  const full = hashLookup.get(bytesToHex(bytes));
  if (full === undefined) {
    throw new Error(`no fixture blake3 for input ${bytesToHex(bytes)}`);
  }
  return {toBytes: () => hexToBytes(full), toHex: () => full};
}

const ffi = {
  Keypair: {
    // The request token is `generate().publicKey().toBytes()`; pin it to the
    // fixture's token so the handshake below is fully deterministic.
    generate: () => ({
      publicKey: () => makePublicKey(hexToBytes(fixture.handshake.token), ''),
      sign: () => {
        throw new Error('token keypair should not sign');
      },
    }),
  },
  PublicKey: {
    fromBytes: (data: Uint8Array) => makePublicKey(data, ''),
    fromAddress: (address: string) => {
      const pk = addressToPubkey.get(address);
      if (pk === undefined) throw new Error('unknown address');
      return makePublicKey(hexToBytes(pk), address);
    },
  },
  Signature: {fromBytes: (data: Uint8Array) => makeSignature(data)},
  Hash: {of: (data: Uint8Array) => makeHash(data)},
  isValidAddress: (address: string) => addressToPubkey.has(address),
} as unknown as RrnCryptoFfi;

beforeAll(() => registerRrnCryptoFfi(ffi));

// --- pure byte layouts -------------------------------------------------------

describe('request signed bytes match the station', () => {
  it.each(fixture.request_layout_vectors)(
    'requested_at=$requested_at',
    vector => {
      const bytes = requestSignedBytes(
        hexToBytes(vector.mobile_pubkey),
        hexToBytes(vector.token),
        vector.requested_at,
      );
      expect(bytesToHex(bytes)).toBe(vector.signed_bytes);
    },
  );
});

describe('response signed bytes match the station', () => {
  it.each(fixture.response_layout_vectors)('token=$token', vector => {
    const bytes = responseSignedBytes(
      hexToBytes(vector.station_pubkey),
      hexToBytes(vector.token),
    );
    expect(bytesToHex(bytes)).toBe(vector.signed_bytes);
  });
});

// --- SAS ---------------------------------------------------------------------

describe('confirmation code matches the station', () => {
  it.each(fixture.sas_vectors)('$sas', vector => {
    expect(
      confirmationCode(
        hexToBytes(vector.station_pubkey),
        hexToBytes(vector.mobile_pubkey),
      ),
    ).toBe(vector.sas);
  });

  it('is station-key-first: swapping the pair changes the code', () => {
    // sas_vectors[1] is [0] with the keys swapped.
    expect(fixture.sas_vectors[0].sas).not.toBe(fixture.sas_vectors[1].sas);
  });
});

// --- full handshake ----------------------------------------------------------

describe('requestPairing against the real station vectors', () => {
  const h = fixture.handshake;

  const station: Station = {
    name: 'Fixture Station',
    host: 'fixture.local',
    port: 7500,
    origin: 'discovered',
    address: h.station_address,
    version: '0.1.0',
  };

  const wallet = {
    address: h.mobile_address,
    publicKey: () => makePublicKey(hexToBytes(h.mobile_pubkey), h.mobile_address),
    sign: async (message: Uint8Array) => {
      // The mobile must sign exactly the request bytes the station expects.
      expect(bytesToHex(message)).toBe(h.request_signed_bytes);
      return makeSignature(hexToBytes(h.mobile_signature));
    },
  } as unknown as Wallet;

  it('emits a station-verifiable request and verifies the real reply', async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe('http://fixture.local:7500/pair');
      body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          station_address: h.station_address,
          signature: h.station_signature,
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await requestPairing(station, wallet, {
      now: h.requested_at,
      fetchImpl,
    });

    // The reply verified and produced the station-first SAS.
    expect(result).toEqual({
      ok: true,
      stationAddress: h.station_address,
      sas: h.sas,
      host: 'fixture.local',
      port: 7500,
    });

    // The request the mobile sent is exactly what the station would accept:
    // the same token, timestamp, and — crucially — the mobile signature over
    // the request bytes, which the station verifies with rrn_crypto.
    expect(body).toEqual({
      mobile_address: h.mobile_address,
      token: h.token,
      requested_at: h.requested_at,
      signature: h.mobile_signature,
    });
  });
});
