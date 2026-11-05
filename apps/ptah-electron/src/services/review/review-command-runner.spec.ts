import * as childProcess from 'node:child_process';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReviewCommandRunner, ReviewCommandScopeError } from './review-command-runner';

jest.mock('node:child_process', () => {
  const actual = jest.requireActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: jest.fn() };
});

const repoA = { owner: 'Hive-Academy', name: 'PtahCode' } as const;

function mockChild(largeOutput: boolean): childProcess.ChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new childProcess.ChildProcess(), { stdout, stderr });
  jest.spyOn(child, 'kill').mockReturnValue(true);
  queueMicrotask(() => {
    if (largeOutput) stdout.emit('data', Buffer.alloc(1_000_001, 'x'));
    Object.defineProperty(child, 'exitCode', { value: 0, configurable: true });
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
  });
  return child;
}

describe('ReviewCommandRunner', () => {
  beforeEach(() => {
    jest.mocked(childProcess.spawn).mockImplementation((_command, args) =>
      mockChild(args?.[0] === '-e' || args?.[0] === 'ls-files'));
  });

  afterEach(() => {
    jest.mocked(childProcess.spawn).mockReset();
  });

  it('permits only the exact repository-root maintenance commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ptah-review-root-commands-'));
    const spawn = jest.mocked(childProcess.spawn);
    try {
      const checkout = join(root, 'repo');
      const outside = join(root, 'outside');
      const attempts = join(root, 'attempts');
      await Promise.all([mkdir(checkout), mkdir(outside), mkdir(attempts)]);
      const runner = new ReviewCommandRunner(async () => ({ repoRoot: checkout, attemptsRoot: attempts }));
      const allowed = [
        ['cat-file', '-e', `${'a'.repeat(40)}^{commit}`],
        ['fetch', '--no-tags', 'origin', '+refs/pull/123/head'],
        ['worktree', 'prune'],
      ];
      const rejected = [
        ['cat-file', '-e', 'a'.repeat(40)],
        ['cat-file', '-e', `${'a'.repeat(7)}^{commit}`],
        ['cat-file', '-e', `${'g'.repeat(40)}^{commit}`],
        ['fetch', '--no-tags', 'origin', '+refs/heads/main'],
        ['fetch', '--no-tags', 'upstream', '+refs/pull/123/head'],
        ['fetch', '--no-tags', 'origin', '+refs/pull/123/head', '--force'],
        ['fetch', '--no-tags', 'origin', '+refs/pull/0/head'],
        ['fetch', '--no-tags', 'origin', '+refs/pull/1/head:refs/x'],
        ['worktree', 'prune', '--expire', 'now'],
        ['status'],
        ['checkout', 'main'],
      ];
      for (const args of allowed) {
        spawn.mockClear();
        await expect(runner.run(repoA, 'git', args, checkout, 1_000))
          .resolves.toMatchObject({ exitCode: 0, timedOut: false });
        expect(spawn).toHaveBeenCalledTimes(1);
      }
      for (const args of rejected) {
        spawn.mockClear();
        await expect(runner.run(repoA, 'git', args, checkout, 1_000))
          .rejects.toBeInstanceOf(ReviewCommandScopeError);
        expect(spawn).not.toHaveBeenCalled();
      }
      for (const args of allowed) {
        spawn.mockClear();
        await expect(runner.run(repoA, 'git', args, outside, 1_000))
          .rejects.toBeInstanceOf(ReviewCommandScopeError);
        expect(spawn).not.toHaveBeenCalled();
      }
    } finally {
      spawn.mockClear();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

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
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
      await expect(runner.run(repoA, 'git', ['worktree', 'add', '--detach', outside, 'a'.repeat(40)], checkoutA, 1_000))
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
      await expect(runner.run(repoA, 'git', ['worktree', 'add', '--detach', join(root, 'outside', 'src'), 'a'.repeat(40)], checkoutA, 1_000))
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
      await expect(runner.run(repoA, 'node', ['--version'], source, 10_000))
        .resolves.toEqual(expect.objectContaining({ timedOut: false }));
      await expect(runner.run(repoA, 'node', ['-e', "process.stdout.write('x'.repeat(1_000_001))"], source, 5_000))
        .resolves.toEqual(expect.objectContaining({ timedOut: true }));
      await expect(runner.run(repoA, 'git', ['ls-files', '-s', '-z'], source, 5_000))
        .resolves.toEqual(expect.objectContaining({ timedOut: false, stdout: expect.stringMatching(/^x+$/) }));
      await expect(runner.run(repoA, 'git', ['worktree', 'add'], checkoutB, 1_000))
        .rejects.toMatchObject({ code: 'review-command-cwd-outside-roots' });
      await expect(runner.run(repoA, 'node', ['--version'], escape, 1_000))
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
      await expect(runner.run(repoA, 'node', ['--version'], root, 1_000))
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
  it('rechecks real paths and claim roots on every command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ptah-review-recheck-'));
    const checkout = join(root, 'repo');
    const attempts = join(root, 'attempts');
    const source = join(attempts, 'claim', 'src');
    await mkdir(checkout);
    await mkdir(source, { recursive: true });
    const roots = jest.fn(async () => ({ repoRoot: checkout, attemptsRoot: attempts }));
    try {
      const runner = new ReviewCommandRunner(roots);
      await expect(runner.run(repoA, 'node', ['--version'], source, 10_000))
        .resolves.toMatchObject({ timedOut: false });
      await rm(source, { recursive: true });
      await expect(runner.run(repoA, 'node', ['--version'], source, 10_000))
        .rejects.toBeInstanceOf(ReviewCommandScopeError);
      expect(roots).toHaveBeenCalledTimes(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });});
