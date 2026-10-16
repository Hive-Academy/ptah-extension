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
  DecisionModelLocality,
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
  getSelection: jest.Mock<DecisionModelSelection, []>;
  localityOf: jest.Mock<DecisionModelLocality | null, [DecisionModelSelection]>;
  setSelection: jest.Mock<Promise<DecisionModelSelection>, [unknown]>;
  setJevApiKey: jest.Mock<Promise<void>, [string | null]>;
  readJevApiKey: jest.Mock<Promise<string | null>, []>;
}

function decisionModelDouble(
  status: DecisionModelStatusDto = UNSET_STATUS,
): DecisionModelDouble {
  return {
    getStatus: jest.fn(() => Promise.resolve(status)),
    getSelection: jest.fn((): DecisionModelSelection => status.selection),
    localityOf: jest.fn(
      (_selection: DecisionModelSelection): DecisionModelLocality | null =>
        status.locality,
    ),
    setSelection: jest.fn((_input: unknown): Promise<DecisionModelSelection> =>
      Promise.resolve({ kind: 'unset' as const }),
    ),
    setJevApiKey: jest.fn((_key: string | null): Promise<void> =>
      Promise.resolve(),
    ),
    readJevApiKey: jest.fn((): Promise<string | null> => Promise.resolve(null)),
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
      getSelection: () => decisionModel.getSelection(),
      localityOf: (selection: DecisionModelSelection) =>
        decisionModel.localityOf(selection),
      setSelection: (input: unknown) => decisionModel.setSelection(input),
      setJevApiKey: (key: string | null) => decisionModel.setJevApiKey(key),
      readJevApiKey: () => decisionModel.readJevApiKey(),
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

describe('agent:getConfig decision model status failure (P4 S-1)', () => {
  const JEV_READY: DecisionModelStatusDto = {
    selection: { kind: 'jev', model: 'jev-1.13.0' },
    locality: 'remote',
    reportsConfidence: true,
    state: 'ready',
    detail: null,
  };
  const RAW_ERROR_TEXT = 'secret store EIO at /home/u/.ptah/secrets';

  it('returns the other fields and an unreachable row for the stored selection when getStatus rejects', async () => {
    const h = makeHarness(JEV_READY);
    const failure = new Error(RAW_ERROR_TEXT);
    h.decisionModel.getStatus.mockRejectedValue(failure);

    const config = await h.getConfig();

    expect(config.detectedClis).toEqual([]);
    expect(config.maxConcurrentAgents).toBe(5);
    expect(config.piModel).toBe('');
    expect(config.workflowsDisabled).toBe(false);
    expect(config.decisionModel).toEqual({
      selection: { kind: 'jev', model: 'jev-1.13.0' },
      locality: 'remote',
      reportsConfidence: true,
      state: 'unreachable',
      detail: 'The status could not be read. The saved choice is unchanged.',
    });
    expect(DECISION_MODEL_STATES).toContain(config.decisionModel.state);
    expect(JSON.stringify(config)).not.toContain(RAW_ERROR_TEXT);
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('decision model status failed'),
      failure,
    );
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
  });

  it('reports a structured selection without confidence when getStatus rejects', async () => {
    const structured: DecisionModelStatusDto = {
      selection: {
        kind: 'structured',
        providerId: 'openrouter',
        model: 'gpt-4o',
      },
      locality: 'remote',
      reportsConfidence: false,
      state: 'ready',
      detail: null,
    };
    const h = makeHarness(structured);
    h.decisionModel.getStatus.mockRejectedValue(new Error(RAW_ERROR_TEXT));

    const { decisionModel } = await h.getConfig();

    expect(decisionModel.selection).toEqual(structured.selection);
    expect(decisionModel.reportsConfidence).toBe(false);
    expect(decisionModel.state).toBe('unreachable');
  });

  it('keeps a stored unset selection unset when getStatus rejects', async () => {
    const h = makeHarness(UNSET_STATUS);
    h.decisionModel.getStatus.mockRejectedValue(new Error(RAW_ERROR_TEXT));

    expect((await h.getConfig()).decisionModel).toEqual(UNSET_STATUS);
    expect(h.decisionModel.localityOf).not.toHaveBeenCalled();
  });

  it('returns an unset unreachable row with fixed detail when the selection cannot be read either', async () => {
    const h = makeHarness(JEV_READY);
    const statusFailure = new Error(RAW_ERROR_TEXT);
    const selectionFailure = new Error(`${RAW_ERROR_TEXT} (settings)`);
    h.decisionModel.getStatus.mockRejectedValue(statusFailure);
    h.decisionModel.getSelection.mockImplementation(() => {
      throw selectionFailure;
    });

    const config = await h.getConfig();

    expect(config.maxConcurrentAgents).toBe(5);
    expect(config.decisionModel).toEqual({
      selection: { kind: 'unset' },
      locality: null,
      reportsConfidence: false,
      state: 'unreachable',
      detail: 'The saved decision model could not be read. It is unchanged.',
    });
    expect(JSON.stringify(config)).not.toContain(RAW_ERROR_TEXT);
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('decision model status failed'),
      statusFailure,
    );
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('selection could not be read'),
      selectionFailure,
    );
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
  });

  it('returns the row without a locality when localityOf throws', async () => {
    const h = makeHarness(JEV_READY);
    const localityFailure = new Error(RAW_ERROR_TEXT);
    h.decisionModel.getStatus.mockRejectedValue(new Error(RAW_ERROR_TEXT));
    h.decisionModel.localityOf.mockImplementation(() => {
      throw localityFailure;
    });

    const { decisionModel } = await h.getConfig();

    expect(decisionModel.selection).toEqual(JEV_READY.selection);
    expect(decisionModel.locality).toBeNull();
    expect(decisionModel.state).toBe('unreachable');
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('locality could not be read'),
      localityFailure,
    );
  });
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
    const result = await h.setConfig({
      decisionModel: { kind: 'ollama', model: '' },
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Unsupported decisionModel value',
    });
    expect(h.settings.size).toBe(0);
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
  });

  it('writes no Jev key when the selection sent with it is invalid (P4 defect 1)', async () => {
    const h = makeHarness();
    const secret = 'jev-secret-value-9f3a';
    const result = await h.setConfig({
      decisionModel: { kind: 'jev', model: '' },
      decisionModelJevApiKey: secret,
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Unsupported decisionModel value',
    });
    expect(h.decisionModel.readJevApiKey).not.toHaveBeenCalled();
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
    expect(h.settings.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('passes the parsed selection, with the Jev model default, to the service', async () => {
    const h = makeHarness();
    expect(await h.setConfig({ decisionModel: { kind: 'jev' } })).toEqual({
      success: true,
    });
    expect(h.decisionModel.setSelection).toHaveBeenCalledWith({
      kind: 'jev',
      model: 'jev-1.13.0',
    });
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

  it('writes the Jev key before the selection (P4 S-2)', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({
        decisionModel: { kind: 'jev' },
        decisionModelJevApiKey: 'jev-secret-value-9f3a',
      }),
    ).toEqual({ success: true });
    const [keyOrder] = h.decisionModel.setJevApiKey.mock.invocationCallOrder;
    const [selectionOrder] =
      h.decisionModel.setSelection.mock.invocationCallOrder;
    expect(keyOrder).toBeLessThan(selectionOrder);
  });

  it('does not write the selection when the Jev key write fails (P4 S-2)', async () => {
    const h = makeHarness();
    const secret = 'jev-secret-value-9f3a';
    h.decisionModel.setJevApiKey.mockRejectedValue(
      new Error(`secret store refused ${secret}`),
    );
    const result = await h.setConfig({
      decisionModel: { kind: 'jev' },
      decisionModelJevApiKey: secret,
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(h.decisionModel.setJevApiKey).toHaveBeenCalledTimes(1);
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
    expect(h.settings.size).toBe(0);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain(secret);
  });

  it('restores the previous key when the selection write fails after the key was stored (P4 defect 1)', async () => {
    const h = makeHarness();
    const previous = 'jev-previous-key-11aa';
    const secret = 'jev-secret-value-9f3a';
    h.decisionModel.readJevApiKey.mockResolvedValue(previous);
    h.decisionModel.setSelection.mockRejectedValue(
      new SettingsPersistError('EIO'),
    );
    const result = await h.setConfig({
      decisionModel: { kind: 'jev' },
      decisionModelJevApiKey: secret,
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Settings could not be saved to disk (EIO)',
    });
    expect(h.decisionModel.setJevApiKey.mock.calls).toEqual([
      [secret],
      [previous],
    ]);
    const [readOrder] = h.decisionModel.readJevApiKey.mock.invocationCallOrder;
    const [keyOrder] = h.decisionModel.setJevApiKey.mock.invocationCallOrder;
    expect(readOrder).toBeLessThan(keyOrder);
    expect(h.decisionModel.setSelection).toHaveBeenCalledTimes(1);
    expect(h.settings.size).toBe(0);
    const logged = JSON.stringify([
      h.logger.error.mock.calls,
      h.logger.debug.mock.calls,
    ]);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain(previous);
  });

  it('deletes the new key on rollback when no key was stored before (P4 defect 1)', async () => {
    const h = makeHarness();
    h.decisionModel.readJevApiKey.mockResolvedValue(null);
    h.decisionModel.setSelection.mockRejectedValue(
      new SettingsPersistError('EIO'),
    );
    const result = await h.setConfig({
      decisionModel: { kind: 'jev' },
      decisionModelJevApiKey: 'jev-secret-value-9f3a',
    });
    expect(result.success).toBe(false);
    expect(h.decisionModel.setJevApiKey.mock.calls).toEqual([
      ['jev-secret-value-9f3a'],
      [null],
    ]);
  });

  it('says the key may have changed when the rollback also fails (P4 defect 1)', async () => {
    const h = makeHarness();
    const previous = 'jev-previous-key-11aa';
    const secret = 'jev-secret-value-9f3a';
    h.decisionModel.readJevApiKey.mockResolvedValue(previous);
    h.decisionModel.setSelection.mockRejectedValue(
      new SettingsPersistError('EIO'),
    );
    h.decisionModel.setJevApiKey
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error(`secret store refused ${previous}`));
    const result = await h.setConfig({
      decisionModel: { kind: 'jev' },
      decisionModelJevApiKey: secret,
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error:
        'Could not save the decision model. The TypeSafe Jev API key may have changed.',
    });
    expect(h.decisionModel.setJevApiKey).toHaveBeenCalledTimes(2);
    expect(h.settings.size).toBe(0);
    expect(h.logger.error).toHaveBeenCalledWith(
      'RPC: agent:setConfig could not restore the previous decision model key',
      { selectionErrorType: 'SettingsPersistError', restoreErrorType: 'Error' },
    );
    const logged = JSON.stringify(h.logger.error.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain(previous);
  });

  it('writes nothing when the previous key cannot be read (P4 defect 1)', async () => {
    const h = makeHarness();
    h.decisionModel.readJevApiKey.mockRejectedValue(new Error('locked'));
    const result = await h.setConfig({
      decisionModel: { kind: 'jev' },
      decisionModelJevApiKey: 'jev-secret-value-9f3a',
      piModel: 'openai/gpt-4o',
    });
    expect(result).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(h.decisionModel.setJevApiKey).not.toHaveBeenCalled();
    expect(h.decisionModel.setSelection).not.toHaveBeenCalled();
    expect(h.settings.size).toBe(0);
  });

  it('reads no previous key when only the key is sent', async () => {
    const h = makeHarness();
    expect(
      await h.setConfig({ decisionModelJevApiKey: 'jev-secret-value-9f3a' }),
    ).toEqual({ success: true });
    expect(h.decisionModel.readJevApiKey).not.toHaveBeenCalled();
    expect(h.decisionModel.setJevApiKey).toHaveBeenCalledTimes(1);
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
