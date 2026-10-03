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

import type {
  IAuthSecretsService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
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

const MIGRATION_FLAG = 'agentOrchestration.migratedToFileSettings';

/**
 * TASK_2026_553 review finding 2 (owned by TASK_2026_555 Batch 5): a
 * rejecting `setConfiguration` inside `migrateAgentOrchestrationSettings`
 * must be logged and must not reject the `register()` path, so a failing
 * settings write cannot take startup down with it.
 */
function makeHarness() {
  const rpcHandler = createMockRpcHandler();
  const settings = new Map<string, unknown>();
  const legacyState = new Map<string, unknown>();
  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws'),
    getConfiguration: jest.fn(
      (s: string, k: string, d: unknown) => settings.get(`${s}.${k}`) ?? d,
    ),
    setConfiguration: jest.fn(
      async (section: string, key: string, value: unknown) => {
        if (value === undefined) settings.delete(`${section}.${key}`);
        else settings.set(`${section}.${key}`, value);
      },
    ),
  };
  const logger = createMockLogger();
  const stateStorage = {
    get: jest.fn((key: string, defaultValue: unknown) => {
      if (key === MIGRATION_FLAG) return false;
      return legacyState.get(key) ?? defaultValue;
    }),
    update: jest.fn(),
  };
  const handlers = new AgentRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    {
      getAdapter: jest.fn().mockReturnValue(undefined),
      invalidateCache: jest.fn(),
      detectAll: jest.fn().mockResolvedValue([]),
    } as unknown as CliDetectionService,
    {
      listAgents: jest.fn().mockResolvedValue([]),
    } as unknown as PtahCliRegistry,
    {} as unknown as AgentProcessManager,
    {} as unknown as SessionMetadataStore,
    workspace as unknown as IWorkspaceProvider,
    stateStorage as unknown as IStateStorage,
    {} as unknown as IModelDiscovery,
    {} as unknown as CodexAuthService,
    {
      isRegistered: jest.fn().mockReturnValue(false),
      resolve: jest.fn(),
    } as unknown as DependencyContainer,
    {
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
      hasProviderKey: jest.fn().mockResolvedValue(false),
    } as unknown as IAuthSecretsService,
  );
  return {
    handlers,
    settings,
    legacyState,
    workspace,
    stateStorage,
    logger,
  };
}

/** All harness mocks resolve synchronously; one macrotask drain is enough. */
const flushAsyncWork = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('migrateAgentOrchestrationSettings', () => {
  it('logs a rejecting setConfiguration and does not reject register()', async () => {
    const h = makeHarness();
    h.legacyState.set('agentOrchestration.codexModel', 'legacy-model');
    h.workspace.setConfiguration.mockImplementation(
      async (section: string, key: string) => {
        if (key === 'agentOrchestration.codexModel') {
          throw new Error(`Cannot persist ${section}.${key}`);
        }
      },
    );

    // register() fires the migration as a floating promise; it must not throw.
    expect(() => h.handlers.register()).not.toThrow();
    await flushAsyncWork();

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[AgentRpc] agentOrchestration migration failed',
      ),
    );
    // The failure aborted the migration before the flag was written, so the
    // next launch retries instead of silently losing the legacy values.
    expect(h.stateStorage.update).not.toHaveBeenCalledWith(
      MIGRATION_FLAG,
      true,
    );
  });

  it('resolves (never rejects) when setConfiguration rejects', async () => {
    const h = makeHarness();
    h.legacyState.set('agentOrchestration.maxConcurrentAgents', 7);
    h.workspace.setConfiguration.mockRejectedValue(
      new Error('EACCES: settings write failed'),
    );
    // The floating promise in register() is this method; if it rejected, the
    // host would see an unhandled rejection during startup.
    const migrate = (
      h.handlers as unknown as {
        migrateAgentOrchestrationSettings(): Promise<void>;
      }
    ).migrateAgentOrchestrationSettings();

    await expect(migrate).resolves.toBeUndefined();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('EACCES: settings write failed'),
    );
    expect(h.stateStorage.update).not.toHaveBeenCalled();
  });

  it('copies legacy values that do not exist in the workspace provider', async () => {
    const h = makeHarness();
    h.legacyState.set('agentOrchestration.codexModel', 'legacy-model');
    h.legacyState.set('agentOrchestration.maxConcurrentAgents', 7);
    // Already present in the workspace provider: must not be clobbered.
    h.settings.set('ptah.agentOrchestration.codexModel', 'user-model');
    h.legacyState.set('agentOrchestration.copilotModel', 'legacy-copilot');

    h.handlers.register();
    await flushAsyncWork();

    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.maxConcurrentAgents',
      7,
    );
    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.copilotModel',
      'legacy-copilot',
    );
    expect(h.workspace.setConfiguration).not.toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.codexModel',
      'legacy-model',
    );
    expect(h.stateStorage.update).toHaveBeenCalledWith(MIGRATION_FLAG, true);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});