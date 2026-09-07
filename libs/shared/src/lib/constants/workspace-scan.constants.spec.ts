import {
  WATCH_IGNORED_DIRS,
  isExcludedWorkspacePath,
} from './workspace-scan.constants';

/**
 * The exact nine names that lived in `HIDDEN_SKIP` in
 * `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts:70-80`
 * before TASK_2026_173 batch 5 deleted it, plus the `node_modules`/`dist`
 * check that sat beside it. `TREE_HIDDEN_DIRS` was this exact union until
 * TASK_2026_385 Phase 4 collapsed it into `WATCH_IGNORED_DIRS` (the file
 * explorer that consumed it, and its RPC surface `EditorRpcHandlers`, are
 * gone). Kept here purely as the reference oracle for the
 * no-silent-shrinkage test below.
 */
const LEGACY_TREE_HIDDEN_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.DS_Store',
  '.Trash',
  '.cache',
  '.tmp',
  '.temp',
  '.nx',
  'node_modules',
  'dist',
]);

describe('workspace-scan.constants', () => {
  describe('WATCH_IGNORED_DIRS', () => {
    it('still contains every name the pre-collapse TREE_HIDDEN_DIRS held (no silent shrinkage)', () => {
      for (const name of LEGACY_TREE_HIDDEN_DIRS) {
        expect(WATCH_IGNORED_DIRS.has(name)).toBe(true);
      }
    });

    it('still contains .angular, the pre-collapse watch-only addition', () => {
      expect(WATCH_IGNORED_DIRS.has('.angular')).toBe(true);
    });

    /**
     * TASK_2026_385 Phase 4. `coverage` and `tmp` are the only genuinely new
     * names added by the collapse — see the module doc for why the old
     * "never exclude a plausible source directory" argument no longer applies
     * to them now that no file explorer renders off this set.
     */
    it('excludes coverage and tmp output (new in the Phase 4 collapse)', () => {
      expect(
        isExcludedWorkspacePath('coverage/lcov.info', WATCH_IGNORED_DIRS),
      ).toBe(true);
      expect(isExcludedWorkspacePath('tmp/x', WATCH_IGNORED_DIRS)).toBe(true);
    });

    it('does NOT exclude plausible source directories (R-9)', () => {
      for (const name of ['out', 'build', '.next', '.turbo']) {
        expect(WATCH_IGNORED_DIRS.has(name)).toBe(false);
      }
    });

    /**
     * Pin of EXISTING behaviour, not a new capability: `.nx` was already a
     * member of `TREE_HIDDEN_DIRS`/`WATCH_IGNORED_DIRS` before this collapse,
     * and the segment-level match in `isExcludedWorkspacePath` already caught
     * a nested `cache` directory under it. This test states that out loud so
     * a future edit cannot mistake the collapse for the reason `.nx/cache`
     * writes go unwatched.
     */
    it('a write under .nx/cache is excluded (pin of existing behaviour)', () => {
      expect(
        isExcludedWorkspacePath(
          '.nx/cache/terminalOutputs/abc',
          WATCH_IGNORED_DIRS,
        ),
      ).toBe(true);
      expect(
        isExcludedWorkspacePath(
          '.nx\\cache\\terminalOutputs\\abc',
          WATCH_IGNORED_DIRS,
        ),
      ).toBe(true);
    });
  });

  describe('isExcludedWorkspacePath', () => {
    it('matches a bare single segment', () => {
      expect(isExcludedWorkspacePath('node_modules', WATCH_IGNORED_DIRS)).toBe(
        true,
      );
      expect(isExcludedWorkspacePath('src', WATCH_IGNORED_DIRS)).toBe(false);
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
        isExcludedWorkspacePath('distribution/a.ts', WATCH_IGNORED_DIRS),
      ).toBe(false);
      expect(
        isExcludedWorkspacePath('node_modules_backup/a.ts', WATCH_IGNORED_DIRS),
      ).toBe(false);
      expect(
        isExcludedWorkspacePath('src/distant.ts', WATCH_IGNORED_DIRS),
      ).toBe(false);
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

    it('excludes .angular at any depth', () => {
      expect(
        isExcludedWorkspacePath('.angular/cache/x.tmp', WATCH_IGNORED_DIRS),
      ).toBe(true);
    });
  });
});
