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
  /** Stations this device has paired with (T1.3.3): a JSON array of records,
   * each the station's bech32 identity address (the durable key ADR-0008 binds),
   * a last-known host hint, and when the pair was confirmed. Non-secret — the
   * address is public and the record carries no key material — so saved without a
   * biometric gate. See {@link network/pairedStation}. */
  PAIRED_STATIONS: 'rrn.station.paired',
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
  /** Per-station monotonic request nonces for the authenticated channel (T1.3.4):
   * a JSON map of station address → highest nonce this device has sent. The
   * station rejects a request whose nonce is not strictly greater, so this must
   * persist to survive an app restart. Non-secret (a counter, not key material);
   * saved without a biometric gate. See {@link network/StationClient}. */
  STATION_NONCES: 'rrn.station.nonces',
  /** Per-station push-event cursor for the subscribe long-poll (T1.3.5): a JSON
   * map of station address → the highest event id (log seq) this device has
   * processed. Sent as `last_seen_event_id` each subscribe so the station returns
   * only newer events; persisted so a restart resumes where it left off rather
   * than replaying or missing. Non-secret; saved without a biometric gate. See
   * {@link network/stationSubscription}. */
  STATION_CURSORS: 'rrn.station.cursors',
  /** Local notification preferences (T1.3.6): a JSON object holding the master
   * on/off, the opt-in background-sync flag, and a per-event-kind allow map.
   * Non-secret (user preferences); saved without a biometric gate. See
   * {@link notifications/notificationPrefs}. */
  NOTIFICATION_PREFS: 'rrn.notifications.prefs',
  /** The self-contained wallet blob re-encrypted under {@link BG_SYNC_SECRET}
   * for background sync (T1.3.6). Provisioned only when the user opts into
   * background sync; stored at device-unlock accessibility (no biometric gate)
   * so a headless background task can open it without a passphrase prompt. The
   * secret still never leaves Rust — this is `saveWalletToBytes` output under a
   * random secret, not raw key material. Cleared when background sync is turned
   * off, on factory reset, or when the last station is unpaired. See
   * {@link network/backgroundCredential}. */
  BG_SYNC_BLOB: 'rrn.bgsync.blob',
  /** The random high-entropy secret that decrypts {@link BG_SYNC_BLOB} (T1.3.6).
   * Stored alongside it at device-unlock accessibility; the pair together is a
   * background-usable signing wallet. Cleared with the blob. */
  BG_SYNC_SECRET: 'rrn.bgsync.secret',
} as const;

/** A value from {@link SecureStoreKeys}. */
export type SecureStoreKey = (typeof SecureStoreKeys)[keyof typeof SecureStoreKeys];
