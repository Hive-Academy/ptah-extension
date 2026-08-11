/**
 * The ratchet. `text-base-content/NN` must not come back to `libs/frontend/**`.
 *
 * ## Why this file replaced the one in tasks-ui
 *
 * TASK_2026_186 shipped this guard scoped to `libs/frontend/tasks-ui` and said
 * so in its own doc-block: "the same defect exists across `libs/frontend` and
 * `libs/web` (~1300 call sites) ... widening the glob below is how that sweep
 * gets ratcheted once it lands." The sweep has landed, so the guard moved up to
 * the app that REGISTERS the token it is protecting — `--bcm` and the
 * `base-content-muted` colour both live in this app's `tailwind.config.js`, and
 * a ratchet that outlives its token registration is a trap.
 *
 * `libs/web/**` is deliberately NOT swept here. It is a different application
 * with its own daisyUI config and its own themes, and it has its own copy of
 * this guard at `apps/ptah-landing-page/src/app/no-alpha-base-content.spec.ts`.
 * Pairing each ratchet with the config that defines the token means neither can
 * silently pass over a tree where `text-base-content-muted` resolves to nothing.
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
 * It already did, three times. TASK_2026_183 removed the ladder from three
 * files and the two `detail/` components kept theirs until 186 found them.
 * TASK_2026_177 B13 closed a contrast finding by moving an element from `/40`
 * to `/60` — a fix that was correct in the dark theme it was measured in and
 * that measures 4.42:1 in `operator-member-light`. And 186 itself left ~1300
 * sites standing outside `tasks-ui`. The alpha modifier is an attractive
 * nuisance: it looks like a dimmer, it reads like a dimmer, and it silently
 * changes meaning per theme.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Root of the tree this ratchet governs. */
const SWEPT_ROOT = join(__dirname, '..', '..', '..', '..', 'libs', 'frontend');

/**
 * `text-base-content/NN` — the banned form. Deliberately does NOT match
 * `border-base-content/10` or `bg-base-content/5`: WCAG's 4.5:1 text rule is
 * about TEXT. A hairline border at 10% is not text and is not governed here.
 */
const BANNED = /text-base-content\/\d+/g;

/**
 * The permitted exceptions, and why each one is permitted.
 *
 * Every entry is a purely decorative element: `aria-hidden`, or a standalone
 * glyph whose meaning is already carried by the text beside it. WCAG 1.4.3
 * exempts decorative imagery from the contrast requirement, so raising these
 * would be a change with a cost and no benefit. TASK_2026_183 left the first
 * two deliberately; 186 kept that call; this sweep kept it again.
 *
 * ⚠️ KEYED TO THE EXACT CLASS STRING AS WELL AS THE FILE, AND TO AN EXACT
 * COUNT. An exception recorded as "this file may contain some" becomes budget
 * for a future violation at a different alpha on a different element. Recorded
 * this way it cannot: a new site, or the same site at a new tier, is an
 * offender until someone writes it down here and says why.
 */
const DECORATIVE_EXCEPTIONS: ReadonlyMap<
  string,
  ReadonlyMap<string, number>
> = new Map([
  [
    // Two large empty-state glyphs. Neither conveys anything the adjacent
    // sentence does not.
    'tasks-ui/src/lib/components/tasks-view.component.ts',
    new Map([['text-base-content/20', 2]]),
  ],
  [
    // Search / MessageSquare empty-state glyphs in the session list, each
    // sitting directly above the sentence that says the same thing.
    'chat/src/lib/components/templates/app-shell.component.html',
    new Map([['text-base-content/20', 2]]),
  ],
  [
    // `aria-hidden` GripVertical drag affordance.
    'chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts',
    new Map([['text-base-content/20', 1]]),
  ],
  [
    // `aria-hidden` middot separating two metadata strings.
    'skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts',
    new Map([['text-base-content/25', 1]]),
  ],
  [
    // Same middot separator in the drawer.
    'skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts',
    new Map([['text-base-content/25', 1]]),
  ],
]);

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

/**
 * Hits in `file` that no recorded exception covers, as `class xN` strings.
 * Surplus over a recorded count counts as an offender, so an exception cannot
 * quietly grow.
 */
function offendersIn(relative: string, source: string): string[] {
  const allowed =
    DECORATIVE_EXCEPTIONS.get(relative) ?? new Map<string, number>();
  const out: string[] = [];
  for (const [klass, count] of tally(source)) {
    const surplus = count - (allowed.get(klass) ?? 0);
    if (surplus > 0) out.push(`${klass} x${surplus}`);
  }
  return out.sort();
}

describe('libs/frontend does not use opacity-modified base-content for text', () => {
  const files = sourceFiles(SWEPT_ROOT);

  it('has no banned text-base-content/NN outside the decorative exceptions', () => {
    // Failure message names the file and the class so the fix is obvious:
    // replace it with `text-base-content-muted`.
    const offenders: Record<string, string[]> = {};
    for (const file of files) {
      const relative = relativeTo(SWEPT_ROOT, file);
      const hits = offendersIn(relative, readFileSync(file, 'utf8'));
      if (hits.length > 0) offenders[relative] = hits;
    }

    expect(offenders).toEqual({});
  });

  it('still sweeps a meaningful number of files', () => {
    // A ratchet that silently stops finding files is a ratchet that has stopped
    // ratcheting. If the tree is restructured and SWEPT_ROOT no longer
    // resolves, this fails rather than passing vacuously. 25 Angular libs are
    // under here and the sweep saw 571 files; 400 is a floor, not a target.
    expect(files.length).toBeGreaterThan(400);
  });

  it('reaches the libs this sweep actually repointed', () => {
    // File COUNT alone would survive the root being pointed at some other tree
    // of similar size. These are the four largest consumers of the token.
    const libs = new Set(
      files.map((file) => relativeTo(SWEPT_ROOT, file).split('/')[0]),
    );
    const largestConsumers = [
      'chat',
      'chat-ui',
      'skill-synthesis-ui',
      'memory-curator-ui',
      'setup-wizard',
    ];

    expect(largestConsumers.filter((lib) => !libs.has(lib))).toEqual([]);
  });

  it('actually detects the banned pattern when it is present', () => {
    // Proves the regex and the comment-stripper agree on a real template line,
    // so the green result above means "absent", not "unmatched".
    const sample = '<span class="text-xs text-base-content/40">x</span>';

    expect(offendersIn('nowhere.html', sample)).toEqual([
      'text-base-content/40 x1',
    ]);
  });

  it('catches an Angular class BINDING, not just a static class attribute', () => {
    // 23 of the swept sites were `[class.text-base-content/50]="expr"`. A
    // regex tuned to `class="..."` would have missed every one of them.
    const sample = '<i [class.text-base-content/50]="!active()"></i>';

    expect(offendersIn('nowhere.html', sample)).toEqual([
      'text-base-content/50 x1',
    ]);
  });

  it('does not flag non-text base-content utilities', () => {
    const sample = '<div class="border-base-content/10 bg-base-content/5">';

    expect(offendersIn('nowhere.html', sample)).toEqual([]);
  });

  it('treats surplus over a recorded exception as an offender', () => {
    // The exception is a CEILING, not a licence. A third `/20` glyph in a file
    // recorded as holding two is a new decision and has to be written down.
    const relative = 'tasks-ui/src/lib/components/tasks-view.component.ts';
    const three = '<i class="text-base-content/20"></i>'.repeat(3);

    expect(offendersIn(relative, three)).toEqual(['text-base-content/20 x1']);
  });

  it('does not let an exception cover a DIFFERENT alpha in the same file', () => {
    const relative = 'tasks-ui/src/lib/components/tasks-view.component.ts';
    const sample =
      '<i class="text-base-content/20"></i><p class="text-base-content/40">t</p>';

    expect(offendersIn(relative, sample)).toEqual(['text-base-content/40 x1']);
  });

  it('records every decorative exception as still present and still exempt', () => {
    // If someone removes the glyphs, the exception must be removed with them —
    // otherwise it silently becomes budget for a future violation.
    const actual: Record<string, Record<string, number>> = {};
    const expected: Record<string, Record<string, number>> = {};

    for (const [relative, classes] of DECORATIVE_EXCEPTIONS) {
      const source = readFileSync(join(SWEPT_ROOT, relative), 'utf8');
      const counts = tally(source);
      actual[relative] = Object.fromEntries(
        [...classes.keys()].map((klass) => [klass, counts.get(klass) ?? 0]),
      );
      expected[relative] = Object.fromEntries(classes);
    }

    expect(actual).toEqual(expected);
  });
});
