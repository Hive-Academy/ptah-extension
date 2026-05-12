/**
 * GitRpcHandlers — unit specs (TASK_2026_111 Batch 6).
 *
 * Coverage matrix:
 *   METHODS invariant  — all 15 entries present (9 original + 6 new)
 *   METHODS invariant  — each of the 6 new names explicitly asserted
 *   register()         — wires all 15 methods into the RpcHandler
 *   git:branches       — workspace guard returns empty result when wsRoot is null
 *   git:branches       — delegates to gitInfo.getBranches with includeRemote
 *   git:checkout       — workspace guard returns { success:false } when wsRoot is null
 *   git:checkout       — rejects when params.branch is blank (param validation)
 *   git:checkout       — passes dirty flag through from GitInfoService
 *   git:checkout       — delegates with force=true when caller provides it
 *   git:stashList      — workspace guard returns empty result when wsRoot is null
 *   git:stashList      — delegates to gitInfo.stashList
 *   git:tags           — delegates to gitInfo.getTags with limit
 *   git:remotes        — delegates to gitInfo.getRemotes
 *   git:lastCommit     — delegates to gitInfo.getLastCommit with ref
 *
 * Mocking posture: direct constructor injection; narrow mock surfaces.
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts
 */

import 'reflect-metadata';

import type {
  Logger,
  RpcHandler,
  GitInfoService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { GitRpcHandlers } from './git-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow GitInfoService mock — only the 6 new methods + 1 existing.
// ---------------------------------------------------------------------------
type MockGitInfo = jest.Mocked<
  Pick<
    GitInfoService,
    | 'getGitInfo'
    | 'getBranches'
    | 'checkout'
    | 'stashList'
    | 'getTags'
    | 'getRemotes'
    | 'getLastCommit'
  >
>;

function createMockGitInfo(): MockGitInfo {
  return {
    getGitInfo: jest.fn().mockResolvedValue({
      isGitRepo: true,
      branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
      files: [],
    }),
    getBranches: jest.fn().mockResolvedValue({
      current: 'main',
      local: [],
      remote: [],
    }),
    checkout: jest.fn().mockResolvedValue({ success: true }),
    stashList: jest.fn().mockResolvedValue({ count: 0, entries: [] }),
    getTags: jest.fn().mockResolvedValue({ tags: [] }),
    getRemotes: jest.fn().mockResolvedValue({ remotes: [] }),
    getLastCommit: jest.fn().mockResolvedValue({
      hash: '',
      shortHash: '',
      subject: '',
      body: '',
      author: '',
      authorEmail: '',
      time: 0,
    }),
  };
}

// ---------------------------------------------------------------------------
// Test suite builder
// ---------------------------------------------------------------------------
interface Suite {
  handlers: GitRpcHandlers;
  rpc: MockRpcHandler;
  workspace: MockWorkspaceProvider;
  gitInfo: MockGitInfo;
  logger: MockLogger;
}

function buildSuite(wsRoot: string | null = '/workspace'): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider(
    wsRoot ? { folders: [wsRoot] } : { folders: [] },
  );
  // Override getWorkspaceRoot to return null when no folders
  if (!wsRoot) {
    workspace.getWorkspaceRoot.mockReturnValue(undefined);
  }
  const gitInfo = createMockGitInfo();

  const handlers = new GitRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    workspace as unknown as IWorkspaceProvider,
    gitInfo as unknown as GitInfoService,
  );

  return { handlers, rpc, workspace, gitInfo, logger };
}

/** Retrieve a registered handler by method name for direct invocation. */
function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (params: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method '${method}' was not registered`);
  return match[1];
}

// ===========================================================================
// METHODS coverage invariant
// ===========================================================================

describe('GitRpcHandlers.METHODS coverage invariant', () => {
  it('contains exactly 15 entries (9 original + 6 new from TASK_2026_111)', () => {
    expect(GitRpcHandlers.METHODS).toHaveLength(15);
  });

  it('contains all 6 new method names from TASK_2026_111', () => {
    const methods: readonly string[] = GitRpcHandlers.METHODS;
    expect(methods).toContain('git:branches');
    expect(methods).toContain('git:checkout');
    expect(methods).toContain('git:stashList');
    expect(methods).toContain('git:tags');
    expect(methods).toContain('git:remotes');
    expect(methods).toContain('git:lastCommit');
  });

  it('contains all 9 original method names', () => {
    const methods: readonly string[] = GitRpcHandlers.METHODS;
    expect(methods).toContain('git:info');
    expect(methods).toContain('git:worktrees');
    expect(methods).toContain('git:addWorktree');
    expect(methods).toContain('git:removeWorktree');
    expect(methods).toContain('git:stage');
    expect(methods).toContain('git:unstage');
    expect(methods).toContain('git:discard');
    expect(methods).toContain('git:commit');
    expect(methods).toContain('git:showFile');
  });

  it('has no duplicates', () => {
    const methods: readonly string[] = GitRpcHandlers.METHODS;
    const unique = new Set(methods);
    expect(unique.size).toBe(methods.length);
  });
});

// ===========================================================================
// register() wires all methods
// ===========================================================================

describe('GitRpcHandlers.register()', () => {
  it('registers all 15 methods into the RpcHandler', () => {
    const { handlers, rpc } = buildSuite();
    handlers.register();

    const registeredNames = (rpc.registerMethod as jest.Mock).mock.calls.map(
      ([name]) => name as string,
    );

    for (const method of GitRpcHandlers.METHODS) {
      expect(registeredNames).toContain(method);
    }
  });
});

// ===========================================================================
// git:branches
// ===========================================================================

describe('git:branches handler', () => {
  it('returns empty result when workspace root is null', async () => {
    const { handlers, rpc } = buildSuite(null);
    handlers.register();
    const handler = getHandler(rpc, 'git:branches');

    const result = (await handler({})) as {
      current: string;
      local: unknown[];
      remote: unknown[];
    };

    expect(result.current).toBe('');
    expect(result.local).toEqual([]);
    expect(result.remote).toEqual([]);
  });

  it('delegates to gitInfo.getBranches with includeRemote param', async () => {
    const { handlers, rpc, gitInfo } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:branches');

    gitInfo.getBranches.mockResolvedValueOnce({
      current: 'main',
      local: [
        { name: 'main', isRemote: false, ahead: 0, behind: 0, isCurrent: true },
      ],
      remote: [],
    });

    const result = (await handler({ includeRemote: true })) as {
      current: string;
    };

    expect(gitInfo.getBranches).toHaveBeenCalledWith('/workspace', true);
    expect(result.current).toBe('main');
  });
});

// ===========================================================================
// git:checkout
// ===========================================================================

describe('git:checkout handler', () => {
  it('returns { success: false } when workspace root is null', async () => {
    const { handlers, rpc } = buildSuite(null);
    handlers.register();
    const handler = getHandler(rpc, 'git:checkout');

    const result = (await handler({ branch: 'main' })) as { success: boolean };

    expect(result.success).toBe(false);
  });

  it('returns { success: false, error } when branch param is blank', async () => {
    const { handlers, rpc } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:checkout');

    const result = (await handler({ branch: '   ' })) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns { success: false, error } when branch param is missing', async () => {
    const { handlers, rpc } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:checkout');

    const result = (await handler({})) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
  });

  it('passes the dirty flag through from GitInfoService', async () => {
    const { handlers, rpc, gitInfo } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:checkout');

    gitInfo.checkout.mockResolvedValueOnce({ success: false, dirty: true });

    const result = (await handler({ branch: 'feat/x', force: false })) as {
      success: boolean;
      dirty?: boolean;
    };

    expect(result.success).toBe(false);
    expect(result.dirty).toBe(true);
  });

  it('passes force=true to gitInfo.checkout when caller provides it', async () => {
    const { handlers, rpc, gitInfo } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:checkout');

    await handler({ branch: 'feat/x', force: true });

    expect(gitInfo.checkout).toHaveBeenCalledWith(
      '/workspace',
      'feat/x',
      undefined,
      true,
    );
  });
});

// ===========================================================================
// git:stashList
// ===========================================================================

describe('git:stashList handler', () => {
  it('returns empty result when workspace root is null', async () => {
    const { handlers, rpc } = buildSuite(null);
    handlers.register();
    const handler = getHandler(rpc, 'git:stashList');

    const result = (await handler({})) as { count: number; entries: unknown[] };

    expect(result.count).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it('delegates to gitInfo.stashList', async () => {
    const { handlers, rpc, gitInfo } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:stashList');

    const stashResult = {
      count: 2,
      entries: [
        { index: 0, message: 'WIP on main', ref: 'stash@{0}' },
        { index: 1, message: 'WIP on feat', ref: 'stash@{1}' },
      ],
    };
    gitInfo.stashList.mockResolvedValueOnce(stashResult);

    const result = (await handler({})) as { count: number };

    expect(gitInfo.stashList).toHaveBeenCalledWith('/workspace');
    expect(result.count).toBe(2);
  });
});

// ===========================================================================
// git:tags
// ===========================================================================

describe('git:tags handler', () => {
  it('delegates to gitInfo.getTags with limit param', async () => {
    const { handlers, rpc, gitInfo } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:tags');

    gitInfo.getTags.mockResolvedValueOnce({ tags: [] });

    await handler({ limit: 10 });

    expect(gitInfo.getTags).toHaveBeenCalledWith('/workspace', 10);
  });

  it('returns empty tags when workspace root is null', async () => {
    const { handlers, rpc } = buildSuite(null);
    handlers.register();
    const handler = getHandler(rpc, 'git:tags');

    const result = (await handler({})) as { tags: unknown[] };

    expect(result.tags).toEqual([]);
  });
});

// ===========================================================================
// git:remotes
// ===========================================================================

describe('git:remotes handler', () => {
  it('delegates to gitInfo.getRemotes', async () => {
    const { handlers, rpc, gitInfo } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:remotes');

    const remotesResult = {
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://github.com/user/repo.git',
          pushUrl: 'https://github.com/user/repo.git',
        },
      ],
    };
    gitInfo.getRemotes.mockResolvedValueOnce(remotesResult);

    const result = (await handler({})) as { remotes: unknown[] };

    expect(gitInfo.getRemotes).toHaveBeenCalledWith('/workspace');
    expect(result.remotes).toHaveLength(1);
  });

  it('returns empty remotes when workspace root is null', async () => {
    const { handlers, rpc } = buildSuite(null);
    handlers.register();
    const handler = getHandler(rpc, 'git:remotes');

    const result = (await handler({})) as { remotes: unknown[] };

    expect(result.remotes).toEqual([]);
  });
});

// ===========================================================================
// git:lastCommit
// ===========================================================================

describe('git:lastCommit handler', () => {
  it('delegates to gitInfo.getLastCommit with ref param', async () => {
    const { handlers, rpc, gitInfo } = buildSuite();
    handlers.register();
    const handler = getHandler(rpc, 'git:lastCommit');

    const commitResult = {
      hash: 'abc123',
      shortHash: 'abc123',
      subject: 'feat: new feature',
      body: '',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      time: 1700000000000,
    };
    gitInfo.getLastCommit.mockResolvedValueOnce(commitResult);

    const result = (await handler({ ref: 'HEAD~1' })) as { subject: string };

    expect(gitInfo.getLastCommit).toHaveBeenCalledWith('/workspace', 'HEAD~1');
    expect(result.subject).toBe('feat: new feature');
  });

  it('returns empty result when workspace root is null', async () => {
    const { handlers, rpc } = buildSuite(null);
    handlers.register();
    const handler = getHandler(rpc, 'git:lastCommit');

    const result = (await handler({})) as { hash: string };

    expect(result.hash).toBe('');
  });
});
