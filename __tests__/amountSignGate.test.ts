/**
 * @format
 *
 * The unsigned-amount gate. `formatCommons` keeps the minus; the unsigned
 * `formatCommonsMagnitude` drops it and is allowed only where the sign is drawn
 * or worded separately. This reads every source file under `src/` — the real
 * tree, not a fixture list — and fails when any other file names the unsigned
 * formatter, so a new screen cannot quietly put "Accept 20.00" beside a −20.00
 * offer.
 *
 * The one other unsigned source is `PaymentCopy.magnitude` (built in
 * `ledger/txDisplay`, which is allowlisted): it is for use only beside its
 * payment role's own verb, which already words the direction.
 */
import {readdirSync, readFileSync, statSync} from 'fs';
import {join, relative, sep} from 'path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** Files allowed to name the unsigned formatter, and why. */
const ALLOWLIST = new Set([
  'src/ledger/format.ts', // defines it
  'src/components/Amount.tsx', // draws the sign itself
  'src/ledger/txDisplay.ts', // direction-verb copy, after the role branch
  'src/screens/main/Marketplace.tsx', // "Subsidy of …" words the sign
  'src/screens/main/CreateListing.tsx', // edit prefill; `isSubsidy` carries the sign
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx|js|jsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map(path => ({
  rel: relative(ROOT, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));
const callers = files.filter(f => /\bformatCommonsMagnitude\b/.test(f.text)).map(f => f.rel);

test('the scan reads the real source tree', () => {
  expect(files.length).toBeGreaterThan(50);
  // Every allowlisted file exists and uses it — a stale entry is a hole.
  for (const rel of ALLOWLIST) {
    expect(callers).toContain(rel);
  }
});

test('only the allowlist formats an amount without its sign', () => {
  expect(callers.filter(rel => !ALLOWLIST.has(rel))).toEqual([]);
});
