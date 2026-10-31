import * as path from 'node:path';
import { readGitWorktreeInfo, type WorktreeFileReader } from './git-worktree-info';

const CWD = path.resolve('/repo/.claude-worktrees/TASK_2026_101-x');
const GITDIR = path.resolve('/repo/.git/worktrees/TASK_2026_101-x');

function reader(files: Record<string, string>): WorktreeFileReader {
  return {
    readFile: jest.fn(async (file: string) => {
      const content = files[path.resolve(file)];
      if (content === undefined) throw new Error(`ENOENT: ${file}`);
      return content;
    }),
  };
}

describe('readGitWorktreeInfo', () => {
  it('reads the branch of a linked worktree', async () => {
    const fs = reader({
      [path.join(CWD, '.git')]: `gitdir: ${GITDIR}\n`,
      [path.join(GITDIR, 'HEAD')]: 'ref: refs/heads/feat/TASK_2026_101-x\n',
    });
    await expect(readGitWorktreeInfo(fs, CWD)).resolves.toEqual({
      worktreePath: CWD,
      branch: 'feat/TASK_2026_101-x',
    });
  });

  it('resolves a relative gitdir against the worktree', async () => {
    const relative = path.relative(CWD, GITDIR);
    const fs = reader({
      [path.join(CWD, '.git')]: `gitdir: ${relative}`,
      [path.join(GITDIR, 'HEAD')]: 'ref: refs/heads/main',
    });
    await expect(readGitWorktreeInfo(fs, CWD)).resolves.toEqual({
      worktreePath: CWD,
      branch: 'main',
    });
  });

  it('reports no branch for a detached HEAD or an unreadable HEAD', async () => {
    const detached = reader({
      [path.join(CWD, '.git')]: `gitdir: ${GITDIR}`,
      [path.join(GITDIR, 'HEAD')]: '0123456789abcdef0123456789abcdef01234567\n',
    });
    await expect(readGitWorktreeInfo(detached, CWD)).resolves.toEqual({
      worktreePath: CWD,
      branch: null,
    });
    const noHead = reader({ [path.join(CWD, '.git')]: `gitdir: ${GITDIR}` });
    await expect(readGitWorktreeInfo(noHead, CWD)).resolves.toEqual({
      worktreePath: CWD,
      branch: null,
    });
  });

  it('is null when .git is missing, a directory, malformed or oversized', async () => {
    await expect(readGitWorktreeInfo(reader({}), CWD)).resolves.toBeNull();
    await expect(
      readGitWorktreeInfo(reader({ [path.join(CWD, '.git')]: 'not a pointer' }), CWD),
    ).resolves.toBeNull();
    await expect(
      readGitWorktreeInfo(
        reader({ [path.join(CWD, '.git')]: `gitdir: ${'x'.repeat(5000)}` }),
        CWD,
      ),
    ).resolves.toBeNull();
  });
});
