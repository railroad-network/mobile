/**
 * @format
 *
 * Mobile seal/open wrapper tests (T1.3.4, ADR-0008 transport envelope).
 *
 * Scope: the real sealed-box crypto (X25519 ECDH + blake3 KDF + XChaCha20)
 * lives in Rust (`rrn_identity::sealed`) and is proven there and in the
 * `rrn-mobile-ffi` FFI tests; it is also exercised end-to-end on device. The
 * native bindings cannot load under Jest, so here we register in-memory handles
 * that model the sealing *contract* — only the matching keypair opens a box, and
 * a wrong key or truncated framing throws — and verify that `seal.ts` delegates
 * to them correctly and marshals bytes through unchanged. This is a wiring test,
 * not a second crypto implementation.
 */
import {open, seal} from '../src/crypto/seal';
import type {Keypair, PublicKey, Signature} from '../src/crypto/ffi';

// A toy "sealed box": recipient id (1 byte) ‖ plaintext. Enough to model the
// one property the wrapper must preserve — a box opens only with the matching
// secret — without standing up real asymmetric crypto in Node.
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function makePublicKey(id: number): PublicKey {
  return {
    toBytes: () => Uint8Array.of(id),
    toAddress: () => `rrn1key${id}`,
    verify: () => {
      throw new Error('verify not exercised by seal tests');
    },
    seal: plaintext => Uint8Array.of(id, ...plaintext),
  };
}

function makeKeypair(id: number): Keypair {
  return {
    publicKey: () => makePublicKey(id),
    sign: (): Signature => {
      throw new Error('sign not exercised by seal tests');
    },
    open: sealedBox => {
      if (sealedBox.length < 1) {
        throw new Error('SealFailed: truncated');
      }
      if (sealedBox[0] !== id) {
        throw new Error('SealFailed: sealed to a different key');
      }
      return sealedBox.slice(1);
    },
  };
}

describe('seal / open', () => {
  test('seal then open round-trips the plaintext', async () => {
    const recipient = makeKeypair(7);
    const plaintext = Uint8Array.of(1, 2, 3, 4, 5);
    const sealed = await seal(recipient.publicKey(), plaintext);
    const opened = await open(recipient, sealed);
    expect(bytesEqual(opened, plaintext)).toBe(true);
  });

  test('the empty plaintext round-trips', async () => {
    const recipient = makeKeypair(3);
    const sealed = await seal(recipient.publicKey(), new Uint8Array(0));
    const opened = await open(recipient, sealed);
    expect(opened).toHaveLength(0);
  });

  test('a box sealed to another key does not open', async () => {
    const recipient = makeKeypair(7);
    const attacker = makeKeypair(9);
    const sealed = await seal(recipient.publicKey(), Uint8Array.of(42));
    await expect(open(attacker, sealed)).rejects.toThrow('SealFailed');
  });

  test('a truncated box is rejected rather than yielding plaintext', async () => {
    const recipient = makeKeypair(1);
    await expect(open(recipient, new Uint8Array(0))).rejects.toThrow('SealFailed');
  });
});
