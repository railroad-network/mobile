/**
 * Namespaced keys for {@link SecureStore}. Each value becomes a distinct
 * keychain/keystore `service`, so entries never collide and can be individually
 * deleted (e.g. on logout or wallet reset).
 *
 * The `rrn.` prefix namespaces our entries within the app's keychain domain.
 */
export const SecureStoreKeys = {
  /** The passphrase-encrypted `.rrnwallet` bytes (T1.1.5). Double protection:
   * these bytes are already passphrase-encrypted, and the keychain/keystore
   * adds OS-level at-rest protection on top. */
  WALLET_FILE: 'rrn.wallet.file',
  /** Reserved for raw wallet secret material stored outside the `.rrnwallet`
   * envelope. Unused today — the wallet lives under WALLET_FILE. */
  WALLET_SECRET: 'rrn.wallet.secret',
  /** Token proving this device is paired with a station. */
  STATION_PAIRING_TOKEN: 'rrn.station.pairing_token',
  /** Sealed social-recovery shards this device holds *for other people*
   * (T1.2.3): a JSON map keyed by the wallet address each shard helps recover.
   * The payloads are ciphertext (sealed to this holder) and each is below the
   * reconstruction threshold, so they carry no biometric gate. See
   * {@link wallet/heldShards}. */
  RECOVERY_SHARDS: 'rrn.recovery.shards',
  /** This wallet's own social-recovery setup (T1.2.3): the holders it split its
   * key across, their nicknames, threshold, and per-holder delivery state. Not
   * secret (no shard material) — stored here only to keep all wallet-scoped
   * persistence in one place; saved without a biometric gate. */
  RECOVERY_CONFIG: 'rrn.recovery.config',
  /** Local device preferences (T1.2.8): the user's chosen nickname and whether
   * biometric unlock is enabled. Non-secret; saved without a biometric gate. */
  PROFILE: 'rrn.profile',
} as const;

/** A value from {@link SecureStoreKeys}. */
export type SecureStoreKey = (typeof SecureStoreKeys)[keyof typeof SecureStoreKeys];
