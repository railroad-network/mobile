/**
 * @format
 *
 * Address QR parse/encode seam (T1.4.2).
 *
 * The parser accepts both the shipped bare-bech32 address QR and the optional
 * `rrn:address?addr=…&n=…` URI envelope, and rejects anything else (other QR
 * kinds, invalid addresses, garbage). Address validity is the one Rust bech32m
 * impl reached via the FFI; here we register an in-memory FFI whose
 * `isValidAddress` is set-membership over a couple of known-good `rrn1…` strings
 * (the established pattern in address.test.ts) — this module carries no address
 * logic to test, only the payload framing around it.
 */
import {encodeAddressQr, parseAddressQr} from '../src/ledger/addressQr';
import {registerRrnCryptoFfi, type RrnCryptoFfi} from '../src/crypto/ffi';

const ADDR_A =
  'rrn18d4z00xwk6jz6c4r4rgz5mcdwdjny9thrh3y8f36cpy2rz6emg5scr4w0n';
const ADDR_B =
  'rrn1vfmcjcqd235ukvz3u9a4x0say5p0w97lasvvuds6smddwmrdzkqqgauurf';
const VALID = new Set([ADDR_A, ADDR_B]);

function throwUnused(): never {
  throw new Error('not exercised by addressQr tests');
}

const fakeFfi: RrnCryptoFfi = {
  RecoveryPackage: {create: () => throwUnused()},
  parseShardPayload: () => throwUnused(),
  Keypair: {generate: () => throwUnused()},
  Signature: {fromBytes: () => throwUnused()},
  Hash: {of: () => throwUnused()},
  PublicKey: {fromBytes: () => throwUnused(), fromAddress: () => throwUnused()},
  isValidAddress: (address: string): boolean => VALID.has(address),
  canonicalBytes: () => throwUnused(),
  WalletContents: {createNew: () => throwUnused()},
  EncryptedWallet: {encrypt: () => throwUnused(), fromBytes: () => throwUnused()},
};

beforeAll(() => registerRrnCryptoFfi(fakeFfi));

describe('parseAddressQr', () => {
  test('accepts a bare bech32 address', () => {
    expect(parseAddressQr(ADDR_A)).toEqual({address: ADDR_A});
  });

  test('trims surrounding whitespace on a bare address', () => {
    expect(parseAddressQr(`  ${ADDR_A}\n`)).toEqual({address: ADDR_A});
  });

  test('accepts a URI envelope with a nickname', () => {
    expect(parseAddressQr(`rrn:address?addr=${ADDR_A}&n=Alice`)).toEqual({
      address: ADDR_A,
      nickname: 'Alice',
    });
  });

  test('url-decodes the nickname (percent- and plus-encoded)', () => {
    expect(parseAddressQr(`rrn:address?addr=${ADDR_A}&n=Al%20ice`)).toEqual({
      address: ADDR_A,
      nickname: 'Al ice',
    });
    expect(parseAddressQr(`rrn:address?addr=${ADDR_A}&n=Al+ice`)).toEqual({
      address: ADDR_A,
      nickname: 'Al ice',
    });
  });

  test('omits the nickname when absent or empty', () => {
    expect(parseAddressQr(`rrn:address?addr=${ADDR_A}`)).toEqual({
      address: ADDR_A,
    });
    expect(parseAddressQr(`rrn:address?addr=${ADDR_A}&n=`)).toEqual({
      address: ADDR_A,
    });
    expect(parseAddressQr(`rrn:address?addr=${ADDR_A}&n=%20%20`)).toEqual({
      address: ADDR_A,
    });
  });

  test('is order-independent in the query', () => {
    expect(parseAddressQr(`rrn:address?n=Bob&addr=${ADDR_B}`)).toEqual({
      address: ADDR_B,
      nickname: 'Bob',
    });
  });

  test('clamps an over-long nickname to 200 chars', () => {
    const long = 'x'.repeat(500);
    const result = parseAddressQr(`rrn:address?addr=${ADDR_A}&n=${long}`);
    expect(result?.nickname).toHaveLength(200);
  });

  test('rejects an invalid address (bare and URI)', () => {
    expect(parseAddressQr('rrn1notavalidaddress')).toBeNull();
    expect(parseAddressQr('rrn:address?addr=rrn1notvalid&n=x')).toBeNull();
  });

  test('rejects a URI envelope missing the addr field', () => {
    expect(parseAddressQr('rrn:address?n=Alice')).toBeNull();
  });

  test('rejects other QR kinds and garbage', () => {
    expect(parseAddressQr('rrnrecovery:AAAA')).toBeNull();
    expect(parseAddressQr(`rrn:pair?token=abc&pubkey=${ADDR_A}`)).toBeNull();
    expect(parseAddressQr('https://example.com')).toBeNull();
    expect(parseAddressQr('')).toBeNull();
  });
});

describe('encodeAddressQr', () => {
  test('emits the bare bech32 address unchanged', () => {
    expect(encodeAddressQr(ADDR_A)).toBe(ADDR_A);
  });

  test('round-trips through parseAddressQr', () => {
    expect(parseAddressQr(encodeAddressQr(ADDR_B))).toEqual({address: ADDR_B});
  });

  test('throws on a non-address input', () => {
    expect(() => encodeAddressQr('not-an-address')).toThrow();
  });
});
