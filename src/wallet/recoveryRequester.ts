/**
 * The requester side of a key-recovery ceremony, run on the device rebuilding
 * its OWN identity — a new phone or a laptop recovering a lost key (ADR-0016).
 *
 * The counterpart to {@link Wallet.respondToRecovery} (the holder side): this
 * device mints an ephemeral recovery keypair, shows a {@link requestQr} for
 * holders to scan, gathers the {@link addResponseQr} responses they hand back,
 * and — once enough distinct shares are in — {@link reconstruct}s the wallet.
 * All of the crypto lives in Rust: the ephemeral secret and the rebuilt key
 * never cross the FFI, only the finished {@link Wallet} handle does, exactly
 * like a brand-new identity. The station is never involved and learns nothing
 * (ADR-0006) — a station cannot hold a member's key.
 *
 * Both failure surfaces fail safe. A scanned response that decodes but is not
 * for this ceremony is rejected ({@link addResponseQr} → `wrong-ceremony`)
 * rather than mixed in, and a reconstruction attempt with too few (or wrong)
 * shares reports `need-more` rather than ever returning a wrong key: Shamir with
 * fewer than `K` shares yields a *different* secret, and Rust checks the rebuilt
 * key against the target address before handing anything back.
 */
import {getRrnCryptoFfi, type RecoverySession as FfiRecoverySession} from '../crypto/ffi';
import {decodeResponseQr, encodeRequestQr} from './recoveryCeremony';
import {Wallet} from './Wallet';

/** The outcome of feeding a scanned QR to {@link RecoverySession.addResponseQr}. */
export type AddResponseResult =
  /** Accepted; `responses` is the distinct count gathered so far. A re-scan of a
   * share already held leaves the count unchanged. */
  | {kind: 'added'; responses: number}
  /** The scanned string was not a `rrnrecover-resp:` QR at all (wrong prefix or
   * corrupt base64) — e.g. someone scanned a shard or an address. */
  | {kind: 'not-a-response'}
  /** It decoded as a response, but for a *different* ceremony — it cannot be
   * opened with this session's ephemeral key. */
  | {kind: 'wrong-ceremony'};

/** The outcome of {@link RecoverySession.reconstruct}. */
export type ReconstructResult =
  | {kind: 'recovered'; wallet: Wallet}
  /** Too few responses, or the shares don't rebuild the target — keep scanning. */
  | {kind: 'need-more'};

/**
 * A live reconstruction ceremony. Wraps the Rust {@link FfiRecoverySession}
 * handle, which owns the ephemeral secret and zeroizes it on drop.
 */
export class RecoverySession {
  private constructor(private readonly inner: FfiRecoverySession) {}

  /**
   * Begins a ceremony to recover `targetAddress`. Throws (recovery error) if the
   * address is malformed.
   */
  static begin(targetAddress: string): RecoverySession {
    return new RecoverySession(
      getRrnCryptoFfi().RecoverySession.create(targetAddress),
    );
  }

  /** The `rrnrecover-req:<base64>` string to render as the request QR. */
  requestQr(): string {
    return encodeRequestQr(this.inner.requestPayload());
  }

  /** The ceremony fingerprint (`xxxxx-xxxxx`); every holder must see this exact
   * code on their screen. */
  fingerprint(): string {
    return this.inner.fingerprint();
  }

  /** How many distinct holder responses have been gathered. */
  get responses(): number {
    return this.inner.responses();
  }

  /**
   * Adds a scanned holder-response QR string, deduplicating a re-scan of the same
   * share. Never throws — a QR that is not a valid response for this ceremony is
   * reported, not raised.
   */
  addResponseQr(value: string): AddResponseResult {
    const bytes = decodeResponseQr(value);
    if (bytes === null) {
      return {kind: 'not-a-response'};
    }
    try {
      return {kind: 'added', responses: this.inner.addResponse(bytes)};
    } catch {
      // A response for another ceremony (or corrupt bytes) cannot be opened with
      // this session's ephemeral key.
      return {kind: 'wrong-ceremony'};
    }
  }

  /**
   * Rebuilds the wallet from the responses gathered so far, or reports
   * `need-more` when there are too few (or the shares don't rebuild the target
   * address) — never a wrong key.
   */
  reconstruct(): ReconstructResult {
    try {
      return {kind: 'recovered', wallet: Wallet.fromContents(this.inner.reconstruct())};
    } catch {
      return {kind: 'need-more'};
    }
  }
}
