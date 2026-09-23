import 'reflect-metadata';

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_REGISTRY: Symbol.for('PtahCliRegistry'),
  },
  PTAH_CLI_ROLE_DELIVERY: {
    roleDelivery: 'native',
    roleChannel: 'agent-selection',
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

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { createMockRpcHandler } from '@ptah-extension/vscode-core/testing';
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

/**
 * TASK_2026_534 review #6: `agent:setConfig` is the host boundary for
 * reasoning effort. Pi's value is passed raw to `pi --thinking`, so an
 * unsupported value must be refused before anything is persisted.
 */
function makeHarness() {
  const rpcHandler = createMockRpcHandler();
  const settings = new Map<string, unknown>();
  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws'),
    getConfiguration: jest.fn((_s: string, _k: string, d: unknown) => d),
    setConfiguration: jest.fn(async (section: string, key: string, value: unknown) => {
      settings.set(`${section}.${key}`, value);
    }),
  };
  const logger = createMockLogger();
  const handlers = new AgentRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    {
      getAdapter: jest.fn().mockReturnValue(undefined),
      invalidateCache: jest.fn(),
    } as unknown as CliDetectionService,
    { listAgents: jest.fn().mockResolvedValue([]) } as unknown as PtahCliRegistry,
    {} as unknown as AgentProcessManager,
    {} as unknown as SessionMetadataStore,
    workspace as unknown as IWorkspaceProvider,
    {
      get: jest.fn((key: string) =>
        key === 'agentOrchestration.migratedToFileSettings' ? true : undefined,
      ),
      update: jest.fn(),
    } as unknown as IStateStorage,
    {} as unknown as IModelDiscovery,
    {} as unknown as CodexAuthService,
    {
      isRegistered: jest.fn().mockReturnValue(false),
      resolve: jest.fn(),
    } as unknown as DependencyContainer,
  );
  handlers.register();
  const setConfig = async (params: Record<string, unknown>) =>
    (
      await rpcHandler.handleMessage({
        method: 'agent:setConfig',
        params,
        correlationId: 'corr-set',
      })
    ).data as { success: boolean; error?: string };
  return { settings, setConfig, logger };
}

describe('agent:setConfig reasoning-effort boundary', () => {
  it('refuses an unsupported Pi effort and writes nothing, even with other fields in the batch', async () => {
    const h = makeHarness();
    const result = await h.setConfig({ piReasoningEffort: 'banana', piModel: 'openai/gpt-4o' });
    expect(result).toEqual({ success: false, error: 'Unsupported piReasoningEffort value' });
    expect(h.settings.size).toBe(0);
  });

  it.each(['max', 'off', ''])('persists the supported Pi effort %p', async (value) => {
    const h = makeHarness();
    expect(await h.setConfig({ piReasoningEffort: value })).toEqual({ success: true });
    expect(h.settings.get('ptah.agentOrchestration.piReasoningEffort')).toBe(value);
  });

  it('refuses Pi-only values for Codex and Copilot (mapEffortToCli allowlist)', async () => {
    const h = makeHarness();
    expect(await h.setConfig({ codexReasoningEffort: 'off' })).toMatchObject({ success: false });
    expect(await h.setConfig({ copilotReasoningEffort: 'banana' })).toMatchObject({ success: false });
    expect(h.settings.size).toBe(0);
    expect(await h.setConfig({ codexReasoningEffort: 'xhigh' })).toEqual({ success: true });
    expect(h.settings.get('ptah.agentOrchestration.codexReasoningEffort')).toBe('xhigh');
  });
});

describe('agent:setConfig logging', () => {
  it('never writes a credential value to the log', async () => {
    const h = makeHarness();
    const secret = 'crsr_live_do-not-log-1234567890';
    expect(await h.setConfig({ cursorApiKey: secret })).toEqual({ success: true });
    expect(h.settings.get('ptah.provider.cursor.apiKey')).toBe(secret);
    const logged = JSON.stringify(
      Object.values(h.logger).flatMap((fn) =>
        jest.isMockFunction(fn) ? fn.mock.calls : [],
      ),
    );
    expect(logged).not.toContain(secret);
    expect(h.logger.debug).toHaveBeenCalledWith('RPC: agent:setConfig called', {
      fields: ['cursorApiKey'],
    });
  });
});
