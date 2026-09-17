import {
  AGENT_WORKTREE_DIR,
  NESTED_WORKSPACE_PATH_RULES,
  WATCH_IGNORED_DIRS,
  isExcludedWorkspacePath,
  toWorkspaceExcludeGlobs,
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

    it('without rules, keeps single-segment behaviour (worktrees are not excluded)', () => {
      expect(
        isExcludedWorkspacePath('.claude-worktrees/x/a.ts', WATCH_IGNORED_DIRS),
      ).toBe(false);
      expect(
        isExcludedWorkspacePath('.claude/worktrees/x/a.ts', WATCH_IGNORED_DIRS),
      ).toBe(false);
    });
  });

  describe('NESTED_WORKSPACE_PATH_RULES (INV-2)', () => {
    it('holds exactly the two agent worktree locations, built from the single literal', () => {
      expect(AGENT_WORKTREE_DIR).toBe('.claude-worktrees');
      expect(NESTED_WORKSPACE_PATH_RULES).toEqual([
        [AGENT_WORKTREE_DIR],
        ['.claude', 'worktrees'],
      ]);
    });

    const EMPTY_DIRS: ReadonlySet<string> = new Set();

    /** [path, excluded] — the INV-2 table. */
    const TABLE: ReadonlyArray<readonly [string, boolean]> = [
      // Ptah worktree dir, root and nested, both separators
      ['.claude-worktrees', true],
      ['.claude-worktrees/x/a.ts', true],
      ['.claude-worktrees\\x\\a.ts', true],
      ['pkg/.claude-worktrees/y', true],
      ['pkg\\.claude-worktrees\\y', true],
      ['a/b/c/.claude-worktrees/d/e/f.ts', true],
      // Claude Code worktree dir: two consecutive segments
      ['.claude/worktrees', true],
      ['.claude/worktrees/x/a.ts', true],
      ['.claude\\worktrees\\x\\a.ts', true],
      ['.claude/worktrees\\x/a.ts', true],
      ['pkg/.claude/worktrees/y/b.ts', true],
      ['pkg\\.claude\\worktrees\\y\\b.ts', true],
      ['/.claude//worktrees/x', true],
      ['D:\\projects\\repo\\.claude\\worktrees\\x\\a.ts', true],
      // `.claude` itself and its tracked siblings stay watched
      ['.claude', false],
      ['.claude/', false],
      ['.claude/commands/x.md', false],
      ['.claude\\commands\\x.md', false],
      ['.claude/skills/foo/SKILL.md', false],
      ['.claude/agents/backend.md', false],
      ['.claude/settings.json', false],
      // Segments must be consecutive and whole
      ['worktrees/x', false],
      ['.claude/x/worktrees/y', false],
      ['worktrees/.claude/y', false],
      ['.claude/worktrees-old/x', false],
      ['.claude-worktrees-backup/x', false],
      ['my.claude/worktrees/x', false],
      ['src/.claude-worktrees.ts', false],
      // ASCII case-insensitive on every platform (NTFS; the 09-14 incident was win32)
      ['.Claude/Worktrees/x', true],
      ['.CLAUDE-WORKTREES/x', true],
      ['.Claude-Worktrees/x', true],
      ['.CLAUDE/Worktrees/x', true],
      ['pkg\\.Claude\\WORKTREES\\y', true],
      ['.Claude/Commands/x.md', false],
      ['', false],
    ];

    it.each(TABLE)('segment predicate: %s → %s', (path, excluded) => {
      expect(
        isExcludedWorkspacePath(path, EMPTY_DIRS, NESTED_WORKSPACE_PATH_RULES),
      ).toBe(excluded);
    });

    it.each(TABLE)(
      'derived globs agree with the predicate: %s → %s',
      (path, excluded) => {
        if (path === '') return;
        const globs = toWorkspaceExcludeGlobs(NESTED_WORKSPACE_PATH_RULES);
        // The globs match the directory's CONTENTS (`/**`); probe with a child
        // so the directory itself is covered, and normalize separators the
        // way glob consumers do.
        const probe = `${path.replace(/\\/g, '/').replace(/\/+$/, '')}/child`;
        const matched = globs.some((glob) =>
          globToRegExp(glob).test(probe.replace(/\/{2,}/g, '/')),
        );
        expect(matched).toBe(excluded);
      },
    );

    it('combines with the single-segment set', () => {
      expect(
        isExcludedWorkspacePath(
          'src/node_modules/x',
          WATCH_IGNORED_DIRS,
          NESTED_WORKSPACE_PATH_RULES,
        ),
      ).toBe(true);
      expect(
        isExcludedWorkspacePath(
          'src/app/main.ts',
          WATCH_IGNORED_DIRS,
          NESTED_WORKSPACE_PATH_RULES,
        ),
      ).toBe(false);
    });

    it('an empty rule never excludes everything', () => {
      expect(isExcludedWorkspacePath('src/a.ts', EMPTY_DIRS, [[]])).toBe(false);
    });
  });

  describe('toWorkspaceExcludeGlobs', () => {
    it('derives one any-depth, case-insensitive glob per rule', () => {
      expect(toWorkspaceExcludeGlobs(NESTED_WORKSPACE_PATH_RULES)).toEqual([
        '**/.[cC][lL][aA][uU][dD][eE]-[wW][oO][rR][kK][tT][rR][eE][eE][sS]/**',
        '**/.[cC][lL][aA][uU][dD][eE]/[wW][oO][rR][kK][tT][rR][eE][eE][sS]/**',
      ]);
    });

    it('skips empty rules and empty names instead of emitting a catch-all', () => {
      expect(toWorkspaceExcludeGlobs([[], [''], ['a', '', 'b1']])).toEqual([
        '**/[aA]/[bB]1/**',
      ]);
    });
  });
});

/**
 * Minimal glob → RegExp for the drift check above. `shared` is
 * zero-dependency, so picomatch is not available here; the derived globs only
 * use a leading `**\/`, literal names, `[...]` letter classes and a trailing
 * `/**`. No `i` flag: case-insensitivity must come from the glob itself.
 */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    const classEnd = char === '[' ? glob.indexOf(']', i + 1) : -1;
    if (classEnd > i + 1) {
      const members = glob.slice(i + 1, classEnd);
      source += `[${members.replace(/[\\\]^-]/g, '\\$&')}]`;
      i = classEnd;
    } else if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 2;
    } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      source += '/.*';
      i += 2;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}
