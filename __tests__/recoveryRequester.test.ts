/**
 * @format
 *
 * The requester-side reconstruction wrapper ({@link RecoverySession}), driven
 * over a fake FFI (the native crypto can't load under Jest). Exercises the real
 * wrapper logic — QR encode/decode, dedupe-by-count, and the fail-safe error
 * mapping the D4 invariant hinges on: a response for a different ceremony is
 * refused (never mixed in), and a reconstruction that doesn't rebuild the target
 * is reported as "need more", never a wrong key.
 */
import {registerRrnCryptoFfi, type RrnCryptoFfi} from '../src/crypto/ffi';
import {
  RESPONSE_QR_PREFIX,
  encodeRequestQr,
  encodeResponseQr,
} from '../src/wallet/recoveryCeremony';
import {RecoverySession} from '../src/wallet/recoveryRequester';

// A scanned response whose first byte is this marker makes the fake FFI throw,
// standing in for a response minted under a *different* ceremony's key.
const WRONG_MARKER = 0xff;

interface FakeState {
  count: number;
  rebuild: boolean; // whether reconstruct() should succeed
}

function registerFakeFfi(state: FakeState): void {
  const fakeContents = {address: () => 'rrn1recovered'};
  const fakeSession = {
    requestPayload: () => Uint8Array.from([1, 2, 3]),
    fingerprint: () => '3dffd-e60ea',
    addResponse: (bytes: Uint8Array) => {
      if (bytes[0] === WRONG_MARKER) {
        throw new Error('Corrupt'); // not openable with this ceremony's key
      }
      state.count += 1;
      return state.count;
    },
    responses: () => state.count,
    reconstruct: () => {
      if (!state.rebuild) {
        throw new Error('NeedMoreResponses');
      }
      return fakeContents;
    },
  };
  registerRrnCryptoFfi({
    RecoverySession: {create: (_addr: string) => fakeSession},
  } as unknown as RrnCryptoFfi);
}

describe('RecoverySession (requester wrapper)', () => {
  test('requestQr encodes the request bytes and fingerprint passes through', () => {
    registerFakeFfi({count: 0, rebuild: false});
    const session = RecoverySession.begin('rrn1lost');
    expect(session.requestQr()).toBe(encodeRequestQr(Uint8Array.from([1, 2, 3])));
    expect(session.fingerprint()).toBe('3dffd-e60ea');
  });

  test('a well-formed response is accepted and the count advances', () => {
    const state = {count: 0, rebuild: false};
    registerFakeFfi(state);
    const session = RecoverySession.begin('rrn1lost');

    const r = session.addResponseQr(encodeResponseQr(Uint8Array.from([10, 11])));
    expect(r).toEqual({kind: 'added', responses: 1});
  });

  test('a non-response QR is rejected without touching the FFI', () => {
    registerFakeFfi({count: 0, rebuild: false});
    const session = RecoverySession.begin('rrn1lost');

    expect(session.addResponseQr('rrn1plainaddress')).toEqual({kind: 'not-a-response'});
    // A corrupt-base64 response prefix is not a usable response either.
    expect(session.addResponseQr(RESPONSE_QR_PREFIX + '%%%')).toEqual({
      kind: 'not-a-response',
    });
  });

  test('a response from another ceremony is refused, not mixed in', () => {
    const state = {count: 0, rebuild: false};
    registerFakeFfi(state);
    const session = RecoverySession.begin('rrn1lost');

    const r = session.addResponseQr(encodeResponseQr(Uint8Array.from([WRONG_MARKER, 1])));
    expect(r).toEqual({kind: 'wrong-ceremony'});
    expect(state.count).toBe(0);
  });

  test('reconstruct reports need-more until the shares rebuild the target', () => {
    const state = {count: 2, rebuild: false};
    registerFakeFfi(state);
    const session = RecoverySession.begin('rrn1lost');
    expect(session.reconstruct()).toEqual({kind: 'need-more'});
  });

  test('reconstruct returns the rebuilt wallet once enough shares are in', () => {
    registerFakeFfi({count: 3, rebuild: true});
    const session = RecoverySession.begin('rrn1lost');
    const result = session.reconstruct();
    expect(result.kind).toBe('recovered');
    if (result.kind === 'recovered') {
      expect(result.wallet.address).toBe('rrn1recovered');
    }
  });
});
