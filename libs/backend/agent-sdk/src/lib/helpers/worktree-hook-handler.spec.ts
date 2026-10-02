import 'reflect-metadata';
import * as path from 'path';
import type { Logger, GitInfoService } from '@ptah-extension/vscode-core';
import { worktreeDirectoryName } from '@ptah-extension/vscode-core';
import { parseWorktreeList } from '@ptah-extension/shared';
import { WorktreeHookHandler } from './worktree-hook-handler';
import type {
  HookInput,
  HookJSONOutput,
} from '../types/sdk-types/claude-sdk.types';

describe('WorktreeHookHandler', () => {
  let logger: jest.Mocked<Logger>;
  let gitInfo: {
    addWorktree: jest.Mock;
    getWorktrees: jest.Mock;
    removeWorktree: jest.Mock;
    pruneWorktrees: jest.Mock;
  };
  let handler: WorktreeHookHandler;

  const REPO = 'D:\\repo';
  const NAME = 'agent-ad9423367fb06a608';
  const expectedPath = path.win32.join(
    REPO,
    '.claude-worktrees',
    worktreeDirectoryName(NAME),
  );
  const pathCases = [
    {
      platform: 'Windows',
      pathApi: path.win32,
      repositoryRoot: 'D:\\projects\\ptah-extension',
    },
    {
      platform: 'Ubuntu/Linux',
      pathApi: path.posix,
      repositoryRoot: '/home/dev/projects/ptah-extension',
    },
    {
      platform: 'macOS',
      pathApi: path.posix,
      repositoryRoot: '/Users/dev/projects/ptah-extension',
    },
  ] as const;

  function invokeCreate(
    onCreated?: Parameters<WorktreeHookHandler['createHooks']>[0],
    cwd = REPO,
    inputOverride?: Partial<HookInput>,
  ): Promise<HookJSONOutput> {
    const hooks = handler.createHooks(onCreated);
    const hook = hooks.WorktreeCreate?.[0]?.hooks?.[0];
    if (!hook) throw new Error('WorktreeCreate hook not registered');
    const input = {
      hook_event_name: 'WorktreeCreate',
      session_id: 's1',
      transcript_path: '',
      cwd,
      name: NAME,
      ...inputOverride,
    } as unknown as HookInput;
    return hook(input, undefined, {
      signal: new AbortController().signal,
    }) as Promise<HookJSONOutput>;
  }

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    gitInfo = {
      addWorktree: jest.fn(),
      getWorktrees: jest.fn().mockResolvedValue([
        {
          path: REPO,
          head: 'abcdef12',
          branch: 'main',
          isMain: true,
          isBare: false,
        },
      ]),
      removeWorktree: jest.fn().mockResolvedValue({ success: true }),
      pruneWorktrees: jest.fn().mockResolvedValue({ success: true }),
    };
    handler = new WorktreeHookHandler(
      logger,
      gitInfo as unknown as GitInfoService,
    );
  });

  it('creates the worktree under .claude-worktrees and returns its path', async () => {
    gitInfo.addWorktree.mockResolvedValue({
      success: true,
      worktreePath: expectedPath,
    });
    const onCreated = jest.fn();

    const result = await invokeCreate(onCreated);

    expect(gitInfo.addWorktree).toHaveBeenCalledWith(REPO, {
      branch: NAME,
      path: expectedPath,
      createBranch: true,
    });
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'WorktreeCreate',
        worktreePath: expectedPath,
      },
      continue: true,
    });
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', name: NAME }),
    );
  });

  it.each(pathCases)(
    'places a $platform child beside its linked parent under the main repository root',
    async ({ pathApi, repositoryRoot }) => {
      const linked = pathApi.join(
        repositoryRoot,
        '.claude-worktrees',
        'parent',
      );
      const sibling = pathApi.join(
        repositoryRoot,
        '.claude-worktrees',
        worktreeDirectoryName(NAME),
      );
      gitInfo.getWorktrees.mockResolvedValue([
        {
          path: repositoryRoot,
          head: 'abcdef12',
          branch: 'main',
          isMain: true,
          isBare: false,
        },
        {
          path: linked,
          head: '12345678',
          branch: 'parent',
          isMain: false,
          isBare: false,
        },
      ]);
      gitInfo.addWorktree.mockResolvedValue({
        success: true,
        worktreePath: sibling,
      });

      const result = await invokeCreate(undefined, linked);

      expect(gitInfo.getWorktrees).toHaveBeenCalledWith(linked);
      expect(gitInfo.addWorktree).toHaveBeenCalledWith(linked, {
        branch: NAME,
        path: sibling,
        createBranch: true,
      });
      expect(pathApi.isAbsolute(sibling)).toBe(true);
      expect(pathApi.dirname(sibling)).toBe(
        pathApi.join(repositoryRoot, '.claude-worktrees'),
      );
      expect(sibling).not.toContain(
        pathApi.join('parent', '.claude-worktrees'),
      );
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'WorktreeCreate',
          worktreePath: sibling,
        },
        continue: true,
      });
    },
  );

  it.each([
    {
      platform: 'POSIX',
      pathApi: path.posix,
      repositoryRoot: '/home/zoë/projects/研究\nrepository ',
    },
    {
      platform: 'Windows',
      pathApi: path.win32,
      repositoryRoot: 'D:\\Users\\Renée\\研究\nrepository ',
    },
  ] as const)(
    'uses the lossless parser result for a $platform sibling path',
    async ({ pathApi, repositoryRoot }) => {
      const linked = pathApi.join(
        repositoryRoot,
        '.claude-worktrees',
        'parent',
      );
      const parsed = parseWorktreeList(
        [
          `worktree ${repositoryRoot}`,
          'HEAD abcdef1234567890',
          'branch refs/heads/main',
          '',
          `worktree ${linked}`,
          'HEAD 1234567890abcdef',
          'branch refs/heads/parent',
          '',
          '',
        ].join('\0'),
      );
      const sibling = pathApi.join(
        repositoryRoot,
        '.claude-worktrees',
        worktreeDirectoryName(NAME),
      );
      gitInfo.getWorktrees.mockResolvedValue(parsed);
      gitInfo.addWorktree.mockResolvedValue({
        success: true,
        worktreePath: sibling,
      });

      const result = await invokeCreate(undefined, linked);

      expect(gitInfo.addWorktree).toHaveBeenCalledWith(linked, {
        branch: NAME,
        path: sibling,
        createBranch: true,
      });
      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'WorktreeCreate',
          worktreePath: sibling,
        },
        continue: true,
      });
    },
  );

  it('propagates the real git failure instead of returning pathless success', async () => {
    gitInfo.addWorktree.mockResolvedValue({
      success: false,
      error: 'not a git repository',
    });
    const onCreated = jest.fn();

    await expect(invokeCreate(onCreated)).rejects.toThrow(
      'not a git repository',
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('propagates exceptions from worktree creation', async () => {
    gitInfo.addWorktree.mockRejectedValue(new Error('git exploded'));

    await expect(invokeCreate()).rejects.toThrow('git exploded');
    expect(logger.error).toHaveBeenCalled();
  });

  it('fails when the main repository worktree cannot be resolved', async () => {
    gitInfo.getWorktrees.mockResolvedValue([]);

    await expect(invokeCreate()).rejects.toThrow(
      'Unable to resolve the main repository worktree',
    );
    expect(gitInfo.addWorktree).not.toHaveBeenCalled();
  });

  it('rejects a non-absolute main worktree path before invoking git add', async () => {
    gitInfo.getWorktrees.mockResolvedValue([
      {
        path: 'relative/repository',
        head: 'abcdef12',
        branch: 'main',
        isMain: true,
        isBare: false,
      },
    ]);

    await expect(invokeCreate()).rejects.toThrow(
      'Main repository worktree path must be absolute',
    );
    expect(gitInfo.addWorktree).not.toHaveBeenCalled();
  });

  it('rejects unexpected WorktreeCreate input instead of returning success', async () => {
    await expect(
      invokeCreate(undefined, REPO, { hook_event_name: 'WorktreeRemove' }),
    ).rejects.toThrow('Unexpected hook input for WorktreeCreate');
    expect(gitInfo.addWorktree).not.toHaveBeenCalled();
  });

  describe('WorktreeRemove', () => {
    const AGENT_PATH = path.win32.join(REPO, '.claude-worktrees', 'agent-a');
    const mainEntry = {
      path: REPO,
      head: 'abcdef12',
      branch: 'main',
      isMain: true,
      isBare: false,
    };

    function listWith(entry: Record<string, unknown>): void {
      gitInfo.getWorktrees.mockResolvedValue([
        mainEntry,
        {
          path: AGENT_PATH,
          head: '12345678',
          branch: 'agent-a',
          isMain: false,
          isBare: false,
          ...entry,
        },
      ]);
    }

    function invokeRemove(
      worktreePath: string,
      onRemoved?: Parameters<WorktreeHookHandler['createHooks']>[1],
      inputOverride?: Partial<HookInput>,
    ): Promise<HookJSONOutput> {
      const hooks = handler.createHooks(undefined, onRemoved);
      const hook = hooks.WorktreeRemove?.[0]?.hooks?.[0];
      if (!hook) throw new Error('WorktreeRemove hook not registered');
      const input = {
        hook_event_name: 'WorktreeRemove',
        session_id: 's1',
        transcript_path: '',
        cwd: REPO,
        worktree_path: worktreePath,
        ...inputOverride,
      } as unknown as HookInput;
      return hook(input, undefined, {
        signal: new AbortController().signal,
      }) as Promise<HookJSONOutput>;
    }

    function loggedRemovalPath(): unknown {
      const call = logger.info.mock.calls.find(
        ([message]) => message === '[WorktreeHookHandler] Worktree removed',
      );
      return (call?.[1] as { removalPath?: unknown } | undefined)?.removalPath;
    }

    it('force-removes a listed agent worktree, prunes, and notifies', async () => {
      listWith({});
      const onRemoved = jest.fn();

      // Forward slashes and different case still name the same win32 path.
      const result = await invokeRemove(
        AGENT_PATH.replace(/\\/g, '/').toUpperCase(),
        onRemoved,
      );

      expect(result).toEqual({ continue: true });
      expect(gitInfo.getWorktrees).toHaveBeenCalledWith(REPO);
      expect(gitInfo.removeWorktree).toHaveBeenCalledWith(
        REPO,
        AGENT_PATH,
        true,
      );
      expect(gitInfo.pruneWorktrees).toHaveBeenCalledWith(REPO);
      expect(gitInfo.removeWorktree.mock.invocationCallOrder[0]).toBeLessThan(
        gitInfo.pruneWorktrees.mock.invocationCallOrder[0],
      );
      expect(loggedRemovalPath()).toBe('removed-and-pruned');
      expect(onRemoved).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's1' }),
      );
    });

    it.each([
      { platform: 'Ubuntu/Linux', root: '/home/dev/repo' },
      { platform: 'macOS', root: '/Users/dev/repo' },
    ])('removes a $platform agent worktree', async ({ root }) => {
      const agent = path.posix.join(root, '.claude-worktrees', 'agent-a');
      gitInfo.getWorktrees.mockResolvedValue([
        { ...mainEntry, path: root },
        { ...mainEntry, path: agent, isMain: false, branch: 'agent-a' },
      ]);

      await invokeRemove(agent, undefined, { cwd: agent });

      expect(gitInfo.removeWorktree).toHaveBeenCalledWith(root, agent, true);
      expect(gitInfo.pruneWorktrees).toHaveBeenCalledWith(root);
    });

    it('only prunes when the worktree directory is already gone', async () => {
      listWith({
        prunable: true,
        prunableReason: 'gitdir file points to non-existent location',
      });

      const onRemoved = jest.fn();

      const result = await invokeRemove(AGENT_PATH, onRemoved);

      expect(result).toEqual({ continue: true });
      expect(gitInfo.removeWorktree).not.toHaveBeenCalled();
      expect(gitInfo.pruneWorktrees).toHaveBeenCalledWith(REPO);
      expect(loggedRemovalPath()).toBe('pruned-missing-directory');
      expect(onRemoved).toHaveBeenCalledWith(
        expect.objectContaining({ worktreePath: AGENT_PATH }),
      );
    });

    it('never force-removes a locked worktree, and does not notify', async () => {
      listWith({ locked: true, lockReason: 'in use' });
      const onRemoved = jest.fn();

      const result = await invokeRemove(AGENT_PATH, onRemoved);

      expect(result).toEqual({ continue: true });
      expect(gitInfo.removeWorktree).not.toHaveBeenCalled();
      expect(gitInfo.pruneWorktrees).not.toHaveBeenCalled();
      expect(loggedRemovalPath()).toBe('skipped-locked');
      expect(onRemoved).not.toHaveBeenCalled();
    });

    it('leaves a path that git worktree list does not report', async () => {
      listWith({});
      const onRemoved = jest.fn();

      await invokeRemove(
        path.win32.join(REPO, '.claude-worktrees', 'other'),
        onRemoved,
      );

      expect(gitInfo.removeWorktree).not.toHaveBeenCalled();
      expect(gitInfo.pruneWorktrees).not.toHaveBeenCalled();
      expect(loggedRemovalPath()).toBe('skipped-not-listed');
      expect(onRemoved).not.toHaveBeenCalled();
    });

    it('leaves a listed worktree outside .claude-worktrees', async () => {
      const outside = 'D:\\elsewhere\\feature';
      listWith({ path: outside });
      const onRemoved = jest.fn();

      await invokeRemove(outside, onRemoved);

      expect(gitInfo.removeWorktree).not.toHaveBeenCalled();
      expect(loggedRemovalPath()).toBe('skipped-outside-agent-dir');
      expect(onRemoved).not.toHaveBeenCalled();
    });

    it('never removes the main worktree', async () => {
      listWith({});

      await invokeRemove(REPO);

      expect(gitInfo.removeWorktree).not.toHaveBeenCalled();
      expect(loggedRemovalPath()).toBe('skipped-not-listed');
    });

    it('skips pruning and still continues when removal fails', async () => {
      listWith({});
      gitInfo.removeWorktree.mockResolvedValue({
        success: false,
        error: 'contains modified files',
      });
      const onRemoved = jest.fn();

      const result = await invokeRemove(AGENT_PATH, onRemoved);

      expect(result).toEqual({ continue: true });
      expect(gitInfo.pruneWorktrees).not.toHaveBeenCalled();
      expect(loggedRemovalPath()).toBe('remove-failed');
      expect(onRemoved).not.toHaveBeenCalled();
    });

    it('warns and continues when prune fails', async () => {
      listWith({});
      gitInfo.pruneWorktrees.mockResolvedValue({
        success: false,
        error: 'lock held',
        code: 'locked',
      });

      const result = await invokeRemove(AGENT_PATH);

      expect(result).toEqual({ continue: true });
      expect(logger.warn).toHaveBeenCalledWith(
        '[WorktreeHookHandler] Worktree prune failed',
        expect.objectContaining({ error: 'lock held' }),
      );
    });

    it('returns continue: true when listing worktrees throws', async () => {
      gitInfo.getWorktrees.mockRejectedValue(new Error('git exploded'));
      const onRemoved = jest.fn();

      const result = await invokeRemove(AGENT_PATH, onRemoved);

      expect(result).toEqual({ continue: true });
      expect(gitInfo.removeWorktree).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
