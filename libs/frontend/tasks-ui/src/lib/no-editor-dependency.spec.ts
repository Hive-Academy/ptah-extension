import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * R11 — the source ratchet on `tasks-ui → editor`.
 *
 * ## Read this before deleting it as "redundant with the boundary lint"
 *
 * It is not redundant — but the claim has to be stated precisely, because the
 * two spellings of this edge are covered very differently, and a reader who
 * tests the wrong one will conclude the whole file is dead weight.
 *
 * **The PACKAGE-SPECIFIER form is the gap, and it is this file's reason to
 * exist.** `@nx/enforce-module-boundaries`' tag constraints cannot catch it:
 *
 * - `libs/frontend/tasks-ui/project.json` tags:
 *   `["scope:webview", "type:feature", "platform:angular"]`
 * - `libs/frontend/editor/project.json` tags:
 *   `["scope:webview", "type:feature"]`
 * - `eslint.config.mjs` permits `scope:webview → scope:webview` and
 *   `type:feature → type:feature`. Both tags are the SAME on both sides here,
 *   so both constraints are satisfied by construction.
 * - tasks-ui's third tag, `platform:angular`, appears in **no `depConstraints`
 *   entry at all** — there is no `sourceTag: 'platform:angular'` rule anywhere
 *   in the config. An unconstrained tag adds no restriction.
 *
 * Verified by injection, not by reading: with a package import of the editor
 * library present in this library, `nx lint tasks-ui` printed *"All files pass
 * linting"*. The only thing that failed was this test.
 *
 * **The RELATIVE-PATH form is already covered by lint**, and this file does not
 * claim otherwise. `@nx/enforce-module-boundaries` carries a separate,
 * tag-independent no-relative-imports-across-projects check that fires on
 * `../../editor/...` regardless of how either project is tagged. The
 * {@link FORBIDDEN_REACH_BACK} assertion below is therefore a **second line**,
 * not the primary one: cheap, and it keeps the ratchet honest if that rule is
 * ever relaxed or the file is ever moved somewhere the lint does not run.
 *
 * ## Why the edge must not exist
 *
 * The editor library's quick-open component is the obvious donor for a command
 * palette, and it was deliberately read rather than imported (FR-C6.8). That
 * library pulls in Monaco, xterm and a node-pty bridge; the Tasks board is a
 * six-column list. One imported component drags the whole graph into every
 * bundle that ships the board.
 *
 * ## What it checks, and why it is two patterns
 *
 * {@link FORBIDDEN_SPECIFIER} is the package name, matched **anywhere** in the
 * file — that is the check Batch 10 was asked for, and it is deliberately not
 * limited to import position so that a lazy `import()` or a string handed to a
 * loader is caught too.
 *
 * {@link FORBIDDEN_REACH_BACK} is the second line described above. It is
 * matched **only in import position**, because prose explaining why the edge is
 * banned necessarily names the directory, and a ratchet that punished its own
 * documentation would be deleted within a week.
 *
 * This file is the single exclusion, because it names the specifier above.
 */

/** The package specifier. Matched anywhere in the file. */
const FORBIDDEN_SPECIFIER = /@ptah-extension\/editor/;

/**
 * A relative reach-back into the editor library, in import position only:
 * `from '../../editor/…'`, `import('../../../editor')`, `require('…/editor')`.
 */
const FORBIDDEN_REACH_BACK =
  /(?:from|import|require)\s*\(?\s*['"](?:\.\.\/)+editor(?:\/|['"])/;

/** `__dirname` is `…/tasks-ui/src/lib`; the ratchet walks all of `src`. */
const SOURCE_ROOT = resolve(__dirname, '..');

function collectSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (entry.isFile() && /\.(ts|html|scss)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe('the tasks-ui → editor ratchet (R11)', () => {
  const files = collectSourceFiles(SOURCE_ROOT);

  it('walks a source tree that actually contains this library', () => {
    // A ratchet over an empty list passes forever. This is what makes the
    // assertions below mean something: if the walk ever resolves to the wrong
    // directory, this fails first and names the reason.
    expect(files.length).toBeGreaterThan(10);
    expect(
      files.some((file) => file.endsWith('task-command-palette.component.ts')),
    ).toBe(true);
  });

  it('includes this spec in the walk, so the exclusion below is a real one', () => {
    // If this file were outside the walked set the exclusion would be
    // decoration, and nobody reading the filter would know.
    expect(files).toContain(__filename);
  });

  it('never imports @ptah-extension/editor', () => {
    const offenders = files
      .filter((file) => file !== __filename)
      .filter((file) => FORBIDDEN_SPECIFIER.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SOURCE_ROOT, file));

    expect(offenders).toEqual([]);
  });

  // Second line only — the Nx boundary lint's no-relative-cross-project-imports
  // check already fires on this form, tag-independently. Kept because it costs
  // one regex and does not depend on that rule staying enabled.
  it('never reaches the editor library by a relative path either', () => {
    const offenders = files
      .filter((file) => file !== __filename)
      .filter((file) => FORBIDDEN_REACH_BACK.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SOURCE_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
