/**
 * TASK_2026_186 — the ratchet. `text-base-content/NN` must not come back.
 *
 * ## Why a source sweep rather than a rendered-DOM check
 *
 * The defect is invisible to every other kind of test. jsdom has no layout and
 * no computed theme values, so a component spec that renders
 * `class="text-base-content/40"` passes exactly as happily as one rendering
 * `text-base-content-muted`. The class name IS the defect, so the class name is
 * what has to be swept — and it has to be swept in the source, because that is
 * the only place it survives in a form a human will copy.
 *
 * ## Why it will come back without this
 *
 * It already did, twice. TASK_2026_183 removed the ladder from three files; the
 * two `detail/` components kept theirs until TASK_2026_186 found them. And
 * TASK_2026_177 B13 closed a contrast finding by moving an element from `/40`
 * to `/60` — a fix that was correct in the dark theme it was measured in and
 * that measures 4.42:1 in `operator-member-light`. The alpha modifier is an
 * attractive nuisance: it looks like a dimmer, it reads like a dimmer, and it
 * silently changes meaning per theme. `text-base-content-muted` is the
 * replacement, and this spec is what keeps the door shut.
 *
 * ## Scope
 *
 * `libs/frontend/tasks-ui` only. The same defect exists across `libs/frontend`
 * and `libs/web` (~1300 call sites) and is NOT this task's to sweep — see the
 * TASK_2026_186 report. Widening the glob below is how that sweep gets ratcheted
 * once it lands.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Root of the library this ratchet governs. */
const LIB_SRC = join(__dirname, '..', '..');

/**
 * `text-base-content/NN` — the banned form. Deliberately does NOT match
 * `border-base-content/10` or `bg-base-content/5`: WCAG's 4.5:1 text rule is
 * about TEXT. A hairline border at 10% is not text and is not governed here.
 */
const BANNED = /text-base-content\/\d+/g;

/**
 * The one permitted exception, and why.
 *
 * `tasks-view.component.ts` dims two large empty-state glyphs to `/20`. Both
 * carry `aria-hidden="true"` and neither conveys information that is not also
 * in the adjacent text. WCAG 1.4.3 exempts purely decorative imagery from the
 * contrast requirement, so raising these would be a change with a cost and no
 * benefit. TASK_2026_183 left them deliberately; TASK_2026_186 kept that call.
 *
 * The exception is keyed to the exact class string AND the file, so it cannot
 * silently start covering a new site or a different alpha.
 */
const DECORATIVE_EXCEPTIONS: ReadonlyMap<string, number> = new Map([
  // file (relative to lib src) -> exact number of `text-base-content/20`
  // occurrences that are aria-hidden decorative glyphs
  ['lib/components/tasks-view.component.ts', 2],
]);

/** Every .ts/.html source file in the library, excluding specs. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (
      /\.(ts|html)$/.test(entry.name) &&
      !entry.name.endsWith('.spec.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** Strip comments so a doc-block *describing* the ban does not trip it. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

describe('tasks-ui does not use opacity-modified base-content for text', () => {
  const offenders = new Map<string, string[]>();

  beforeAll(() => {
    for (const file of sourceFiles(LIB_SRC)) {
      const relative = file
        .slice(LIB_SRC.length + 1)
        .split('\\')
        .join('/');
      const hits = stripComments(readFileSync(file, 'utf8')).match(BANNED);
      if (hits === null) continue;

      const allowed = DECORATIVE_EXCEPTIONS.get(relative) ?? 0;
      const decorative = hits.filter((h) => h === 'text-base-content/20');
      // Only `/20` decorative glyphs are ever exemptible, and only up to the
      // count recorded above. Anything else is an offender.
      const surplus = [
        ...hits.filter((h) => h !== 'text-base-content/20'),
        ...decorative.slice(allowed),
      ];
      if (surplus.length > 0) offenders.set(relative, surplus);
    }
  });

  it('has no banned text-base-content/NN outside the decorative exceptions', () => {
    // Failure message names the file and the class so the fix is obvious:
    // replace it with `text-base-content-muted`.
    expect(Object.fromEntries(offenders)).toEqual({});
  });

  it('still sweeps a meaningful number of files', () => {
    // A ratchet that silently stops finding files is a ratchet that has
    // stopped ratcheting. If the library is restructured and LIB_SRC no longer
    // resolves, this fails rather than passing vacuously.
    expect(sourceFiles(LIB_SRC).length).toBeGreaterThan(20);
  });

  it('actually detects the banned pattern when it is present', () => {
    // Proves the regex and the comment-stripper agree on a real template line,
    // so the green result above means "absent", not "unmatched".
    const sample = '<span class="text-xs text-base-content/40">x</span>';

    expect(stripComments(sample).match(BANNED)).toEqual([
      'text-base-content/40',
    ]);
  });

  it('does not flag non-text base-content utilities', () => {
    const sample = '<div class="border-base-content/10 bg-base-content/5">';

    expect(stripComments(sample).match(BANNED)).toBeNull();
  });

  it('records every decorative exception as still present and still exempt', () => {
    // If someone removes the glyphs, the exception must be removed with them —
    // otherwise it silently becomes budget for a future violation.
    for (const [relative, count] of DECORATIVE_EXCEPTIONS) {
      const source = readFileSync(join(LIB_SRC, relative), 'utf8');
      const hits = source.match(/text-base-content\/20/g) ?? [];

      expect({ relative, count: hits.length }).toEqual({ relative, count });
    }
  });
});
