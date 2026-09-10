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
  let gitInfo: { addWorktree: jest.Mock; getWorktrees: jest.Mock };
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
});
