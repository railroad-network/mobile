/**
 * Namespaced keys for {@link SecureStore}. Each value becomes a distinct
 * keychain/keystore `service`, so entries never collide and can be individually
 * deleted (e.g. on logout or wallet reset).
 *
 * The `rrn.` prefix namespaces our entries within the app's keychain domain.
 */
export const SecureStoreKeys = {
  /** The wallet's secret key material (the passphrase-encrypted `.rrnwallet`
   * bytes land here in T1.1.5 — see WALLET_FILE, added then). */
  WALLET_SECRET: 'rrn.wallet.secret',
  /** Token proving this device is paired with a station. */
  STATION_PAIRING_TOKEN: 'rrn.station.pairing_token',
  /** Social-recovery shards held on this device (M1.4). */
  RECOVERY_SHARDS: 'rrn.recovery.shards',
} as const;

/** A value from {@link SecureStoreKeys}. */
export type SecureStoreKey = (typeof SecureStoreKeys)[keyof typeof SecureStoreKeys];
