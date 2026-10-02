/**
 * `classifyGitDirChange` — the pure path table the git-directory subscription
 * routes every change through (TASK_2026_576 RC5).
 *
 * Covered: the main-worktree layout (own gitdir === common dir), a linked
 * worktree (own gitdir `<common>/worktrees/<name>`), nested and remote refs,
 * the stash, other worktrees' administration, Windows spelling (backslashes,
 * drive-letter case) and paths outside the git directory.
 */

import {
  classifyGitDirChange,
  type GitDirChange,
} from './git-dir-change-classifier';

const COMMON = '/repo/.git';
const LINKED_OWN = '/repo/.git/worktrees/wt1';

describe('classifyGitDirChange', () => {
  describe('main worktree (own gitdir is the common dir)', () => {
    const table: ReadonlyArray<[string, GitDirChange | null]> = [
      ['HEAD', 'head'],
      ['ORIG_HEAD', 'head'],
      ['MERGE_HEAD', 'head'],
      ['CHERRY_PICK_HEAD', 'head'],
      ['REVERT_HEAD', 'head'],
      ['REBASE_HEAD', 'head'],
      ['AUTO_MERGE', 'head'],
      ['rebase-merge', 'head'],
      ['rebase-merge/done', 'head'],
      ['rebase-apply/0001', 'head'],
      ['index', 'index'],
      ['FETCH_HEAD', 'refs'],
      ['packed-refs', 'refs'],
      ['refs', 'refs'],
      ['refs/heads/main', 'refs'],
      ['refs/heads/feature/deep/x', 'refs'],
      ['refs/heads/logs', 'refs'],
      ['refs/remotes/origin/x', 'refs'],
      ['refs/tags/v1.0.0', 'refs'],
      ['refs/stash', 'refs-stash'],
      ['refs/heads/stash', 'refs'],
      ['worktrees', 'worktree-admin'],
      ['worktrees/wt1', 'worktree-admin'],
      ['worktrees/wt1/HEAD', 'worktree-admin'],
      ['worktrees/wt1/gitdir', 'worktree-admin'],
      ['config', null],
      ['description', null],
      ['COMMIT_EDITMSG', null],
      ['head', null],
      ['HEAD/nested', null],
      ['index/nested', null],
      ['packed-refs/nested', null],
      ['info/exclude', null],
    ];

    it.each(table)('%s → %s', (relative, expected) => {
      expect(
        classifyGitDirChange(`${COMMON}/${relative}`, COMMON, COMMON),
      ).toBe(expected);
    });

    it('the git directory itself is not a change', () => {
      expect(classifyGitDirChange(COMMON, COMMON, COMMON)).toBeNull();
    });
  });

  describe('linked worktree (own gitdir under <common>/worktrees)', () => {
    const table: ReadonlyArray<[string, GitDirChange | null]> = [
      // Own gitdir.
      ['worktrees/wt1/HEAD', 'head'],
      ['worktrees/wt1/MERGE_HEAD', 'head'],
      ['worktrees/wt1/rebase-merge/msgnum', 'head'],
      ['worktrees/wt1/index', 'index'],
      ['worktrees/wt1/FETCH_HEAD', 'refs'],
      ['worktrees/wt1/refs/bisect/bad', 'refs'],
      ['worktrees/wt1/commondir', null],
      ['worktrees/wt1/gitdir', null],
      ['worktrees/wt1/locked', null],
      ['worktrees/wt1', null],
      // Shared, in the common dir.
      ['refs/heads/wt-branch', 'refs'],
      ['refs/remotes/origin/x', 'refs'],
      ['refs/stash', 'refs-stash'],
      ['packed-refs', 'refs'],
      // The main worktree's own files are not this worktree's HEAD or index.
      ['HEAD', null],
      ['index', null],
      ['ORIG_HEAD', null],
      // Another worktree's administration.
      ['worktrees/wt2', 'worktree-admin'],
      ['worktrees/wt2/HEAD', 'worktree-admin'],
      ['worktrees/wt10/index', 'worktree-admin'],
      ['worktrees', 'worktree-admin'],
    ];

    it.each(table)('%s → %s', (relative, expected) => {
      expect(
        classifyGitDirChange(`${COMMON}/${relative}`, LINKED_OWN, COMMON),
      ).toBe(expected);
    });
  });

  describe('path spelling', () => {
    it('matches Windows paths across separators and drive-letter case', () => {
      expect(
        classifyGitDirChange(
          'd:\\Work\\Repo\\.git\\refs\\heads\\main',
          'D:/work/repo/.git',
          'D:\\work\\repo\\.git\\',
        ),
      ).toBe('refs');
      expect(
        classifyGitDirChange(
          'D:\\work\\repo\\.git\\worktrees\\wt1\\index',
          'D:/work/repo/.git/worktrees/wt1',
          'D:\\work\\repo\\.git',
        ),
      ).toBe('index');
    });

    it('keeps POSIX paths case-sensitive', () => {
      expect(
        classifyGitDirChange('/Repo/.git/HEAD', '/repo/.git', '/repo/.git'),
      ).toBeNull();
    });

    it('git names stay case-sensitive on Windows', () => {
      expect(
        classifyGitDirChange(
          'D:\\repo\\.git\\Head',
          'D:\\repo\\.git',
          'D:\\repo\\.git',
        ),
      ).toBeNull();
    });

    it('ignores paths outside the git directory and sibling prefixes', () => {
      expect(
        classifyGitDirChange('/repo/src/index', COMMON, COMMON),
      ).toBeNull();
      expect(
        classifyGitDirChange('/repo/.github/HEAD', COMMON, COMMON),
      ).toBeNull();
      expect(
        classifyGitDirChange('/repo/.git/../HEAD', COMMON, COMMON),
      ).toBeNull();
    });
  });
});
