/**
 * Drift pin for TASK_2026_437 INV-2: the glob excludes every workspace walk
 * uses must carry the shared nested-checkout rules, and must answer the same
 * question the shared segment predicate answers.
 */

import picomatch from 'picomatch';
import {
  NESTED_WORKSPACE_PATH_RULES,
  isExcludedWorkspacePath,
  toWorkspaceExcludeGlobs,
} from '@ptah-extension/shared';

import { DEFAULT_WORKSPACE_EXCLUDES } from './workspace-default-excludes';

describe('DEFAULT_WORKSPACE_EXCLUDES', () => {
  it('is a superset of the globs derived from NESTED_WORKSPACE_PATH_RULES', () => {
    const derived = toWorkspaceExcludeGlobs(NESTED_WORKSPACE_PATH_RULES);
    expect(derived.length).toBe(NESTED_WORKSPACE_PATH_RULES.length);
    expect(DEFAULT_WORKSPACE_EXCLUDES).toEqual(expect.arrayContaining(derived));
  });

  it('has no duplicate entries', () => {
    expect(new Set(DEFAULT_WORKSPACE_EXCLUDES).size).toBe(
      DEFAULT_WORKSPACE_EXCLUDES.length,
    );
  });

  // Matched the way `WorkspaceFileIndexService` matches: picomatch, dot: true,
  // over forward-slash workspace-relative paths. Deliberately NO `nocase`:
  // case-insensitivity must come from the derived globs themselves.
  const isExcluded = picomatch([...DEFAULT_WORKSPACE_EXCLUDES], { dot: true });
  const EMPTY_DIRS: ReadonlySet<string> = new Set();

  it.each([
    ['.claude-worktrees/feature-x/src/a.ts', true],
    ['pkg/.claude-worktrees/y/b.ts', true],
    ['.claude/worktrees/agent-1/package.json', true],
    ['libs/foo/.claude/worktrees/w/index.ts', true],
    // Case variants (NTFS is case-insensitive; the 09-14 incident was win32)
    ['.Claude-Worktrees/x/a.ts', true],
    ['.CLAUDE-WORKTREES/x/a.ts', true],
    ['.CLAUDE/Worktrees/x/a.ts', true],
    ['pkg/.Claude/WORKTREES/y/b.ts', true],
    ['.Claude/Commands/x.md', false],
    ['.claude/commands/x.md', false],
    ['.claude/skills/foo/SKILL.md', false],
    ['.claude/settings.json', false],
    ['src/app/main.ts', false],
  ] as const)(
    'globs and segment predicate agree on %s (excluded: %s)',
    (relativePath, excluded) => {
      expect(isExcluded(relativePath)).toBe(excluded);
      expect(
        isExcludedWorkspacePath(
          relativePath,
          EMPTY_DIRS,
          NESTED_WORKSPACE_PATH_RULES,
        ),
      ).toBe(excluded);
    },
  );
});
