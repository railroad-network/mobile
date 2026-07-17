/**
 * Sealing and opening transport envelopes (T1.3.4, ADR-0008).
 *
 * The mobile↔station channel is plain HTTP; its confidentiality and integrity
 * come from an application-layer **sealed box** (see the station's
 * `rrn_identity::sealed`). The mobile seals a request to its paired station's
 * public key so only that station can read it, and opens the station's sealed
 * reply with its own secret. Both directions delegate to the Rust core via the
 * FFI — mobile carries no sealing crypto of its own, and the same construction
 * is reused for recovery-shard sealing, so there is one audited path.
 *
 * The sealed bytes are **opaque**: this module and its callers never parse them.
 * `seal` hands the phone a black box to POST; `open` hands it back plaintext.
 * The framing agreement lives entirely in Rust, on both ends of the wire.
 *
 * `async` to match the rest of the FFI-backed crypto surface (`sign.ts`), even
 * though the current FFI returns synchronously.
 */
import type {Keypair, PublicKey} from './ffi';

/**
 * Seals `plaintext` to `recipient` (the paired station's public key), returning
 * opaque sealed bytes only the recipient's secret can open. Rejects only if the
 * recipient key is malformed (unreachable for a validated {@link PublicKey}).
 */
export async function seal(
  recipient: PublicKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  return recipient.seal(plaintext);
}

/**
 * Opens a `sealedBox` addressed to `keypair`'s public key, returning the
 * plaintext. Rejects (throws) on a wrong key, wrong context, truncated framing,
 * or tampering — it never yields wrong plaintext. The secret stays in Rust.
 */
export async function open(
  keypair: Keypair,
  sealedBox: Uint8Array,
): Promise<Uint8Array> {
  return keypair.open(sealedBox);
}

export type {Keypair, PublicKey} from './ffi';
