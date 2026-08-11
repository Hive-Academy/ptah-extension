import * as fs from 'fs';
import * as path from 'path';
import {
  TREE_HIDDEN_DIRS,
  WATCH_IGNORED_DIRS,
  isExcludedWorkspacePath,
} from './workspace-scan.constants';

/**
 * The exact nine names that lived in `HIDDEN_SKIP` in
 * `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts:70-80`
 * before TASK_2026_173 batch 5 deleted it.
 */
const LEGACY_HIDDEN_SKIP = new Set([
  '.git',
  '.hg',
  '.svn',
  '.DS_Store',
  '.Trash',
  '.cache',
  '.tmp',
  '.temp',
  '.nx',
]);

/**
 * The tree builder's *previous* two-check filter, reproduced verbatim from
 * `editor-rpc.handlers.ts:855-860` as it stood before batch 5:
 *
 * ```ts
 * if (entry.name === 'node_modules' || entry.name === 'dist') continue;
 * if (entry.name.startsWith('.') && HIDDEN_SKIP.has(entry.name)) continue;
 * ```
 *
 * Kept here purely as the reference oracle for the visibility-invariance
 * test below. It is NOT a second maintained exclusion list — it is frozen
 * history, and the test that consumes it fails the moment the shipped
 * behaviour diverges from it.
 */
function legacyTreeSkips(entryName: string): boolean {
  if (entryName === 'node_modules' || entryName === 'dist') return true;
  if (entryName.startsWith('.') && LEGACY_HIDDEN_SKIP.has(entryName)) {
    return true;
  }
  return false;
}

describe('workspace-scan.constants', () => {
  describe('set relations', () => {
    it('TREE_HIDDEN_DIRS is a subset of WATCH_IGNORED_DIRS', () => {
      for (const name of TREE_HIDDEN_DIRS) {
        expect(WATCH_IGNORED_DIRS.has(name)).toBe(true);
      }
      expect(WATCH_IGNORED_DIRS.size).toBeGreaterThanOrEqual(
        TREE_HIDDEN_DIRS.size,
      );
    });

    it('the watch set adds exactly one name beyond the tree set: .angular', () => {
      const extra = [...WATCH_IGNORED_DIRS].filter(
        (name) => !TREE_HIDDEN_DIRS.has(name),
      );
      expect(extra).toEqual(['.angular']);
    });

    it('TREE_HIDDEN_DIRS is exactly the union of the two pre-batch-5 tree checks', () => {
      const expected = new Set([...LEGACY_HIDDEN_SKIP, 'node_modules', 'dist']);
      expect([...TREE_HIDDEN_DIRS].sort()).toEqual([...expected].sort());
    });

    it('does NOT speculatively exclude plausible source directories (R-9)', () => {
      for (const name of ['out', 'build', 'coverage', '.next', '.turbo']) {
        expect(TREE_HIDDEN_DIRS.has(name)).toBe(false);
        expect(WATCH_IGNORED_DIRS.has(name)).toBe(false);
      }
    });

    it('.angular is watch-ignored but NOT tree-hidden (Option B: visibility unchanged)', () => {
      expect(TREE_HIDDEN_DIRS.has('.angular')).toBe(false);
      expect(WATCH_IGNORED_DIRS.has('.angular')).toBe(true);
    });
  });

  /**
   * TASK_2026_173 batch 5 / Option B: the file tree must render exactly the
   * same set of directories before and after the shared-predicate migration.
   * `buildFileTree`'s filter is a pure function of `entry.name`, so proving
   * the old and new predicates agree on every name proves the rendered tree
   * is unchanged.
   */
  describe('tree visibility is byte-identical to the pre-batch-5 behaviour', () => {
    const corpus = [
      // every name in either legacy check
      ...LEGACY_HIDDEN_SKIP,
      'node_modules',
      'dist',
      // dot-directories the tree deliberately still SHOWS
      '.angular',
      '.claude',
      '.agent',
      '.vscode',
      '.github',
      '.husky',
      '.ptah',
      '.gitignore',
      '.editorconfig',
      '.env',
      // ordinary source directories
      'src',
      'apps',
      'libs',
      'out',
      'build',
      'coverage',
      '.next',
      '.turbo',
      'distribution',
      'node_modules_backup',
      'index.ts',
      '',
    ];

    it.each(corpus)(
      'renders %p identically under old and new filters',
      (name) => {
        expect(isExcludedWorkspacePath(name, TREE_HIDDEN_DIRS)).toBe(
          legacyTreeSkips(name),
        );
      },
    );

    it('the dot gate was a no-op: every legacy HIDDEN_SKIP name starts with "."', () => {
      for (const name of LEGACY_HIDDEN_SKIP) {
        expect(name.startsWith('.')).toBe(true);
      }
    });
  });

  /**
   * TASK_2026_207. The M3 perf harness
   * (`apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs`)
   * hand-maintains its own `IGNORED_DIRS` copy of `WATCH_IGNORED_DIRS`. The
   * copy is justified — the harness is plain `.mjs` run by bare `node`, and
   * importing this TypeScript module would drag it into the build graph and
   * forfeit the "zero product-code change" property that makes the M3
   * before/after numbers comparable — but until now its only safeguard was a
   * comment asking the next editor to remember.
   *
   * This reads the harness as TEXT and parses the literal out, so the guard
   * costs the harness nothing at run time while making the comment's promise
   * an enforced invariant. Drift here corrupts a future measurement, never
   * production behaviour, which is exactly why it would otherwise go
   * unnoticed until someone trusted a bad number.
   */
  describe('M3 perf harness IGNORED_DIRS copy', () => {
    const HARNESS_PATH = path.resolve(
      __dirname,
      '../../../../..',
      'apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs',
    );

    /** Names inside the harness's `const IGNORED_DIRS = new Set([...])`. */
    function harnessIgnoredDirs(): string[] {
      const source = fs.readFileSync(HARNESS_PATH, 'utf8');
      const literal = source.match(
        /const IGNORED_DIRS = new Set\(\[([\s\S]*?)\]\)/,
      );
      if (!literal) {
        throw new Error(
          `Could not find "const IGNORED_DIRS = new Set([...])" in ${HARNESS_PATH}. ` +
            'If the harness was restructured, update this guard — do not delete it.',
        );
      }
      return [...literal[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }

    it('the harness file is where this guard expects it', () => {
      expect(fs.existsSync(HARNESS_PATH)).toBe(true);
    });

    it('mirrors WATCH_IGNORED_DIRS exactly', () => {
      expect(harnessIgnoredDirs().sort()).toEqual(
        [...WATCH_IGNORED_DIRS].sort(),
      );
    });

    it('lists each name once', () => {
      const names = harnessIgnoredDirs();
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('isExcludedWorkspacePath', () => {
    it('matches a bare single segment', () => {
      expect(isExcludedWorkspacePath('node_modules', TREE_HIDDEN_DIRS)).toBe(
        true,
      );
      expect(isExcludedWorkspacePath('src', TREE_HIDDEN_DIRS)).toBe(false);
    });

    it('matches on POSIX separators', () => {
      expect(
        isExcludedWorkspacePath('node_modules/foo.ts', WATCH_IGNORED_DIRS),
      ).toBe(true);
      expect(isExcludedWorkspacePath('.git/HEAD', WATCH_IGNORED_DIRS)).toBe(
        true,
      );
      expect(
        isExcludedWorkspacePath('src/app/main.ts', WATCH_IGNORED_DIRS),
      ).toBe(false);
    });

    it('matches on Windows separators', () => {
      expect(
        isExcludedWorkspacePath('node_modules\\foo.ts', WATCH_IGNORED_DIRS),
      ).toBe(true);
      expect(isExcludedWorkspacePath('.git\\HEAD', WATCH_IGNORED_DIRS)).toBe(
        true,
      );
      expect(
        isExcludedWorkspacePath('src\\app\\main.ts', WATCH_IGNORED_DIRS),
      ).toBe(false);
    });

    it('matches a nested segment, not only a leading one', () => {
      expect(
        isExcludedWorkspacePath(
          'packages/foo/node_modules/bar/index.js',
          WATCH_IGNORED_DIRS,
        ),
      ).toBe(true);
      expect(
        isExcludedWorkspacePath(
          'libs\\shared\\dist\\index.js',
          WATCH_IGNORED_DIRS,
        ),
      ).toBe(true);
    });

    it('matches on mixed separators', () => {
      expect(
        isExcludedWorkspacePath(
          'libs/shared\\dist/index.js',
          WATCH_IGNORED_DIRS,
        ),
      ).toBe(true);
    });

    it('does not match a prefix of a longer segment', () => {
      expect(
        isExcludedWorkspacePath('distribution/a.ts', TREE_HIDDEN_DIRS),
      ).toBe(false);
      expect(
        isExcludedWorkspacePath('node_modules_backup/a.ts', TREE_HIDDEN_DIRS),
      ).toBe(false);
      expect(isExcludedWorkspacePath('src/distant.ts', TREE_HIDDEN_DIRS)).toBe(
        false,
      );
    });

    it('returns false for an empty path', () => {
      expect(isExcludedWorkspacePath('', WATCH_IGNORED_DIRS)).toBe(false);
    });

    it('tolerates leading, trailing and doubled separators', () => {
      expect(isExcludedWorkspacePath('/dist/', WATCH_IGNORED_DIRS)).toBe(true);
      expect(isExcludedWorkspacePath('//src//app//', WATCH_IGNORED_DIRS)).toBe(
        false,
      );
    });

    it('excludes .angular under the watch policy but not the tree policy', () => {
      expect(
        isExcludedWorkspacePath('.angular/cache/x.tmp', WATCH_IGNORED_DIRS),
      ).toBe(true);
      expect(
        isExcludedWorkspacePath('.angular/cache/x.tmp', TREE_HIDDEN_DIRS),
      ).toBe(false);
    });
  });
});
