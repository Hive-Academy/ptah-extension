import 'reflect-metadata';
import * as path from 'path';
import type { Logger, GitInfoService } from '@ptah-extension/vscode-core';
import { WorktreeHookHandler } from './worktree-hook-handler';
import type {
  HookInput,
  HookJSONOutput,
} from '../types/sdk-types/claude-sdk.types';

describe('WorktreeHookHandler', () => {
  let logger: jest.Mocked<Logger>;
  let gitInfo: { addWorktree: jest.Mock };
  let handler: WorktreeHookHandler;

  const REPO = 'D:/repo';
  const NAME = 'agent-ad9423367fb06a608';
  const expectedPath = path.join(REPO, '.claude-worktrees', NAME);

  function invokeCreate(
    onCreated?: Parameters<WorktreeHookHandler['createHooks']>[0],
  ): Promise<HookJSONOutput> {
    const hooks = handler.createHooks(onCreated);
    const hook = hooks.WorktreeCreate?.[0]?.hooks?.[0];
    if (!hook) throw new Error('WorktreeCreate hook not registered');
    const input = {
      hook_event_name: 'WorktreeCreate',
      session_id: 's1',
      transcript_path: '',
      cwd: REPO,
      name: NAME,
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
    gitInfo = { addWorktree: jest.fn() };
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

  it('falls back to continue:true with no path when worktree creation fails', async () => {
    gitInfo.addWorktree.mockResolvedValue({
      success: false,
      error: 'not a git repository',
    });
    const onCreated = jest.fn();

    const result = await invokeCreate(onCreated);

    expect(result).toEqual({ continue: true });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('never throws when git worktree creation rejects', async () => {
    gitInfo.addWorktree.mockRejectedValue(new Error('git exploded'));

    const result = await invokeCreate();

    expect(result).toEqual({ continue: true });
    expect(logger.error).toHaveBeenCalled();
  });
});
