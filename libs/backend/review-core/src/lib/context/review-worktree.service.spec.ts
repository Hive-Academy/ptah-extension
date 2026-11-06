import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { RepoIdentity } from '@ptah-extension/review-contracts';
import { Logger } from '@ptah-extension/vscode-core';
import { classifyReviewFailure } from '../review-failure';
import type { IReviewCommandRunner, IReviewContextFiles, ReviewCommandResult } from './review-context.ports';
import { ReviewWorktreeService } from './review-worktree.service';

const repo: RepoIdentity = { owner: 'Hive-Academy', name: 'PtahCode' };
const sha = 'a'.repeat(40);
const ok = (stdout = ''): ReviewCommandResult => ({ exitCode: 0, stdout, stderr: '', timedOut: false });

function setup(response: (args: readonly string[]) => ReviewCommandResult) {
  const run = jest.fn(async (_repo: RepoIdentity, _command: string, args: readonly string[]) => response(args));
  const commands: IReviewCommandRunner = { run };
  const remove = jest.fn(async () => undefined);
  const files: IReviewContextFiles = { mkdir: jest.fn(async () => undefined), read: jest.fn(async () => new Uint8Array()),
    exists: jest.fn(async () => false), remove };
  const logger = Object.create(Logger.prototype) as Logger;
  logger.error = jest.fn();
  return { service: new ReviewWorktreeService(commands, files, logger), run, remove, files };
}

describe('ReviewWorktreeService.create', () => {
  it('removes and prunes a stale attempt before recreating the same ID', async () => {
    const { service, run, remove, files } = setup((args) => args[0] === 'rev-parse' ? ok(sha) : ok());
    jest.mocked(files.exists).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    await service.create(repo, '/repo', '/attempts', 'attempt-1', sha, 7);
    const src = resolve('/attempts', 'attempt-1', 'src');
    expect(run).toHaveBeenCalledWith(repo, 'git', ['worktree', 'remove', '--force', src], '/repo', 60_000);
    expect(run).toHaveBeenCalledWith(repo, 'git', ['worktree', 'prune'], '/repo', 60_000);
    expect(remove).toHaveBeenCalledWith(resolve('/attempts', 'attempt-1'));
    expect(run.mock.calls.findIndex((call) => call[2][1] === 'remove')).toBeLessThan(
      run.mock.calls.findIndex((call) => call[2][1] === 'add'));
  });

  it('uses a present SHA without fetching', async () => {
    const { service, run } = setup((args) => args[0] === 'rev-parse' ? ok(sha) : ok());
    await service.create(repo, '/repo', '/attempts', 'attempt-1', sha, 7);
    expect(run).toHaveBeenCalledWith(repo, 'git', ['cat-file', '-e', `${sha}^{commit}`], '/repo', 60_000, undefined);
    expect(run.mock.calls.some((call) => call[2][0] === 'fetch')).toBe(false);
  });

  it('fetches a missing PR head and rechecks the commit', async () => {
    let probes = 0;
    const { service, run } = setup((args) => {
      if (args[0] === 'cat-file') return ++probes === 1 ? { ...ok(), exitCode: 1 } : ok();
      return args[0] === 'rev-parse' ? ok(sha) : ok();
    });
    await service.create(repo, '/repo', '/attempts', 'attempt-1', sha, 7);
    expect(probes).toBe(2);
    expect(run).toHaveBeenCalledWith(repo, 'git', ['fetch', '--no-tags', 'origin', '+refs/pull/7/head'], '/repo', 180_000, undefined);
  });

  it('reports head-missing when fetch cannot provide the commit', async () => {
    const { service } = setup((args) => args[0] === 'cat-file' || args[0] === 'fetch' ? { ...ok(), exitCode: 1 } : ok());
    const failure = await service.create(repo, '/repo', '/attempts', 'attempt-1', sha, 7).catch((error: unknown) => error);
    expect(classifyReviewFailure(failure, 'context')).toMatchObject({ code: 'head-missing', message: 'PR head commit is unavailable after fetch' });
  });

  it('classifies worktree add timeout and cleans up the attempt', async () => {
    const { service, run, remove } = setup((args) => args[0] === 'worktree' && args[1] === 'add' ? { ...ok(), timedOut: true } : ok());
    const failure = await service.create(repo, '/repo', '/attempts', 'attempt-1', sha, 7).catch((error: unknown) => error);
    expect(classifyReviewFailure(failure, 'context').code).toBe('git-timeout');
    expect(remove).toHaveBeenCalledWith(resolve('/attempts', 'attempt-1'));
    expect(run.mock.calls.some((call) => call[2][0] === 'worktree' && call[2][1] === 'prune')).toBe(true);
  });

  it('classifies non-zero checkout and redacts stderr', async () => {
    const token = ['ghp', 'abcdefghijklmnopqrstuvwxyz'].join('_');
    const { service, remove } = setup((args) => args[0] === 'worktree' && args[1] === 'add'
      ? { ...ok(), exitCode: 1, stderr: `fatal: auth Bearer ${token} failed at /private/repo` } : ok());
    const failure = await service.create(repo, '/repo', '/attempts', 'attempt-1', sha, 7).catch((error: unknown) => error);
    const classified = classifyReviewFailure(failure, 'context');
    expect(classified.code).toBe('git-failed');
    expect(classified.message).toContain('fatal: auth');
    expect(classified.message).not.toContain(token);
    expect(classified.message.length).toBeLessThanOrEqual(300);
    expect(remove).toHaveBeenCalled();
  });
});

describe('ReviewWorktreeService.snapshot', () => {
  const entry = `100644 ${'b'.repeat(40)} 0\tsrc/file.ts\0`;
  it('hashes HEAD and index entries without reading tracked files', async () => {
    const { service, run, files } = setup((args) => args[0] === 'rev-parse' ? ok(sha) :
      args[0] === 'ls-files' ? ok(entry) : ok());
    const expected = createHash('sha256').update(sha).update('\0').update(entry).digest('hex');
    expect(await service.snapshot(repo, '/attempt/src', sha)).toEqual({ headSha: sha, checksum: expected, files: ['src/file.ts'] });
    expect(files.read).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(repo, 'git', ['ls-files', '-s', '-z'], '/attempt/src', 60_000, undefined);
  });

  it('rejects dirty sources and malformed index paths', async () => {
    const dirty = setup((args) => args[0] === 'rev-parse' ? ok(sha) :
      args[0] === 'ls-files' ? ok(entry) : ok(' M src/file.ts'));
    await expect(dirty.service.snapshot(repo, '/attempt/src', sha)).rejects.toThrow('Review source is dirty');
    const bad = setup((args) => args[0] === 'rev-parse' ? ok(sha) :
      args[0] === 'ls-files' ? ok(`100644 ${'b'.repeat(40)} 0\t../outside\0`) : ok());
    await expect(bad.service.snapshot(repo, '/attempt/src', sha)).rejects.toThrow();
  });

  it('detects an index change during integrity assertion', async () => {
    let index = entry;
    const { service } = setup((args) => args[0] === 'rev-parse' ? ok(sha) : args[0] === 'ls-files' ? ok(index) : ok());
    const original = await service.snapshot(repo, '/attempt/src', sha);
    await service.assertIntegrity(repo, '/attempt/src', original);
    index = `100644 ${'c'.repeat(40)} 0\tsrc/file.ts\0`;
    await expect(service.assertIntegrity(repo, '/attempt/src', original)).rejects.toThrow('Review source checksum changed');
  });
});
