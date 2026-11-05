import { ReviewWorktreeService } from './review-worktree.service';
import { ReviewContextService } from './review-context.service';
import { ReviewChecksService } from './review-checks.service';
import { ReviewDependenciesService } from './review-dependencies.service';
import type { IReviewCommandRunner, IReviewContextFiles, ReviewCommandResult } from './review-context.ports';
import type { Logger } from '@ptah-extension/vscode-core';
import { resolve } from 'node:path';
const repo = { owner: 'Hive-Academy', name: 'PtahCode' } as const;

const ok = (stdout = ''): ReviewCommandResult => ({ exitCode: 0, stdout, stderr: '', timedOut: false });
const logger = { error: jest.fn() } as Pick<Logger, 'error'> as Logger;

describe('review exact SHA context', () => {
  it('diffs only commits after the prior reviewed head', async () => {
    const runner: IReviewCommandRunner = { run: jest.fn(async () => ok('diff --git a/src/new.ts b/src/new.ts\n+export const changed = true;')) };
    const context = new ReviewContextService(runner);
    const result = await context.diffSince(repo, '/repo', 'b'.repeat(40), 'a'.repeat(40));
    expect(result.changedPaths).toEqual(['src/new.ts']);
    expect(runner.run).toHaveBeenCalledWith(repo, 'git',
      ['diff', '--no-ext-diff', '--no-renames', 'b'.repeat(40), 'a'.repeat(40), '--'], '/repo', 60_000, undefined);
  });
  const files: IReviewContextFiles = {
    mkdir: jest.fn(async () => undefined),
    read: jest.fn(async () => Buffer.from('contents')),
    remove: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
  };

  it('rejects a detached worktree whose HEAD differs from the requested SHA', async () => {
    const runner: IReviewCommandRunner = { run: jest.fn(async (_repo, _cmd, args) => args[0] === 'rev-parse' ? ok('b'.repeat(40)) : ok()) };
    const service = new ReviewWorktreeService(runner, files, logger);
    await expect(service.create(repo, '/repo', '/attempts', 'attempt-1', 'a'.repeat(40), 1)).rejects.toThrow('HEAD differs');
    expect(runner.run).toHaveBeenCalledWith(repo, 'git', ['worktree', 'add', '--detach', resolve('/attempts', 'attempt-1', 'src'), 'a'.repeat(40)], '/repo', 180_000, undefined);
  });

  it('finds unchanged callers outside the diff and flags a changed lockfile', async () => {
    const runner: IReviewCommandRunner = { run: jest.fn(async () => ok('src/caller.ts:12:target()\n')) };
    const context = await new ReviewContextService(runner).build(repo, '/repo', ['src/export.ts', 'package-lock.json'], ['target']);
    expect(context.callers).toEqual([{ symbol: 'target', path: 'src/caller.ts', line: 12, outsideDiff: true }]);
    expect(context.dependentPaths).toEqual(['src/caller.ts']);
    expect(context.changedLockfiles).toEqual(['package-lock.json']);
  });

  it('runs checks through verify lock and records unavailable checks', async () => {
    const runner: IReviewCommandRunner = { run: jest.fn(async () => ({ ...ok(), timedOut: true })) };
    const checks = await new ReviewChecksService(runner).run(repo, '/repo', [
      { name: 'audit', command: 'node', args: ['audit.mjs'], timeoutMs: 1000, needsDependencies: false },
      { name: 'lint', command: 'npm', args: ['run', 'lint'], timeoutMs: 1000, needsDependencies: true },
    ], false);
    expect(runner.run).toHaveBeenCalledWith(repo, 'node', ['scripts/verify.mjs', '--exec', '--task', 'review-audit', '--', 'node', 'audit.mjs'], '/repo', 1000, undefined);
    expect(checks.map((check) => check.status)).toEqual(['unavailable', 'unavailable']);
    expect(checks[1].reason).toBe('Dependencies unavailable');
  });

  it('returns bounded, redacted diagnostics with the check scope', async () => {
    // Fake token, built at runtime so secret scanners do not flag a literal.
    const fakeToken = ['ghp', 'abcdefghijklmnopqrstuvwxyz'].join('_');
    const runner: IReviewCommandRunner = { run: jest.fn(async () => ({
      ...ok(`authorization: Bearer ${fakeToken}\n` + 'x'.repeat(5000)),
      exitCode: 1,
    })) };
    const [result] = await new ReviewChecksService(runner).run(repo, '/repo', [
      { name: 'audit', command: 'node', args: ['audit.mjs'], timeoutMs: 1000,
        needsDependencies: false, scope: ['libs/backend/sample/src/a.ts'] },
    ], true);
    expect(result.status).toBe('failed');
    expect(result.scope).toEqual(['libs/backend/sample/src/a.ts']);
    expect(result.diagnostics).toHaveLength(4000);
    expect(result.diagnostics).toContain('[REDACTED]');
    expect(result.diagnostics).not.toContain(fakeToken);
    expect(result.truncated).toBe(true);
  });

  it('blocks changed lockfiles without policy and disables lifecycle scripts when allowed', async () => {
    const runner: IReviewCommandRunner = { run: jest.fn(async () => ok()) };
    const present = { ...files, exists: jest.fn(async () => true) };
    const service = new ReviewDependenciesService(runner, present);
    expect((await service.prepare(repo, '/repo', ['package-lock.json'], false)).status).toBe('unavailable');
    const result = await service.prepare(repo, '/repo', ['package-lock.json'], true);
    expect(result.status).toBe('available');
    expect(result.lockfileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runner.run).toHaveBeenCalledWith(repo, 'node', ['scripts/verify.mjs', '--exec', '--task', 'review-npm-ci', '--', 'npm', 'ci', '--ignore-scripts'], '/repo', 600_000, undefined);
  });

  it('detects source checksum drift after lanes', async () => {
    let blob = 'b'.repeat(40);
    const runner: IReviewCommandRunner = { run: jest.fn(async (_repo, _cmd, args) => args[0] === 'rev-parse' ? ok('a'.repeat(40)) :
      args[0] === 'ls-files' ? ok(`100644 ${blob} 0\tsrc/main.ts\0`) : ok()) };
    const service = new ReviewWorktreeService(runner, files, logger);
    const snapshot = await service.snapshot(repo, '/repo', 'a'.repeat(40));
    expect(snapshot.files).toEqual(['src/main.ts']);
    blob = 'c'.repeat(40);
    await expect(service.assertIntegrity(repo, '/repo', snapshot)).rejects.toThrow('checksum changed');
  });
});
