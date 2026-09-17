import { createHash } from 'crypto';
import * as path from 'path';
import { resolveWorktreePath, worktreeDirectoryName } from './worktree-path';

function shortHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

describe('worktree path resolution', () => {
  it('uses a nested, bounded, deterministic default path', () => {
    const root = path.resolve('/repo');
    const branch = 'feature/deep-change';

    expect(resolveWorktreePath(root, branch)).toBe(
      path.join(
        root,
        '.claude-worktrees',
        `feature-deep-change-${shortHash(branch)}`,
      ),
    );
  });

  it('does not collapse distinct branch refs onto one directory', () => {
    expect(worktreeDirectoryName('feature/a-b')).not.toBe(
      worktreeDirectoryName('feature/a/b'),
    );
  });

  it.each([`feature/${'a'.repeat(180)}`, 'feature/修复-ёж', '../escape'])(
    'maps %p to one bounded filesystem-safe segment',
    (branch) => {
      const name = worktreeDirectoryName(branch);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).not.toMatch(/[\\/]/);
      expect(name).not.toBe('.');
      expect(name).not.toBe('..');
      expect(name.endsWith(shortHash(branch))).toBe(true);
    },
  );

  it('rejects a relative custom path escaping the workspace', () => {
    const root = path.resolve('/repo');
    expect(() =>
      resolveWorktreePath(root, 'feature/x', '../repo-evil'),
    ).toThrow(/Relative worktree path must stay/);
  });

  it('retains explicit absolute paths', () => {
    const root = path.resolve('/repo');
    const explicit = path.resolve('/worktrees/feature-x');
    expect(resolveWorktreePath(root, 'feature/x', explicit)).toBe(explicit);
    expect(resolveWorktreePath(root, 'feature/x', 'D:/worktrees/x')).toBe(
      'D:/worktrees/x',
    );
  });
});
