/**
 * Specs for buildGitNamespace.
 *
 * ptah.git.worktree* commands shell out via cross-spawn. We mock the
 * cross-spawn module with a tiny EventEmitter-compatible child stub that lets
 * each test control stdout/stderr/exit-code and the event timing.
 *
 * Covers:
 *   - shape
 *   - worktreeList — success parses porcelain output, non-zero exit returns
 *     error, cross-spawn error also maps to error envelope
 *   - worktreeAdd — default path derivation, createBranch flag, notification
 *     callback, non-zero exit handling
 *   - worktreeRemove — force flag, notification callback
 *   - missing workspace root rejection
 */

import { EventEmitter } from 'events';

// Must mock before importing the SUT.
jest.mock('cross-spawn', () => jest.fn());

const crossSpawnMock = require('cross-spawn') as jest.Mock;

import {
  buildGitNamespace,
  type GitNamespaceDependencies,
  type WorktreeChangeCallback,
} from './git-namespace.builder';

// ---------------------------------------------------------------------------
// Test child-process stub
// ---------------------------------------------------------------------------

interface FakeChildOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorEvent?: Error;
}

function queueFakeChild(opts: FakeChildOptions): void {
  crossSpawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;

    setImmediate(() => {
      if (opts.errorEvent) {
        child.emit('error', opts.errorEvent);
        return;
      }
      if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.exitCode ?? 0);
    });

    return child;
  });
}

function makeDeps(
  overrides: Partial<GitNamespaceDependencies> = {},
): GitNamespaceDependencies {
  return {
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => 'D:/ws'),
    onWorktreeChanged: overrides.onWorktreeChanged,
  };
}

beforeEach(() => {
  crossSpawnMock.mockReset();
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildGitNamespace — shape', () => {
  it('exposes worktreeList/Add/Remove', () => {
    const ns = buildGitNamespace(makeDeps());
    expect(typeof ns.worktreeList).toBe('function');
    expect(typeof ns.worktreeAdd).toBe('function');
    expect(typeof ns.worktreeRemove).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// worktreeList
// ---------------------------------------------------------------------------

describe('buildGitNamespace — worktreeList', () => {
  it('parses porcelain output into worktrees on exit 0', async () => {
    queueFakeChild({
      stdout: [
        'worktree D:/ws',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
      ].join('\n'),
      exitCode: 0,
    });

    const out = await buildGitNamespace(makeDeps()).worktreeList();
    expect(out.error).toBeUndefined();
    expect(out.worktrees.length).toBeGreaterThanOrEqual(1);
    expect(out.worktrees[0].path).toBe('D:/ws');
  });

  it('returns error + [] when git exits non-zero', async () => {
    queueFakeChild({ stderr: 'not a git repo', exitCode: 128 });

    const out = await buildGitNamespace(makeDeps()).worktreeList();
    expect(out.worktrees).toEqual([]);
    expect(out.error).toBe('not a git repo');
  });

  it('returns error envelope when cross-spawn emits error event', async () => {
    queueFakeChild({ errorEvent: new Error('ENOENT git not found') });

    const out = await buildGitNamespace(makeDeps()).worktreeList();
    expect(out.worktrees).toEqual([]);
    expect(out.error).toMatch(/ENOENT/);
  });

  it('rejects with helpful error when workspace root is unresolved', async () => {
    const ns = buildGitNamespace(makeDeps({ getWorkspaceRoot: () => '' }));
    const out = await ns.worktreeList();
    expect(out.error).toMatch(/workspace root/);
    expect(crossSpawnMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// worktreeAdd
// ---------------------------------------------------------------------------

describe('buildGitNamespace — worktreeAdd', () => {
  it('invokes `git worktree add <path> <branch>` by default', async () => {
    queueFakeChild({ exitCode: 0 });
    const out = await buildGitNamespace(makeDeps()).worktreeAdd({
      branch: 'feature/x',
      path: 'D:/ws-feature-x',
    });
    expect(out.success).toBe(true);
    expect(out.worktreePath).toBe('D:/ws-feature-x');

    const [cmd, args] = crossSpawnMock.mock.calls[0];
    expect(cmd).toBe('git');
    expect(args).toEqual(['worktree', 'add', 'D:/ws-feature-x', 'feature/x']);
  });

  it('uses `-b <branch>` when createBranch is true', async () => {
    queueFakeChild({ exitCode: 0 });
    await buildGitNamespace(makeDeps()).worktreeAdd({
      branch: 'feat-new',
      path: 'D:/ws-new',
      createBranch: true,
    });
    const [, args] = crossSpawnMock.mock.calls[0];
    expect(args).toEqual(['worktree', 'add', '-b', 'feat-new', 'D:/ws-new']);
  });

  it('fires the onWorktreeChanged callback with action=created on success', async () => {
    queueFakeChild({ exitCode: 0 });
    const cb: jest.MockedFunction<WorktreeChangeCallback> = jest.fn();
    await buildGitNamespace(makeDeps({ onWorktreeChanged: cb })).worktreeAdd({
      branch: 'b',
      path: 'D:/ws-b',
    });
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'created', branch: 'b' }),
    );
  });

  it('returns error envelope on non-zero exit and does NOT notify', async () => {
    queueFakeChild({ stderr: 'already exists', exitCode: 1 });
    const cb: jest.MockedFunction<WorktreeChangeCallback> = jest.fn();
    const out = await buildGitNamespace(
      makeDeps({ onWorktreeChanged: cb }),
    ).worktreeAdd({ branch: 'b', path: 'D:/ws-b' });

    expect(out.success).toBe(false);
    expect(out.error).toBe('already exists');
    expect(cb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// worktreeRemove
// ---------------------------------------------------------------------------

describe('buildGitNamespace — worktreeRemove', () => {
  it('passes --force when requested', async () => {
    queueFakeChild({ exitCode: 0 });
    await buildGitNamespace(makeDeps()).worktreeRemove({
      path: 'D:/ws-b',
      force: true,
    });
    const [, args] = crossSpawnMock.mock.calls[0];
    expect(args).toEqual(['worktree', 'remove', '--force', 'D:/ws-b']);
  });

  it('fires onWorktreeChanged with action=removed on success', async () => {
    queueFakeChild({ exitCode: 0 });
    const cb: jest.MockedFunction<WorktreeChangeCallback> = jest.fn();
    const out = await buildGitNamespace(
      makeDeps({ onWorktreeChanged: cb }),
    ).worktreeRemove({ path: 'D:/ws-b' });

    expect(out.success).toBe(true);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'removed', worktreePath: 'D:/ws-b' }),
    );
  });

  it('tolerates notification callback throwing', async () => {
    queueFakeChild({ exitCode: 0 });
    const cb: jest.MockedFunction<WorktreeChangeCallback> = jest
      .fn()
      .mockImplementation(() => {
        throw new Error('listener boom');
      });
    const out = await buildGitNamespace(
      makeDeps({ onWorktreeChanged: cb }),
    ).worktreeRemove({ path: 'D:/ws-b' });
    expect(out.success).toBe(true);
  });
});
