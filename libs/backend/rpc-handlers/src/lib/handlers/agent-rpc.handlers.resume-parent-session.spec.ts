/**
 * AgentRpcHandlers — parent-session threading on `agent:resumeCliSession`
 * (TASK_2026_295).
 *
 * The Ptah CLI resume path spawns in two halves: `PtahCliRegistry.spawnAgent`
 * creates the SDK-side agent, and `AgentProcessManager.spawnFromSdkHandle`
 * records the process. The second half received `parentSessionId`; the first
 * did not. A resumed agent therefore ran with no parent — its nested subagents
 * registered against nothing and its CLI session reference was dropped on
 * persist.
 *
 * These specs pin that BOTH halves receive the same parent, and that an empty
 * id is normalized to absent rather than threaded as a session that does not
 * exist.
 */

import 'reflect-metadata';

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  access: jest.fn(),
}));

// The cli-agent-runtime barrel transitively reaches workspace-intelligence's
// tree-sitter loader, which uses `import.meta` and cannot load under CJS jest.
// Only the DI token registry and the error class are needed here — the
// handler is constructed directly, so tsyringe never resolves these.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_REGISTRY: Symbol.for('PtahCliRegistry'),
  },
  AgentContinueError: class AgentContinueError extends Error {},
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: {
    SDK_SESSION_METADATA_STORE: Symbol.for('SessionMetadataStore'),
  },
}));

jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: { SDK_CODEX_AUTH: Symbol.for('CodexAuthService') },
}));

import * as fs from 'fs/promises';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  IWorkspaceProvider,
  IStateStorage,
  IModelDiscovery,
} from '@ptah-extension/platform-core';
import type {
  CliDetectionService,
  AgentProcessManager,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { CodexAuthService } from '@ptah-extension/auth-providers';
import type { DependencyContainer } from 'tsyringe';

import { AgentRpcHandlers } from './agent-rpc.handlers';

const mockReaddir = fs.readdir as unknown as jest.Mock;
const mockAccess = fs.access as unknown as jest.Mock;

const WORKSPACE = 'D:/ws';
const PTAH_CLI_ID = 'pc-agent-1';
const CLI_SESSION_ID = 'cli-session-uuid';

interface Harness {
  handlers: AgentRpcHandlers;
  rpcHandler: MockRpcHandler;
  registry: { spawnAgent: jest.Mock; listAgents: jest.Mock };
  processManager: { spawnFromSdkHandle: jest.Mock; spawn: jest.Mock };
}

function makeHarness(): Harness {
  const rpcHandler = createMockRpcHandler();

  const registry = {
    spawnAgent: jest.fn().mockResolvedValue({
      handle: { onSessionResolved: undefined },
      agentName: 'Test CLI Agent',
      setAgentId: jest.fn(),
    }),
    listAgents: jest.fn().mockResolvedValue([]),
  };

  const processManager = {
    spawnFromSdkHandle: jest.fn().mockResolvedValue({ agentId: 'a-1' }),
    spawn: jest.fn().mockResolvedValue({ agentId: 'a-1' }),
  };

  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue(WORKSPACE),
    // getAgentCfg falls back to the supplied default.
    getConfiguration: jest.fn((_s: string, _k: string, d: unknown) => d),
  };

  const stateStorage = {
    // Short-circuits migrateAgentOrchestrationSettings().
    get: jest.fn((key: string) =>
      key === 'agentOrchestration.migratedToFileSettings' ? true : undefined,
    ),
    update: jest.fn(),
  };

  const cliDetection = { getAdapter: jest.fn().mockReturnValue(undefined) };

  const handlers = new AgentRpcHandlers(
    createMockLogger() as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    cliDetection as unknown as CliDetectionService,
    registry as unknown as PtahCliRegistry,
    processManager as unknown as AgentProcessManager,
    { createChild: jest.fn() } as unknown as SessionMetadataStore,
    workspace as unknown as IWorkspaceProvider,
    stateStorage as unknown as IStateStorage,
    {} as unknown as IModelDiscovery,
    {} as unknown as CodexAuthService,
    {
      isRegistered: jest.fn().mockReturnValue(false),
      resolve: jest.fn(),
    } as unknown as DependencyContainer,
  );
  handlers.register();

  return { handlers, rpcHandler, registry, processManager };
}

async function resume(
  h: Harness,
  parentSessionId?: string,
): Promise<{ success: boolean }> {
  const response = await h.rpcHandler.handleMessage({
    method: 'agent:resumeCliSession',
    params: {
      cliSessionId: CLI_SESSION_ID,
      cli: 'ptah-cli',
      task: 'continue the work',
      ptahCliId: PTAH_CLI_ID,
      ...(parentSessionId !== undefined ? { parentSessionId } : {}),
    },
    correlationId: 'corr-resume',
  });
  return response.data as { success: boolean };
}

describe('AgentRpcHandlers — agent:resumeCliSession parent session', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockAccess.mockReset();
    // The workspace resolves to a project dir and the CLI session file exists.
    mockReaddir.mockResolvedValue(['D-ws']);
    mockAccess.mockResolvedValue(undefined);
  });

  it('threads parentSessionId into PtahCliRegistry.spawnAgent, not just the process manager', async () => {
    const h = makeHarness();

    const result = await resume(h, 'chat-session-uuid');

    expect(result.success).toBe(true);
    expect(h.registry.spawnAgent).toHaveBeenCalledTimes(1);
    const options = h.registry.spawnAgent.mock.calls[0][2];
    expect(options.parentSessionId).toBe('chat-session-uuid');
    // Both halves must agree on the parent.
    expect(
      h.processManager.spawnFromSdkHandle.mock.calls[0][1].parentSessionId,
    ).toBe('chat-session-uuid');
  });

  it('still threads the parent when the CLI session file is missing (fresh start)', async () => {
    const h = makeHarness();
    mockAccess.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    await resume(h, 'chat-session-uuid');

    const options = h.registry.spawnAgent.mock.calls[0][2];
    // resumeSessionId is correctly dropped — parentSessionId must not be.
    expect(options.resumeSessionId).toBeUndefined();
    expect(options.parentSessionId).toBe('chat-session-uuid');
  });

  it('normalizes an empty parentSessionId to undefined in both halves', async () => {
    const h = makeHarness();

    await resume(h, '');

    expect(
      h.registry.spawnAgent.mock.calls[0][2].parentSessionId,
    ).toBeUndefined();
    expect(
      h.processManager.spawnFromSdkHandle.mock.calls[0][1].parentSessionId,
    ).toBeUndefined();
  });

  it('passes undefined when no parentSessionId is supplied at all', async () => {
    const h = makeHarness();

    await resume(h);

    expect(
      h.registry.spawnAgent.mock.calls[0][2].parentSessionId,
    ).toBeUndefined();
  });
});
