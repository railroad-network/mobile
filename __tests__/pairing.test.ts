/**
 * @format
 *
 * Pairing seam tests (T1.3.3).
 *
 * The native crypto cannot load under Jest, so this registers a small in-memory
 * FFI — a toy signature scheme (not Ed25519, not Blake3) whose only job is to be
 * internally consistent: a signature made with one key verifies only against
 * that key and that message. That is enough to exercise the seam's control flow
 * and, crucially, the byte layouts — which are asserted directly against the
 * documented `TAG ‖ … ` concatenation, since those are the cross-implementation
 * contract with the station and must not drift.
 *
 * The real cross-platform agreement (that these exact bytes and this SAS match
 * the station's Rust) is a separate, station-generated fixture concern; here we
 * lock the layout the fixture will check against.
 */
import {
  registerRrnCryptoFfi,
  type Hash,
  type Keypair,
  type PublicKey,
  type RrnCryptoFfi,
  type Signature,
} from '../src/crypto/ffi';
import {bytesToHex, hexToBytes} from '../src/crypto/hex';
import {utf8ToBytes} from '../src/crypto/utf8';
import type {Station} from '../src/network/Discovery';
import {
  confirmationCode,
  requestPairing,
  requestSignedBytes,
  responseSignedBytes,
} from '../src/network/Pairing';
import type {Wallet} from '../src/wallet/Wallet';

// --- toy, internally-consistent crypto --------------------------------------

/** A message-sensitive 32-byte fold — stands in for a hash / signature core. */
function fold(msg: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < msg.length; i++) {
    out[i % 32] = (out[i % 32] * 31 + msg[i] + i + 1) % 256;
  }
  return out;
}

/** A 64-byte "signature": the signer's key, then a fold of the message. */
function toySign(pk: Uint8Array, msg: Uint8Array): Uint8Array {
  const sig = new Uint8Array(64);
  sig.set(pk, 0);
  sig.set(fold(msg), 32);
  return sig;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function makeSignature(bytes: Uint8Array): Signature {
  return {toBytes: () => bytes};
}

function makePublicKey(bytes: Uint8Array): PublicKey {
  return {
    toBytes: () => bytes,
    toAddress: () => `rrn1${bytesToHex(bytes)}`,
    verify: (message, signature) => {
      const sig = signature.toBytes();
      // Valid iff the signature was made by *this* key over *this* message.
      return (
        sig.length === 64 &&
        bytesEqual(sig.slice(0, 32), bytes) &&
        bytesEqual(sig.slice(32), fold(message))
      );
    },
    seal: () => {
      throw new Error('seal not exercised by pairing tests');
    },
  };
}

function makeKeypair(pk: Uint8Array): Keypair {
  return {
    publicKey: () => makePublicKey(pk),
    sign: message => makeSignature(toySign(pk, message)),
    open: () => {
      throw new Error('open not exercised by pairing tests');
    },
  };
}

let generateCounter = 0;
function makeHash(bytes: Uint8Array): Hash {
  const h = fold(bytes);
  return {toBytes: () => h, toHex: () => bytesToHex(h)};
}

const ffi = {
  Keypair: {
    generate: () => {
      // Distinct, deterministic bytes per call, so tokens differ across requests.
      generateCounter += 1;
      const pk = new Uint8Array(32);
      for (let i = 0; i < 32; i++) pk[i] = (generateCounter * 97 + i * 13) % 256;
      return makeKeypair(pk);
    },
  },
  PublicKey: {
    fromBytes: (data: Uint8Array) => makePublicKey(data),
    fromAddress: (address: string) => {
      if (!address.startsWith('rrn1')) throw new Error('bad address');
      return makePublicKey(hexToBytes(address.slice(4)));
    },
  },
  Signature: {
    fromBytes: (data: Uint8Array) => {
      if (data.length !== 64) throw new Error('bad signature length');
      return makeSignature(data);
    },
  },
  Hash: {of: (data: Uint8Array) => makeHash(data)},
  isValidAddress: (address: string) => address.startsWith('rrn1'),
} as unknown as RrnCryptoFfi;

beforeAll(() => registerRrnCryptoFfi(ffi));

// --- fixtures ---------------------------------------------------------------

const MOBILE_PK = Uint8Array.from({length: 32}, (_, i) => i + 1);
const STATION_PK = Uint8Array.from({length: 32}, (_, i) => 200 - i);
const STATION_ADDRESS = `rrn1${bytesToHex(STATION_PK)}`;

const wallet = {
  address: `rrn1${bytesToHex(MOBILE_PK)}`,
  publicKey: () => makePublicKey(MOBILE_PK),
  sign: async (message: Uint8Array) => makeSignature(toySign(MOBILE_PK, message)),
} as unknown as Wallet;

const station: Station = {
  name: 'Railroad Station — Test',
  host: 'station.local',
  port: 7500,
  origin: 'discovered',
  address: STATION_ADDRESS,
  version: '0.1.0',
};

/** A minimal duck-typed Response, since Jest's env has no global `Response`. */
function fakeResponse(
  status: number,
  body: unknown,
  opts: {jsonThrows?: boolean} = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (opts.jsonThrows) throw new Error('not json');
      return body;
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** A station that answers correctly, signing over this request's token. */
function goodFetch(): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const req = JSON.parse(init.body as string) as {token: string};
    const token = hexToBytes(req.token);
    const signature = toySign(STATION_PK, responseSignedBytes(STATION_PK, token));
    return fakeResponse(200, {
      station_address: STATION_ADDRESS,
      signature: bytesToHex(signature),
    });
  }) as unknown as typeof fetch;
}

// --- byte layouts (the cross-impl contract) ---------------------------------

describe('requestSignedBytes', () => {
  it('is TAG ‖ mobilePk(32) ‖ token(32) ‖ requested_at(8, big-endian)', () => {
    const token = Uint8Array.from({length: 32}, (_, i) => 100 + i);
    const bytes = requestSignedBytes(MOBILE_PK, token, 1000);

    const tag = utf8ToBytes('rrn-pair-req-v1');
    expect(bytes.length).toBe(tag.length + 32 + 32 + 8);
    expect(Array.from(bytes.slice(0, tag.length))).toEqual(Array.from(tag));
    expect(Array.from(bytes.slice(tag.length, tag.length + 32))).toEqual(
      Array.from(MOBILE_PK),
    );
    expect(Array.from(bytes.slice(tag.length + 32, tag.length + 64))).toEqual(
      Array.from(token),
    );
    // 1000 = 0x00000000000003E8.
    expect(Array.from(bytes.slice(tag.length + 64))).toEqual([0, 0, 0, 0, 0, 0, 3, 232]);
  });
});

describe('responseSignedBytes', () => {
  it('is TAG ‖ stationPk(32) ‖ token(32)', () => {
    const token = Uint8Array.from({length: 32}, (_, i) => i);
    const bytes = responseSignedBytes(STATION_PK, token);

    const tag = utf8ToBytes('rrn-pair-resp-v1');
    expect(bytes.length).toBe(tag.length + 32 + 32);
    expect(Array.from(bytes.slice(0, tag.length))).toEqual(Array.from(tag));
    expect(Array.from(bytes.slice(tag.length, tag.length + 32))).toEqual(
      Array.from(STATION_PK),
    );
    expect(Array.from(bytes.slice(tag.length + 32))).toEqual(Array.from(token));
  });
});

describe('confirmationCode', () => {
  it('is 8 hex chars and deterministic for a pair', () => {
    const code = confirmationCode(STATION_PK, MOBILE_PK);
    expect(code).toMatch(/^[0-9a-f]{8}$/);
    expect(confirmationCode(STATION_PK, MOBILE_PK)).toBe(code);
  });

  it('depends on the order of the keys (station first)', () => {
    expect(confirmationCode(STATION_PK, MOBILE_PK)).not.toBe(
      confirmationCode(MOBILE_PK, STATION_PK),
    );
  });

  it('differs when either key changes', () => {
    const other = Uint8Array.from({length: 32}, () => 9);
    expect(confirmationCode(STATION_PK, MOBILE_PK)).not.toBe(
      confirmationCode(other, MOBILE_PK),
    );
    expect(confirmationCode(STATION_PK, MOBILE_PK)).not.toBe(
      confirmationCode(STATION_PK, other),
    );
  });
});

// --- the handshake ----------------------------------------------------------

describe('requestPairing', () => {
  it('returns the verified station address, code, and where it was reached', async () => {
    const result = await requestPairing(station, wallet, {
      now: 1000,
      fetchImpl: goodFetch(),
    });
    expect(result).toEqual({
      ok: true,
      stationAddress: STATION_ADDRESS,
      sas: confirmationCode(STATION_PK, MOBILE_PK),
      host: 'station.local',
      port: 7500,
    });
  });

  it('POSTs a request signed over the exact request bytes', async () => {
    let captured: {url: string; body: Record<string, unknown>} | null = null;
    const spyFetch = (async (url: string, init: RequestInit) => {
      captured = {url, body: JSON.parse(init.body as string)};
      const req = captured.body as {token: string};
      const token = hexToBytes(req.token);
      return fakeResponse(200, {
        station_address: STATION_ADDRESS,
        signature: bytesToHex(
          toySign(STATION_PK, responseSignedBytes(STATION_PK, token)),
        ),
      });
    }) as unknown as typeof fetch;

    await requestPairing(station, wallet, {now: 4242, fetchImpl: spyFetch});

    expect(captured!.url).toBe('http://station.local:7500/pair');
    const body = captured!.body as {
      mobile_address: string;
      token: string;
      requested_at: number;
      signature: string;
    };
    expect(body.mobile_address).toBe(wallet.address);
    expect(body.requested_at).toBe(4242);
    // The signature must verify against the mobile key over the request bytes.
    const token = hexToBytes(body.token);
    const signed = requestSignedBytes(MOBILE_PK, token, 4242);
    const sig = ffi.Signature.fromBytes(hexToBytes(body.signature));
    expect(makePublicKey(MOBILE_PK).verify(signed, sig)).toBe(true);
  });

  it('uses a fresh 32-byte token each request', async () => {
    const tokens: string[] = [];
    const spyFetch = (async (_url: string, init: RequestInit) => {
      const req = JSON.parse(init.body as string) as {token: string};
      tokens.push(req.token);
      const token = hexToBytes(req.token);
      return fakeResponse(200, {
        station_address: STATION_ADDRESS,
        signature: bytesToHex(
          toySign(STATION_PK, responseSignedBytes(STATION_PK, token)),
        ),
      });
    }) as unknown as typeof fetch;

    await requestPairing(station, wallet, {fetchImpl: spyFetch});
    await requestPairing(station, wallet, {fetchImpl: spyFetch});
    expect(tokens[0]).toHaveLength(64);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('reports a network failure when the station is unreachable', async () => {
    const failFetch = (async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;
    const result = await requestPairing(station, wallet, {fetchImpl: failFetch});
    expect(result).toEqual({
      ok: false,
      error: 'network',
      detail: 'Network request failed',
    });
  });

  it('surfaces the station’s rejection reason', async () => {
    const rejectFetch = (async () =>
      fakeResponse(400, 'requested_at outside allowed clock skew')) as unknown as typeof fetch;
    const result = await requestPairing(station, wallet, {fetchImpl: rejectFetch});
    expect(result).toEqual({
      ok: false,
      error: 'rejected',
      detail: 'requested_at outside allowed clock skew',
    });
  });

  it('treats a reply missing fields as malformed', async () => {
    const badFetch = (async () =>
      fakeResponse(200, {station_address: STATION_ADDRESS})) as unknown as typeof fetch;
    expect(await requestPairing(station, wallet, {fetchImpl: badFetch})).toEqual({
      ok: false,
      error: 'malformed',
    });
  });

  it('treats an unparseable body as malformed', async () => {
    const badFetch = (async () =>
      fakeResponse(200, null, {jsonThrows: true})) as unknown as typeof fetch;
    expect(await requestPairing(station, wallet, {fetchImpl: badFetch})).toEqual({
      ok: false,
      error: 'malformed',
    });
  });

  it('rejects a reply whose address does not parse', async () => {
    const badFetch = (async () =>
      fakeResponse(200, {
        station_address: 'not-an-address',
        signature: bytesToHex(new Uint8Array(64)),
      })) as unknown as typeof fetch;
    expect(await requestPairing(station, wallet, {fetchImpl: badFetch})).toEqual({
      ok: false,
      error: 'unverified',
    });
  });

  it('rejects a reply signed by a different key', async () => {
    const imposterPk = Uint8Array.from({length: 32}, () => 42);
    const badFetch = (async (_url: string, init: RequestInit) => {
      const req = JSON.parse(init.body as string) as {token: string};
      const token = hexToBytes(req.token);
      // Claims the station's address but signs with the imposter's key.
      return fakeResponse(200, {
        station_address: STATION_ADDRESS,
        signature: bytesToHex(
          toySign(imposterPk, responseSignedBytes(STATION_PK, token)),
        ),
      });
    }) as unknown as typeof fetch;
    expect(await requestPairing(station, wallet, {fetchImpl: badFetch})).toEqual({
      ok: false,
      error: 'unverified',
    });
  });

  it('rejects a reply signed over a different token (no replay)', async () => {
    const badFetch = (async () => {
      const otherToken = Uint8Array.from({length: 32}, () => 5);
      return fakeResponse(200, {
        station_address: STATION_ADDRESS,
        signature: bytesToHex(
          toySign(STATION_PK, responseSignedBytes(STATION_PK, otherToken)),
        ),
      });
    }) as unknown as typeof fetch;
    expect(await requestPairing(station, wallet, {fetchImpl: badFetch})).toEqual({
      ok: false,
      error: 'unverified',
    });
  });
});
