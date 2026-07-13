/**
 * @format
 *
 * Ledger formatting (T1.2.4). Money is signed integer centi; the display helpers
 * must group thousands, always show two decimals, use a proper minus for debits,
 * and never depend on `Intl` (Hermes lacks it). Plus relative-time bucketing,
 * address shortening, and the state → badge mapping.
 */
import {
  amountSign,
  formatCommons,
  relativeTime,
  shortAddress,
  MINUS,
} from '../src/ledger/format';
import {stateBadge} from '../src/ledger/txDisplay';

describe('formatCommons', () => {
  test('formats whole and fractional centi with two decimals', () => {
    expect(formatCommons(2400)).toBe('24.00');
    expect(formatCommons(350)).toBe('3.50');
    expect(formatCommons(5)).toBe('0.05');
    expect(formatCommons(0)).toBe('0.00');
  });

  test('groups thousands', () => {
    expect(formatCommons(123456)).toBe('1,234.56');
    expect(formatCommons(100000000)).toBe('1,000,000.00');
  });

  test('is sign-agnostic (absolute value only)', () => {
    expect(formatCommons(-300)).toBe('3.00');
    expect(formatCommons(300)).toBe('3.00');
  });
});

describe('amountSign', () => {
  test('credit is plus, debit is a proper minus, zero is empty', () => {
    expect(amountSign(800)).toBe('+');
    expect(amountSign(-800)).toBe(MINUS);
    expect(amountSign(-800)).not.toBe('-'); // U+2212, not a hyphen
    expect(amountSign(0)).toBe('');
  });
});

describe('shortAddress', () => {
  test('keeps head and tail of a long address', () => {
    expect(shortAddress('rrn1q9f2c8x7v3k0p4m6w2j5h8n1d4s7a0zqr')).toBe('rrn1q9f2c…a0zqr');
  });
  test('leaves short strings unchanged', () => {
    expect(shortAddress('rrn1short')).toBe('rrn1short');
  });
});

describe('relativeTime', () => {
  const now = 1_000_000 * 1000; // fixed "now" in ms
  const ago = (secs: number) => Math.floor(now / 1000) - secs;

  test('buckets recent times', () => {
    expect(relativeTime(ago(10), now)).toBe('just now');
    expect(relativeTime(ago(20 * 60), now)).toBe('20 min ago');
    expect(relativeTime(ago(2 * 3600), now)).toBe('2h ago');
    expect(relativeTime(ago(3 * 86400), now)).toBe('3d ago');
  });

  test('falls back to a date past a week', () => {
    // 10 days ago from a fixed epoch — a stable MM/DD/YYYY string.
    const result = relativeTime(ago(10 * 86400), now);
    expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });
});

describe('stateBadge', () => {
  test('maps each state to a variant + label', () => {
    expect(stateBadge('settled')).toEqual({variant: 'success', label: 'Settled'});
    expect(stateBadge('pending')).toEqual({variant: 'neutral', label: 'Pending'});
    expect(stateBadge('window')).toEqual({variant: 'warning', label: 'Dispute window'});
    expect(stateBadge('disputed')).toEqual({variant: 'danger', label: 'Disputed'});
    expect(stateBadge('cancelled')).toEqual({variant: 'neutral', label: 'Cancelled'});
    expect(stateBadge('confirmed')).toEqual({variant: 'info', label: 'Confirmed'});
  });
});
