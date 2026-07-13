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
import {base64ToBytes} from '../crypto/base64';
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** One sealed shard this device is holding on someone else's behalf. */
export interface HeldShard {
  /** The `rrn1…` address of the wallet this shard helps recover — the map key. */
  originalAddress: string;
  /** The `rrn1…` address the shard is sealed to (this device's identity). */
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
 * Files `shard`, replacing any shard previously held for the same wallet. A
 * fresh setup by the same friend supersedes the old shard, so keying by
 * `originalAddress` is intentional.
 */
export async function saveHeldShard(
  shard: HeldShard,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const shards = await loadHeldShards(store);
  shards[shard.originalAddress] = shard;
  await persist(shards, store);
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
