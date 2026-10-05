/**
 * AgentRpcHandlers — TASK_2026_614 Batch 25.
 *
 * - G.6 (decision G-D): `agent:resumeCliSession` returns the resume gate's
 *   decision and logs it, on the system-CLI and the Ptah CLI path.
 * - `agent:setConfig` runs one call at a time, so two overlapping writes to
 *   the lane guard pair cannot both pass validation against the same stored
 *   values and leave stop <= steer.
 */

import 'reflect-metadata';

// The cli-agent-runtime barrel transitively reaches workspace-intelligence's
// tree-sitter loader, which uses `import.meta` and cannot load under CJS jest.
// The handler is constructed directly, so only tokens and constants are needed.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_REGISTRY: Symbol.for('PtahCliRegistry'),
  },
  AgentContinueError: class AgentContinueError extends Error {},
  MIN_CONCURRENT_AGENTS: 1,
  MAX_CONCURRENT_AGENTS: 10,
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: {
    SDK_SESSION_METADATA_STORE: Symbol.for('SessionMetadataStore'),
  },
}));

jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: { SDK_CODEX_AUTH: Symbol.for('CodexAuthService') },
}));

import type {
  IAuthSecretsService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  IWorkspaceProvider,
  IStateStorage,
} from '@ptah-extension/platform-core';
import type {
  CliDetectionService,
  AgentProcessManager,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { AgentResumeOutcome } from '@ptah-extension/shared';
import type { CliModelListService } from '../services/cli-model-list.service';
import type { DependencyContainer } from 'tsyringe';

import { AgentRpcHandlers } from './agent-rpc.handlers';

const WORKSPACE = 'D:/ws';
const PTAH_CLI_ID = 'pc-agent-1';
const CLI_SESSION_ID = 'cli-session-uuid';

const FRESH: AgentResumeOutcome = {
  decision: 'fresh',
  reason: 'the prompt cache has expired',
  sessionKnown: true,
};

interface Harness {
  rpcHandler: MockRpcHandler;
  logger: ReturnType<typeof createMockLogger>;
  processManager: {
    spawn: jest.Mock;
    spawnFromSdkHandle: jest.Mock;
    reserveAgentId: jest.Mock;
    prepareSdkHandleSpawn: jest.Mock;
  };
  /** Stored `ptah` settings, keyed by the full key (`agentOrchestration.x`). */
  settings: Map<string, unknown>;
  setConfiguration: jest.Mock;
}

function makeHarness(): Harness {
  const rpcHandler = createMockRpcHandler();
  const logger = createMockLogger();
  const settings = new Map<string, unknown>();

  const registry = {
    spawnAgent: jest.fn().mockResolvedValue({
      handle: { onSessionResolved: undefined },
      agentName: 'Test CLI Agent',
      setAgentId: jest.fn(),
    }),
    listAgents: jest.fn().mockResolvedValue([]),
  };

  const processManager = {
    spawn: jest.fn().mockResolvedValue({ agentId: 'a-1' }),
    spawnFromSdkHandle: jest.fn().mockResolvedValue({ agentId: 'a-2' }),
    reserveAgentId: jest.fn().mockReturnValue('reserved-agent-id'),
    prepareSdkHandleSpawn: jest.fn(
      async (input: { task: string; resumeSessionId?: string }) => ({
        task: input.task,
        resumeSessionId: input.resumeSessionId,
      }),
    ),
  };

  // Each write yields to the event loop before it lands, the way the file
  // settings store does, so two unserialised calls would interleave.
  const setConfiguration = jest.fn(
    async (_section: string, key: string, value: unknown) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      settings.set(key, value);
    },
  );

  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue(WORKSPACE),
    getConfiguration: jest.fn((_s: string, key: string, fallback: unknown) =>
      settings.has(key) ? settings.get(key) : fallback,
    ),
    setConfiguration,
  };

  const stateStorage = {
    // Short-circuits migrateAgentOrchestrationSettings().
    get: jest.fn((key: string) =>
      key === 'agentOrchestration.migratedToFileSettings' ? true : undefined,
    ),
    update: jest.fn(),
  };

  const handlers = new AgentRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    {
      getAdapter: jest.fn().mockReturnValue(undefined),
    } as unknown as CliDetectionService,
    registry as unknown as PtahCliRegistry,
    processManager as unknown as AgentProcessManager,
    {
      createChild: jest.fn().mockResolvedValue(undefined),
    } as unknown as SessionMetadataStore,
    workspace as unknown as IWorkspaceProvider,
    stateStorage as unknown as IStateStorage,
    {} as unknown as CliModelListService,
    {
      isRegistered: jest.fn().mockReturnValue(false),
      resolve: jest.fn(),
    } as unknown as DependencyContainer,
    {
      hasProviderKey: jest.fn().mockResolvedValue(false),
    } as unknown as IAuthSecretsService,
  );
  handlers.register();

  return { rpcHandler, logger, processManager, settings, setConfiguration };
}

async function call<T>(
  h: Harness,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params,
    correlationId: `corr-${method}`,
  });
  return response.data as T;
}

type ResumeResult = {
  success: boolean;
  agentId?: string;
  error?: string;
  resumeDecision?: AgentResumeOutcome;
};

type SetConfigResult = { success: boolean; error?: string };

function successLogPayload(h: Harness): Record<string, unknown> | undefined {
  const entry = (h.logger.info as jest.Mock).mock.calls.find(
    ([message]) => message === 'RPC: agent:resumeCliSession success',
  );
  return entry?.[1] as Record<string, unknown> | undefined;
}

describe('AgentRpcHandlers — agent:resumeCliSession resume decision (G.6)', () => {
  it('returns and logs the decision on the system-CLI path', async () => {
    const h = makeHarness();
    h.processManager.spawn.mockResolvedValueOnce({
      agentId: 'a-1',
      resumeDecision: FRESH,
    });

    const result = await call<ResumeResult>(h, 'agent:resumeCliSession', {
      cliSessionId: CLI_SESSION_ID,
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result).toEqual({
      success: true,
      agentId: 'a-1',
      resumeDecision: FRESH,
    });
    expect(successLogPayload(h)).toEqual(
      expect.objectContaining({ agentId: 'a-1', resumeDecision: FRESH }),
    );
  });

  it('returns and logs the decision on the Ptah CLI path', async () => {
    const h = makeHarness();
    h.processManager.prepareSdkHandleSpawn.mockResolvedValueOnce({
      task: 'HANDOFF BRIEF',
      resumeDecision: FRESH,
    });
    h.processManager.spawnFromSdkHandle.mockResolvedValueOnce({
      agentId: 'a-2',
      resumeDecision: FRESH,
    });

    const result = await call<ResumeResult>(h, 'agent:resumeCliSession', {
      cliSessionId: CLI_SESSION_ID,
      cli: 'ptah-cli',
      task: 'continue the work',
      ptahCliId: PTAH_CLI_ID,
    });

    expect(
      h.processManager.spawnFromSdkHandle.mock.calls[0][1].resumeDecision,
    ).toEqual(FRESH);
    expect(result).toEqual({
      success: true,
      agentId: 'a-2',
      resumeDecision: FRESH,
    });
    expect(successLogPayload(h)).toEqual(
      expect.objectContaining({ agentId: 'a-2', resumeDecision: FRESH }),
    );
  });

  it('omits the field when the spawn reports no decision', async () => {
    const h = makeHarness();

    const result = await call<ResumeResult>(h, 'agent:resumeCliSession', {
      cliSessionId: CLI_SESSION_ID,
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result).toEqual({ success: true, agentId: 'a-1' });
    expect(successLogPayload(h)).not.toHaveProperty('resumeDecision');
  });
});

describe('AgentRpcHandlers — agent:setConfig serialisation', () => {
  it('validates the second of two overlapping calls against the first call’s writes', async () => {
    const h = makeHarness();
    // Stored pair: steer 40, stop 60 (the defaults). Each call alone is
    // valid against it; together they would leave stop 50 <= steer 55.
    const [raiseSteer, lowerStop] = await Promise.all([
      call<SetConfigResult>(h, 'agent:setConfig', { laneToolCallSteerAt: 55 }),
      call<SetConfigResult>(h, 'agent:setConfig', { laneToolCallStopAt: 50 }),
    ]);

    expect(raiseSteer).toEqual({ success: true });
    expect(lowerStop).toEqual({
      success: false,
      error: 'Unsupported laneToolCallStopAt value',
    });
    expect(h.settings.get('agentOrchestration.laneToolCallSteerAt')).toBe(55);
    expect(h.settings.has('agentOrchestration.laneToolCallStopAt')).toBe(false);
  });

  it('starts a call only after the previous one has finished writing', async () => {
    const h = makeHarness();
    const order: string[] = [];
    h.setConfiguration.mockImplementation(
      async (_section: string, key: string, value: unknown) => {
        order.push(`start ${key}`);
        await new Promise<void>((resolve) => setImmediate(resolve));
        h.settings.set(key, value);
        order.push(`end ${key}`);
      },
    );

    await Promise.all([
      call<SetConfigResult>(h, 'agent:setConfig', {
        codexModel: 'gpt-5',
        piModel: 'pi-1',
      }),
      call<SetConfigResult>(h, 'agent:setConfig', { cursorModel: 'c-1' }),
    ]);

    expect(order).toEqual([
      'start agentOrchestration.codexModel',
      'end agentOrchestration.codexModel',
      'start agentOrchestration.piModel',
      'end agentOrchestration.piModel',
      'start agentOrchestration.cursorModel',
      'end agentOrchestration.cursorModel',
    ]);
  });

  it('keeps serving calls after one fails to write', async () => {
    const h = makeHarness();
    h.setConfiguration.mockRejectedValueOnce(new Error('disk full'));

    const [failed, next] = await Promise.all([
      call<SetConfigResult>(h, 'agent:setConfig', { codexModel: 'gpt-5' }),
      call<SetConfigResult>(h, 'agent:setConfig', { piModel: 'pi-1' }),
    ]);

    expect(failed).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(next).toEqual({ success: true });
    expect(h.settings.get('agentOrchestration.piModel')).toBe('pi-1');
  });
});
