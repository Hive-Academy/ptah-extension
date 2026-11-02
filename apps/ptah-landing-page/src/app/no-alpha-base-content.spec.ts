/**
 * The ratchet. `text-base-content/NN` must not come back to `libs/web/**`.
 *
 * Sibling of `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`,
 * which governs `libs/frontend/**`. The two are deliberately separate rather
 * than one workspace-wide sweep: each is paired with the `tailwind.config.js`
 * that REGISTERS `base-content-muted` for the themes that tree renders under,
 * so neither can pass over a tree where the replacement token resolves to
 * nothing. `libs/web/**` is compiled only by this app.
 *
 * ## The defect
 *
 * TASK_2026_177 Batch 15B measured `text-base-content/60` at **4.42:1** on
 * `operator-member-light` — below WCAG AA's 4.5:1 for body text, on the SHARED
 * panel nav, so on every member and admin surface. It was the closing state of
 * B13's own F-1 fix, which had moved that element from `/40` to `/60`: correct
 * in the dark theme it was measured in, insufficient in the light one. An alpha
 * modifier tuned against one theme is a fix with an expiry date. The value has
 * to be chosen per theme, which is what `--bcm` is.
 *
 * ## Why a source sweep rather than a rendered-DOM check
 *
 * jsdom has no layout and no computed theme values, so a component spec that
 * renders `class="text-base-content/40"` passes exactly as happily as one
 * rendering `text-base-content-muted`. The class name IS the defect, so the
 * class name is what has to be swept — in the source, because that is the only
 * place it survives in a form a human will copy.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Root of the tree this ratchet governs. */
const SWEPT_ROOT = join(__dirname, '..', '..', '..', '..', 'libs', 'web');

/**
 * `text-base-content/NN` — the banned form. Deliberately does NOT match
 * `border-base-content/10` or `bg-base-content/5`: WCAG's 4.5:1 text rule is
 * about TEXT. A hairline border at 10% is not text and is not governed here.
 */
const BANNED = /text-base-content\/\d+/g;

/** Hits in a source file as `class xN` strings. */
function offendersIn(source: string): string[] {
  const out: string[] = [];
  for (const [klass, count] of tally(source)) {
    out.push(`${klass} x${count}`);
  }
  return out.sort();
}
/** Every .ts/.html source file under the swept root, excluding specs. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
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

const relativeTo = (root: string, file: string): string =>
  file
    .slice(root.length + 1)
    .split(sep)
    .join('/');

/** `class -> count` for one file's banned hits, comments already stripped. */
function tally(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hit of stripComments(source).match(BANNED) ?? []) {
    counts.set(hit, (counts.get(hit) ?? 0) + 1);
  }
  return counts;
}

describe('libs/web does not use opacity-modified base-content for text', () => {
  const files = sourceFiles(SWEPT_ROOT);

  it('has no banned text-base-content/NN', () => {
    // Failure message names the file and the class so the fix is obvious:
    // replace it with `text-base-content-muted`.
    const offenders: Record<string, string[]> = {};
    for (const file of files) {
      const relative = relativeTo(SWEPT_ROOT, file);
      const hits = offendersIn(readFileSync(file, 'utf8'));
      if (hits.length > 0) offenders[relative] = hits;
    }

    expect(offenders).toEqual({});
  });

  it('still sweeps a meaningful number of files', () => {
    // Keep a floor that detects an empty or incorrectly rooted sweep.
    expect(files.length).toBeGreaterThan(10);
  });

  it('reaches the libs this sweep actually repointed', () => {
    // File COUNT alone would survive the root being pointed at some other tree
    // of similar size.
    const libs = new Set(
      files.map((file) => relativeTo(SWEPT_ROOT, file).split('/')[0]),
    );

    expect(
      ['core', 'landing', 'legal', 'ui'].filter((lib) => !libs.has(lib)),
    ).toEqual([]);
  });

  it('actually detects the banned pattern when it is present', () => {
    // Proves the regex and the comment-stripper agree on a real template line,
    // so the green result above means "absent", not "unmatched".
    const sample = '<span class="text-xs text-base-content/40">x</span>';

    expect(offendersIn(sample)).toEqual([
      'text-base-content/40 x1',
    ]);
  });

  it('catches an Angular class BINDING, not just a static class attribute', () => {
    // Eight of the swept `libs/web` sites were `[class.text-base-content/60]`.
    // A regex tuned to `class="..."` would have missed every one of them.
    const sample = '<i [class.text-base-content/60]="!row.expiringSoon"></i>';

    expect(offendersIn(sample)).toEqual([
      'text-base-content/60 x1',
    ]);
  });

  it('does not flag non-text base-content utilities', () => {
    const sample = '<div class="border-base-content/10 bg-base-content/5">';

    expect(offendersIn(sample)).toEqual([]);
  });

});
