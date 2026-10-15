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
import type { AgentOrchestrationConfig } from '@ptah-extension/shared';
import type {
  DecisionModelSelection,
  DecisionModelStatusDto,
} from '@ptah-extension/lane-routing';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SettingsPersistError } from '@ptah-extension/platform-core';
import type {
  AgentProcessManager,
  CliDetectionService,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { DependencyContainer } from 'tsyringe';
import type { CliModelListService } from '../services/cli-model-list.service';

import { AgentRpcHandlers } from './agent-rpc.handlers';

/**
 * Decision #46 state set. `Missing` / `Extra` are `never` only when this
 * list is exactly `DecisionModelStatusDto['state']`, so a new state
 * (`model-unavailable`) fails the assignment below.
 */
const DECISION_MODEL_STATES = [
  'unset',
  'ready',
  'no-credential',
  'unreachable',
  'unsupported-endpoint',
] as const;

type ListedState = (typeof DECISION_MODEL_STATES)[number];
type StateGap =
  | Exclude<DecisionModelStatusDto['state'], ListedState>
  | Exclude<ListedState, DecisionModelStatusDto['state']>;
const STATE_SET_IS_UNCHANGED: StateGap extends never ? true : never = true;

const UNSET_STATUS: DecisionModelStatusDto = {
  selection: { kind: 'unset' },
  locality: null,
  reportsConfidence: false,
  state: 'unset',
  detail: null,
};

const READY_AFTER_LIVE_404: DecisionModelStatusDto = {
  selection: { kind: 'ollama', model: 'tev1' },
  locality: 'local',
  reportsConfidence: true,
  state: 'ready',
  detail: 'last call failed: http 404',
};

const UNSUPPORTED_ENDPOINT: DecisionModelStatusDto = {
  selection: { kind: 'ollama', model: 'tev1' },
  locality: 'local',
  reportsConfidence: true,
  state: 'unsupported-endpoint',
  detail: 'Ollama 0.34.2 < 0.35.0',
};

interface DecisionModelDouble {
  getStatus: jest.Mock<Promise<DecisionModelStatusDto>, []>;
  setSelection: jest.Mock<Promise<DecisionModelSelection>, [unknown]>;
  setJevApiKey: jest.Mock<Promise<void>, [string | null]>;
}

function decisionModelDouble(
  status: DecisionModelStatusDto = UNSET_STATUS,
): DecisionModelDouble {
  return {
    getStatus: jest.fn(() => Promise.resolve(status)),
    setSelection: jest.fn((_input: unknown): Promise<DecisionModelSelection> =>
      Promise.resolve({ kind: 'unset' as const }),
    ),
    setJevApiKey: jest.fn((_key: string | null): Promise<void> =>
      Promise.resolve(),
    ),
  };
}

function makeHarness(status: DecisionModelStatusDto = UNSET_STATUS) {
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
  const decisionModel = decisionModelDouble(status);
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
      getStatus: () => decisionModel.getStatus(),
      setSelection: (input: unknown) => decisionModel.setSelection(input),
      setJevApiKey: (key: string | null) => decisionModel.setJevApiKey(key),
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

  return {
    rpcHandler,
    settings,
    workspace,
    logger,
    decisionModel,
    setConfig,
    getConfig,
  };
}

describe('agent:getConfig decision model', () => {
  it('registers no new RPC method (D5)', () => {
    const h = makeHarness();
    expect(STATE_SET_IS_UNCHANGED).toBe(true);
    expect(h.rpcHandler.getRegisteredMethods()).toEqual([
      ...AgentRpcHandlers.METHODS,
    ]);
    expect(
      h.rpcHandler
        .getRegisteredMethods()
        .some((name) => name.toLowerCase().includes('decision')),
    ).toBe(false);
  });

  it('returns a ready row whose detail is the live error text (decision #46)', async () => {
    const h = makeHarness(READY_AFTER_LIVE_404);
    const config = await h.getConfig();
    expect(config.decisionModel).toEqual(READY_AFTER_LIVE_404);
    expect(config.decisionModel.state).toBe('ready');
    expect(config.decisionModel.detail).toBe('last call failed: http 404');
    expect(h.decisionModel.getStatus).toHaveBeenCalledTimes(1);
  });

  it('returns unsupported-endpoint with the probe detail unchanged', async () => {
    const h = makeHarness(UNSUPPORTED_ENDPOINT);
    const config = await h.getConfig();
    expect(config.decisionModel).toEqual(UNSUPPORTED_ENDPOINT);
    expect(config.decisionModel.state).toBe('unsupported-endpoint');
    expect(config.decisionModel.detail).toBe('Ollama 0.34.2 < 0.35.0');
  });

  it.each(DECISION_MODEL_STATES)(
    'passes the existing state %s through with its detail',
    async (state) => {
      const status: DecisionModelStatusDto = {
        selection:
          state === 'unset'
            ? { kind: 'unset' as const }
            : { kind: 'ollama' as const, model: 'tev1' },
        locality: state === 'unset' ? null : 'remote',
        reportsConfidence: state !== 'unset' && state !== 'no-credential',
        state,
        detail: state === 'unset' ? null : `detail for ${state}`,
      };
      const h = makeHarness(status);
      expect((await h.getConfig()).decisionModel).toEqual(status);
    },
  );
});

describe('agent:setConfig decision model', () => {
  it('delegates the selection and does not write the setting itself', async () => {
    const h = makeHarness();
    const selection = { kind: 'ollama' as const, model: 'tev1' };
    expect(await h.setConfig({ decisionModel: selection })).toEqual({
      success: true,
    });
    expect(h.decisionModel.setSelection).toHaveBeenCalledTimes(1);
    expect(h.decisionModel.setSelection).toHaveBeenCalledWith(selection);
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    expect(h.settings.size).toBe(0);
  });

  it('stores a Jev key through the service and never echoes it', async () => {
    const h = makeHarness(READY_AFTER_LIVE_404);
    const secret = 'jev-secret-value-9f3a';
    expect(
      await h.setConfig({ decisionModelJevApiKey: `  ${secret}  ` }),
    ).toEqual({ success: true });
    expect(h.decisionModel.setJevApiKey).toHaveBeenCalledTimes(1);
    expect(h.decisionModel.setJevApiKey).toHaveBeenCalledWith(`  ${secret}  `);
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();

    const config = await h.getConfig();
    expect(config.decisionModel).toEqual(READY_AFTER_LIVE_404);
    expect(Object.keys(config)).not.toContain('decisionModelJevApiKey');
    expect(JSON.stringify(config)).not.toContain(secret);
    const logged = JSON.stringify(h.logger.debug.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).toContain('decisionModelJevApiKey');
  });

  it('passes an empty Jev key through so the service can delete it', async () => {
    const h = makeHarness();
    expect(await h.setConfig({ decisionModelJevApiKey: '' })).toEqual({
      success: true,
    });
    expect(h.decisionModel.setJevApiKey).toHaveBeenCalledWith('');
  });

  it('refuses a non-string Jev key before any write', async () => {
    const h = makeHarness();
    const result = await h.setConfig({
      decisionModelJevApiKey: 12,
      decisionModel: { kind: 'jev' },
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Unsupported decisionModelJevApiKey value',
    });
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
    expect(h.settings.size).toBe(0);
  });

  it('leaves other fields unchanged when the selection is invalid', async () => {
    const h = makeHarness();
    h.decisionModel.setSelection.mockRejectedValue(
      new Error('invalid decision model selection at model: too small'),
    );
    const result = await h.setConfig({
      decisionModel: { kind: 'ollama', model: '' },
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(h.settings.size).toBe(0);
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain(
      'invalid decision model selection',
    );
  });

  it('returns SettingsPersistError text when the service cannot store', async () => {
    const h = makeHarness();
    h.decisionModel.setSelection.mockRejectedValue(
      new SettingsPersistError('EIO'),
    );
    expect(await h.setConfig({ decisionModel: { kind: 'unset' } })).toEqual({
      success: false,
      error: 'Settings could not be saved to disk (EIO)',
    });
    expect(h.settings.size).toBe(0);
  });

  it('does not call the decision-model service when those fields are omitted', async () => {
    const h = makeHarness();
    expect(await h.setConfig({ piModel: 'openai/gpt-4o' })).toEqual({
      success: true,
    });
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
    expect(h.settings.get('ptah.agentOrchestration.piModel')).toBe(
      'openai/gpt-4o',
    );
  });
});
