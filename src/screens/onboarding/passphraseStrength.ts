/**
 * A deliberately simple passphrase strength heuristic — length times character
 * class variety, expressed as a rough entropy estimate. This is *not* zxcvbn:
 * it does no dictionary or pattern analysis, only rewards longer passphrases
 * that draw on more character classes. Good enough to nudge users toward
 * stronger secrets; not a substitute for the real thing.
 */

/** Minimum passphrase length, in characters. Enforced before the user proceeds. */
export const MIN_PASSPHRASE_LENGTH = 12;

export type StrengthLevel = 0 | 1 | 2 | 3;

export interface PassphraseStrength {
  level: StrengthLevel;
  label: string;
}

const LABELS: Record<StrengthLevel, string> = {
  0: 'Too weak',
  1: 'Weak',
  2: 'Good',
  3: 'Strong',
};

/** The size of the character pool implied by which classes appear in `p`. */
function poolSize(p: string): number {
  let size = 0;
  if (/[a-z]/.test(p)) size += 26;
  if (/[A-Z]/.test(p)) size += 26;
  if (/[0-9]/.test(p)) size += 10;
  if (/[^a-zA-Z0-9]/.test(p)) size += 32;
  return size;
}

/**
 * Estimates the strength of `p`. Returns level 0 ("Too weak") for anything
 * below {@link MIN_PASSPHRASE_LENGTH}; otherwise buckets a rough entropy
 * (length × log2(pool size)) into Weak / Good / Strong.
 */
export function estimateStrength(p: string): PassphraseStrength {
  if (p.length < MIN_PASSPHRASE_LENGTH) {
    return {level: 0, label: LABELS[0]};
  }
  const pool = poolSize(p);
  const bits = pool > 0 ? p.length * Math.log2(pool) : 0;

  const level: StrengthLevel = bits >= 90 ? 3 : bits >= 64 ? 2 : 1;
  return {level, label: LABELS[level]};
}
