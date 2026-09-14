import { NestedRepoRoots, nestedRepoRootOf } from './nested-repo-roots';
import { parseWorktreeList } from './git.utils';

describe('NestedRepoRoots', () => {
  describe('fromWorktreeList', () => {
    it('keeps worktrees under a Windows workspace, skipping the main worktree and outside paths', () => {
      // `git worktree list --porcelain` on Windows reports forward slashes.
      const output = [
        'worktree D:/projects/ptah-extension',
        'HEAD 1111111111111111111111111111111111111111',
        'branch refs/heads/main',
        '',
        'worktree D:/projects/ptah-extension/.claude-worktrees/feature-x',
        'HEAD 2222222222222222222222222222222222222222',
        'branch refs/heads/feature/x',
        '',
        'worktree D:/projects/ptah-extension/packages/vendored',
        'HEAD 3333333333333333333333333333333333333333',
        'detached',
        '',
        'worktree D:/projects/ptah-437',
        'HEAD 4444444444444444444444444444444444444444',
        'branch refs/heads/fix/x',
        '',
        'worktree D:/projects/ptah-extension-sibling/y',
        'HEAD 5555555555555555555555555555555555555555',
        'branch refs/heads/y',
        '',
      ].join('\n');

      const roots = NestedRepoRoots.fromWorktreeList(
        parseWorktreeList(output),
        'D:\\projects\\ptah-extension',
      );

      expect(roots.roots()).toEqual([
        '.claude-worktrees/feature-x',
        'packages/vendored',
      ]);
    });

    it('matches the workspace root case-insensitively on Windows', () => {
      const roots = NestedRepoRoots.fromWorktreeList(
        [{ path: 'd:/Projects/Repo/.claude/worktrees/A' }],
        'D:\\projects\\repo\\',
      );
      expect(roots.size).toBe(1);
      expect(roots.contains('.claude\\worktrees\\a\\src\\x.ts')).toBe(true);
      expect(roots.contains('.CLAUDE/WORKTREES/A')).toBe(true);
    });

    it('is case-sensitive for a POSIX workspace', () => {
      const roots = NestedRepoRoots.fromWorktreeList(
        [
          { path: '/home/u/repo' },
          { path: '/home/u/repo/nested/Wt' },
          { path: '/home/u/Repo/other' },
        ],
        '/home/u/repo/',
      );
      expect(roots.roots()).toEqual(['nested/Wt']);
      expect(roots.contains('nested/Wt/a.ts')).toBe(true);
      expect(roots.contains('nested/wt/a.ts')).toBe(false);
    });

    it('does not treat a sibling directory sharing the root prefix as inside', () => {
      const roots = NestedRepoRoots.fromWorktreeList(
        [{ path: '/repo-other/x' }, { path: '/repo2' }],
        '/repo',
      );
      expect(roots.size).toBe(0);
    });

    it('collapses doubled separators and trailing slashes in worktree paths', () => {
      const roots = NestedRepoRoots.fromWorktreeList(
        [{ path: 'C:\\\\ws\\\\sub\\\\wt\\\\' }],
        'C:\\ws',
      );
      expect(roots.roots()).toEqual(['sub/wt']);
    });

    it('supports UNC workspace roots', () => {
      const roots = NestedRepoRoots.fromWorktreeList(
        [{ path: '//Server/Share/ws/wt' }],
        '\\\\server\\share\\ws',
      );
      expect(roots.roots()).toEqual(['wt']);
    });

    it('adds nothing when the workspace root is empty', () => {
      const roots = NestedRepoRoots.fromWorktreeList(
        [{ path: '/anything/x' }],
        '',
      );
      expect(roots.size).toBe(0);
    });

    it('returns an empty set for no worktrees', () => {
      expect(NestedRepoRoots.fromWorktreeList([], '/repo').size).toBe(0);
    });
  });

  describe('add (runtime discovery)', () => {
    it('adds workspace-relative roots with either separator', () => {
      const roots = new NestedRepoRoots('C:\\ws');
      expect(roots.add('libs\\vendor\\repo')).toBe(true);
      expect(roots.add('./tools/sub/')).toBe(true);
      expect(roots.roots()).toEqual(['libs/vendor/repo', 'tools/sub']);
    });

    it('is idempotent across spellings on Windows', () => {
      const roots = new NestedRepoRoots('C:/ws');
      roots.add('Libs/Repo');
      roots.add('libs\\repo\\');
      expect(roots.size).toBe(1);
    });

    it('refuses the workspace root itself and paths that climb out', () => {
      const roots = new NestedRepoRoots('/ws');
      expect(roots.add('')).toBe(false);
      expect(roots.add('/')).toBe(false);
      expect(roots.add('.')).toBe(false);
      expect(roots.add('../other')).toBe(false);
      expect(roots.add('a/../../b')).toBe(false);
      expect(roots.size).toBe(0);
    });

    it('merges with worktree-list roots', () => {
      const roots = NestedRepoRoots.fromWorktreeList(
        [{ path: '/ws/.claude-worktrees/a' }],
        '/ws',
      );
      roots.add('vendor/lib');
      expect(roots.contains('vendor/lib/x.c')).toBe(true);
      expect(roots.contains('.claude-worktrees/a/y.ts')).toBe(true);
    });
  });

  describe('contains / findRoot', () => {
    const roots = new NestedRepoRoots('/ws');
    roots.add('pkg/sub');

    it.each([
      ['pkg/sub', true],
      ['pkg/sub/a.ts', true],
      ['pkg\\sub\\deep\\b.ts', true],
      ['/pkg//sub/', true],
      ['./pkg/sub/c', true],
      ['pkg', false],
      ['pkg/subway/a.ts', false],
      ['pkg/su', false],
      ['other/pkg/sub/a.ts', false],
      ['', false],
    ] as const)('%s → %s', (path, expected) => {
      expect(roots.contains(path)).toBe(expected);
    });

    it('returns the shallowest matching root', () => {
      const nested = new NestedRepoRoots('/ws');
      nested.add('a/b/c');
      nested.add('a/b');
      expect(nested.findRoot('a/b/c/d.ts')).toBe('a/b');
    });

    it('returns undefined on an empty set without splitting', () => {
      expect(new NestedRepoRoots('/ws').findRoot('a/b')).toBeUndefined();
    });
  });
});

describe('nestedRepoRootOf', () => {
  it.each([
    // A worktree's `.git` FILE or a repository's `.git` DIR: same event name
    ['pkg/sub/.git', 'pkg/sub'],
    ['pkg\\sub\\.git', 'pkg/sub'],
    ['vendor/.git', 'vendor'],
    // An event inside a nested repository's metadata
    ['pkg/sub/.git/index', 'pkg/sub'],
    ['pkg\\sub\\.git\\refs\\heads\\main', 'pkg/sub'],
    // The workspace's own repository is not nested
    ['.git', undefined],
    ['.git/index', undefined],
    ['/.git/HEAD', undefined],
    ['./.git/HEAD', undefined],
    // Not a git marker
    ['src/a.ts', undefined],
    ['src/.gitignore', undefined],
    ['src/.github/workflows/ci.yml', undefined],
    ['', undefined],
  ] as const)('%s → %s', (path, expected) => {
    expect(nestedRepoRootOf(path)).toBe(expected);
  });

  it('feeds NestedRepoRoots.add', () => {
    const roots = new NestedRepoRoots('D:\\ws');
    const root = nestedRepoRootOf('Pkg\\Sub\\.git');
    expect(root).toBe('Pkg/Sub');
    expect(roots.add(root ?? '')).toBe(true);
    expect(roots.contains('pkg/sub/src/a.ts')).toBe(true);
  });
});
