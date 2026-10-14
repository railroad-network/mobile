/**
 * The social-recovery shards this device holds *for other people* (T1.2.3).
 *
 * When a friend sets up recovery and hands this device one of their sealed
 * shards, it is filed here so it survives until they ever need to be restored.
 * A device can hold shards for many different wallets, so the store is a map
 * keyed by the `originalAddress` the shard helps recover — one entry per wallet.
 *
 * What is stored is the **sealed** shard payload exactly as scanned: it is
 * encrypted to this holder's public key, and a single shard is below the
 * reconstruction threshold, so it reveals nothing about the friend's key on its
 * own (see `docs/threat-model`, mobile social-recovery UI surface). It is kept
 * through {@link SecureStore} — the app's one persistence backend — without a
 * biometric gate, since it is already ciphertext and gating every read would
 * prompt the holder needlessly.
 */
import {parseAddress} from '../crypto/address';
import {base64ToBytes} from '../crypto/base64';
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** One sealed shard this device is holding on someone else's behalf. */
export interface HeldShard {
  /** The `rrn1…` address of the wallet this shard helps recover — the map key. */
  originalAddress: string;
  /** The `rrn1…` address the shard is sealed to — normally this device's
   * identity; a row sealed elsewhere is kept and flagged, never used. */
  holderAddress: string;
  /** `K` — how many holders must cooperate to reconstruct the friend's wallet. */
  threshold: number;
  /** `N` — how many holders the friend split their key across. */
  total: number;
  /** The sealed shard payload, base64-encoded (the bytes that were scanned). */
  payload: string;
  /** Unix seconds when this shard was received. */
  receivedAt: number;
}

/** The persisted map of held shards, keyed by `originalAddress`. */
export type HeldShards = Record<string, HeldShard>;

/**
 * Loads every shard held on this device, or an empty map if none are held (or
 * the stored blob is unreadable — treated as "none" rather than crashing).
 */
export async function loadHeldShards(
  store: SecureStore = getSecureStore(),
): Promise<HeldShards> {
  const bytes = await store.load(SecureStoreKeys.RECOVERY_SHARDS);
  if (bytes === null) {
    return {};
  }
  try {
    return JSON.parse(bytesToUtf8(bytes)) as HeldShards;
  } catch {
    return {};
  }
}

/**
 * Thrown by {@link saveHeldShard} when this device already holds a *different*
 * piece for the same person and the caller did not ask to replace it. A scanned
 * shard payload is unauthenticated — anyone can make one that names a friend —
 * so a held piece is only ever replaced after the holder explicitly confirms.
 */
export class HeldShardExistsError extends Error {
  /** The piece already held for that person, left untouched. */
  readonly existing: HeldShard;

  constructor(existing: HeldShard) {
    super(`a different shard is already held for ${existing.originalAddress}`);
    this.name = 'HeldShardExistsError';
    this.existing = existing;
  }
}

/**
 * Files `shard` under the wallet it helps recover, one piece per person.
 *
 * - No piece held for that person: writes it and returns `'saved'`.
 * - The identical payload is already held: writes nothing (the original
 *   `receivedAt` is kept) and returns `'unchanged'`.
 * - A *different* payload is held: throws {@link HeldShardExistsError} unless
 *   `opts.replace` is `true`, in which case it overwrites and returns `'saved'`.
 *   Only an explicit confirmation by the holder may pass `replace` — a fake
 *   "new piece" silently overwriting a real one could leave its owner unable
 *   to recover.
 */
export async function saveHeldShard(
  shard: HeldShard,
  store: SecureStore = getSecureStore(),
  opts: {replace?: boolean} = {},
): Promise<'saved' | 'unchanged'> {
  const shards = await loadHeldShards(store);
  const existing = shards[shard.originalAddress];
  if (existing !== undefined) {
    if (existing.payload === shard.payload) {
      return 'unchanged';
    }
    if (opts.replace !== true) {
      throw new HeldShardExistsError(existing);
    }
  }
  shards[shard.originalAddress] = shard;
  await persist(shards, store);
  return 'saved';
}

/**
 * Whether a shard claiming to be sealed to `holderAddress` is addressed to the
 * identity whose public key is `ownPublicKey`. Compares key bytes, not address
 * strings, so a differently-spelled address for the same key still matches; an
 * address that does not parse is never a match.
 */
export function shardIsForKey(
  holderAddress: string,
  ownPublicKey: Uint8Array,
): boolean {
  const parsed = parseAddress(holderAddress);
  if ('error' in parsed) {
    return false;
  }
  const bytes = parsed.toBytes();
  return (
    bytes.length === ownPublicKey.length &&
    bytes.every((b, i) => b === ownPublicKey[i])
  );
}

/** Forgets the shard held for `originalAddress`. A no-op if none is held. */
export async function deleteHeldShard(
  originalAddress: string,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const shards = await loadHeldShards(store);
  if (!(originalAddress in shards)) {
    return;
  }
  delete shards[originalAddress];
  await persist(shards, store);
}

/** The raw sealed-shard bytes of a held shard (undoes the base64 wrapping). */
export function shardPayloadBytes(shard: HeldShard): Uint8Array {
  return base64ToBytes(shard.payload);
}

async function persist(shards: HeldShards, store: SecureStore): Promise<void> {
  const bytes = utf8ToBytes(JSON.stringify(shards));
  // Already ciphertext and sub-threshold; no biometric gate (see file header).
  await store.save(SecureStoreKeys.RECOVERY_SHARDS, bytes, {
    requireBiometric: false,
  });
}
