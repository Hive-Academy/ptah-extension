/**
 * wireSdkCallbacks — parent-session remapping on session-id resolution
 * (TASK_2026_295).
 *
 * The subagent-registry remap used to be NESTED inside the
 * `AGENT_PROCESS_MANAGER` registration check. The two services are unrelated,
 * so on any host that does not register the agent-process manager every
 * `SubagentRecord` kept `parentSessionId = <tabId>` forever while `chat:resume`
 * queried by the real SDK UUID — which is why interrupted subagents were never
 * offered for resume, and why steering/stopping them failed.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { AgentId, AgentProcessInfo } from '@ptah-extension/shared';
import type { DependencyContainer } from 'tsyringe';
import { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { wireSdkCallbacks } from './sdk-callbacks';

const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const REAL_SESSION_ID = '11111111-2222-4333-8444-555555555555';

type SessionIdResolvedCallback = (
  tabId: string | undefined,
  realSessionId: string,
) => void;

interface Harness {
  container: DependencyContainer;
  logger: ReturnType<typeof createMockLogger>;
  fireSessionIdResolved: SessionIdResolvedCallback;
  agentProcessManagerRemap: jest.Mock;
  subagentRegistryRemap: jest.Mock;
}

function buildHarness(options: {
  withAgentProcessManager: boolean;
  withSubagentRegistry: boolean;
}): Harness {
  const logger = createMockLogger();
  let captured: SessionIdResolvedCallback | undefined;

  const sdkAdapter = {
    setResultStatsCallback: jest.fn(),
    setSessionIdResolvedCallback: jest.fn((cb: SessionIdResolvedCallback) => {
      captured = cb;
    }),
    setCompactionStartCallback: jest.fn(),
  };

  const webviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };

  const agentProcessManagerRemap = jest.fn();
  const agentProcessManager = {
    resolveParentSessionId: agentProcessManagerRemap,
    // No exited agents — the re-persist branch is covered by agent-events.spec.
    listTrackedAgents: jest.fn().mockReturnValue([]),
  };

  const subagentRegistryRemap = jest.fn();
  const subagentRegistry = { resolveParentSessionId: subagentRegistryRemap };

  const registry = new Map<symbol, unknown>([
    [TOKENS.AGENT_ADAPTER, sdkAdapter],
    [TOKENS.WEBVIEW_MANAGER, webviewManager],
  ]);
  if (options.withAgentProcessManager) {
    registry.set(TOKENS.AGENT_PROCESS_MANAGER, agentProcessManager);
  }
  if (options.withSubagentRegistry) {
    registry.set(TOKENS.SUBAGENT_REGISTRY_SERVICE, subagentRegistry);
  }

  const container = {
    isRegistered: (token: symbol) => registry.has(token),
    resolve: (token: symbol) => registry.get(token),
  } as unknown as DependencyContainer;

  wireSdkCallbacks(container, {
    logger: logger as unknown as Logger,
    platform: 'electron',
  });

  if (!captured) {
    throw new Error('setSessionIdResolvedCallback was never wired');
  }

  return {
    container,
    logger,
    fireSessionIdResolved: captured,
    agentProcessManagerRemap,
    subagentRegistryRemap,
  };
}

describe('wireSdkCallbacks — session id resolution', () => {
  it('remaps subagent records even when AGENT_PROCESS_MANAGER is absent', () => {
    const harness = buildHarness({
      withAgentProcessManager: false,
      withSubagentRegistry: true,
    });

    harness.fireSessionIdResolved(TAB_ID, REAL_SESSION_ID);

    expect(harness.subagentRegistryRemap).toHaveBeenCalledWith(
      TAB_ID,
      REAL_SESSION_ID,
    );
  });

  it('remaps agent-process records even when the subagent registry is absent', () => {
    const harness = buildHarness({
      withAgentProcessManager: true,
      withSubagentRegistry: false,
    });

    harness.fireSessionIdResolved(TAB_ID, REAL_SESSION_ID);

    expect(harness.agentProcessManagerRemap).toHaveBeenCalledWith(
      TAB_ID,
      REAL_SESSION_ID,
    );
  });

  it('remaps both when both are registered', () => {
    const harness = buildHarness({
      withAgentProcessManager: true,
      withSubagentRegistry: true,
    });

    harness.fireSessionIdResolved(TAB_ID, REAL_SESSION_ID);

    expect(harness.agentProcessManagerRemap).toHaveBeenCalledWith(
      TAB_ID,
      REAL_SESSION_ID,
    );
    expect(harness.subagentRegistryRemap).toHaveBeenCalledWith(
      TAB_ID,
      REAL_SESSION_ID,
    );
  });

  it('remaps nothing and says so when the tab id is blank', () => {
    const harness = buildHarness({
      withAgentProcessManager: true,
      withSubagentRegistry: true,
    });

    harness.fireSessionIdResolved('', REAL_SESSION_ID);

    expect(harness.agentProcessManagerRemap).not.toHaveBeenCalled();
    expect(harness.subagentRegistryRemap).not.toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('blank id'),
      expect.anything(),
    );
  });

  it('remaps nothing when the resolved session id is blank', () => {
    const harness = buildHarness({
      withAgentProcessManager: true,
      withSubagentRegistry: true,
    });

    harness.fireSessionIdResolved(TAB_ID, '');

    expect(harness.agentProcessManagerRemap).not.toHaveBeenCalled();
    expect(harness.subagentRegistryRemap).not.toHaveBeenCalled();
  });
});

/**
 * TASK_2026_323 blocker B5 — the re-persist pass.
 *
 * Filtering on `parentSessionId === realSessionId` AFTER the remap also matches
 * every agent that was already filed under the real id, whose stored reference
 * is already correct. Each of those cost a full all-sessions blob rewrite,
 * times `retryWithBackoff(retries: 3)`, on every session-id resolution.
 */
describe('wireSdkCallbacks — re-persist only what actually changed', () => {
  function agent(
    overrides: Partial<Omit<AgentProcessInfo, 'agentId'>> & {
      agentId?: string;
    },
  ): AgentProcessInfo {
    return {
      agentId: 'agent-x',
      cli: 'codex',
      task: 'work',
      workingDirectory: '/repo',
      status: 'completed',
      startedAt: new Date(0).toISOString(),
      ...overrides,
    } as AgentProcessInfo;
  }

  function buildRepersistHarness(agents: AgentProcessInfo[]): {
    fire: SessionIdResolvedCallback;
    addCliSession: jest.Mock;
  } {
    let captured: SessionIdResolvedCallback | undefined;
    const addCliSession = jest.fn().mockResolvedValue(undefined);

    const agentProcessManager = {
      // Emulate the real remap so the post-remap read sees moved parents.
      resolveParentSessionId: jest.fn((tabId: string, realId: string) => {
        for (const a of agents) {
          if (a.parentSessionId === tabId) {
            (a as { parentSessionId?: string }).parentSessionId = realId;
          }
        }
      }),
      listTrackedAgents: jest.fn(() => agents),
      readOutputForPersistence: jest.fn().mockReturnValue(undefined),
    };

    const registry = new Map<symbol, unknown>([
      [
        TOKENS.AGENT_ADAPTER,
        {
          setResultStatsCallback: jest.fn(),
          setSessionIdResolvedCallback: jest.fn(
            (cb: SessionIdResolvedCallback) => {
              captured = cb;
            },
          ),
          setCompactionStartCallback: jest.fn(),
        },
      ],
      [
        TOKENS.WEBVIEW_MANAGER,
        { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      ],
      [TOKENS.AGENT_PROCESS_MANAGER, agentProcessManager],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          saveAgentOutput: jest.fn().mockResolvedValue(undefined),
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    wireSdkCallbacks(
      {
        isRegistered: (token: symbol) => registry.has(token),
        resolve: (token: symbol) => registry.get(token),
      } as unknown as DependencyContainer,
      {
        logger: createMockLogger() as unknown as Logger,
        platform: 'electron',
      },
    );

    if (!captured) throw new Error('setSessionIdResolvedCallback never wired');
    return { fire: captured, addCliSession };
  }

  it('skips agents already filed under the real session id', () => {
    const { fire, addCliSession } = buildRepersistHarness([
      agent({
        agentId: 'agent-remapped',
        parentSessionId: TAB_ID,
        cliSessionId: 'cli-remapped',
      }),
      agent({
        agentId: 'agent-already',
        parentSessionId: REAL_SESSION_ID,
        cliSessionId: 'cli-already',
      }),
    ]);

    fire(TAB_ID, REAL_SESSION_ID);

    expect(addCliSession).toHaveBeenCalledTimes(1);
    expect(addCliSession).toHaveBeenCalledWith(
      REAL_SESSION_ID,
      expect.objectContaining({ cliSessionId: 'cli-remapped' }),
    );
  });

  it('skips agents that are still running', () => {
    const { fire, addCliSession } = buildRepersistHarness([
      agent({
        agentId: 'agent-running',
        parentSessionId: TAB_ID,
        status: 'running',
        cliSessionId: 'cli-running',
      }),
    ]);

    fire(TAB_ID, REAL_SESSION_ID);

    expect(addCliSession).not.toHaveBeenCalled();
  });

  it('re-persists nothing when the tab id already equals the real id', () => {
    const { fire, addCliSession } = buildRepersistHarness([
      agent({
        agentId: 'agent-noop',
        parentSessionId: REAL_SESSION_ID,
        cliSessionId: 'cli-noop',
      }),
    ]);

    fire(REAL_SESSION_ID, REAL_SESSION_ID);

    expect(addCliSession).not.toHaveBeenCalled();
  });
});

/**
 * TASK_2026_364 blocker B1 — the remap reads the UNSCOPED registry.
 *
 * The two harnesses above hand `wireSdkCallbacks` a hand-rolled manager, so no
 * test in them can see the workspace filter that TASK_2026_364 added to
 * `getStatus()`. This one drives the REAL `AgentProcessManager`.
 *
 * The scenario is the one the task was filed to fix: two folders open, the
 * platform provider points at folder B (the focused window), and a chat session
 * whose CLI agents live in folder A resolves its tab id to a real SDK UUID.
 * This callback runs on the chat SDK stream, never inside
 * `runWithMcpRequestContext`, so there is no caller workspace and the scope
 * falls back to the provider root — folder B. Reading the list through
 * `getStatus()` therefore returned NOTHING, the remapped-id set was empty, and
 * the re-persist loop never ran, leaving folder A's session references keyed to
 * the pre-resolution tab id and unfindable by `chat:resume`.
 */
describe('wireSdkCallbacks — the remap is unscoped by construction', () => {
  const ROOT_A = 'D:\\projects\\workspace-a';
  const ROOT_B = 'D:\\projects\\workspace-b';

  function makeManager(providerRoot: string): AgentProcessManager {
    const workspaceProvider = {
      getWorkspaceRoot: jest.fn().mockReturnValue(providerRoot),
      getWorkspaceFolders: jest.fn().mockReturnValue([providerRoot]),
      getConfiguration: jest.fn(
        (_section: string, _key: string, dflt?: unknown) => dflt,
      ),
      setConfiguration: jest.fn(),
      onDidChangeConfiguration: jest.fn(),
      onDidChangeWorkspaceFolders: jest.fn(),
    } as unknown as IWorkspaceProvider;

    type Args = ConstructorParameters<typeof AgentProcessManager>;
    return new AgentProcessManager(
      createMockLogger() as unknown as Args[0],
      { getAdapter: jest.fn() } as unknown as Args[1],
      {
        getRunningBySession: jest.fn().mockReturnValue([]),
      } as unknown as Args[2],
      workspaceProvider as unknown as Args[3],
      { captureException: jest.fn() } as unknown as Args[4],
      { effort: { get: jest.fn(() => '') } } as unknown as Args[5],
      null,
      null,
      // No caller resolver: this host registers one, but the chat stream is not
      // an MCP request, so it would answer `undefined` here anyway.
      null,
    );
  }

  function seedExitedAgent(
    manager: AgentProcessManager,
    agentId: string,
    workingDirectory: string,
  ): void {
    const info: AgentProcessInfo = {
      agentId: agentId as AgentId,
      cli: 'codex',
      task: 'work in the OTHER workspace',
      workingDirectory,
      status: 'completed',
      startedAt: new Date(0).toISOString(),
      parentSessionId: TAB_ID,
      cliSessionId: `cli-${agentId}`,
    };
    (
      manager as unknown as {
        agents: Map<string, Record<string, unknown>>;
      }
    ).agents.set(agentId, {
      info,
      stdoutBuffer: '',
      stderrBuffer: '',
      accumulatedSegments: [],
      accumulatedStreamEvents: [],
    });
  }

  it('re-persists an exited agent living OUTSIDE the provider root (two folders open)', async () => {
    const manager = makeManager(ROOT_B);
    seedExitedAgent(manager, 'agent-in-a', `${ROOT_A}\\sub`);

    const addCliSession = jest.fn().mockResolvedValue(undefined);
    let captured: SessionIdResolvedCallback | undefined;

    const registry = new Map<symbol, unknown>([
      [
        TOKENS.AGENT_ADAPTER,
        {
          setResultStatsCallback: jest.fn(),
          setSessionIdResolvedCallback: jest.fn(
            (cb: SessionIdResolvedCallback) => {
              captured = cb;
            },
          ),
          setCompactionStartCallback: jest.fn(),
        },
      ],
      [
        TOKENS.WEBVIEW_MANAGER,
        { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      ],
      [TOKENS.AGENT_PROCESS_MANAGER, manager],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          saveAgentOutput: jest.fn().mockResolvedValue(undefined),
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    wireSdkCallbacks(
      {
        isRegistered: (token: symbol) => registry.has(token),
        resolve: (token: symbol) => registry.get(token),
      } as unknown as DependencyContainer,
      {
        logger: createMockLogger() as unknown as Logger,
        platform: 'electron',
      },
    );
    if (!captured) throw new Error('setSessionIdResolvedCallback never wired');

    // Sanity: the caller-facing list really does hide this agent, so the
    // assertion below is measuring the fix and not a vacuous case.
    expect(manager.getStatus() as AgentProcessInfo[]).toHaveLength(0);

    captured(TAB_ID, REAL_SESSION_ID);
    await new Promise((resolve) => setImmediate(resolve));

    expect(addCliSession).toHaveBeenCalledWith(
      REAL_SESSION_ID,
      expect.objectContaining({ cliSessionId: 'cli-agent-in-a' }),
    );
  });
});
