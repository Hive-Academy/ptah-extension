/**
 * GitRootResolver — unit specs (TASK_2026_855 component 3, D17).
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/git-root-resolver.ts
 */

import 'reflect-metadata';
import { FileType } from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { GitWorktreeInfo } from '@ptah-extension/shared';

import {
  GIT_ROOT_UNAVAILABLE_MESSAGE,
  GitRootResolver,
  MAX_CONSECUTIVE_PROBE_FAILURES,
  READ_PROBE_NEGATIVE_TTL_MS,
  READ_PROBE_TTL_MS,
  createWorktreeRootProbe,
} from './git-root-resolver';
import type { WorktreeRootProbe } from './git-workspace-root';

const FOLDER = '/workspace';
const WORKTREE = '/workspace/.claude-worktrees/feature';

function listed(...paths: string[]) {
  const worktrees: GitWorktreeInfo[] = paths.map((path) => ({
    path,
    head: 'a',
    branch: 'b',
    isMain: path === FOLDER,
    isBare: false,
  }));
  return { kind: 'listed' as const, worktrees };
}

type ProbeMock = jest.Mocked<WorktreeRootProbe>;

function createProbe(): ProbeMock {
  return {
    listWorktrees: jest.fn().mockResolvedValue(listed(FOLDER, WORKTREE)),
    commonDir: jest
      .fn()
      .mockResolvedValue({ kind: 'dir', path: '/workspace/.git' }),
    directory: jest.fn().mockResolvedValue({ kind: 'exists' }),
    invalidate: jest.fn(),
  };
}

function build(
  folders: string[] = [FOLDER],
  now: () => number = () => 0,
  epoch: () => number = () => 0,
): {
  resolver: GitRootResolver;
  probe: ProbeMock;
  warn: jest.Mock;
} {
  const probe = createProbe();
  const warn = jest.fn();
  const resolver = new GitRootResolver({
    workspace: createMockWorkspaceProvider({ folders }),
    probe,
    warn,
    platform: 'linux',
    now,
    epoch,
  });
  return { resolver, probe, warn };
}

const unavailable = { errorCode: 'GIT_ROOT_UNAVAILABLE' };
const probeFailed = { errorCode: 'GIT_ROOT_PROBE_FAILED' };

describe('GitRootResolver', () => {
  it('returns the active workspace root when no root is named', async () => {
    const { resolver, probe } = build();

    await expect(
      resolver.resolve(undefined, 'git:info', 'folder-or-worktree'),
    ).resolves.toBe(FOLDER);
    expect(probe.listWorktrees).not.toHaveBeenCalled();
  });

  it.each(['folder', 'folder-or-worktree'] as const)(
    'accepts a registered folder under the %s policy, in its registered spelling',
    async (policy) => {
      const { resolver, probe } = build();

      await expect(
        resolver.resolve(`${FOLDER}/`, 'git:stage', policy),
      ).resolves.toBe(FOLDER);
      expect(probe.listWorktrees).not.toHaveBeenCalled();
    },
  );

  it('accepts a live worktree only under the folder-or-worktree policy', async () => {
    const { resolver } = build();

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
    await expect(
      resolver.resolve(WORKTREE, 'git:removeWorktree', 'folder'),
    ).rejects.toMatchObject(unavailable);
  });

  it('refuses an unregistered path with a warn and no fallback', async () => {
    const { resolver, warn } = build();

    await expect(
      resolver.resolve('/elsewhere', 'git:commit', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
    expect(warn).toHaveBeenCalledWith(
      '[GitRoot] git:commit refused workspaceRoot',
      {
        method: 'git:commit',
        workspaceRoot: '/elsewhere',
        policy: 'folder-or-worktree',
      },
    );
  });

  it('re-validates every write and drops the probe caches first', async () => {
    const { resolver, probe } = build();

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
    probe.listWorktrees.mockResolvedValue(listed(FOLDER));

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
    expect(probe.listWorktrees).toHaveBeenCalledTimes(2);
    expect(probe.invalidate).toHaveBeenCalledTimes(2);
  });

  it('never reuses a read confirmation for a write (M1)', async () => {
    const { resolver, probe } = build();

    await resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree');
    probe.listWorktrees.mockResolvedValue(listed(FOLDER));

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
  });

  it('refuses a worktree replaced by a directory of another repository', async () => {
    const { resolver, probe } = build();
    probe.commonDir.mockImplementation(async (dir: string) => ({
      kind: 'dir',
      path: dir === WORKTREE ? '/elsewhere/.git' : '/workspace/.git',
    }));

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
  });

  it('reads a probe failure as retryable, not a missing worktree', async () => {
    const { resolver, probe, warn } = build();
    probe.listWorktrees.mockResolvedValue({
      kind: 'failed',
      cause: new Error('git failed'),
    });

    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject(probeFailed);
    expect(warn).toHaveBeenCalledWith(
      '[GitRoot] git:info probe failed',
      expect.objectContaining({ cause: expect.any(Error) }),
    );
  });

  it('throws a coded GIT_ROOT_UNAVAILABLE error with the worktree message (S2)', async () => {
    const { resolver } = build();

    await expect(
      resolver.resolve('/elsewhere', 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject({
      name: 'RpcUserError',
      errorCode: 'GIT_ROOT_UNAVAILABLE',
      message: GIT_ROOT_UNAVAILABLE_MESSAGE,
    });
  });

  it('reuses a confirmed worktree for recent reads until its TTL (M1)', async () => {
    let clock = 0;
    const { resolver, probe } = build([FOLDER], () => clock);

    await resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree');
    await resolver.resolve(WORKTREE, 'git:diffFile', 'folder-or-worktree');
    await resolver.resolve(WORKTREE, 'git:reviewChanges', 'folder-or-worktree');
    expect(probe.listWorktrees).toHaveBeenCalledTimes(1);

    clock = READ_PROBE_TTL_MS + 1;
    await resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree');
    expect(probe.listWorktrees).toHaveBeenCalledTimes(2);
  });

  // Review M1, created-externally case: a worktree that was not listed yet
  // must be accepted within seconds, with no invalidation at all.
  it('keeps a confirmed refusal only briefly', async () => {
    let clock = 0;
    const { resolver, probe } = build([FOLDER], () => clock);
    probe.listWorktrees.mockResolvedValueOnce(listed(FOLDER));

    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
    expect(probe.listWorktrees).toHaveBeenCalledTimes(1);

    clock = READ_PROBE_NEGATIVE_TTL_MS + 1;
    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
  });

  it('drops a cached answer when the probe epoch changes', async () => {
    let epoch = 0;
    const { resolver, probe } = build(
      [FOLDER],
      () => 0,
      () => epoch,
    );
    probe.listWorktrees.mockResolvedValueOnce(listed(FOLDER));

    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
    epoch++;
    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
  });

  // Review M1, mirror case: a worktree deleted outside Ptah.
  it('re-checks the directory of a cached confirmation on every reuse', async () => {
    const { resolver, probe } = build();
    await resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree');
    probe.directory.mockResolvedValue({ kind: 'absent' });

    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);
    expect(probe.listWorktrees).toHaveBeenCalledTimes(1);
  });

  // Review M3: one caller's deadline must not fail, or be cached for, another.
  it('neither caches nor shares the answer of a caller that aborted', async () => {
    const { resolver, probe } = build();
    const deadline = new AbortController();
    probe.listWorktrees.mockImplementationOnce(async () => {
      deadline.abort();
      return { kind: 'failed', cause: new Error('cancelled') };
    });

    await expect(
      resolver.resolve(
        WORKTREE,
        'git:watchRoots',
        'folder-or-worktree',
        deadline.signal,
      ),
    ).rejects.toMatchObject(probeFailed);
    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
    expect(probe.listWorktrees).toHaveBeenCalledTimes(2);
    expect(probe.listWorktrees.mock.calls[1][1]).toBeUndefined();
  });

  it('gives each concurrent reader its own signal', async () => {
    const { resolver, probe } = build();
    const a = new AbortController();
    const b = new AbortController();

    await Promise.all([
      resolver.resolve(
        WORKTREE,
        'git:watchRoots',
        'folder-or-worktree',
        a.signal,
      ),
      resolver.resolve(
        WORKTREE,
        'git:watchRoots',
        'folder-or-worktree',
        b.signal,
      ),
    ]);
    const signals = probe.listWorktrees.mock.calls.map(([, signal]) => signal);
    expect(signals).toEqual([a.signal, b.signal]);
  });

  // Review #6: a root that fails for good stops being retryable.
  it('degrades a root to unavailable after consecutive probe failures, and recovers', async () => {
    const { resolver, probe } = build();
    probe.listWorktrees.mockResolvedValue({
      kind: 'failed',
      cause: new Error('dubious ownership'),
    });

    for (let i = 1; i < MAX_CONSECUTIVE_PROBE_FAILURES; i++) {
      await expect(
        resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
      ).rejects.toMatchObject(probeFailed);
    }
    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject(unavailable);

    probe.listWorktrees.mockResolvedValue(listed(FOLDER, WORKTREE));
    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
    probe.listWorktrees.mockResolvedValue({
      kind: 'failed',
      cause: new Error('blip'),
    });
    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).rejects.toMatchObject(probeFailed);
  });

  it('does not count a failure caused by the caller’s own abort', async () => {
    const { resolver, probe } = build();
    probe.listWorktrees.mockResolvedValue({
      kind: 'failed',
      cause: new Error('cancelled'),
    });
    const aborted = new AbortController();
    aborted.abort();

    for (let i = 0; i < MAX_CONSECUTIVE_PROBE_FAILURES + 1; i++) {
      await expect(
        resolver.resolve(
          WORKTREE,
          'git:watchRoots',
          'folder-or-worktree',
          aborted.signal,
        ),
      ).rejects.toMatchObject(probeFailed);
    }
  });

  it('returns undefined when no root is named and no folder is open', async () => {
    const { resolver } = build([]);

    await expect(
      resolver.resolve(undefined, 'git:info', 'folder-or-worktree'),
    ).resolves.toBeUndefined();
  });
});

describe('createWorktreeRootProbe', () => {
  function errno(code: string): Error {
    return Object.assign(new Error(code), { code });
  }

  it('delegates to the shared git probe and classifies a stat', async () => {
    const signal = new AbortController().signal;
    const gitInfo = {
      probeWorktreeList: jest.fn().mockResolvedValue(listed()),
      probeCommonDir: jest
        .fn()
        .mockResolvedValue({ kind: 'dir', path: '/workspace/.git' }),
      invalidateProbeReadCache: jest.fn(),
    };
    const fileSystem = createMockFileSystemProvider();
    fileSystem.stat.mockImplementation(async (dir: string) => {
      if (dir === '/missing') throw errno('ENOENT');
      if (dir === '/denied') throw errno('EACCES');
      return {
        type: dir === '/file' ? FileType.File : FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
      };
    });
    const probe = createWorktreeRootProbe(gitInfo, fileSystem);

    await probe.listWorktrees(FOLDER, signal);
    await probe.commonDir(WORKTREE, signal);
    probe.invalidate();
    expect(gitInfo.probeWorktreeList).toHaveBeenCalledWith(FOLDER, signal);
    expect(gitInfo.probeCommonDir).toHaveBeenCalledWith(WORKTREE, signal);
    expect(gitInfo.invalidateProbeReadCache).toHaveBeenCalledTimes(1);
    await expect(probe.directory('/dir')).resolves.toEqual({ kind: 'exists' });
    await expect(probe.directory('/file')).resolves.toEqual({ kind: 'absent' });
    await expect(probe.directory('/missing')).resolves.toEqual({
      kind: 'absent',
    });
    await expect(probe.directory('/denied')).resolves.toMatchObject({
      kind: 'failed',
      cause: expect.any(Error),
    });
  });
});
