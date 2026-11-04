import { resolve } from 'node:path';
import { ReviewWorktreeService } from '@ptah-extension/review-core';
import { ReviewLaneFiles } from './review-lane-files';

describe('ReviewLaneFiles', () => {
  const repo = { owner: 'Hive-Academy', name: 'PtahCode' } as const;
  it('checks the exact head and confines the source to an attempt', async () => {
    const root = resolve('review-attempts');
    const snapshot = jest.fn(async () => ({ headSha: 'a'.repeat(40), checksum: 'sum', files: [] }));
    const worktree = Object.create(ReviewWorktreeService.prototype) as ReviewWorktreeService;
    worktree.snapshot = snapshot;
    const files = new ReviewLaneFiles(worktree, async () => ({ repoRoot: resolve('repo'), attemptsRoot: root }));
    const attempt = resolve(root, 'attempt-1');
    await files.prepare(repo, attempt, 'a'.repeat(40));
    expect(await files.sourceChecksum(repo, attempt, 'a'.repeat(40))).toBe('sum');
    expect(snapshot).toHaveBeenCalledWith(repo, resolve(attempt, 'src'), 'a'.repeat(40));
    await expect(files.prepare(repo, resolve(root, '..', 'outside'), 'a'.repeat(40))).rejects.toThrow();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});
