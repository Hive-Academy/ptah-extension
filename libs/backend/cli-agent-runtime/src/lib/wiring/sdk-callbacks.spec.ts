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
