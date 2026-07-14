/**
 * ⚠️ MOCK ledger data source — replaced by the real mobile↔station RPC in M1.3.
 *
 * T1.2.4 builds the wallet home screen in isolation, before the transport layer
 * exists. Every function here returns seeded in-memory data behind a short
 * artificial delay so the UI exercises its real loading / refresh / empty paths.
 * When M1.3 lands, swap these implementations for station calls behind the same
 * signatures ({@link useLedger} depends only on these shapes). Nothing here is
 * persisted or authoritative.
 *
 * Seed: the "Blue Ridge Collective" fixtures from the design system's mobile kit.
 */
import {loadProfile} from '../wallet/profile';
import type {Balance, Identity, Transaction} from './types';

/** Simulated network latency for the mock (ms). */
const MOCK_DELAY = 350;

function delay<T>(value: T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), MOCK_DELAY));
}

const ME: Identity = {
  address: 'rrn1q9f2c8x7v3k0p4m6w2j5h8n1d4s7a0zqr',
  nickname: 'asa_wren',
  community: 'Blue Ridge Collective',
};

const BALANCE: Balance = {centi: 2400};

/** Address book for the seeded counterparties. */
const ADDR: Record<string, string> = {
  dr_sarah: 'rrn1q7m4d2k9x3v6p1w8j5h2n7d4s9a3zqk',
  valley_farm: 'rrn1q3k8w2j5h9n4d7s1a6z2p8m4v9x3kqp',
  mill_co_op: 'rrn1q8n4d7s2a9z3k6w1j5h2p8m4v7x3kqm',
  ridge_watch: 'rrn1q2p8m4v9x3k7w1j5h8n4d2s7a3z9kqr',
  lena_p: 'rrn1q5h8n4d2s7a9z3k6w1j2p8m4v7x3kqt',
  east_market: 'rrn1q9z3k6w1j5h2n8d4s7a2p8m4v7x3kqn',
};

const HOUR = 3600;
const DAY = 86400;

// Content-address ids (Blake3, 64 hex chars) for the incoming proposals, so the
// receiver can sign a real TransactionConfirmation against them (its proposal_id
// is a 32-byte hash). Fixed here since the mock has no real proposal behind them.
const INBOX_ID_1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';
const INBOX_ID_2 = '00ffeeddccbbaa998877665544332211009f8e7d6c5b4a3928190a7b6c5d4e3f';

/** Builds the seeded activity relative to `now` so relative times stay fresh. */
function seededActivity(now: number): Transaction[] {
  const t = (offset: number) => Math.floor(now / 1000) - offset;
  return [
    // Incoming proposals awaiting this member's confirmation (the inbox).
    {
      id: INBOX_ID_1, counterparty: 'valley_farm', counterpartyAddress: ADDR.valley_farm,
      direction: 'in', amountCenti: 1500, memo: 'Split the seed order',
      state: 'pending', timestamp: t(3 * HOUR), expiresAt: t(-2 * DAY),
    },
    {
      id: INBOX_ID_2, counterparty: 'lena_p', counterpartyAddress: ADDR.lena_p,
      direction: 'in', amountCenti: 450, memo: 'Herbs from the fall market',
      state: 'pending', timestamp: t(30 * HOUR), expiresAt: t(-18 * HOUR),
    },
    {
      id: 'tx_7b21', counterparty: 'dr_sarah', counterpartyAddress: ADDR.dr_sarah,
      direction: 'out', amountCenti: -300, memo: 'General consultation',
      state: 'window', timestamp: t(2 * HOUR),
    },
    {
      id: 'tx_8f3a', counterparty: 'valley_farm', counterpartyAddress: ADDR.valley_farm,
      direction: 'in', amountCenti: 800, memo: 'Grain — 2 sacks',
      state: 'settled', timestamp: t(20 * HOUR),
    },
    {
      id: 'tx_2b88', counterparty: 'dr_sarah', counterpartyAddress: ADDR.dr_sarah,
      direction: 'out', amountCenti: -300, memo: 'General consultation',
      state: 'pending', timestamp: t(21 * HOUR),
    },
    {
      id: 'tx_6c90', counterparty: 'ridge_watch', counterpartyAddress: ADDR.ridge_watch,
      direction: 'out', amountCenti: -800, memo: 'Perimeter patrol — wk 8',
      state: 'settled', timestamp: t(3 * DAY),
    },
    {
      id: 'tx_5a14', counterparty: 'mill_co_op', counterpartyAddress: ADDR.mill_co_op,
      direction: 'in', amountCenti: 2200, memo: 'Repaired the grist wheel',
      state: 'settled', timestamp: t(4 * DAY),
    },
    {
      id: 'tx_4d77', counterparty: 'east_market', counterpartyAddress: ADDR.east_market,
      direction: 'out', amountCenti: -250, memo: 'Beeswax candles ×12',
      state: 'settled', timestamp: t(4 * DAY + HOUR),
    },
    {
      id: 'tx_3e02', counterparty: 'lena_p', counterpartyAddress: ADDR.lena_p,
      direction: 'in', amountCenti: 600, memo: 'Taught a first-aid class',
      state: 'cancelled', timestamp: t(5 * DAY),
    },
  ];
}

/**
 * MOCK: the member's identity. Replace with a station call in M1.3. The nickname
 * is overlaid from the local profile (T1.2.8), so an edit in Settings shows up
 * here too; everything else is still seeded.
 */
export async function fetchIdentity(): Promise<Identity> {
  let nickname = ME.nickname;
  try {
    const profile = await loadProfile();
    if (profile.nickname !== undefined && profile.nickname.length > 0) {
      nickname = profile.nickname;
    }
  } catch {
    // No secure store available — keep the seeded nickname.
  }
  return delay({...ME, nickname});
}

/** MOCK: the member's current balance. Replace with a `BalanceView` RPC in M1.3. */
export function fetchBalance(): Promise<Balance> {
  return delay(BALANCE);
}

/** MOCK: the member's transactions, newest first. Replace with a station call in M1.3. */
export function fetchActivity(): Promise<Transaction[]> {
  return delay(seededActivity(Date.now()));
}
