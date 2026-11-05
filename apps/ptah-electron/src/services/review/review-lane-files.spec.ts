import { resolve } from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    expect(await files.prepare(repo, attempt, 'a'.repeat(40))).toBe('sum');
    expect(await files.sourceChecksum(repo, attempt, 'a'.repeat(40))).toBe('sum');
    expect(snapshot).toHaveBeenCalledWith(repo, resolve(attempt, 'src'), 'a'.repeat(40), undefined);
    await expect(files.prepare(repo, resolve(root, '..', 'outside'), 'a'.repeat(40))).rejects.toThrow();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it('removes both previous lane artifacts before the next spawn', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ptah-review-lane-'));
    try {
      const attempt = resolve(root, 'attempt-1');
      const out = resolve(attempt, 'out');
      await mkdir(out, { recursive: true });
      await writeFile(resolve(out, 'lane-output.json'), '{"findings":[1]}');
      await writeFile(resolve(out, 'walkthrough.md'), '# old');
      const worktree = Object.create(ReviewWorktreeService.prototype) as ReviewWorktreeService;
      const files = new ReviewLaneFiles(worktree, async () => ({ repoRoot: resolve('repo'), attemptsRoot: root }));
      await files.clearOutput(attempt);
      await expect(readFile(resolve(out, 'lane-output.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(resolve(out, 'walkthrough.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await files.clearOutput(attempt);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
