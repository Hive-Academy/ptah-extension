/**
 * `agent:setConfig` / `agent:getConfig` for the Ollama Cloud and custom
 * endpoint decision models (Component 9): field-named validation (2.2), the
 * key transport rule (D4), one key field per request and the custom key's
 * endpoint binding (DC10), the write-only key indicator (2.4), and a
 * sentinel-key search over every response, DTO and log line (1.6).
 *
 * Keys go through a real `DecisionModelKeys` over an in-memory secret store,
 * so the stored value and its origin binding are observed directly.
 */
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
import {
  DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED,
  DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT,
  DECISION_MODEL_INVALID_BASE_URL,
  DECISION_MODEL_INVALID_MODEL,
  DECISION_MODEL_KEY_NEEDS_HTTPS,
  type AgentOrchestrationConfig,
} from '@ptah-extension/shared';
import {
  DecisionModelKeys,
  DecisionModelSelectionSchema,
  type DecisionModelSelection,
  type DecisionModelStatusDto,
} from '@ptah-extension/lane-routing';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { createMockSecretStorage } from '@ptah-extension/platform-core/testing';
import type {
  AgentProcessManager,
  CliDetectionService,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { DependencyContainer } from 'tsyringe';
import type { CliModelListService } from '../services/cli-model-list.service';

import { AgentRpcHandlers } from './agent-rpc.handlers';

/** The custom slot's secret-storage key (DC3). */
const CUSTOM_SLOT = 'ptah.laneRouting.customEndpointApiKey';
const JEV_SLOT = 'ptah.laneRouting.jevApiKey';

/** A key that must never appear in a response, a DTO or a log line (1.6). */
const SENTINEL = 'sk-sentinel-custom-5d41-never-echoed';

const HTTPS_ENDPOINT = {
  kind: 'custom' as const,
  baseUrl: 'https://gateway.example/gw',
  model: 'laya-1',
};

const HTTP_REMOTE_ENDPOINT = {
  kind: 'custom' as const,
  baseUrl: 'http://192.168.1.20:11434',
  model: 'laya-1',
};

/** The stored value of the custom slot for a key bound to `origin`. */
function customRecord(origin: string, key: string): string {
  return JSON.stringify({ origin, key });
}

function makeHarness(saved: DecisionModelSelection = { kind: 'unset' }) {
  const rpcHandler = createMockRpcHandler();
  const settings = new Map<string, unknown>();
  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws'),
    getConfiguration: jest.fn(
      (section: string, key: string, fallback: unknown) =>
        settings.get(`${section}.${key}`) ?? fallback,
    ),
    setConfiguration: jest.fn(
      async (section: string, key: string, value: unknown) => {
        if (value === undefined) settings.delete(`${section}.${key}`);
        else settings.set(`${section}.${key}`, value);
      },
    ),
  };
  const logger = createMockLogger();
  const secrets = createMockSecretStorage();
  const keys = new DecisionModelKeys(secrets, createMockLogger());
  let selection: DecisionModelSelection = saved;
  const setSelection = jest.fn(
    async (input: unknown): Promise<DecisionModelSelection> => {
      selection = DecisionModelSelectionSchema.parse(input);
      return selection;
    },
  );
  const getStatus = async (): Promise<DecisionModelStatusDto> => ({
    selection,
    locality: selection.kind === 'unset' ? null : 'remote',
    reportsConfidence: selection.kind !== 'unset',
    state: selection.kind === 'unset' ? 'unset' : 'ready',
    detail: null,
    ...(selection.kind === 'custom'
      ? { apiKeyStored: await keys.has('custom', selection.baseUrl) }
      : {}),
  });
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
    {} as unknown as CliModelListService,
    {
      isRegistered: jest.fn().mockReturnValue(false),
      resolve: jest.fn(),
    } as unknown as DependencyContainer,
    {
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
      hasProviderKey: jest.fn().mockResolvedValue(false),
    } as unknown as IAuthSecretsService,
    { exists: jest.fn().mockResolvedValue(true) } as never,
    { type: 'electron', extensionPath: '/ptah-app' } as never,
    {
      getStatus,
      getSelection: () => selection,
      localityOf: () => 'remote',
      setSelection,
      keys,
    },
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

  /** Every logger call at every level, as one string. */
  const logged = (): string =>
    JSON.stringify([
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);

  return {
    settings,
    secrets,
    logger,
    setSelection,
    selection: () => selection,
    setConfig,
    getConfig,
    logged,
  };
}

type Harness = ReturnType<typeof makeHarness>;

/** Nothing was written: no selection, no secret, no other setting (2.2). */
function expectNothingWritten(h: Harness): void {
  expect(h.setSelection).not.toHaveBeenCalled();
  expect(h.secrets.store).not.toHaveBeenCalled();
  expect(h.secrets.delete).not.toHaveBeenCalled();
  expect(h.settings.size).toBe(0);
}

describe('agent:setConfig decision endpoint validation (2.2)', () => {
  it.each([
    ['not http', 'ftp://gateway.example'],
    ['relative', '/v1/systemone'],
    ['userinfo', `https://user:${SENTINEL}@gateway.example`],
    ['query', `https://gateway.example/gw?token=${SENTINEL}`],
    ['fragment', `https://gateway.example/gw#${SENTINEL}`],
  ])(
    'refuses a %s base URL with the base URL error and keeps the previous selection',
    async (_label, baseUrl) => {
      const h = makeHarness(HTTPS_ENDPOINT);
      const result = await h.setConfig({
        decisionModel: { kind: 'custom', baseUrl, model: 'laya-1' },
        decisionModelCustomApiKey: SENTINEL,
        piModel: 'openai/gpt-4o',
      });

      expect(result).toEqual({
        success: false,
        error: DECISION_MODEL_INVALID_BASE_URL,
      });
      expectNothingWritten(h);
      expect(h.selection()).toEqual(HTTPS_ENDPOINT);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(h.logged()).not.toContain(SENTINEL);
    },
  );

  it.each([
    ['custom', { kind: 'custom', baseUrl: 'https://gateway.example' }],
    ['ollama-cloud', { kind: 'ollama-cloud' }],
  ])('refuses an empty %s model with the model error', async (_kind, base) => {
    const h = makeHarness();
    const result = await h.setConfig({
      decisionModel: { ...base, model: '' },
      piModel: 'openai/gpt-4o',
    });

    expect(result).toEqual({
      success: false,
      error: DECISION_MODEL_INVALID_MODEL,
    });
    expectNothingWritten(h);
  });

  it('reports the base URL first when both fields are bad', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        decisionModel: { kind: 'custom', baseUrl: 'nope', model: '' },
      }),
    ).toEqual({ success: false, error: DECISION_MODEL_INVALID_BASE_URL });
  });

  it('keeps the generic error for an unknown field and never echoes it', async () => {
    const h = makeHarness();
    const result = await h.setConfig({
      decisionModel: { ...HTTPS_ENDPOINT, apiKey: SENTINEL },
    });

    expect(result).toEqual({
      success: false,
      error: 'Unsupported decisionModel value',
    });
    expectNothingWritten(h);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('refuses a non-string custom key before any write', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        decisionModel: HTTPS_ENDPOINT,
        decisionModelCustomApiKey: 42,
      }),
    ).toEqual({
      success: false,
      error: 'Unsupported decisionModelCustomApiKey value',
    });
    expectNothingWritten(h);
  });
});

describe('agent:setConfig one key field and the custom key binding (DC10)', () => {
  it.each([
    ['two keys', SENTINEL, 'jev-key'],
    ['two deletions', '', ''],
  ])('refuses both key fields together (%s)', async (_label, custom, jev) => {
    const h = makeHarness();
    const result = await h.setConfig({
      decisionModel: HTTPS_ENDPOINT,
      decisionModelCustomApiKey: custom,
      decisionModelJevApiKey: jev,
    });

    expect(result).toEqual({
      success: false,
      error:
        'Unsupported decisionModelJevApiKey with decisionModelCustomApiKey',
    });
    expectNothingWritten(h);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('refuses a custom key when neither the request nor the saved choice is a custom endpoint', async () => {
    const h = makeHarness({ kind: 'jev', model: 'jev-1.13.0' });
    expect(await h.setConfig({ decisionModelCustomApiKey: SENTINEL })).toEqual({
      success: false,
      error: DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT,
    });
    expectNothingWritten(h);
  });

  it('refuses a custom key sent with a selection of another kind', async () => {
    const h = makeHarness(HTTPS_ENDPOINT);
    expect(
      await h.setConfig({
        decisionModel: { kind: 'ollama-cloud', model: 'clef:27b' },
        decisionModelCustomApiKey: SENTINEL,
      }),
    ).toEqual({
      success: false,
      error: DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT,
    });
    expectNothingWritten(h);
    expect(h.selection()).toEqual(HTTPS_ENDPOINT);
  });

  it('binds a key sent with a custom selection to that selection origin', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        decisionModel: HTTPS_ENDPOINT,
        decisionModelCustomApiKey: `  ${SENTINEL}  `,
      }),
    ).toEqual({ success: true });

    expect(h.secrets.__state.entries.get(CUSTOM_SLOT)).toBe(
      customRecord('https://gateway.example', SENTINEL),
    );
    expect(h.selection()).toEqual(HTTPS_ENDPOINT);
  });

  it('binds a key sent alone to the saved custom endpoint', async () => {
    const h = makeHarness(HTTPS_ENDPOINT);
    expect(await h.setConfig({ decisionModelCustomApiKey: SENTINEL })).toEqual({
      success: true,
    });

    expect(h.secrets.__state.entries.get(CUSTOM_SLOT)).toBe(
      customRecord('https://gateway.example', SENTINEL),
    );
    expect(h.setSelection).not.toHaveBeenCalled();
  });

  it("deletes the custom key with '' even without a custom endpoint", async () => {
    const h = makeHarness({ kind: 'unset' });
    h.secrets.__state.seed(
      CUSTOM_SLOT,
      customRecord('https://gateway.example', SENTINEL),
    );

    expect(await h.setConfig({ decisionModelCustomApiKey: '' })).toEqual({
      success: true,
    });
    expect(h.secrets.__state.entries.has(CUSTOM_SLOT)).toBe(false);
  });

  it('never touches the Jev slot for a custom key', async () => {
    const h = makeHarness();
    h.secrets.__state.seed(JEV_SLOT, 'jev-stored-key');

    await h.setConfig({
      decisionModel: HTTPS_ENDPOINT,
      decisionModelCustomApiKey: SENTINEL,
    });
    expect(h.secrets.__state.entries.get(JEV_SLOT)).toBe('jev-stored-key');
  });
});

describe('agent:setConfig key transport rule (D4)', () => {
  it('refuses a new key for a plain-http remote endpoint and writes nothing', async () => {
    const h = makeHarness(HTTPS_ENDPOINT);
    const result = await h.setConfig({
      decisionModel: HTTP_REMOTE_ENDPOINT,
      decisionModelCustomApiKey: SENTINEL,
      piModel: 'openai/gpt-4o',
    });

    expect(result).toEqual({
      success: false,
      error: DECISION_MODEL_KEY_NEEDS_HTTPS,
    });
    expectNothingWritten(h);
    expect(h.selection()).toEqual(HTTPS_ENDPOINT);
    expect(h.logged()).not.toContain(SENTINEL);
  });

  it('refuses a key sent alone when the saved endpoint is plain-http remote', async () => {
    const h = makeHarness(HTTP_REMOTE_ENDPOINT);
    expect(await h.setConfig({ decisionModelCustomApiKey: SENTINEL })).toEqual({
      success: false,
      error: DECISION_MODEL_KEY_NEEDS_HTTPS,
    });
    expectNothingWritten(h);
  });

  it.each([
    'http://localhost:11434',
    'http://localhost.:11434',
    'http://127.0.0.1:11434',
    'http://127.4.5.6:8080',
    'http://[::1]:11434',
  ])('accepts a key for the loopback endpoint %s', async (baseUrl) => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        decisionModel: { kind: 'custom', baseUrl, model: 'laya-1' },
        decisionModelCustomApiKey: SENTINEL,
      }),
    ).toEqual({ success: true });
    expect(h.secrets.__state.entries.has(CUSTOM_SLOT)).toBe(true);
  });

  it('refuses a domain that only starts like a loopback address', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        decisionModel: {
          kind: 'custom',
          baseUrl: 'http://127.0.0.1.evil.example',
          model: 'laya-1',
        },
        decisionModelCustomApiKey: SENTINEL,
      }),
    ).toEqual({ success: false, error: DECISION_MODEL_KEY_NEEDS_HTTPS });
    expectNothingWritten(h);
  });

  it('allows a plain-http remote endpoint without a key', async () => {
    const h = makeHarness();
    expect(await h.setConfig({ decisionModel: HTTP_REMOTE_ENDPOINT })).toEqual({
      success: true,
    });
    expect(h.selection()).toEqual(HTTP_REMOTE_ENDPOINT);
  });

  it('refuses a plain-http remote endpoint whose origin holds a stored key', async () => {
    const h = makeHarness();
    h.secrets.__state.seed(
      CUSTOM_SLOT,
      customRecord('http://192.168.1.20:11434', SENTINEL),
    );

    expect(await h.setConfig({ decisionModel: HTTP_REMOTE_ENDPOINT })).toEqual({
      success: false,
      error: DECISION_MODEL_KEY_NEEDS_HTTPS,
    });
    expect(h.setSelection).not.toHaveBeenCalled();
    expect(h.logged()).not.toContain(SENTINEL);
  });

  it('ignores a stored key bound to another origin', async () => {
    const h = makeHarness();
    h.secrets.__state.seed(
      CUSTOM_SLOT,
      customRecord('https://192.168.1.20:11434', SENTINEL),
    );

    expect(await h.setConfig({ decisionModel: HTTP_REMOTE_ENDPOINT })).toEqual({
      success: true,
    });
  });

  it("allows the endpoint when the same request deletes its key with ''", async () => {
    const h = makeHarness();
    h.secrets.__state.seed(
      CUSTOM_SLOT,
      customRecord('http://192.168.1.20:11434', SENTINEL),
    );

    expect(
      await h.setConfig({
        decisionModel: HTTP_REMOTE_ENDPOINT,
        decisionModelCustomApiKey: '',
      }),
    ).toEqual({ success: true });
    expect(h.secrets.__state.entries.has(CUSTOM_SLOT)).toBe(false);
    expect(h.selection()).toEqual(HTTP_REMOTE_ENDPOINT);
  });
});

describe('agent:getConfig custom key indicator (2.4) and sentinel search (1.6)', () => {
  it('reports apiKeyStored only, never the key, after a save', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        decisionModel: HTTPS_ENDPOINT,
        decisionModelCustomApiKey: SENTINEL,
      }),
    ).toEqual({ success: true });

    const config = await h.getConfig();
    expect(config.decisionModel).toEqual({
      selection: HTTPS_ENDPOINT,
      locality: 'remote',
      reportsConfidence: true,
      state: 'ready',
      detail: null,
      apiKeyStored: true,
    });
    expect(Object.keys(config)).not.toContain('decisionModelCustomApiKey');
    expect(JSON.stringify(config)).not.toContain(SENTINEL);
    // The debug line names the field, never its value.
    expect(h.logged()).toContain('decisionModelCustomApiKey');
    expect(h.logged()).not.toContain(SENTINEL);
  });

  it("reports apiKeyStored false after the key is deleted with ''", async () => {
    const h = makeHarness(HTTPS_ENDPOINT);
    h.secrets.__state.seed(
      CUSTOM_SLOT,
      customRecord('https://gateway.example', SENTINEL),
    );
    expect((await h.getConfig()).decisionModel.apiKeyStored).toBe(true);

    await h.setConfig({ decisionModelCustomApiKey: '' });
    const config = await h.getConfig();
    expect(config.decisionModel.apiKeyStored).toBe(false);
    expect(JSON.stringify(config)).not.toContain(SENTINEL);
  });

  it('keeps the key out of every result and log line when the secret store fails', async () => {
    const h = makeHarness();
    h.secrets.store.mockRejectedValueOnce(
      new Error(`keychain refused ${SENTINEL}`),
    );
    const result = await h.setConfig({
      decisionModel: HTTPS_ENDPOINT,
      decisionModelCustomApiKey: SENTINEL,
    });

    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(h.setSelection).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(h.logged()).not.toContain(SENTINEL);
  });
});

/*
 * Phase 3 logic review defect 1: a secret store can persist a write and then
 * reject. The fakes below change the backing map before they reject, so only
 * a restore of the snapshot leaves the previous key in place.
 */
describe('agent:setConfig key write that persists and then rejects', () => {
  const PREVIOUS = customRecord('https://gateway.example', 'previous-key-3c9e');

  function storeThenReject(h: Harness): void {
    h.secrets.store.mockImplementationOnce(async (key, value) => {
      h.secrets.__state.entries.set(key, value);
      throw new Error(`keychain refused ${SENTINEL}`);
    });
  }

  it('restores the previous key when the store persists and then rejects', async () => {
    const h = makeHarness();
    h.secrets.__state.seed(CUSTOM_SLOT, PREVIOUS);
    storeThenReject(h);

    const result = await h.setConfig({
      decisionModel: HTTPS_ENDPOINT,
      decisionModelCustomApiKey: SENTINEL,
    });

    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(h.secrets.__state.entries.get(CUSTOM_SLOT)).toBe(PREVIOUS);
    expect(h.setSelection).not.toHaveBeenCalled();
    expect(h.logged()).not.toContain(SENTINEL);
  });

  it('restores the previous key when a key-only save persists and then rejects', async () => {
    const h = makeHarness(HTTPS_ENDPOINT);
    h.secrets.__state.seed(CUSTOM_SLOT, PREVIOUS);
    storeThenReject(h);

    const result = await h.setConfig({ decisionModelCustomApiKey: SENTINEL });

    expect(result.success).toBe(false);
    expect(h.secrets.__state.entries.get(CUSTOM_SLOT)).toBe(PREVIOUS);
  });

  it('restores the key when a delete persists and then rejects', async () => {
    const h = makeHarness(HTTPS_ENDPOINT);
    h.secrets.__state.seed(CUSTOM_SLOT, PREVIOUS);
    h.secrets.delete.mockImplementationOnce(async (key) => {
      h.secrets.__state.entries.delete(key);
      throw new Error(`keychain refused ${SENTINEL}`);
    });

    const result = await h.setConfig({ decisionModelCustomApiKey: '' });

    expect(result.success).toBe(false);
    expect(h.secrets.__state.entries.get(CUSTOM_SLOT)).toBe(PREVIOUS);
  });

  it('says the key may have changed when the restore fails too', async () => {
    const h = makeHarness();
    h.secrets.__state.seed(CUSTOM_SLOT, PREVIOUS);
    storeThenReject(h);
    h.secrets.store.mockRejectedValueOnce(new Error(`restore ${SENTINEL}`));

    const result = await h.setConfig({
      decisionModel: HTTPS_ENDPOINT,
      decisionModelCustomApiKey: SENTINEL,
    });

    expect(result).toEqual({
      success: false,
      error: DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED,
    });
    expect(h.setSelection).not.toHaveBeenCalled();
    expect(h.logged()).not.toContain(SENTINEL);
  });
});
