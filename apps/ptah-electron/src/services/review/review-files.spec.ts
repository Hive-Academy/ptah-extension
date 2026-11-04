import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ReviewFiles } from './review-files';

describe('ReviewFiles', () => {
  it('confines attempt files and refuses to overwrite an artifact', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'ptah-review-files-'));
    const attemptsRoot = resolve(temp, 'attempts');
    const files = new ReviewFiles(async () => ({ repoRoot: resolve(temp, 'repo'), attemptsRoot }));
    try {
      await import('node:fs/promises').then(({ mkdir }) => mkdir(attemptsRoot));
      const out = resolve(attemptsRoot, 'attempt-1', 'out');
      await files.mkdir(out);
      const artifact = resolve(out, 'review.json');
      await files.writeFile(artifact, 'first', 'utf8');
      await expect(files.writeFile(artifact, 'second', 'utf8')).rejects.toThrow();
      expect(await readFile(artifact, 'utf8')).toBe('first');
      await expect(files.read(resolve(temp, 'outside'))).rejects.toThrow();
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
});
