/**
 * The mobile↔station pairing handshake (T1.3.3).
 *
 * Pairing is the one in-person step ADR-0008 makes the root of all later trust:
 * it binds two static Ed25519 keys and nothing else — there is no certificate to
 * pin or rotate. The mobile POSTs a signed request to the station's `POST /pair`
 * over plain HTTP (the security is the signatures, not the transport), the
 * station replies with a signature proving it holds the key behind its address,
 * and both sides independently derive an 8-hex **short authenticated string**
 * from the two public keys. A human compares that code — read aloud from the
 * operator's `station pair-mobile` against what this screen shows — and only then
 * does each side remember the other. A network man-in-the-middle would have to
 * present its own key, which changes the code, so the comparison catches it.
 *
 * ## Cross-implementation contract
 *
 * The three byte layouts below — {@link requestSignedBytes},
 * {@link responseSignedBytes}, and the SAS input in {@link confirmationCode} —
 * are duplicated in the station's `pairing.rs` / `paired.rs` and must match
 * **byte-for-byte**, or no signature will verify and no code will agree across
 * the two implementations. Each is domain-separated by a version tag, and the
 * SAS hashes the **station key first, then the mobile key** — that order is
 * load-bearing. This is a deliberately plain fixed concatenation rather than the
 * canonical-dCBOR envelope of T1.3.4: pairing bootstraps the keys that channel
 * later relies on, and a fixed layout is easier to keep identical on two
 * platforms than a dCBOR encoder.
 */
import {parseAddress} from '../crypto/address';
import {getRrnCryptoFfi} from '../crypto/ffi';
import {bytesToHex, hexToBytes} from '../crypto/hex';
import {utf8ToBytes} from '../crypto/utf8';
import type {Wallet} from '../wallet/Wallet';
import type {Station} from './Discovery';

/** Domain tag over a mobile's pairing *request*. */
const REQUEST_TAG = utf8ToBytes('rrn-pair-req-v1');
/** Domain tag over a station's pairing *response*. */
const RESPONSE_TAG = utf8ToBytes('rrn-pair-resp-v1');
/** Domain tag over the SAS input, so this hash can never collide with another. */
const SAS_TAG = utf8ToBytes('rrn-pair-sas-v1');

/** How many hex chars of the SAS hash both sides display. Matches the station. */
const SAS_HEX_LEN = 8;

/** Length of an Ed25519 public key, in bytes. */
const PUBKEY_LEN = 32;
/** Length of the request nonce, in bytes. */
const TOKEN_LEN = 32;

/** The station's pairing route. */
const PAIR_PATH = '/pair';

/**
 * How long to wait for the station to answer before giving up. Pairing is a
 * single small round-trip on the local network; a station that has not replied
 * in this long is unreachable, not slow.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * A mobile's pairing request, exactly as it goes on the wire (the JSON body of
 * `POST /pair`). Field names are snake_case to match the station's serde types.
 */
interface PairRequestWire {
  /** This wallet's bech32m `rrn1…` identity address. */
  mobile_address: string;
  /** {@link TOKEN_LEN} random bytes, hex-encoded — a per-request nonce. */
  token: string;
  /** Unix seconds this request was stamped; the station's replay bound (±5 min). */
  requested_at: number;
  /** Ed25519 signature over {@link requestSignedBytes}, hex-encoded. */
  signature: string;
}

/** The station's reply. `station_address` is bech32; `signature` is hex. */
interface PairResponseWire {
  station_address: string;
  signature: string;
}

/** A pairing attempt that reached a station and verified its reply. */
export interface PairingSuccess {
  ok: true;
  /**
   * The station's verified bech32m `rrn1…` identity address — canonicalised from
   * its own key, and the durable thing to persist (ADR-0008). Not the discovered
   * TXT claim, which was never trusted.
   */
  stationAddress: string;
  /**
   * The 8-hex confirmation code to show the user, for comparison against the
   * operator's `station pair-mobile`. Deriving it needed the station's real key,
   * so a matching code is what makes the pair trustworthy.
   */
  sas: string;
  /** Where the station was reached, to persist as a reconnect hint. */
  host: string;
  port: number;
}

/** Why a pairing attempt did not produce a code to confirm. */
export type PairingFailure =
  /** The station could not be reached (offline, wrong host, timed out). */
  | {ok: false; error: 'network'; detail?: string}
  /** The station answered but rejected the request (bad clock skew, etc.). */
  | {ok: false; error: 'rejected'; detail: string}
  /** The reply did not have the shape of a pairing response. */
  | {ok: false; error: 'malformed'}
  /**
   * The reply was shaped right but its signature did not prove the station holds
   * the key behind the address it claimed, or did not bind our request's token.
   * Treated as a hard stop: something is answering that cannot prove it is the
   * station.
   */
  | {ok: false; error: 'unverified'};

export type PairingResult = PairingSuccess | PairingFailure;

/** Options for {@link requestPairing}, all injectable for tests. */
export interface RequestPairingOptions {
  /** Unix seconds to stamp the request with. Defaults to now. */
  now?: number;
  /** The `fetch` to use. Defaults to the global. */
  fetchImpl?: typeof fetch;
}

/**
 * Runs the pairing handshake against `station`, signing with `wallet`.
 *
 * Resolves to a {@link PairingSuccess} carrying the code to confirm — it does
 * **not** persist anything. Remembering the station is a separate, deliberate
 * step the user takes only after they have compared the code (see
 * `pairedStation`). Never rejects: every failure is a typed {@link PairingFailure}
 * so the screen can say what to do about it.
 */
export async function requestPairing(
  station: Station,
  wallet: Wallet,
  options: RequestPairingOptions = {},
): Promise<PairingResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestedAt = options.now ?? Math.floor(Date.now() / 1000);

  const token = generateToken();
  const mobilePk = wallet.publicKey().toBytes();
  const signedBytes = requestSignedBytes(mobilePk, token, requestedAt);
  const signature = (await wallet.sign(signedBytes)).toBytes();

  const body: PairRequestWire = {
    mobile_address: wallet.address,
    token: bytesToHex(token),
    requested_at: requestedAt,
    signature: bytesToHex(signature),
  };

  const response = await post(fetchImpl, station, body);
  if (!response.ok) {
    return response.failure;
  }
  return verifyResponse(response.wire, station, token, mobilePk);
}

/**
 * The exact bytes a mobile signs to prove it holds its key:
 * `TAG ‖ mobile_pubkey(32) ‖ token(32) ‖ requested_at(8, big-endian i64)`.
 * Must match the station's `pairing::request_signed_bytes` byte-for-byte.
 */
export function requestSignedBytes(
  mobilePk: Uint8Array,
  token: Uint8Array,
  requestedAt: number,
): Uint8Array {
  return concat(REQUEST_TAG, mobilePk, token, bigEndianI64(requestedAt));
}

/**
 * The exact bytes a station signs to prove its key and bind its reply to this
 * request: `TAG ‖ station_pubkey(32) ‖ token(32)`. Must match the station's
 * `pairing::response_signed_bytes` byte-for-byte.
 */
export function responseSignedBytes(
  stationPk: Uint8Array,
  token: Uint8Array,
): Uint8Array {
  return concat(RESPONSE_TAG, stationPk, token);
}

/**
 * The 8-hex short authenticated string both sides display, derived from
 * `blake3(TAG ‖ station_pubkey(32) ‖ mobile_pubkey(32))`. The station key comes
 * first — swapping the order is a different pair. Must match the station's
 * `paired::confirmation_code`.
 */
export function confirmationCode(
  stationPk: Uint8Array,
  mobilePk: Uint8Array,
): string {
  const input = concat(SAS_TAG, stationPk, mobilePk);
  return getRrnCryptoFfi().Hash.of(input).toHex().slice(0, SAS_HEX_LEN);
}

// --- internals --------------------------------------------------------------

/**
 * 32 CSPRNG-derived bytes for the request nonce. The mobile carries no JS
 * CSPRNG, and ADR-0003 makes Rust the single source of crypto, so we take a
 * throwaway keypair's public key — 32 bytes the Rust core drew from the OS
 * CSPRNG — rather than adding a second randomness source. The keypair is
 * discarded; only its public-key bytes are used, as an opaque nonce.
 */
function generateToken(): Uint8Array {
  return getRrnCryptoFfi().Keypair.generate().publicKey().toBytes();
}

type PostResult =
  | {ok: true; wire: PairResponseWire}
  | {ok: false; failure: PairingFailure};

/** POSTs the signed request and returns the parsed reply or a typed failure. */
async function post(
  fetchImpl: typeof fetch,
  station: Station,
  body: PairRequestWire,
): Promise<PostResult> {
  const url = `http://${station.host}:${station.port}${PAIR_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    // A refused connection, a DNS miss, or our own timeout abort all land here:
    // the station was not reachable at that address.
    return {
      ok: false,
      failure: {
        ok: false,
        error: 'network',
        detail: e instanceof Error ? e.message : String(e),
      },
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // The station reached us and said no — its body is a short, safe reason
    // (`pairing.rs::PairError::as_str`), which the screen shows the user.
    const detail = (await safeText(res)).trim();
    return {
      ok: false,
      failure: {ok: false, error: 'rejected', detail: detail || `HTTP ${res.status}`},
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return {ok: false, failure: {ok: false, error: 'malformed'}};
  }
  if (!isPairResponseWire(parsed)) {
    return {ok: false, failure: {ok: false, error: 'malformed'}};
  }
  return {ok: true, wire: parsed};
}

/**
 * Verifies the station's reply: its signature must prove it holds the key behind
 * the address it claims, over exactly this request's token. Returns the success
 * with the derived code, or `unverified`.
 */
function verifyResponse(
  wire: PairResponseWire,
  station: Station,
  token: Uint8Array,
  mobilePk: Uint8Array,
): PairingResult {
  const parsedKey = parseAddress(wire.station_address);
  if ('error' in parsedKey) {
    return {ok: false, error: 'unverified'};
  }
  const stationPk = parsedKey.toBytes();

  let verified = false;
  try {
    const signature = getRrnCryptoFfi().Signature.fromBytes(
      hexToBytes(wire.signature),
    );
    verified = parsedKey.verify(responseSignedBytes(stationPk, token), signature);
  } catch {
    // A malformed signature (bad hex, wrong length) is not a verifiable proof —
    // fold it into the same "could not verify the station" outcome.
    verified = false;
  }
  if (!verified) {
    return {ok: false, error: 'unverified'};
  }

  return {
    ok: true,
    // Canonicalise from the verified key rather than trusting the wire string.
    stationAddress: parsedKey.toAddress(),
    sas: confirmationCode(stationPk, mobilePk),
    host: station.host,
    port: station.port,
  };
}

/** Reads a response body as text, never throwing (a body may be absent). */
async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Whether an unknown parsed body has the two string fields of a reply. */
function isPairResponseWire(value: unknown): value is PairResponseWire {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.station_address === 'string' &&
    v.station_address.length > 0 &&
    typeof v.signature === 'string' &&
    v.signature.length > 0
  );
}

/** Encodes a Unix-seconds value as 8 big-endian bytes (an i64, two's complement). */
function bigEndianI64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt(value), false);
  return out;
}

/** Concatenates byte arrays into one. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export {PUBKEY_LEN, TOKEN_LEN};
