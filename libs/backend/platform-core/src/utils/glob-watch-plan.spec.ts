/**
 * `planGlobWatch` — the glob → watchable-directory translation the Electron and
 * CLI adapters both depend on.
 *
 * The regression behind every case here: chokidar removed glob support in v4,
 * so a pattern passed straight to `chokidar.watch` became a literal directory
 * name, `getWatched()` came back `{}`, and the watcher silently never fired.
 */

import * as path from 'path';

import { planGlobWatch } from './glob-watch-plan';

const ROOT = path.resolve('/ws');
const abs = (...parts: string[]): string => path.resolve(ROOT, ...parts);

/** Existence probe over a fixed set of directories. */
function existing(...dirs: string[]): (candidate: string) => boolean {
  const set = new Set(dirs.map((d) => path.resolve(d).replace(/\\/g, '/')));
  return (candidate: string) =>
    set.has(path.resolve(candidate).replace(/\\/g, '/'));
}

describe('planGlobWatch', () => {
  describe('watchRoot', () => {
    it('resolves the glob to its static prefix so the watch is scoped', () => {
      const plan = planGlobWatch('.ptah/specs/**', {
        cwd: ROOT,
        exists: existing(abs('.ptah/specs')),
      });

      // NOT the workspace root: watching `<root>` to find `.ptah/specs`
      // would put every file in the tree under an OS watch.
      expect(plan.watchRoot).toBe(abs('.ptah/specs').replace(/\\/g, '/'));
    });

    it('falls back to cwd for a pattern that opens with a wildcard', () => {
      const plan = planGlobWatch('**/*', {
        cwd: ROOT,
        exists: existing(ROOT),
      });

      expect(plan.watchRoot).toBe(ROOT.replace(/\\/g, '/'));
    });

    /**
     * chokidar does not pick up a watch path created after `watch()` returns —
     * verified against the installed version. `.ptah/specs/` legitimately does
     * not exist in a workspace that has never used tasks, so without the walk
     * that watcher would be dead for the whole session.
     */
    it('walks up to the nearest existing ancestor when the target is absent', () => {
      const plan = planGlobWatch('.ptah/specs/**', {
        cwd: ROOT,
        exists: existing(ROOT, abs('.ptah')),
      });

      expect(plan.watchRoot).toBe(abs('.ptah').replace(/\\/g, '/'));
    });

    it('never walks above cwd', () => {
      const plan = planGlobWatch('.ptah/specs/**', {
        cwd: ROOT,
        exists: existing('/'),
      });

      expect(plan.watchRoot).toBe(ROOT.replace(/\\/g, '/'));
    });
  });

  describe('matches', () => {
    const plan = planGlobWatch('.ptah/specs/**', {
      cwd: ROOT,
      exists: existing(abs('.ptah/specs')),
    });

    it('accepts a dotted path under the pattern', () => {
      expect(plan.matches(abs('.ptah/specs/TASK_2026_1/task.md'))).toBe(true);
    });

    it('rejects a path outside the pattern', () => {
      expect(plan.matches(abs('.ptah/other/task.md'))).toBe(false);
      expect(plan.matches(abs('src/app.ts'))).toBe(false);
    });

    it('rejects a path outside cwd entirely', () => {
      expect(plan.matches(path.resolve('/elsewhere/task.md'))).toBe(false);
    });

    it('honours the caller excludes', () => {
      const excluded = planGlobWatch('**/*', {
        cwd: ROOT,
        exclude: ['**/node_modules/**', '**/*.map'],
        exists: existing(ROOT),
      });

      expect(excluded.matches(abs('src/app.ts'))).toBe(true);
      expect(excluded.matches(abs('src/app.js.map'))).toBe(false);
      expect(excluded.matches(abs('libs/node_modules/x/index.js'))).toBe(false);
    });
  });

  describe('ignores', () => {
    /**
     * The prune, not a filter. chokidar consults `ignored` for DIRECTORIES, so
     * a true here keeps the subtree off the OS watch instead of walking it and
     * discarding the events — the difference between a bounded watcher and one
     * that indexes `node_modules`.
     */
    it('prunes an excluded directory, not just the files inside it', () => {
      const plan = planGlobWatch('**/*', {
        cwd: ROOT,
        exclude: ['**/node_modules/**'],
        exists: existing(ROOT),
      });

      expect(plan.ignores(abs('libs/node_modules'))).toBe(true);
      expect(plan.ignores(abs('libs/src'))).toBe(false);
    });

    it('keeps everything under the watch root when the target exists', () => {
      const plan = planGlobWatch('.ptah/specs/**', {
        cwd: ROOT,
        exists: existing(abs('.ptah/specs')),
      });

      expect(plan.ignores(abs('.ptah/specs/TASK_2026_1'))).toBe(false);
    });

    /**
     * The other half of the ancestor walk: widening the root must not widen
     * what is watched. Only the branch leading to the target survives, so a
     * missing `.ptah/specs/` never costs a recursive watch of the workspace.
     */
    it('prunes every branch that cannot lead to the target after a walk-up', () => {
      const plan = planGlobWatch('.ptah/specs/**', {
        cwd: ROOT,
        exists: existing(ROOT),
      });

      expect(plan.watchRoot).toBe(ROOT.replace(/\\/g, '/'));
      expect(plan.ignores(abs('node_modules'))).toBe(true);
      expect(plan.ignores(abs('src'))).toBe(true);
      // The path down to the target, and the target's own subtree.
      expect(plan.ignores(abs('.ptah'))).toBe(false);
      expect(plan.ignores(abs('.ptah/specs/TASK_2026_1'))).toBe(false);
    });

    it('ignores anything outside cwd', () => {
      const plan = planGlobWatch('**/*', {
        cwd: ROOT,
        exists: existing(ROOT),
      });

      expect(plan.ignores(path.resolve('/elsewhere'))).toBe(true);
    });
  });
});
