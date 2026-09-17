/**
 * Drift pin for TASK_2026_437 C7: the watch port's exclusion decision in
 * platform-core (`isExcludedBySegmentRules`, the directory-name + segment-rule
 * half of `WorkspaceChangeCoalescer`) must answer exactly what shared
 * `isExcludedWorkspacePath` answers. Neither lib may import the other, so the
 * algorithm is duplicated; this lib imports both and is where a divergence
 * fails CI.
 *
 * A consumer migrating onto `IWorkspaceWatcher` passes
 * `excludeDirNames: [...WATCH_IGNORED_DIRS]` and
 * `excludeSegmentRules: NESTED_WORKSPACE_PATH_RULES`; that mapping is the one
 * exercised here, so the migration changes no behaviour.
 */

import { isExcludedBySegmentRules } from '@ptah-extension/platform-core';
import {
  NESTED_WORKSPACE_PATH_RULES,
  WATCH_IGNORED_DIRS,
  isExcludedWorkspacePath,
} from '@ptah-extension/shared';

/** [path, expected] — the expectation guards against both copies drifting together. */
const TABLE: ReadonlyArray<readonly [string, boolean]> = [
  // Agent worktree directories (multi-segment and single-name rules).
  ['.claude/worktrees/agent-1/src/a.ts', true],
  ['.claude\\worktrees\\agent-1\\src\\a.ts', true],
  ['pkg/.claude/worktrees/x', true],
  ['.Claude/WorkTrees/x', true],
  ['.CLAUDE\\WORKTREES', true],
  ['.claude//worktrees/x', true],
  ['.claude\\\\worktrees', true],
  ['.claude-worktrees/t1/file.ts', true],
  ['pkg\\.Claude-Worktrees\\t1', true],
  // Siblings that must stay watched.
  ['.claude/commands/x.md', false],
  ['.claude/skills/s/SKILL.md', false],
  ['.claude/agents/a.md', false],
  ['.claude', false],
  ['worktrees/.claude/x', false],
  ['.claude/work/trees', false],
  ['foo.claude-worktrees/x', false],
  ['.claude-worktrees-old/x', false],
  ['my.claude/worktrees', false],
  // Directory names: exact, case-sensitive.
  ['node_modules', true],
  ['packages/foo/node_modules/bar/index.js', true],
  ['packages\\foo\\node_modules\\bar', true],
  ['Node_Modules/x', false],
  ['NODE_MODULES', false],
  ['dist/main.js', true],
  ['Dist/main.js', false],
  ['.git/index', true],
  ['.GIT/index', false],
  ['src/.gitignore', false],
  ['.github/workflows/ci.yml', false],
  ['coverage/lcov.info', true],
  ['tmp', true],
  // Absolute and UNC shapes (every segment is tested, as the shared doc says).
  ['C:\\ws\\src\\a.ts', false],
  ['C:\\ws\\node_modules\\a.js', true],
  ['\\\\server\\share\\repo\\src\\a.ts', false],
  ['\\\\server\\share\\repo\\.claude\\worktrees\\a', true],
  ['//server/share/repo/dist/x', true],
  ['/home/u/ws/.claude-worktrees/x', true],
  // Degenerate input.
  ['', false],
  ['/', false],
  ['\\', false],
  ['./node_modules', true],
  ['src/a.ts', false],
  // Non-BMP characters never fold into ASCII letters.
  ['.claude/w\u{1D428}rktrees', false],
  ['\u{1F600}/node_modules', true],
];

describe('workspace exclusion drift: platform-core coalescer vs shared predicate', () => {
  it.each(TABLE)('%j → %s in both', (path, expected) => {
    const shared = isExcludedWorkspacePath(
      path,
      WATCH_IGNORED_DIRS,
      NESTED_WORKSPACE_PATH_RULES,
    );
    const port = isExcludedBySegmentRules(
      path,
      WATCH_IGNORED_DIRS,
      NESTED_WORKSPACE_PATH_RULES,
    );
    expect(port).toBe(shared);
    expect(shared).toBe(expected);
  });

  it('agrees on caller-supplied edge rules (empty rule, empty name, repeated segments)', () => {
    const dirs = new Set(['build']);
    const rules = [[], ['a', ''], ['x', 'x'], ['.claude', 'worktrees']];
    const paths = [
      'a',
      'a/b',
      'x',
      'x/x',
      'y/x/x/z',
      'x//x',
      'build',
      'Build',
      '.claude/worktrees',
      'z/a',
    ];
    for (const path of paths) {
      expect(isExcludedBySegmentRules(path, dirs, rules)).toBe(
        isExcludedWorkspacePath(path, dirs, rules),
      );
    }
  });
});
