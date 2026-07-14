/**
 * Formatting helpers for ledger values and timestamps.
 *
 * Money is carried everywhere as **signed integer centi** (hundredths of a
 * Common) — never a float. The mutual-credit ledger and the Rust FFI use
 * integer minor units (floats are forbidden in signed payloads; see the threat
 * model), so the mobile app never introduces a `number` with a fractional part
 * for money. These helpers turn centi into display strings without relying on
 * `Intl`/`toLocaleString`, which Hermes does not fully implement — grouping and
 * padding are done by hand so the output is identical on-device and under Jest.
 */

/** U+2212 MINUS SIGN — a proper minus, not a hyphen, for debit amounts. */
export const MINUS = '−';

/**
 * Formats an *unsigned* centi value as grouped Commons with two decimals, e.g.
 * `123456` → `"1,234.56"`. The sign is applied separately (see {@link amountSign})
 * so callers can color and place it independently of the digits.
 */
export function formatCommons(centi: number): string {
  const abs = Math.abs(Math.trunc(centi));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${String(cents).padStart(2, '0')}`;
}

/**
 * Parses a user-typed Commons amount (e.g. `"3.50"`) into unsigned integer
 * centi, or returns an error message. Mirrors the CLI's rules: `"3.5"` → `350`,
 * `"3.50"` → `350`, `"3"` → `300`; at most two decimal places (`"3.001"` is
 * rejected). No sign is accepted — direction is applied by the caller. The
 * result is always non-negative; callers reject zero where an amount is
 * required.
 */
export function parseCommons(input: string): {centi: number} | {error: string} {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {error: 'Enter an amount.'};
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return {error: 'Enter a valid amount, like 3.50.'};
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > 2) {
    return {error: 'Use at most two decimal places.'};
  }
  const centi = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(centi)) {
    return {error: 'That amount is too large.'};
  }
  return {centi};
}

/** The sign to show for a signed centi value: `+`, a proper minus, or none. */
export function amountSign(centi: number): '' | '+' | typeof MINUS {
  if (centi > 0) return '+';
  if (centi < 0) return MINUS;
  return '';
}

/**
 * Shortens a bech32m `rrn1…` address for display: keeps a recognizable head and
 * tail with an ellipsis between, e.g. `rrn1q9f2c8…a0zqr`. Short addresses are
 * returned unchanged.
 */
export function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 9)}…${address.slice(-5)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A day header for grouping the transaction history: `"Today"`, `"Yesterday"`,
 * otherwise `"Wed, Jul 9"` (or `"Wed, Jul 9, 2024"` for a prior year). `now` is
 * injectable for deterministic tests. Uses local calendar days.
 */
export function dayLabel(unixSeconds: number, now: number = Date.now()): string {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const dayMs = 86400_000;
  const days = Math.round((startOfDay(now) - startOfDay(unixSeconds * 1000)) / dayMs);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const d = new Date(unixSeconds * 1000);
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/**
 * A short, human relative time from a unix-seconds timestamp, e.g. `"just now"`,
 * `"20 min ago"`, `"2h ago"`, `"3d ago"`. Falls back to a `MM/DD/YYYY` date past
 * a week. `now` is injectable for deterministic tests.
 */
export function relativeTime(unixSeconds: number, now: number = Date.now()): string {
  const secs = Math.floor(now / 1000 - unixSeconds);
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(unixSeconds * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
