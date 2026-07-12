/**
 * @format
 *
 * Unit tests for the passphrase strength heuristic (T1.2.2). This is a simple
 * length × class-variety estimate, not zxcvbn — the tests pin its buckets and
 * the minimum-length floor, not any claim of real-world crack resistance.
 */
import {
  estimateStrength,
  MIN_PASSPHRASE_LENGTH,
} from '../src/screens/onboarding/passphraseStrength';

describe('estimateStrength', () => {
  test('anything below the minimum length is "Too weak" (level 0)', () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(12);
    for (const p of ['', 'short', 'a'.repeat(MIN_PASSPHRASE_LENGTH - 1)]) {
      expect(estimateStrength(p)).toEqual({level: 0, label: 'Too weak'});
    }
  });

  test('a bare-minimum single-class passphrase is Weak', () => {
    // 12 lowercase chars → 12 * log2(26) ≈ 56 bits → below the "Good" cutoff.
    const s = estimateStrength('abcdefghijkl');
    expect(s.level).toBe(1);
    expect(s.label).toBe('Weak');
  });

  test('more length and class variety raises the score', () => {
    const weak = estimateStrength('a'.repeat(12));
    const good = estimateStrength('Abcdefghijkl9'); // mixed classes, 13 chars
    const strong = estimateStrength('Abcd3fgh!jklmnopqrst'); // 20 chars, 4 classes
    expect(good.level).toBeGreaterThan(weak.level);
    expect(strong.level).toBeGreaterThanOrEqual(good.level);
    expect(strong.level).toBe(3);
    expect(strong.label).toBe('Strong');
  });

  test('score never exceeds level 3', () => {
    const s = estimateStrength('Tr0ub4dour&3xtr4L0ng!Passphrase#With$ymbols');
    expect(s.level).toBe(3);
  });

  test('is monotonic in length for a fixed character set', () => {
    let prev = -1;
    for (const len of [12, 16, 24, 40]) {
      const {level} = estimateStrength('aB3$'.repeat(Math.ceil(len / 4)).slice(0, len));
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });
});
