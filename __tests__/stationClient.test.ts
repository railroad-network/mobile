/**
 * @format
 *
 * Authenticated request-channel client tests (T1.3.4, ADR-0008).
 *
 * The real sealing/signing lives in Rust (proven by the station's integration
 * test and the on-device run); here we register an in-memory FFI that models the
 * *contract* — seal binds a recipient key, open rejects a box not meant for us,
 * sign/verify are consistent — and stand up a faithful **loopback station** in
 * the fake `fetch`: it opens the sealed request with the station key, echoes the
 * request nonce, and seals a signed JSON reply back to the mobile. That exercises
 * the whole client round-trip (envelope build → frame → seal → POST → open →
 * verify → parse) plus its typed failure mapping, without real crypto.
 */
import {registerRrnCryptoFfi, type RrnCryptoFfi} from '../src/crypto/ffi';
import {bytesToHex, hexToBytes} from '../src/crypto/hex';
import {bytesToUtf8, utf8ToBytes} from '../src/crypto/utf8';
import type {SecureStore} from '../src/crypto/SecureStore';
import {addPairedStation} from '../src/network/pairedStation';
import {StationClient, StationClientError} from '../src/network/StationClient';
import type {Wallet} from '../src/wallet/Wallet';

// --- in-memory secure store -------------------------------------------------

class MemStore implements SecureStore {
  readonly map = new Map<string, Uint8Array>();
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

// --- a tiny consistent crypto model -----------------------------------------
//
// A key is identified by a 32-byte pubkey (here filled from a one-byte tag).
// seal(pt) = recipientPubkey(32) ‖ pt; open strips it iff addressed to us.
// A signature is 64 deterministic bytes over (pubkey, message).

const MOBILE_TAG = 0x11;
const STATION_TAG = 0x22;

const pubkeyFor = (tag: number): Uint8Array => new Uint8Array(32).fill(tag);
const addressFor = (tag: number): string => `rrn1${bytesToHex(pubkeyFor(tag))}`;

function sigFor(pubkey: Uint8Array, message: Uint8Array): Uint8Array {
  let acc = 0;
  for (const b of pubkey) acc = (acc + b) & 0xff;
  for (const b of message) acc = (acc * 31 + b) & 0xff;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = (acc + i) & 0xff;
  return out;
}

interface FakeSignature {
  toBytes(): Uint8Array;
}
function makeSignature(bytes: Uint8Array): FakeSignature {
  return {toBytes: () => bytes};
}

function makePublicKey(tag: number) {
  const pk = pubkeyFor(tag);
  return {
    toBytes: () => pk,
    toAddress: () => addressFor(tag),
    verify: (message: Uint8Array, signature: FakeSignature) =>
      bytesToHex(signature.toBytes()) === bytesToHex(sigFor(pk, message)),
    seal: (plaintext: Uint8Array) => {
      const out = new Uint8Array(pk.length + plaintext.length);
      out.set(pk, 0);
      out.set(plaintext, pk.length);
      return out;
    },
  };
}

function makeKeypair(tag: number) {
  const pk = pubkeyFor(tag);
  return {
    publicKey: () => makePublicKey(tag),
    sign: (message: Uint8Array) => makeSignature(sigFor(pk, message)),
    open: (sealed: Uint8Array) => {
      if (bytesToHex(sealed.subarray(0, 32)) !== bytesToHex(pk)) {
        throw new Error('sealed to a different key');
      }
      return sealed.subarray(32);
    },
  };
}

/** A duck-typed Wallet for the mobile side. */
function makeWallet(tag: number): Wallet {
  const kp = makeKeypair(tag);
  return {
    address: addressFor(tag),
    publicKey: () => kp.publicKey(),
    sign: async (m: Uint8Array) => kp.sign(m),
    open: async (s: Uint8Array) => kp.open(s),
  } as unknown as Wallet;
}

const tagForAddress = new Map<string, number>([
  [addressFor(MOBILE_TAG), MOBILE_TAG],
  [addressFor(STATION_TAG), STATION_TAG],
]);

const fakeFfi = {
  Keypair: {generate: () => makeKeypair(0)},
  PublicKey: {
    fromBytes: () => {
      throw new Error('not used');
    },
    fromAddress: (address: string) => {
      const tag = tagForAddress.get(address);
      if (tag === undefined) throw new Error(`invalid address: ${address}`);
      return makePublicKey(tag);
    },
  },
  Signature: {fromBytes: (data: Uint8Array) => makeSignature(data)},
  Hash: {of: () => ({toBytes: () => new Uint8Array(32), toHex: () => '00'})},
  isValidAddress: (a: string) => tagForAddress.has(a),
  // canonicalBytes: the request envelope is a tagged CBOR model; for the test we
  // encode it as its deterministic JSON so the loopback station can read fields.
  canonicalBytes: (json: string) => utf8ToBytes(json),
  WalletContents: {createNew: () => makeKeypair(0)},
  EncryptedWallet: {
    encrypt: () => {
      throw new Error('not used');
    },
    fromBytes: () => {
      throw new Error('not used');
    },
  },
  RecoveryPackage: {create: () => {
    throw new Error('not used');
  }},
  parseShardPayload: () => {
    throw new Error('not used');
  },
} as unknown as RrnCryptoFfi;

// --- the loopback station (inside the fake fetch) ---------------------------

const LEN = 4;
const readLen = (b: Uint8Array): number =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, false);
function frameReply(payload: Uint8Array, sig: Uint8Array): Uint8Array {
  const out = new Uint8Array(LEN + payload.length + sig.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, LEN);
  out.set(sig, LEN + payload.length);
  return out;
}

/** Reads the request envelope's fields from a sealed request. */
function readRequest(sealed: Uint8Array): {nonce: number; method: string; params: string; signerTag: number} {
  const frame = makeKeypair(STATION_TAG).open(sealed); // throws if not for us
  const payload = frame.subarray(LEN, LEN + readLen(frame));
  const model = JSON.parse(bytesToUtf8(payload)) as {map: Array<[string, Record<string, string>]>};
  const fields = Object.fromEntries(model.map);
  const signerHex = fields.signer.bytes;
  return {
    nonce: Number(fields.nonce.int),
    method: fields.method.text,
    params: fields.params.text,
    signerTag: hexToBytes(signerHex)[0],
  };
}

/** Seals a signed JSON reply back to the mobile that sent `sealed`. */
function stationReply(
  sealed: Uint8Array,
  build: (method: string, params: string) => {result?: string; error?: {code: number; message: string}},
  overrides: {nonce?: number; version?: number; signWrong?: boolean} = {},
): Uint8Array {
  const {nonce, method, params, signerTag} = readRequest(sealed);
  const body = build(method, params);
  const payload = utf8ToBytes(
    JSON.stringify({v: overrides.version ?? 1, nonce: overrides.nonce ?? nonce, ...body}),
  );
  const stationPk = pubkeyFor(STATION_TAG);
  const sig = overrides.signWrong
    ? new Uint8Array(64) // a signature that will not verify
    : sigFor(stationPk, payload);
  const frame = frameReply(payload, sig);
  return makePublicKey(signerTag).seal(frame);
}

function okResponse(body: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}
function errResponse(status: number, reason: string): Response {
  return {ok: false, status, text: async () => reason} as unknown as Response;
}

// --- tests ------------------------------------------------------------------

const STATION_ADDR = addressFor(STATION_TAG);

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

async function pairedStore(): Promise<MemStore> {
  const store = new MemStore();
  await addPairedStation(
    {address: STATION_ADDR, host: '192.168.1.5', port: 7500, pairedAt: 1000},
    store,
  );
  return store;
}

function clientWith(
  store: MemStore,
  fetchImpl: typeof fetch,
): StationClient {
  return new StationClient(makeWallet(MOBILE_TAG), STATION_ADDR, {
    store,
    fetchImpl,
    now: () => 1_700_000_000,
  });
}

describe('StationClient', () => {
  test('balance round-trips through seal/sign/open/verify', async () => {
    const store = await pairedStore();
    const fetchImpl = (async (_url: string, init: {body: Uint8Array}) =>
      okResponse(
        stationReply(init.body, () => ({result: JSON.stringify({balance_centi: 2400})})),
      )) as unknown as typeof fetch;

    const client = clientWith(store, fetchImpl);
    const result = await client.balance();
    expect(result.balance_centi).toBe(2400);
  });

  test('posts to /rpc on the resolved endpoint', async () => {
    const store = await pairedStore();
    let seenUrl = '';
    const fetchImpl = (async (url: string, init: {body: Uint8Array}) => {
      seenUrl = url;
      return okResponse(stationReply(init.body, () => ({result: JSON.stringify({address: STATION_ADDR})})));
    }) as unknown as typeof fetch;

    await clientWith(store, fetchImpl).whoami();
    expect(seenUrl).toBe('http://192.168.1.5:7500/rpc');
  });

  test('the request carries the method and JSON params', async () => {
    const store = await pairedStore();
    let seen: {method: string; params: string} | null = null;
    const fetchImpl = (async (_url: string, init: {body: Uint8Array}) => {
      const {method, params} = readRequest(init.body);
      seen = {method, params};
      return okResponse(stationReply(init.body, () => ({result: JSON.stringify({transactions: []})})));
    }) as unknown as typeof fetch;

    await clientWith(store, fetchImpl).transactions('rrn1me', 25);
    expect(seen).toEqual({method: 'transactions', params: JSON.stringify({address: 'rrn1me', limit: 25})});
  });

  test('nonces strictly increase across calls', async () => {
    const store = await pairedStore();
    const nonces: number[] = [];
    const fetchImpl = (async (_url: string, init: {body: Uint8Array}) => {
      nonces.push(readRequest(init.body).nonce);
      return okResponse(stationReply(init.body, () => ({result: '{}'})));
    }) as unknown as typeof fetch;

    const client = clientWith(store, fetchImpl);
    await client.whoami();
    await client.whoami();
    await client.whoami();
    expect(nonces).toEqual([1, 2, 3]);
  });

  test('a method error becomes a method-error', async () => {
    const store = await pairedStore();
    const fetchImpl = (async (_url: string, init: {body: Uint8Array}) =>
      okResponse(
        stationReply(init.body, () => ({error: {code: -32601, message: 'method not available'}})),
      )) as unknown as typeof fetch;

    const err = await clientWith(store, fetchImpl).whoami().catch(e => e);
    expect(err).toBeInstanceOf(StationClientError);
    expect(err.kind).toBe('method-error');
    expect(err.code).toBe(-32601);
  });

  test('a 401 is unauthenticated', async () => {
    const store = await pairedStore();
    const fetchImpl = (async () => errResponse(401, 'stale or replayed nonce')) as unknown as typeof fetch;
    const err = await clientWith(store, fetchImpl).whoami().catch(e => e);
    expect(err.kind).toBe('unauthenticated');
  });

  test('a 503 and a network failure are both unreachable', async () => {
    const store = await pairedStore();
    const err503 = await clientWith(store, (async () => errResponse(503, 'down')) as unknown as typeof fetch)
      .whoami()
      .catch(e => e);
    expect(err503.kind).toBe('unreachable');

    const errNet = await clientWith(store, (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch)
      .whoami()
      .catch(e => e);
    expect(errNet.kind).toBe('unreachable');
  });

  test('an unpaired station is unreachable (not-paired)', async () => {
    const store = new MemStore(); // no pairing recorded
    const err = await clientWith(store, (async () => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch)
      .whoami()
      .catch(e => e);
    expect(err.kind).toBe('unreachable');
  });

  test('a reply signed by the wrong key is unverified', async () => {
    const store = await pairedStore();
    const fetchImpl = (async (_url: string, init: {body: Uint8Array}) =>
      okResponse(
        stationReply(init.body, () => ({result: '{}'}), {signWrong: true}),
      )) as unknown as typeof fetch;
    const err = await clientWith(store, fetchImpl).whoami().catch(e => e);
    expect(err.kind).toBe('unverified');
  });

  test('a reply echoing the wrong nonce is rejected as malformed', async () => {
    const store = await pairedStore();
    const fetchImpl = (async (_url: string, init: {body: Uint8Array}) =>
      okResponse(
        stationReply(init.body, () => ({result: '{}'}), {nonce: 999}),
      )) as unknown as typeof fetch;
    const err = await clientWith(store, fetchImpl).whoami().catch(e => e);
    expect(err.kind).toBe('malformed');
  });
});
