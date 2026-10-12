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
  dayLabel,
  formatCommons,
  formatCommonsMagnitude,
  formatSignedCommons,
  parseCommons,
  parseOfferCommons,
  relativeTime,
  shortAddress,
  MINUS,
} from '../src/ledger/format';
import {paymentCopy, paymentRole, stateBadge, tierBadge, tierLabel} from '../src/ledger/txDisplay';

describe('dayLabel', () => {
  // Fixed local reference: Monday, Jul 15 2024, noon.
  const now = new Date(2024, 6, 15, 12, 0, 0).getTime();
  const secs = (d: Date) => Math.floor(d.getTime() / 1000);

  test('labels today and yesterday', () => {
    expect(dayLabel(secs(new Date(2024, 6, 15, 9, 0, 0)), now)).toBe('Today');
    expect(dayLabel(secs(new Date(2024, 6, 14, 23, 0, 0)), now)).toBe('Yesterday');
  });

  test('labels an older day in the same year without the year', () => {
    expect(dayLabel(secs(new Date(2024, 6, 9, 9, 0, 0)), now)).toBe('Tue, Jul 9');
  });

  test('includes the year for a prior year', () => {
    expect(dayLabel(secs(new Date(2023, 6, 9, 9, 0, 0)), now)).toBe('Sun, Jul 9, 2023');
  });
});

describe('parseCommons', () => {
  test('parses whole and fractional amounts to centi', () => {
    expect(parseCommons('3')).toEqual({centi: 300});
    expect(parseCommons('3.5')).toEqual({centi: 350});
    expect(parseCommons('3.50')).toEqual({centi: 350});
    expect(parseCommons('0.05')).toEqual({centi: 5});
    expect(parseCommons('1234.56')).toEqual({centi: 123456});
  });

  test('trims surrounding whitespace', () => {
    expect(parseCommons('  3.50  ')).toEqual({centi: 350});
  });

  test('rejects an empty amount', () => {
    expect(parseCommons('')).toEqual({error: expect.any(String)});
    expect(parseCommons('   ')).toEqual({error: expect.any(String)});
  });

  test('rejects more than two decimal places', () => {
    const r = parseCommons('3.001');
    expect(r).toEqual({error: expect.stringContaining('two decimal')});
  });

  test('rejects malformed input (letters, signs, stray dots)', () => {
    for (const bad of ['abc', '3.5.5', '-3', '+3', '3,50', '.5', '3.']) {
      expect(parseCommons(bad)).toHaveProperty('error');
    }
  });
});

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

  test('formatCommons keeps the minus', () => {
    expect(formatCommons(-2000)).toBe('−20.00');
    expect(formatCommons(-2000)).toBe(`${MINUS}20.00`); // U+2212, not a hyphen
    expect(formatCommons(2000)).toBe('20.00'); // no plus
    expect(formatCommons(0)).toBe('0.00');
    expect(formatCommons(-123456)).toBe('−1,234.56');
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
    expect(stateBadge('window')).toEqual({variant: 'warning', label: 'Settlement window'});
    expect(stateBadge('disputed')).toEqual({variant: 'danger', label: 'Disputed'});
    expect(stateBadge('cancelled')).toEqual({variant: 'neutral', label: 'Cancelled'});
    expect(stateBadge('confirmed')).toEqual({variant: 'info', label: 'Confirmed'});
  });
});

describe('tierBadge / tierLabel (T1.8.6)', () => {
  test('tierBadge surfaces Tier 2 and stays quiet for Tier 1 / unknown', () => {
    expect(tierBadge(2)).toEqual({variant: 'info', label: 'Tier 2 · staked'});
    expect(tierBadge(1)).toBeNull();
    expect(tierBadge(undefined)).toBeNull();
  });

  test('tierLabel names both tiers, defaulting an unknown tier to Tier 1', () => {
    expect(tierLabel(2)).toBe('Tier 2 — reputation-staked');
    expect(tierLabel(1)).toBe('Tier 1 — settlement window');
    expect(tierLabel(undefined)).toBe('Tier 1 — settlement window');
  });
});

describe('formatCommonsMagnitude', () => {
  test('drops the sign — only for callers that draw it themselves', () => {
    expect(formatCommonsMagnitude(-300)).toBe('3.00');
    expect(formatCommonsMagnitude(300)).toBe('3.00');
    expect(formatCommonsMagnitude(-123456)).toBe('1,234.56');
  });
});

describe('formatSignedCommons', () => {
  test('signs both ways and leaves zero bare', () => {
    expect(formatSignedCommons(2000)).toBe('+20.00');
    expect(formatSignedCommons(-2000)).toBe('−20.00');
    expect(formatSignedCommons(0)).toBe('0.00');
  });
});

describe('parseOfferCommons', () => {
  const neg = {allowNegative: true};
  const pos = {allowNegative: false};

  test('blank is no offer', () => {
    expect(parseOfferCommons('', pos)).toEqual({centi: null});
    expect(parseOfferCommons('   ', neg)).toEqual({centi: null});
  });

  test('parses to integer centi through the same rules as parseCommons', () => {
    expect(parseOfferCommons('4', pos)).toEqual({centi: 400});
    expect(parseOfferCommons('4.5', pos)).toEqual({centi: 450});
    expect(parseOfferCommons(' 4.20 ', pos)).toEqual({centi: 420});
    expect(parseOfferCommons('0.29', pos)).toEqual({centi: 29}); // no float rounding
    expect(parseOfferCommons('4.001', pos)).toEqual({error: 'Use at most two decimal places.'});
    expect(parseOfferCommons('99999999999999999', pos)).toEqual({error: 'That amount is too large.'});
  });

  test('a sign is allowed only when the listing is a subsidy', () => {
    expect(parseOfferCommons('-3', neg)).toEqual({centi: -300});
    expect(parseOfferCommons('−3.25', neg)).toEqual({centi: -325}); // U+2212
    expect(parseOfferCommons('-3', pos)).toEqual({error: 'Offers on this listing can’t be negative.'});
    expect(parseOfferCommons('−3', pos)).toEqual({error: 'Offers on this listing can’t be negative.'});
    expect(parseOfferCommons('-0', neg)).toEqual({centi: 0});
    expect(Object.is((parseOfferCommons('-0', neg) as {centi: number}).centi, -0)).toBe(false);
  });

  test('anything that is not a plain amount is refused', () => {
    const invalid = {error: 'Enter an amount in Commons, like 4 or 4.50'};
    for (const s of ['1e3', '0x10', '--1', '-−1', '+5', '-', '4.', '.5', 'Infinity', 'NaN', '4,000']) {
      expect(parseOfferCommons(s, neg)).toEqual(invalid);
    }
  });

  test('every accepted value is a safe integer', () => {
    for (const s of ['0', '1', '0.01', '12345.67', '-0.01', '-9007199254740.99']) {
      const r = parseOfferCommons(s, neg);
      expect('centi' in r && Number.isSafeInteger(r.centi)).toBe(true);
    }
  });
});

describe('paymentRole + paymentCopy', () => {
  test('direction and sign decide the role; zero takes the direction role', () => {
    expect(paymentRole({direction: 'in', amountCenti: 500})).toBe('paying_you');
    expect(paymentRole({direction: 'in', amountCenti: 0})).toBe('paying_you');
    expect(paymentRole({direction: 'in', amountCenti: -500})).toBe('requesting_from_you');
    expect(paymentRole({direction: 'out', amountCenti: -500})).toBe('you_paid');
    expect(paymentRole({direction: 'out', amountCenti: 0})).toBe('you_paid');
    expect(paymentRole({direction: 'out', amountCenti: 500})).toBe('you_requested');
  });

  test('each role has its exact wording', () => {
    expect(paymentCopy('paying_you', 'ana', 500)).toEqual({
      caption: 'from ana',
      heading: 'ana is paying you',
      detailTitle: 'Received from ana',
      directionLabel: 'Incoming credit',
      magnitude: '5.00',
    });
    expect(paymentCopy('requesting_from_you', 'ana', -2000)).toEqual({
      caption: 'request from ana',
      heading: 'ana is asking you to pay',
      detailTitle: 'Requested by ana',
      directionLabel: 'Payment request — you pay',
      magnitude: '20.00',
    });
    expect(paymentCopy('you_paid', 'ana', -500)).toEqual({
      caption: 'to ana',
      heading: 'You paid ana',
      detailTitle: 'Sent to ana',
      directionLabel: 'Outgoing debit',
      magnitude: '5.00',
    });
    expect(paymentCopy('you_requested', 'ana', 500)).toEqual({
      caption: 'request to ana',
      heading: 'You asked ana to pay',
      detailTitle: 'Requested from ana',
      directionLabel: 'Payment request — they pay',
      magnitude: '5.00',
    });
  });
});
