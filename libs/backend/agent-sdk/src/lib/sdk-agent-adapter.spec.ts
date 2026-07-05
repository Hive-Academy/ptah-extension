/**
 * SdkAgentAdapter — facade-level unit specs (Win 6c).
 *
 * After the Win 6c extraction, this spec covers ONLY the adapter's facade /
 * orchestration surface:
 *   - initialize / dispose / reset / preloadSdk
 *   - startChatSession / resumeSession / executeSlashCommand dispatch
 *   - Callback wiring from adapter setters into executeQuery() options
 *   - includePartialMessages passthrough
 *
 * The pushed-down behavior lives in:
 *   - helpers/session-fork.service.spec.ts  (forkSession + rewindFiles)
 *   - helpers/sdk-adapter-callback-registry.spec.ts (registry semantics)
 */

import 'reflect-metadata';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
  };
});

jest.mock('./helpers/sdk-module-loader', () => ({
  SdkModuleLoader: jest.fn(),
}));

import { existsSync } from 'fs';
import type {
  Logger,
  ConfigManager,
  SentryService,
} from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  FlatStreamEventUnion,
  SessionId,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  createFakeAsyncGenerator,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  PlatformType,
  type IPlatformInfo,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

import { SdkAgentAdapter } from './sdk-agent-adapter';
import { SdkRuntimeStateService } from './helpers/sdk-runtime-state.service';
import { SdkAdapterEvents } from './helpers/sdk-adapter-events.service';
import { SessionActivityRegistry } from './helpers/session-activity-registry';
import { SdkError } from './errors';
import type { SessionMetadataStore } from './session-metadata-store';
import type {
  SessionLifecycleManager,
  StreamTransformer,
  SdkModuleLoader,
  SdkModelService,
  SessionForkService,
  ExecuteQueryResult,
  Query,
  ResultStatsCallback,
} from './helpers';
import type { IAuthEnvProvider } from './auth-env.port';
import type {
  ClaudeCliDetector,
  ClaudeInstallation,
} from './detector/claude-cli-detector';
import type { SDKMessage } from './types/sdk-types/claude-sdk.types';

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

interface MockConfigManager {
  get: jest.Mock;
  set: jest.Mock;
}

function createMockConfigManager(
  initial: Record<string, unknown> = {},
): MockConfigManager {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: jest.fn((key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

function createMockSentry(): jest.Mocked<
  Pick<SentryService, 'captureException'>
> {
  return { captureException: jest.fn() };
}

function createMockIAuthEnvProvider(): jest.Mocked<
  Pick<
    IAuthEnvProvider,
    'configureAuthentication' | 'clearAuthentication' | 'resolveActiveAuth'
  >
> {
  return {
    configureAuthentication: jest.fn().mockResolvedValue({
      configured: true,
      details: [],
      errorMessage: undefined,
    }),
    clearAuthentication: jest.fn(),
    resolveActiveAuth: jest
      .fn()
      .mockReturnValue({ authMethod: 'apiKey', providerId: 'anthropic' }),
  };
}

function createMockCliDetector(): jest.Mocked<
  Pick<ClaudeCliDetector, 'findExecutable' | 'configure' | 'clearCache'>
> {
  return {
    findExecutable: jest.fn().mockResolvedValue(null),
    configure: jest.fn(),
    clearCache: jest.fn(),
  };
}

function createMockModelService(): jest.Mocked<
  Pick<
    SdkModelService,
    | 'getSupportedModels'
    | 'getDefaultModel'
    | 'getApiModelsNormalized'
    | 'clearCache'
    | 'resolveModelId'
  >
> {
  return {
    getSupportedModels: jest.fn().mockResolvedValue([]),
    getDefaultModel: jest.fn().mockResolvedValue('claude-sonnet-4-20250514'),
    getApiModelsNormalized: jest.fn().mockResolvedValue([]),
    clearCache: jest.fn(),
    resolveModelId: jest.fn((m: string) => m),
  };
}

function createMockMetadataStore(): jest.Mocked<
  Pick<SessionMetadataStore, 'create' | 'touch' | 'get'>
> {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    touch: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  };
}

function createMockModuleLoader(): jest.Mocked<
  Pick<SdkModuleLoader, 'preload' | 'getQueryFunction' | 'getCliJsPath'>
> {
  return {
    preload: jest.fn().mockResolvedValue(undefined),
    getQueryFunction: jest.fn(),
    getCliJsPath: jest.fn().mockResolvedValue(null),
  };
}

function createMockSessionLifecycle(): jest.Mocked<
  Pick<
    SessionLifecycleManager,
    | 'executeQuery'
    | 'executeSlashCommandQuery'
    | 'disposeAllSessions'
    | 'dispose'
    | 'endSession'
    | 'find'
    | 'bindRealSessionId'
    | 'sendMessage'
    | 'interruptCurrentTurn'
    | 'setSessionPermissionLevel'
    | 'setSessionModel'
  >
> {
  return {
    executeQuery: jest.fn(),
    executeSlashCommandQuery: jest.fn(),
    disposeAllSessions: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
    endSession: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockReturnValue(undefined),
    bindRealSessionId: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    interruptCurrentTurn: jest.fn().mockResolvedValue(true),
    setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
    setSessionModel: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockStreamTransformer(): jest.Mocked<
  Pick<StreamTransformer, 'transform'>
> {
  const transform = jest.fn<
    AsyncIterable<FlatStreamEventUnion>,
    Parameters<StreamTransformer['transform']>
  >();
  transform.mockImplementation(
    () =>
      createFakeAsyncGenerator<FlatStreamEventUnion>(
        [],
      ) as AsyncIterable<FlatStreamEventUnion>,
  );
  return { transform };
}

function createMockForkService(): jest.Mocked<
  Pick<SessionForkService, 'forkSession' | 'rewindFiles'>
> {
  return {
    forkSession: jest.fn().mockResolvedValue({ sessionId: 'fork-id' }),
    rewindFiles: jest.fn().mockResolvedValue({ canRewind: true }),
  };
}

function createMockPlatformInfo(
  overrides: Partial<IPlatformInfo> = {},
): IPlatformInfo {
  return {
    type: PlatformType.VSCode,
    extensionPath: '/fake/extension',
    globalStoragePath: '/fake/global',
    workspaceStoragePath: '/fake/workspace',
    ...overrides,
  };
}

function createMockWorkspaceProvider(
  root: string | null = '/fake/workspace-root',
): jest.Mocked<IWorkspaceProvider> {
  return {
    getWorkspaceRoot: jest.fn(() => root),
    getWorkspaceFolders: jest.fn(() => (root ? [root] : [])),
    getConfiguration: jest.fn(<T>(_: string, __: string, def?: T) => def),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
  } as unknown as jest.Mocked<IWorkspaceProvider>;
}

function createFakeQuery(): Query {
  const gen = createFakeAsyncGenerator<SDKMessage>([]);
  const q = {
    [Symbol.asyncIterator]: () => gen as AsyncIterator<SDKMessage, void>,
    next: () => gen.next(),
    return: (value?: void) => gen.return(value as unknown as SDKMessage),
    throw: (e?: unknown) => gen.throw(e),
    interrupt: jest.fn().mockResolvedValue(undefined),
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
    setModel: jest.fn().mockResolvedValue(undefined),
    streamInput: jest.fn().mockResolvedValue(undefined),
    rewindFiles: jest.fn().mockResolvedValue({ canRewind: true }),
  };
  return q as unknown as Query;
}

interface AdapterHarness {
  adapter: SdkAgentAdapter;
  logger: MockLogger;
  config: MockConfigManager;
  sentry: ReturnType<typeof createMockSentry>;
  metadataStore: ReturnType<typeof createMockMetadataStore>;
  authManager: ReturnType<typeof createMockIAuthEnvProvider>;
  sessionLifecycle: ReturnType<typeof createMockSessionLifecycle>;
  cliDetector: ReturnType<typeof createMockCliDetector>;
  streamTransformer: ReturnType<typeof createMockStreamTransformer>;
  moduleLoader: ReturnType<typeof createMockModuleLoader>;
  modelService: ReturnType<typeof createMockModelService>;
  platformInfo: IPlatformInfo;
  workspaceProvider: jest.Mocked<IWorkspaceProvider>;
  forkService: ReturnType<typeof createMockForkService>;
  events: SdkAdapterEvents;
}

function makeAdapter(
  options: {
    config?: Record<string, unknown>;
    platformInfo?: Partial<IPlatformInfo>;
    workspaceRoot?: string | null;
  } = {},
): AdapterHarness {
  const logger = createMockLogger();
  const config = createMockConfigManager(options.config);
  const sentry = createMockSentry();
  const metadataStore = createMockMetadataStore();
  const authManager = createMockIAuthEnvProvider();
  const sessionLifecycle = createMockSessionLifecycle();
  const cliDetector = createMockCliDetector();
  const streamTransformer = createMockStreamTransformer();
  const moduleLoader = createMockModuleLoader();
  const modelService = createMockModelService();
  const platformInfo = createMockPlatformInfo(options.platformInfo);
  const workspaceProvider = createMockWorkspaceProvider(
    options.workspaceRoot === undefined
      ? '/fake/workspace-root'
      : options.workspaceRoot,
  );
  const forkService = createMockForkService();

  const runtimeState = new SdkRuntimeStateService(asLogger(logger));
  const events = new SdkAdapterEvents(asLogger(logger));
  const activityRegistry = new SessionActivityRegistry(asLogger(logger));

  const adapter = new SdkAgentAdapter(
    asLogger(logger),
    config as unknown as ConfigManager,
    runtimeState,
    metadataStore as unknown as SessionMetadataStore,
    authManager as unknown as IAuthEnvProvider,
    sessionLifecycle as unknown as SessionLifecycleManager,
    cliDetector as unknown as ClaudeCliDetector,
    streamTransformer as unknown as StreamTransformer,
    moduleLoader as unknown as SdkModuleLoader,
    modelService as unknown as SdkModelService,
    platformInfo,
    forkService as unknown as SessionForkService,
    sentry as unknown as SentryService,
    events,
    activityRegistry,
    workspaceProvider,
  );

  return {
    adapter,
    logger,
    config,
    sentry,
    metadataStore,
    authManager,
    sessionLifecycle,
    cliDetector,
    streamTransformer,
    moduleLoader,
    modelService,
    platformInfo,
    workspaceProvider,
    forkService,
    events,
  };
}

function makeSessionConfig(
  overrides: Partial<AISessionConfig> & { tabId?: string } = {},
): AISessionConfig & { tabId: string } {
  return {
    model: 'claude-sonnet-4-20250514',
    projectPath: '/fake/workspace',
    tabId: 'tab_1',
    ...overrides,
  } as AISessionConfig & { tabId: string };
}

describe('SdkAgentAdapter', () => {
  beforeEach(() => {
    mockedExistsSync.mockReset();
    mockedExistsSync.mockReturnValue(true);
  });

  describe('initialize()', () => {
    it('emits initialized=true on the events bus after a successful init', async () => {
      const h = makeAdapter();
      const listener = jest.fn();
      h.events.onInitialized(listener);

      await h.adapter.initialize();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({ success: true });
    });

    it('emits initialized=false when authentication fails', async () => {
      const h = makeAdapter();
      h.authManager.configureAuthentication.mockResolvedValueOnce({
        configured: false,
        details: [],
        errorMessage: 'no key',
      });
      const listener = jest.fn();
      h.events.onInitialized(listener);

      await h.adapter.initialize();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({ success: false });
    });

    it('returns false and records errorMessage when auth is not configured', async () => {
      const h = makeAdapter();
      h.authManager.configureAuthentication.mockResolvedValueOnce({
        configured: false,
        details: [],
        errorMessage: 'missing api key',
      });

      await expect(h.adapter.initialize()).resolves.toBe(false);
      const health = h.adapter.getHealth();
      expect(health.status).toBe('error');
      expect(health.errorMessage).toBe('missing api key');
    });

    it('falls back to bundled cli.js when detector returns null', async () => {
      const h = makeAdapter({
        platformInfo: { extensionPath: '/fake/ext' },
      });
      h.cliDetector.findExecutable.mockResolvedValueOnce(null);
      mockedExistsSync.mockReturnValueOnce(true);

      await h.adapter.initialize();

      expect(h.adapter.getCliJsPath()).toEqual(
        expect.stringContaining('cli.js'),
      );
      expect(mockedExistsSync).toHaveBeenCalled();
    });

    it('uses the detected CLI installation when found', async () => {
      const h = makeAdapter();
      const installation: ClaudeInstallation = {
        path: '/usr/local/bin/claude',
        source: 'path',
        cliJsPath: '/usr/local/bin/cli.js',
        useDirectExecution: false,
      } as ClaudeInstallation;
      h.cliDetector.findExecutable.mockResolvedValueOnce(installation);

      await h.adapter.initialize();
      expect(h.adapter.getCliJsPath()).toBe('/usr/local/bin/cli.js');
    });

    it('persists the default model from the SDK on first init', async () => {
      const h = makeAdapter();
      h.modelService.getDefaultModel.mockResolvedValueOnce('claude-opus-4-6');
      await h.adapter.initialize();

      expect(h.config.set).toHaveBeenCalledWith(
        'model.selected',
        'claude-opus-4-6',
      );
    });

    it('migrates a legacy bare tier name ("opus") to the resolved full ID', async () => {
      const h = makeAdapter({ config: { 'model.selected': 'opus' } });
      h.modelService.resolveModelId.mockImplementationOnce((m: string) =>
        m === 'opus' ? 'claude-opus-4-6' : m,
      );
      await h.adapter.initialize();

      expect(h.config.set).toHaveBeenCalledWith(
        'model.selected',
        'claude-opus-4-6',
      );
    });

    it('marks health as available after a successful init', async () => {
      const h = makeAdapter();
      await expect(h.adapter.initialize()).resolves.toBe(true);
      expect(h.adapter.getHealth().status).toBe('available');
    });

    it('[WP-3T] leaves a valid full model ID unchanged (no catalog validation in initialize)', async () => {
      const validModel = 'claude-opus-4-5';
      const h = makeAdapter({ config: { 'model.selected': validModel } });

      await h.adapter.initialize();

      expect(h.modelService.resolveModelId).not.toHaveBeenCalled();
      const modelSetCalls = h.config.set.mock.calls.filter(
        ([key]: [string, unknown]) => key === 'model.selected',
      );
      expect(modelSetCalls).toHaveLength(0);
    });

    it('[WP-3T] falls back to default model when model.selected is empty (first-run path)', async () => {
      const h = makeAdapter({ config: { 'model.selected': '' } });
      h.modelService.getDefaultModel.mockResolvedValueOnce('valid-model-1');

      await h.adapter.initialize();

      expect(h.config.set).toHaveBeenCalledWith(
        'model.selected',
        'valid-model-1',
      );
    });

    it('[WP-3T] resolves stale bare tier name via resolveModelId and persists the result', async () => {
      const h = makeAdapter({ config: { 'model.selected': 'haiku' } });
      h.modelService.resolveModelId.mockImplementationOnce((m: string) =>
        m === 'haiku' ? 'valid-model-2' : m,
      );

      await h.adapter.initialize();

      expect(h.config.set).toHaveBeenCalledWith(
        'model.selected',
        'valid-model-2',
      );
      expect(h.modelService.resolveModelId).toHaveBeenCalledWith('haiku');
    });
  });

  describe('startChatSession()', () => {
    it('throws SdkError before initialize()', async () => {
      const { adapter } = makeAdapter();
      await expect(
        adapter.startChatSession(makeSessionConfig()),
      ).rejects.toBeInstanceOf(SdkError);
    });

    it('delegates query dispatch to SessionLifecycleManager.executeQuery()', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const sdkQuery = createFakeQuery();
      const abortController = new AbortController();
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery,
        initialModel: 'claude-sonnet-4-20250514',
        abortController,
      } as ExecuteQueryResult);

      const cfg = {
        ...makeSessionConfig(),
        prompt: 'Write a spec',
        isPremium: true,
      } as AISessionConfig & {
        tabId: string;
        prompt: string;
        isPremium: boolean;
      };
      await h.adapter.startChatSession(cfg);

      expect(h.sessionLifecycle.executeQuery).toHaveBeenCalledTimes(1);
      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg).toMatchObject({
        sessionId: 'tab_1',
        isPremium: true,
        mcpServerRunning: true,
      });
      expect(callArg.initialPrompt).toMatchObject({
        content: 'Write a spec',
      });
    });

    it('threads the AbortController from executeQuery() into StreamTransformer.transform()', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const sdkQuery = createFakeQuery();
      const abortController = new AbortController();
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery,
        initialModel: 'claude-sonnet-4-20250514',
        abortController,
      } as ExecuteQueryResult);

      await h.adapter.startChatSession(makeSessionConfig());

      expect(h.streamTransformer.transform).toHaveBeenCalledTimes(1);
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      expect(transformArg.abortController).toBe(abortController);
      expect(transformArg.sdkQuery).toBe(sdkQuery);
      expect(transformArg.sessionId).toBe('tab_1');
      expect(transformArg.initialModel).toBe('claude-sonnet-4-20250514');
      expect(transformArg.tabId).toBe('tab_1');
    });

    it('propagates errors from executeQuery() unchanged to the caller', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const failure = new Error('SDK launch failed');
      h.sessionLifecycle.executeQuery.mockRejectedValueOnce(failure);

      await expect(
        h.adapter.startChatSession(makeSessionConfig()),
      ).rejects.toBe(failure);
      expect(h.streamTransformer.transform).not.toHaveBeenCalled();
    });

    it('passes pathToClaudeCodeExecutable through when CLI js path is resolved', async () => {
      const h = makeAdapter();
      h.cliDetector.findExecutable.mockResolvedValueOnce({
        path: '/bin/claude',
        source: 'path',
        cliJsPath: '/bin/cli.js',
        useDirectExecution: false,
      } as ClaudeInstallation);
      await h.adapter.initialize();

      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      await h.adapter.startChatSession(makeSessionConfig());
      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg.pathToClaudeCodeExecutable).toBe('/bin/cli.js');
    });
  });

  describe('SdkAgentAdapter.startChatSession (mcpServersOverride threading)', () => {
    it('forwards mcpServersOverride to sessionLifecycle.executeQuery', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      const override = {
        ptah: {
          type: 'http' as const,
          url: 'http://override.example/proxy',
          headers: { 'X-Trace': 'on' },
        },
      };

      await h.adapter.startChatSession({
        ...makeSessionConfig(),
        mcpServersOverride: override,
      } as AISessionConfig & {
        tabId: string;
        mcpServersOverride: typeof override;
      });

      expect(h.sessionLifecycle.executeQuery).toHaveBeenCalledTimes(1);
      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg.mcpServersOverride).toBe(override);
    });

    it('omits mcpServersOverride when caller did not supply it', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      await h.adapter.startChatSession(makeSessionConfig());

      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg.mcpServersOverride).toBeUndefined();
    });
  });

  describe('resumeSession()', () => {
    it('throws SdkError before initialize()', async () => {
      const { adapter } = makeAdapter();
      await expect(
        adapter.resumeSession('session-uuid' as SessionId),
      ).rejects.toBeInstanceOf(SdkError);
    });

    it('returns the existing stream when the session is already active with a query', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const existingQuery = createFakeQuery();
      h.sessionLifecycle.find.mockReturnValueOnce({
        tabId: 'sess-1',
        realSessionId: null,
        query: existingQuery,
        config: {} as AISessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        permissionLevel: 'ask',
        lastActivityAt: 0,
      });

      await h.adapter.resumeSession(
        'sess-1' as SessionId,
        {
          tabId: 'tab-resume',
        } as AISessionConfig & { tabId: string },
      );

      expect(h.sessionLifecycle.executeQuery).not.toHaveBeenCalled();
      expect(h.streamTransformer.transform).toHaveBeenCalledTimes(1);
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      expect(transformArg.sdkQuery).toBe(existingQuery);
      expect(transformArg.tabId).toBe('tab-resume');
    });

    it('dispatches a new executeQuery() when no active session exists, threading AbortController through', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.sessionLifecycle.find.mockReturnValueOnce(undefined);
      const sdkQuery = createFakeQuery();
      const abortController = new AbortController();
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery,
        initialModel: 'claude-sonnet-4-20250514',
        abortController,
      } as ExecuteQueryResult);

      await h.adapter.resumeSession('sess-1' as SessionId);

      expect(h.sessionLifecycle.executeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          resumeSessionId: 'sess-1',
        }),
      );
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      expect(transformArg.abortController).toBe(abortController);
      expect(transformArg.sdkQuery).toBe(sdkQuery);
    });
  });

  describe('executeSlashCommand()', () => {
    it('throws SdkError before initialize()', async () => {
      const { adapter } = makeAdapter();
      await expect(
        adapter.executeSlashCommand('sess-1' as SessionId, '/help', {}),
      ).rejects.toBeInstanceOf(SdkError);
    });

    it('delegates to executeSlashCommandQuery and threads AbortController into the transformer', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const sdkQuery = createFakeQuery();
      const abortController = new AbortController();
      h.sessionLifecycle.executeSlashCommandQuery.mockResolvedValueOnce({
        sdkQuery,
        initialModel: 'claude-sonnet-4-20250514',
        abortController,
      } as ExecuteQueryResult);

      await h.adapter.executeSlashCommand('sess-1' as SessionId, '/help', {
        tabId: 'tab-1',
      });

      expect(h.sessionLifecycle.executeSlashCommandQuery).toHaveBeenCalledWith(
        'sess-1',
        '/help',
        expect.any(Object),
      );
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      expect(transformArg.abortController).toBe(abortController);
      expect(transformArg.sdkQuery).toBe(sdkQuery);
      expect(transformArg.tabId).toBe('tab-1');
    });
  });

  describe('callback wiring', () => {
    it('passes registered callbacks through into executeQuery() options', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const onCompact = jest.fn();
      const onWorktreeAdd = jest.fn();
      const onWorktreeRm = jest.fn();
      h.adapter.setCompactionStartCallback(onCompact);
      h.adapter.setWorktreeCreatedCallback(onWorktreeAdd);
      h.adapter.setWorktreeRemovedCallback(onWorktreeRm);

      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);
      await h.adapter.startChatSession(makeSessionConfig());

      const arg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(arg.onCompactionStart).toBe(onCompact);
      expect(arg.onWorktreeCreated).toBe(onWorktreeAdd);
      expect(arg.onWorktreeRemoved).toBe(onWorktreeRm);
    });

    it('wires onResultStats from setResultStatsCallback into StreamTransformer', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const onStats = jest.fn();
      h.adapter.setResultStatsCallback(onStats);

      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);
      await h.adapter.startChatSession(makeSessionConfig());

      const arg = h.streamTransformer.transform.mock.calls[0][0];
      expect(typeof arg.onResultStats).toBe('function');
      const fakeStats = {
        sessionId: 'sess' as unknown as SessionId,
        cost: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        duration: 0,
      };
      (arg.onResultStats as ResultStatsCallback)(fakeStats);
      expect(onStats).toHaveBeenCalledWith(fakeStats);
    });
  });

  describe('dispose()', () => {
    it('emits disposed on the events bus, clears auth, and clears the model cache', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const disposedListener = jest.fn();
      h.events.onDisposed(disposedListener);

      h.adapter.dispose();

      expect(disposedListener).toHaveBeenCalledTimes(1);
      expect(h.sessionLifecycle.disposeAllSessions).toHaveBeenCalled();
      expect(h.authManager.clearAuthentication).toHaveBeenCalled();
      expect(h.modelService.clearCache).toHaveBeenCalled();
      expect(h.adapter.getCliJsPath()).toBeNull();
    });
  });

  describe('preloadSdk()', () => {
    it('delegates to the SdkModuleLoader', async () => {
      const h = makeAdapter();
      await h.adapter.preloadSdk();
      expect(h.moduleLoader.preload).toHaveBeenCalledTimes(1);
    });
  });

  describe('forkSession() facade', () => {
    it('throws SdkError before initialize()', async () => {
      const h = makeAdapter();
      await expect(
        h.adapter.forkSession('src' as SessionId),
      ).rejects.toBeInstanceOf(SdkError);
      expect(h.forkService.forkSession).not.toHaveBeenCalled();
    });

    it('delegates to SessionForkService.forkSession with the same params', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      h.forkService.forkSession.mockResolvedValueOnce({
        sessionId: 'forked-uuid-123',
      });

      const result = await h.adapter.forkSession(
        'source-uuid' as SessionId,
        'msg-uuid-50',
        'My Fork',
      );

      expect(result).toEqual({ sessionId: 'forked-uuid-123' });
      expect(h.forkService.forkSession).toHaveBeenCalledWith({
        sessionId: 'source-uuid',
        upToMessageId: 'msg-uuid-50',
        title: 'My Fork',
      });
    });
  });

  describe('rewindFiles() facade', () => {
    it('throws SdkError before initialize()', async () => {
      const h = makeAdapter();
      await expect(
        h.adapter.rewindFiles('s' as SessionId, 'msg-1'),
      ).rejects.toBeInstanceOf(SdkError);
      expect(h.forkService.rewindFiles).not.toHaveBeenCalled();
    });

    it('delegates to SessionForkService.rewindFiles with the same params', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.forkService.rewindFiles.mockResolvedValueOnce({
        canRewind: true,
        filesChanged: ['/a.ts'],
        insertions: 1,
        deletions: 0,
      });

      const result = await h.adapter.rewindFiles(
        'live' as SessionId,
        'msg-1',
        true,
      );

      expect(result.canRewind).toBe(true);
      expect(h.forkService.rewindFiles).toHaveBeenCalledWith({
        sessionId: 'live',
        userMessageId: 'msg-1',
        dryRun: true,
      });
    });
  });

  describe('includePartialMessages passthrough', () => {
    it('forwards includePartialMessages=false from startChatSession config to executeQuery', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      const cfg = {
        ...makeSessionConfig(),
        includePartialMessages: false,
      } as AISessionConfig & { tabId: string; includePartialMessages: boolean };
      await h.adapter.startChatSession(cfg);

      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg.includePartialMessages).toBe(false);
    });

    it('forwards includePartialMessages=true from startChatSession config to executeQuery', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      const cfg = {
        ...makeSessionConfig(),
        includePartialMessages: true,
      } as AISessionConfig & { tabId: string; includePartialMessages: boolean };
      await h.adapter.startChatSession(cfg);

      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg.includePartialMessages).toBe(true);
    });

    it('leaves includePartialMessages undefined when caller does not specify it (preserves SDK-layer default)', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      await h.adapter.startChatSession(makeSessionConfig());

      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg.includePartialMessages).toBeUndefined();
    });

    it('forwards includePartialMessages from resumeSession config to executeQuery', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      h.sessionLifecycle.find.mockReturnValueOnce(undefined);
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      await h.adapter.resumeSession(
        'sess-1' as SessionId,
        {
          tabId: 'tab-r',
          includePartialMessages: false,
        } as AISessionConfig & {
          tabId: string;
          includePartialMessages: boolean;
        },
      );

      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg.includePartialMessages).toBe(false);
    });
  });
});
