/**
 * @format
 *
 * A source-level guard: the back link is written once, in ScreenHeader.
 *
 * This exists because the invariant it protects has now broken twice in the
 * same week. First VouchList shipped with no back link at all, because writing
 * a new screen gives you no reminder that the block exists. Then, during the
 * refactor that was meant to fix exactly that, VouchList ended up with *two* —
 * a hand-written one surviving next to the new component. Neither the type
 * checker nor a render test that grabs the first matching node can see either
 * mistake.
 *
 * Rendering every screen to count chevrons would be the thorough check, but
 * most screens need a navigator, a station client, and an unlocked wallet to
 * mount. Reading the source costs nothing and catches the real failure mode,
 * which is markup being copied rather than imported.
 */
// The project's tsconfig limits `types` to jest on purpose, so app code cannot
// reach for Node APIs. This test reads the source tree, so it opts itself in
// rather than widening the setting for everything.
/// <reference types="node" />
import {readFileSync, readdirSync, type Dirent} from 'fs';
import {join} from 'path';

const SRC = join(__dirname, '..', 'src');

/** The chevron that opens every back link in the app. */
const CHEVRON = '‹';

/** Where the back link is legitimately written out. */
const HOME = join('components', 'ScreenHeader.tsx');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry: Dirent) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [full] : [];
  });
}

test('no screen hand-writes a back link', () => {
  const offenders = sourceFiles(SRC)
    .filter(file => !file.endsWith(HOME))
    .filter(file => readFileSync(file, 'utf8').includes(CHEVRON))
    .map(file => file.slice(SRC.length + 1));

  expect(offenders).toEqual([]);
});

test('the back link is written exactly once, and it is in ScreenHeader', () => {
  const source = readFileSync(join(SRC, HOME), 'utf8');
  // Two occurrences: the JSX itself and the doc comment naming it.
  const inJsx = source.split('\n').filter((line: string) => line.trim() === `${CHEVRON} {label}`);
  expect(inJsx).toHaveLength(1);
});
