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
import type { AgentProcessInfo } from '@ptah-extension/shared';
import type { DependencyContainer } from 'tsyringe';
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
    getStatus: jest.fn().mockReturnValue([]),
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
      getStatus: jest.fn(() => agents),
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
