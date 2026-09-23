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
import type { AgentOrchestrationConfig } from '@ptah-extension/shared';
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
  const authSecrets = {
    setProviderKey: jest.fn().mockResolvedValue(undefined),
    deleteProviderKey: jest.fn().mockResolvedValue(undefined),
    hasProviderKey: jest.fn().mockResolvedValue(false),
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
    authSecrets as unknown as IAuthSecretsService,
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
  const getConfig = async () =>
    (
      await rpcHandler.handleMessage({
        method: 'agent:getConfig',
        params: undefined,
        correlationId: 'corr-get',
      })
    ).data as AgentOrchestrationConfig;
  return { settings, setConfig, getConfig, logger, authSecrets, workspace };
}

describe('agent:setConfig reasoning-effort boundary', () => {
  it('refuses an unsupported Pi effort and writes nothing, even with other fields in the batch', async () => {
    const h = makeHarness();
    const result = await h.setConfig({
      piReasoningEffort: 'banana',
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Unsupported piReasoningEffort value',
    });
    expect(h.settings.size).toBe(0);
  });

  it.each(['max', 'off', ''])(
    'persists the supported Pi effort %p',
    async (value) => {
      const h = makeHarness();
      expect(await h.setConfig({ piReasoningEffort: value })).toEqual({
        success: true,
      });
      expect(h.settings.get('ptah.agentOrchestration.piReasoningEffort')).toBe(
        value,
      );
    },
  );

  it('refuses Pi-only values for Codex and Copilot (mapEffortToCli allowlist)', async () => {
    const h = makeHarness();
    expect(await h.setConfig({ codexReasoningEffort: 'off' })).toMatchObject({
      success: false,
    });
    expect(
      await h.setConfig({ copilotReasoningEffort: 'banana' }),
    ).toMatchObject({ success: false });
    expect(h.settings.size).toBe(0);
    expect(await h.setConfig({ codexReasoningEffort: 'xhigh' })).toEqual({
      success: true,
    });
    expect(h.settings.get('ptah.agentOrchestration.codexReasoningEffort')).toBe(
      'xhigh',
    );
  });
});

describe('agent:setConfig logging', () => {
  it('never writes a credential value to the log', async () => {
    const h = makeHarness();
    const secret = 'crsr_live_do-not-log-1234567890';
    expect(await h.setConfig({ cursorApiKey: secret })).toEqual({
      success: true,
    });
    expect(h.settings.get('ptah.provider.cursor.apiKey')).not.toBe(secret);
    expect(h.authSecrets.setProviderKey).toHaveBeenCalledWith('cursor', secret);
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

describe('agent:setConfig Cursor secrets', () => {
  it('stores the trimmed key only in secrets and removes the plain copy', async () => {
    const h = makeHarness();
    const key = 'cursor-test-key';
    h.settings.set('ptah.provider.cursor.apiKey', 'legacy-key');
    expect(await h.setConfig({ cursorApiKey: `  ${key}  ` })).toEqual({
      success: true,
    });
    expect(h.authSecrets.setProviderKey).toHaveBeenCalledWith('cursor', key);
    expect(h.authSecrets.deleteProviderKey).not.toHaveBeenCalled();
    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'provider.cursor.apiKey',
      undefined,
    );
    expect(h.settings.has('ptah.provider.cursor.apiKey')).toBe(false);
    expect(
      JSON.stringify(h.workspace.setConfiguration.mock.calls),
    ).not.toContain(key);
  });

  it.each(['', ' \t '])(
    'deletes the secret and plain copy for %p',
    async (cursorApiKey) => {
      const h = makeHarness();
      h.settings.set('ptah.provider.cursor.apiKey', 'legacy-key');
      expect(await h.setConfig({ cursorApiKey })).toEqual({ success: true });
      expect(h.authSecrets.deleteProviderKey).toHaveBeenCalledWith('cursor');
      expect(h.authSecrets.setProviderKey).not.toHaveBeenCalled();
      expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'provider.cursor.apiKey',
        undefined,
      );
      expect(h.settings.has('ptah.provider.cursor.apiKey')).toBe(false);
    },
  );

  it('rejects non-string keys before any write', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({ cursorApiKey: 42, piModel: 'new-model' }),
    ).toMatchObject({ success: false });
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    expect(h.authSecrets.setProviderKey).not.toHaveBeenCalled();
    expect(h.authSecrets.deleteProviderKey).not.toHaveBeenCalled();
  });

  it('keeps the plain copy and hides credential-bearing storage errors', async () => {
    const h = makeHarness();
    const key = 'cursor-sensitive-test-key';
    h.settings.set('ptah.provider.cursor.apiKey', key);
    h.authSecrets.setProviderKey.mockRejectedValue(new Error(key));
    const result = await h.setConfig({ cursorApiKey: key });
    expect(result).toEqual({
      success: false,
      error: 'Failed to update agent configuration',
    });
    expect(h.settings.get('ptah.provider.cursor.apiKey')).toBe(key);
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    for (const fn of Object.values(h.logger)) {
      if (jest.isMockFunction(fn)) {
        for (const call of fn.mock.calls)
          expect(call.map(String).join(' ')).not.toContain(key);
      }
    }
  });
});

describe('agent:getConfig Cursor key status', () => {
  const originalEnv = process.env['CURSOR_API_KEY'];
  beforeEach(() => {
    delete process.env['CURSOR_API_KEY'];
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env['CURSOR_API_KEY'];
    else process.env['CURSOR_API_KEY'] = originalEnv;
  });

  it('reports false with nothing configured and ignores the legacy plain setting', async () => {
    const h = makeHarness();
    expect((await h.getConfig()).cursorApiKeyConfigured).toBe(false);
    h.settings.set('ptah.provider.cursor.apiKey', 'legacy-key');
    expect((await h.getConfig()).cursorApiKeyConfigured).toBe(false);
    expect(
      h.workspace.getConfiguration.mock.calls.some(
        ([, key]) => key === 'provider.cursor.apiKey',
      ),
    ).toBe(false);
  });

  it('reports true from the secret', async () => {
    const h = makeHarness();
    h.authSecrets.hasProviderKey.mockResolvedValue(true);
    expect((await h.getConfig()).cursorApiKeyConfigured).toBe(true);
    expect(h.authSecrets.hasProviderKey).toHaveBeenCalledWith('cursor');
  });

  it('reports true from a non-blank environment key without reading secrets', async () => {
    const h = makeHarness();
    process.env['CURSOR_API_KEY'] = ' env-test-key ';
    expect((await h.getConfig()).cursorApiKeyConfigured).toBe(true);
    expect(h.authSecrets.hasProviderKey).not.toHaveBeenCalled();
  });

  it('treats a blank environment key as absent', async () => {
    const h = makeHarness();
    process.env['CURSOR_API_KEY'] = ' \t ';
    expect((await h.getConfig()).cursorApiKeyConfigured).toBe(false);
    expect(h.authSecrets.hasProviderKey).toHaveBeenCalledWith('cursor');
  });
});
