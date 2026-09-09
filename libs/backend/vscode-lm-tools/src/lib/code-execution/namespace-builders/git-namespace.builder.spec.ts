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
import { createHash } from 'crypto';
import * as path from 'path';

// Must mock before importing the SUT.
jest.mock('cross-spawn', () => jest.fn());

// Replace the vscode-core boundary so we don't load its api-wrappers (which
// import `vscode`). The mock exposes a tiny execGit that forwards to the
// cross-spawn mock above so existing `queueFakeChild` plumbing keeps working.
jest.mock('@ptah-extension/vscode-core', () => {
  const crossSpawn = require('cross-spawn');
  return {
    WORKTREE_GIT_TIMEOUT_MS: 300_000,
    DEFAULT_GIT_TIMEOUT_MS: 10_000,
    resolveWorktreePath: (
      workspaceRoot: string,
      branch: string,
      requestedPath?: string,
    ) => {
      const { createHash } = require('crypto');
      const nodePath = require('path');
      if (requestedPath) {
        if (
          nodePath.isAbsolute(requestedPath) ||
          nodePath.win32.isAbsolute(requestedPath)
        ) {
          return requestedPath;
        }
        const resolved = nodePath.resolve(workspaceRoot, requestedPath);
        const relative = nodePath.relative(workspaceRoot, resolved);
        if (relative === '..' || relative.startsWith(`..${nodePath.sep}`)) {
          throw new Error(
            'Relative worktree path must stay within the workspace root.',
          );
        }
        return resolved;
      }
      const hash = createHash('sha256')
        .update(branch, 'utf8')
        .digest('hex')
        .slice(0, 12);
      const stem = branch
        .normalize('NFKC')
        .replace(/[\\/]+/g, '-')
        .replace(/[^\p{L}\p{N}._-]+/gu, '-')
        .replace(/[-_.]{2,}/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '')
        .slice(0, 51)
        .replace(/[-_.]+$/g, '');
      return nodePath.join(
        workspaceRoot,
        '.claude-worktrees',
        `${stem || 'worktree'}-${hash}`,
      );
    },
    execGit: (args: string[], cwd: string) =>
      new Promise((resolve, reject) => {
        const child = crossSpawn('git', args, {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        child.on('close', (code: number | null) =>
          resolve({ stdout, stderr, exitCode: code ?? 1 }),
        );
        child.on('error', (err: Error) => reject(err));
      }),
  };
});

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
  it('defaults to a bounded hashed path nested under the workspace', async () => {
    queueFakeChild({ exitCode: 0 });
    const root = path.resolve('/repo');
    const branch = 'feature/deep-change';
    const out = await buildGitNamespace(
      makeDeps({ getWorkspaceRoot: () => root }),
    ).worktreeAdd({ branch });

    const hash = createHash('sha256')
      .update(branch, 'utf8')
      .digest('hex')
      .slice(0, 12);
    const expected = path.join(
      root,
      '.claude-worktrees',
      `feature-deep-change-${hash}`,
    );
    expect(out).toEqual({ success: true, worktreePath: expected });
    const [, args] = crossSpawnMock.mock.calls[0];
    expect(args).toEqual(['worktree', 'add', expected, branch]);
  });

  it('keeps formerly-colliding branch refs on distinct default paths', async () => {
    queueFakeChild({ exitCode: 0 });
    queueFakeChild({ exitCode: 0 });
    const root = path.resolve('/repo');
    const namespace = buildGitNamespace(
      makeDeps({ getWorkspaceRoot: () => root }),
    );

    const hyphenated = await namespace.worktreeAdd({ branch: 'feature/a-b' });
    const nested = await namespace.worktreeAdd({ branch: 'feature/a/b' });

    expect(hyphenated.success).toBe(true);
    expect(nested.success).toBe(true);
    expect(hyphenated.worktreePath).not.toBe(nested.worktreePath);
  });

  it.each([
    ['long', `feature/${'a'.repeat(180)}`],
    ['Unicode', 'feature/修复-ёж'],
  ])(
    'supports a legitimate %s branch with a bounded default path',
    async (_name, branch) => {
      queueFakeChild({ exitCode: 0 });
      const root = path.resolve('/repo');
      const out = await buildGitNamespace(
        makeDeps({ getWorkspaceRoot: () => root }),
      ).worktreeAdd({ branch });

      expect(out.success).toBe(true);
      expect(path.basename(out.worktreePath ?? '').length).toBeLessThanOrEqual(
        64,
      );
      const [, args] = crossSpawnMock.mock.calls[0];
      expect(args.at(-1)).toBe(branch);
    },
  );

  it('turns traversal-looking refs into one safe hashed directory segment', async () => {
    queueFakeChild({ exitCode: 0 });
    const root = path.resolve('/repo');
    const out = await buildGitNamespace(
      makeDeps({ getWorkspaceRoot: () => root }),
    ).worktreeAdd({ branch: '../escape' });

    expect(out.success).toBe(true);
    const target = out.worktreePath ?? '';
    expect(path.dirname(target)).toBe(path.join(root, '.claude-worktrees'));
    expect(path.basename(target)).not.toContain('..');
  });
  it('rejects a relative custom path that traverses outside the workspace', async () => {
    const root = path.resolve('/repo');
    const out = await buildGitNamespace(
      makeDeps({ getWorkspaceRoot: () => root }),
    ).worktreeAdd({ branch: 'feature/x', path: '../repo-evil' });

    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Relative worktree path must stay/);
    expect(crossSpawnMock).not.toHaveBeenCalled();
  });

  it('retains an explicit absolute path outside the workspace', async () => {
    queueFakeChild({ exitCode: 0 });
    const root = path.resolve('/repo');
    const explicit = path.resolve('/worktrees/feature-x');
    const out = await buildGitNamespace(
      makeDeps({ getWorkspaceRoot: () => root }),
    ).worktreeAdd({ branch: 'feature/x', path: explicit });

    expect(out).toEqual({ success: true, worktreePath: explicit });
    const [, args] = crossSpawnMock.mock.calls[0];
    expect(args).toEqual(['worktree', 'add', explicit, 'feature/x']);
  });
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
