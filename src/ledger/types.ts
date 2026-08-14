/**
 * The mobile-side view of ledger data: the member's identity, their balance, and
 * the transactions involving them. These are display models assembled from the
 * station over the authenticated channel (T1.3.4) — see
 * {@link network/StationClient} and `useLedger`. Amounts are always **signed
 * integer centi**, never a float (see `ledger/format`).
 */

/** Where a transaction sits in its lifecycle. Mirrors the station's states. */
export type TransactionState =
  /** Proposed by the sender, not yet confirmed by the receiver. */
  | 'pending'
  /** Confirmed by the receiver; the settlement window is running. */
  | 'confirmed'
  /** In the post-settlement dispute window. */
  | 'window'
  /** Settled and final. */
  | 'settled'
  /** Cancelled or rejected before settlement. */
  | 'cancelled'
  /** Under dispute. */
  | 'disputed';

/** Money direction relative to this member. */
export type TransactionDirection = 'in' | 'out';

/** One transaction involving this member. */
export interface Transaction {
  id: string;
  /** Counterparty display name (nickname) or shortened address. */
  counterparty: string;
  /** Counterparty's full bech32m `rrn1…` address. */
  counterpartyAddress: string;
  direction: TransactionDirection;
  /**
   * Signed amount in centi: positive is a credit (money in), negative a debit
   * (money out). Consistent with {@link direction}.
   */
  amountCenti: number;
  /** Optional free-text memo. */
  memo?: string;
  /** For a marketplace payment (T1.7.6), the listing's title, resolved by the
   * station — so the detail screen can name what was bought regardless of the
   * memo. Absent on a direct pay. */
  listingTitle?: string;
  state: TransactionState;
  /**
   * The oracle tier governing this transaction (T1.8.1): `1` — settlement window
   * only — or `2` — reputation-staked confirmation. Absent (treated as Tier 1) on
   * a row from a station that predates the field. Drives the tier badge and the
   * per-tier settlement window.
   */
  oracleTier?: number;
  /**
   * Unix seconds when the settlement window closes, as the station computed it
   * from the tier (T1.8.6). Present once confirmed; {@link settlementAt} prefers
   * it over a locally-derived window. Absent from a legacy station.
   */
  settleBy?: number;
  /** When the transaction was proposed, in unix seconds. */
  timestamp: number;
  /**
   * Unix seconds after which an unconfirmed proposal auto-cancels. Present on
   * proposals awaiting confirmation (the receiver's inbox); drives the "expires
   * in" countdown and the expired-and-uncomfirmable state.
   */
  expiresAt?: number;
  /**
   * Unix seconds when the receiver confirmed. Present once confirmed; the
   * settlement window runs from here.
   */
  confirmedAt?: number;
  /** Unix seconds when the transaction settled. Present once settled. */
  settledAt?: number;
  /** The sender's per-sender monotonic nonce, if known (present on sent items). */
  nonce?: number;
}

/** This device's identity, for the home header. */
export interface Identity {
  /** The member's own bech32m `rrn1…` address. */
  address: string;
  /** Local nickname, if set. */
  nickname?: string;
  /** The community/collective the member belongs to. */
  community?: string;
  /**
   * Bootstrap-grace status (T1.8.6; widened in T1.11.2 / ADR-0015), read from
   * `whoami`. Present when the paired station reports it; absent when offline or
   * from a station predating the field. Home shows a banner while
   * {@link BootstrapGrace.inGrace} is true.
   */
  bootstrap?: BootstrapGrace;
}

/** The community's bootstrap-grace status (T1.8.6 / ADR-0015). */
export interface BootstrapGrace {
  /** Whether fewer than {@link threshold} members are established. While true the
   * community runs under grace across all three subsystems: any member may
   * confirm a Tier-2 payment, and the genesis founders stand in as the electorate
   * for governance votes and dispute juries. */
  inGrace: boolean;
  /** How many members are currently established (composite over the Member band). */
  established: number;
  /** The established-member count at which grace ends. */
  threshold: number;
}

/** The member's current balance. */
export interface Balance {
  /** Signed balance in centi (mutual-credit; may be negative). */
  centi: number;
}
