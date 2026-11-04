import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReviewCommandRunner, ReviewCommandScopeError } from './review-command-runner';

const repoA = { owner: 'Hive-Academy', name: 'PtahCode' } as const;

describe('ReviewCommandRunner', () => {
  it('allows the claimed checkout and source, but rejects another checkout and a symlink escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ptah-review-command-'));
    try {
      const checkoutA = join(root, 'repo-a');
      const checkoutB = join(root, 'repo-b');
      const attempts = join(root, 'attempts-a');
      const source = join(attempts, 'attempt-1', 'src');
      const outside = join(root, 'outside');
      await Promise.all([mkdir(checkoutA), mkdir(checkoutB), mkdir(source, { recursive: true }), mkdir(outside)]);
      const escape = join(source, 'escape');
      await symlink(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
      const runner = new ReviewCommandRunner(async (repo) => {
        expect(repo).toEqual(repoA);
        return { repoRoot: checkoutA, attemptsRoot: attempts };
      });

      await expect(runner.run(repoA, 'git', ['worktree', 'add'], checkoutA, 1_000))
        .resolves.toEqual(expect.objectContaining({ timedOut: false }));
      await expect(runner.run(repoA, 'node', ['--version'], source, 1_000))
        .resolves.toEqual(expect.objectContaining({ timedOut: false }));
      await expect(runner.run(repoA, 'git', ['worktree', 'add'], checkoutB, 1_000))
        .rejects.toMatchObject({ code: 'review-command-cwd-outside-roots' });
      await expect(runner.run(repoA, 'node', ['--version'], escape, 1_000))
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
      await expect(runner.run(repoA, 'node', ['--version'], root, 1_000))
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
