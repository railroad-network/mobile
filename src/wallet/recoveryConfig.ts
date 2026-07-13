/**
 * The owner's social-recovery setup, persisted on this device (T1.2.3).
 *
 * This records *who* the wallet split its key across and how — holder addresses,
 * their local nicknames, the threshold, and which shards have been handed out —
 * so Settings can show the recovery status and a later milestone (M1.4) can
 * refresh or reissue shards. It holds **no shard material** and nothing secret;
 * the sealed shards live only on the holders' phones. It is stored through
 * {@link SecureStore} (the app's one persistence backend) without a biometric
 * gate, as JSON encoded to UTF-8 bytes.
 */
import {SecureStoreKeys} from '../crypto/constants';
import {getSecureStore, type SecureStore} from '../crypto/SecureStore';
import {bytesToUtf8, utf8ToBytes} from '../crypto/utf8';

/** One holder in a recovery circle. */
export interface RecoveryHolder {
  /** The holder's bech32m `rrn1…` address (the shard is sealed to it). */
  address: string;
  /** A local, user-chosen label for the holder. Never leaves the device. */
  nickname?: string;
  /** Whether the owner has handed this holder their shard (self-attested). */
  delivered: boolean;
}

/** A wallet's persisted recovery setup. */
export interface RecoveryConfig {
  /** The `rrn1…` address of the wallet this recovery protects. */
  originalAddress: string;
  /** `K` — how many holders must cooperate to restore. */
  threshold: number;
  /** `N` — how many holders the key was split across (== `holders.length`). */
  total: number;
  holders: RecoveryHolder[];
  /** Unix seconds when recovery was set up. */
  createdAt: number;
}

/** Persists `config`, replacing any previous recovery setup. */
export async function saveRecoveryConfig(
  config: RecoveryConfig,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  const bytes = utf8ToBytes(JSON.stringify(config));
  // Non-secret: no biometric prompt when Settings reads it back.
  await store.save(SecureStoreKeys.RECOVERY_CONFIG, bytes, {
    requireBiometric: false,
  });
}

/**
 * Loads the persisted recovery setup, or `null` if recovery has not been set up
 * (or the stored blob is unreadable — treated as "not set up" rather than
 * crashing the caller).
 */
export async function loadRecoveryConfig(
  store: SecureStore = getSecureStore(),
): Promise<RecoveryConfig | null> {
  const bytes = await store.load(SecureStoreKeys.RECOVERY_CONFIG);
  if (bytes === null) {
    return null;
  }
  try {
    return JSON.parse(bytesToUtf8(bytes)) as RecoveryConfig;
  } catch {
    return null;
  }
}
