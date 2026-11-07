import type { Logger } from '../../logging';
import { GitTimeoutError, type ExecGitResult } from '../../utils/exec-git';
import { GitProbeReader } from './git-probe-reader';

function logger(): jest.Mocked<Pick<Logger, 'error'>> {
  return { error: jest.fn() };
}

function result(partial: Partial<ExecGitResult>): ExecGitResult {
  return { stdout: '', stderr: '', exitCode: 0, ...partial };
}

function reader(exec: jest.Mock, log = logger()): GitProbeReader {
  return new GitProbeReader({ exec, logger: log });
}

describe('GitProbeReader', () => {
  it('lists worktrees from NUL-delimited porcelain', async () => {
    const exec = jest.fn(async () =>
      result({
        stdout: [
          'worktree /repo',
          'HEAD abc',
          'branch refs/heads/main',
          '',
          '',
        ].join('\0'),
      }),
    );

    const read = await reader(exec).readWorktreeList('/repo');

    expect(exec).toHaveBeenCalledWith(
      ['worktree', 'list', '--porcelain', '-z'],
      '/repo',
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
    expect(read).toMatchObject({
      kind: 'listed',
      worktrees: [expect.objectContaining({ path: '/repo', isMain: true })],
    });
  });

  it('reads git’s own "not a git repository" as a confirmed not-a-repo', async () => {
    const exec = jest.fn(async () =>
      result({ exitCode: 128, stderr: 'fatal: not a git repository' }),
    );

    await expect(reader(exec).readWorktreeList('/x')).resolves.toEqual({
      kind: 'not-a-repo',
    });
    await expect(reader(exec).readCommonDir('/x')).resolves.toEqual({
      kind: 'not-a-repo',
    });
  });

  it('reads another non-zero exit, a timeout and an empty path as failed, and logs them', async () => {
    const log = logger();
    const exec = jest
      .fn()
      .mockResolvedValueOnce(
        result({ exitCode: 128, stderr: 'fatal: detected dubious ownership' }),
      )
      .mockRejectedValueOnce(new GitTimeoutError('worktree', 10_000))
      .mockResolvedValueOnce(result({ stdout: '  \n' }));
    const probe = reader(exec, log);

    await expect(probe.readWorktreeList('/r')).resolves.toMatchObject({
      kind: 'failed',
    });
    await expect(probe.readWorktreeList('/r')).resolves.toMatchObject({
      kind: 'failed',
      cause: expect.any(GitTimeoutError),
    });
    await expect(probe.readCommonDir('/r')).resolves.toMatchObject({
      kind: 'failed',
    });
    expect(log.error).toHaveBeenCalledTimes(3);
  });

  it('returns the absolute common dir and passes the caller signal through', async () => {
    const exec = jest.fn(async () => result({ stdout: '/repo/.git\n' }));
    const controller = new AbortController();

    await expect(
      reader(exec).readCommonDir('/repo/wt', controller.signal),
    ).resolves.toEqual({ kind: 'dir', path: '/repo/.git' });
    expect(exec).toHaveBeenCalledWith(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      '/repo/wt',
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
