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
import {
  FILE_BASED_SETTINGS_DEFAULTS,
  SettingsPersistError,
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

describe('agent:setConfig inherit effort (TASK_2026_597)', () => {
  it.each([
    'codexReasoningEffort',
    'copilotReasoningEffort',
    'piReasoningEffort',
  ])('persists inherit for %s', async (field) => {
    const h = makeHarness();
    expect(await h.setConfig({ [field]: 'inherit' })).toEqual({
      success: true,
    });
    expect(h.settings.get(`ptah.agentOrchestration.${field}`)).toBe('inherit');
  });
});

describe('Codex lane budget settings (TASK_2026_597)', () => {
  const budgetKeys = [
    'codexAutoCompactTokens',
    'codexToolOutputTokenLimit',
    'codexWebSearch',
  ] as const;

  it('getConfig returns the file-settings defaults when nothing is stored', async () => {
    const h = makeHarness();
    const result = await h.getConfig();
    for (const key of budgetKeys) {
      expect(result[key]).toBe(
        FILE_BASED_SETTINGS_DEFAULTS[`agentOrchestration.${key}`],
      );
    }
    expect(result.codexAutoCompactTokens).toBe(120000);
    expect(result.codexToolOutputTokenLimit).toBe(2500);
    expect(result.codexWebSearch).toBe(true);
  });

  it('round-trips valid values, including 0 and false', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        codexAutoCompactTokens: 0,
        codexToolOutputTokenLimit: 4000,
        codexWebSearch: false,
      }),
    ).toEqual({ success: true });
    expect(
      h.settings.get('ptah.agentOrchestration.codexAutoCompactTokens'),
    ).toBe(0);
    const result = await h.getConfig();
    expect(result.codexAutoCompactTokens).toBe(0);
    expect(result.codexToolOutputTokenLimit).toBe(4000);
    expect(result.codexWebSearch).toBe(false);
  });

  it.each([
    ['codexAutoCompactTokens', -1],
    ['codexAutoCompactTokens', 1.5],
    ['codexAutoCompactTokens', '120000'],
    ['codexAutoCompactTokens', null],
    ['codexAutoCompactTokens', Number.NaN],
    ['codexToolOutputTokenLimit', Number.POSITIVE_INFINITY],
    ['codexToolOutputTokenLimit', -2500],
    ['codexToolOutputTokenLimit', true],
    ['codexWebSearch', 'false'],
    ['codexWebSearch', 0],
    ['codexWebSearch', null],
  ])(
    'rejects %s = %p with its own message and writes nothing (never clamped)',
    async (field, value) => {
      const h = makeHarness();
      const result = await h.setConfig({
        [field]: value,
        piModel: 'openai/gpt-4o',
      });
      expect(result).toEqual({
        success: false,
        error: `Unsupported ${field} value`,
      });
      expect(result.error).not.toBe(
        'Could not save the orchestration settings.',
      );
      expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
      expect(h.settings.size).toBe(0);
    },
  );

  it('a rejected budget field is not masked by the generic catch even when writes would throw', async () => {
    const h = makeHarness();
    h.workspace.setConfiguration.mockRejectedValue(new Error('disk full'));
    const result = await h.setConfig({
      codexWebSearch: false,
      codexToolOutputTokenLimit: -1,
    });
    expect(result).toEqual({
      success: false,
      error: 'Unsupported codexToolOutputTokenLimit value',
    });
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('getConfig reports hand-edited invalid file values as the defaults', async () => {
    const h = makeHarness();
    h.settings.set('ptah.agentOrchestration.codexAutoCompactTokens', -5);
    h.settings.set('ptah.agentOrchestration.codexToolOutputTokenLimit', 'lots');
    h.settings.set('ptah.agentOrchestration.codexWebSearch', 'yes');
    const result = await h.getConfig();
    expect(result.codexAutoCompactTokens).toBe(120000);
    expect(result.codexToolOutputTokenLimit).toBe(2500);
    expect(result.codexWebSearch).toBe(true);
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

  it('keeps the plain copy and hides credential-bearing setProviderKey errors', async () => {
    const h = makeHarness();
    const key = 'cursor-sensitive-test-key';
    h.settings.set('ptah.provider.cursor.apiKey', key);
    h.authSecrets.setProviderKey.mockRejectedValue(new Error(key));
    const result = await h.setConfig({ cursorApiKey: key });
    expect(result).toEqual({
      success: false,
      error: 'Failed to update the Cursor API key',
    });
    expect(h.settings.get('ptah.provider.cursor.apiKey')).toBe(key);
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledWith(
      'RPC: agent:setConfig Cursor API key update failed',
    );
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain(key);
  });

  it('a delete clears the plain copy first, then hides a credential-bearing deleteProviderKey error', async () => {
    const h = makeHarness();
    const key = 'cursor-sensitive-test-key';
    h.settings.set('ptah.provider.cursor.apiKey', key);
    h.authSecrets.deleteProviderKey.mockRejectedValue(new Error(key));
    const result = await h.setConfig({ cursorApiKey: '' });
    expect(result).toEqual({
      success: false,
      error: 'Failed to update the Cursor API key',
    });
    // The plain copy is gone, so the startup migration cannot re-import it.
    expect(h.settings.has('ptah.provider.cursor.apiKey')).toBe(false);
    expect(h.logger.error).toHaveBeenCalledWith(
      'RPC: agent:setConfig Cursor API key update failed',
    );
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain(key);
  });

  it('a stored key is reported saved even when the legacy plain copy cannot be cleared (final review M-3)', async () => {
    const h = makeHarness();
    const key = 'cursor-new-test-key-9876';
    h.settings.set('ptah.provider.cursor.apiKey', 'legacy-key');
    h.workspace.setConfiguration.mockImplementation(async (_s, k) => {
      if (k === 'provider.cursor.apiKey') {
        throw new SettingsPersistError('EACCES');
      }
    });
    const result = await h.setConfig({
      cursorApiKey: key,
      workflowsDisabled: true,
    });
    expect(result).toEqual({ success: true });
    expect(h.authSecrets.setProviderKey).toHaveBeenCalledWith('cursor', key);
    // Fields after the Cursor key in the same request still run.
    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'workflows.disabled',
      true,
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: agent:setConfig Cursor key stored; legacy plain copy not cleared (cleared at next start)',
      { errorType: 'SettingsPersistError' },
    );
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain(key);
  });

  it('a delete whose legacy plain copy cannot be cleared removes nothing and says so (final review M-3)', async () => {
    const h = makeHarness();
    h.workspace.setConfiguration.mockImplementation(async (_s, k) => {
      if (k === 'provider.cursor.apiKey') {
        throw new SettingsPersistError('EACCES');
      }
    });
    const result = await h.setConfig({ cursorApiKey: '' });
    expect(result).toEqual({
      success: false,
      error: 'Could not remove the Cursor API key.',
    });
    expect(h.authSecrets.deleteProviderKey).not.toHaveBeenCalled();
  });

  it('reports unrelated field errors with fixed text in a request that also updates the Cursor key', async () => {
    const h = makeHarness();
    const error = new Error('Cannot persist workflows.disabled');
    h.workspace.setConfiguration.mockImplementation(async (_section, key) => {
      if (key === 'workflows.disabled') throw error;
    });
    const result = await h.setConfig({
      cursorApiKey: 'cursor-test-key',
      workflowsDisabled: true,
    });
    expect(h.authSecrets.setProviderKey).toHaveBeenCalledWith(
      'cursor',
      'cursor-test-key',
    );
    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'provider.cursor.apiKey',
      undefined,
    );
    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(h.logger.error).toHaveBeenCalledWith('RPC: agent:setConfig failed', {
      errorType: 'Error',
    });
  });
});

describe('agent:setConfig outer-catch error text (TASK_2026_555 Batch 12c)', () => {
  const fakeKey = 'sk-test-FAKEKEY123';
  const leakyMessage = `write failed for ${fakeKey} at C:\\Users\\someone\\.ptah\\settings.json`;

  it('never returns the raw error text (key or path) to the client', async () => {
    const h = makeHarness();
    const error = new Error(leakyMessage);
    h.workspace.setConfiguration.mockRejectedValue(error);
    const result = await h.setConfig({ piModel: 'openai/gpt-4o' });
    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(JSON.stringify(result)).not.toContain(fakeKey);
    expect(JSON.stringify(result)).not.toContain('someone');
    expect(h.logger.error).toHaveBeenCalledWith('RPC: agent:setConfig failed', {
      errorType: 'Error',
    });
  });

  it('a thrown error carrying the Cursor key never reaches the logger (final review S-1)', async () => {
    const h = makeHarness();
    const cursorKey = 'crsr_live_FAKE-s1-key-123456';
    h.workspace.setConfiguration.mockImplementation(async (_s, key) => {
      if (key === 'workflows.disabled') {
        throw new Error(`persist failed; request held ${cursorKey}`);
      }
    });
    const result = await h.setConfig({
      cursorApiKey: cursorKey,
      workflowsDisabled: true,
    });
    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    const logged = JSON.stringify(
      Object.values(h.logger).flatMap((fn) =>
        jest.isMockFunction(fn) ? fn.mock.calls : [],
      ),
      (_k, value: unknown) =>
        value instanceof Error
          ? { message: value.message, stack: value.stack }
          : value,
    );
    expect(logged).not.toContain(cursorKey);
    expect(logged).not.toContain('persist failed');
  });

  it('passes a SettingsPersistError through (fixed text by construction)', async () => {
    const h = makeHarness();
    const error = new SettingsPersistError('EACCES');
    h.workspace.setConfiguration.mockRejectedValue(error);
    const result = await h.setConfig({ piModel: 'openai/gpt-4o' });
    expect(result).toEqual({ success: false, error: error.message });
    expect(result.error).toBe('Settings could not be saved to disk (EACCES)');
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
    const result = await h.getConfig();
    expect(result.cursorApiKeyConfigured).toBe(false);
    expect(result.cursorApiKeyStored).toBe(false);
    expect(result.cursorApiKeyEnvSet).toBe(false);
    h.settings.set('ptah.provider.cursor.apiKey', 'legacy-key');
    const afterLegacy = await h.getConfig();
    expect(afterLegacy.cursorApiKeyConfigured).toBe(false);
    expect(afterLegacy.cursorApiKeyStored).toBe(false);
    expect(afterLegacy.cursorApiKeyEnvSet).toBe(false);
    expect(
      h.workspace.getConfiguration.mock.calls.some(
        ([, key]) => key === 'provider.cursor.apiKey',
      ),
    ).toBe(false);
  });

  it('reports true from the secret', async () => {
    const h = makeHarness();
    h.authSecrets.hasProviderKey.mockResolvedValue(true);
    const result = await h.getConfig();
    expect(result.cursorApiKeyConfigured).toBe(true);
    expect(result.cursorApiKeyStored).toBe(true);
    expect(result.cursorApiKeyEnvSet).toBe(false);
    expect(h.authSecrets.hasProviderKey).toHaveBeenCalledWith('cursor');
  });

  it('reports true from a non-blank environment key without leaking it', async () => {
    const h = makeHarness();
    process.env['CURSOR_API_KEY'] = ' env-test-key ';
    const result = await h.getConfig();
    expect(result.cursorApiKeyConfigured).toBe(true);
    expect(result.cursorApiKeyStored).toBe(false);
    expect(result.cursorApiKeyEnvSet).toBe(true);
    // `cursorApiKeyStored` reads the secret store even when the env var wins,
    // so the UI can show both sources separately (TASK_2026_551).
    expect(h.authSecrets.hasProviderKey).toHaveBeenCalledWith('cursor');
    expect(JSON.stringify(result)).not.toContain('env-test-key');
  });

  it('treats a blank environment key as absent', async () => {
    const h = makeHarness();
    process.env['CURSOR_API_KEY'] = ' \t ';
    const result = await h.getConfig();
    expect(result.cursorApiKeyConfigured).toBe(false);
    expect(result.cursorApiKeyStored).toBe(false);
    expect(result.cursorApiKeyEnvSet).toBe(false);
    expect(h.authSecrets.hasProviderKey).toHaveBeenCalledWith('cursor');
  });

  it('reports both sources set at the same time', async () => {
    const h = makeHarness();
    h.authSecrets.hasProviderKey.mockResolvedValue(true);
    process.env['CURSOR_API_KEY'] = 'env-test-key';
    const result = await h.getConfig();
    expect(result.cursorApiKeyConfigured).toBe(true);
    expect(result.cursorApiKeyStored).toBe(true);
    expect(result.cursorApiKeyEnvSet).toBe(true);
  });
});
