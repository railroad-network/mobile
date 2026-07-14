/**
 * The mobile-side view of ledger data: the member's identity, their balance, and
 * the transactions involving them. These are display models assembled from the
 * station over RPC (M1.3); until that lands they come from a clearly-marked mock
 * ({@link mockLedger}). Amounts are always **signed integer centi**, never a
 * float (see `ledger/format`).
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
  state: TransactionState;
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
}

/** The member's current balance. */
export interface Balance {
  /** Signed balance in centi (mutual-credit; may be negative). */
  centi: number;
}
