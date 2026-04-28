/**
 * SdkAgentAdapter — unit specs (TASK_2025_294 W3.B4).
 *
 * Surface under test:
 *   - Query dispatch: startChatSession() and resumeSession() MUST delegate
 *     to SessionLifecycleManager.executeQuery() and then hand the returned
 *     sdkQuery off to StreamTransformer.transform() with the *same*
 *     AbortController threaded through. The adapter is a thin orchestration
 *     layer — it owns callback wiring, nothing else.
 *   - AbortSignal propagation: the AbortController returned by executeQuery()
 *     MUST flow unchanged into StreamTransformer.transform(). Losing this
 *     coupling would mean UI cancellations (user hits Stop) can't reach the
 *     underlying SDK query.
 *   - Error propagation: calls into query paths before initialize() MUST
 *     throw SdkError (never a generic Error) so RPC handlers can classify
 *     the failure correctly. Downstream errors from executeQuery() MUST
 *     bubble up unchanged.
 *   - Initialization flow: registers a config watcher BEFORE auth
 *     configuration, so token changes are still detected when auth fails;
 *     falls back to bundled cli.js when the CLI detector returns null;
 *     persists the default model on first init.
 *
 * Mocking posture:
 *   - `fs.existsSync` and `../helpers/sdk-module-loader` are mocked at the
 *     module level so the adapter runs in full isolation.
 *   - All DI collaborators are constructed directly as `jest.Mocked<T>`
 *     (NO tsyringe container), matching the pattern used in
 *     `copilot-auth.service.spec.ts`.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Module mocks — MUST precede source imports so ts-jest hoists them above.
// ---------------------------------------------------------------------------

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
  };
});

// Mock the SdkModuleLoader module — the adapter is wired with a constructor
// injection but downstream services (InternalQueryService) also reach into
// this module. Mocking it here prevents accidental real imports when other
// specs share the module registry.
jest.mock('./helpers/sdk-module-loader', () => ({
  SdkModuleLoader: jest.fn(),
}));

// Mock the SDK's standalone forkSession export so adapter.forkSession() can
// be unit-tested without the real SDK. The mock factory returns a jest.fn()
// for `forkSession`; tests grab the reference via `getMockedForkSession()`.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  forkSession: jest.fn(),
  startup: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdkModuleMock = require('@anthropic-ai/claude-agent-sdk') as {
  forkSession: jest.Mock;
  startup: jest.Mock;
};
function getMockedForkSession(): jest.Mock {
  return sdkModuleMock.forkSession;
}
function getMockedStartup(): jest.Mock {
  return sdkModuleMock.startup;
}

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
} from '@ptah-extension/platform-core';

import { SdkAgentAdapter } from './sdk-agent-adapter';
import { SdkError } from './errors';
import type { SessionMetadataStore } from './session-metadata-store';
import type {
  AuthManager,
  SessionLifecycleManager,
  ConfigWatcher,
  StreamTransformer,
  SdkModuleLoader,
  SdkModelService,
  ExecuteQueryResult,
  Query,
} from './helpers';
import type {
  ClaudeCliDetector,
  ClaudeInstallation,
} from './detector/claude-cli-detector';
import type { SDKMessage } from './types/sdk-types/claude-sdk.types';

// ---------------------------------------------------------------------------
// Typed bridges — production classes have private fields so a structural
// duck-type match fails nominal typing. We cast at the module handle only.
// ---------------------------------------------------------------------------

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Dependency factories — each returns a `jest.Mocked<T>`-shaped stub with
// sensible defaults so individual specs only override what they care about.
// ---------------------------------------------------------------------------

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
  return {
    captureException: jest.fn(),
  };
}

function createMockAuthManager(): jest.Mocked<
  Pick<AuthManager, 'configureAuthentication' | 'clearAuthentication'>
> {
  return {
    configureAuthentication: jest.fn().mockResolvedValue({
      configured: true,
      details: [],
      errorMessage: undefined,
    }),
    clearAuthentication: jest.fn(),
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

function createMockConfigWatcher(): jest.Mocked<
  Pick<ConfigWatcher, 'registerWatchers' | 'dispose'>
> {
  return {
    registerWatchers: jest.fn(),
    dispose: jest.fn(),
  };
}

function createMockMetadataStore(): jest.Mocked<
  Pick<SessionMetadataStore, 'create' | 'touch'>
> {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    touch: jest.fn().mockResolvedValue(undefined),
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
    | 'endSession'
    | 'getActiveSession'
    | 'resolveRealSessionId'
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
    endSession: jest.fn().mockResolvedValue(undefined),
    getActiveSession: jest.fn().mockReturnValue(undefined),
    resolveRealSessionId: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    interruptCurrentTurn: jest.fn().mockResolvedValue(true),
    setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
    setSessionModel: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockStreamTransformer(): jest.Mocked<
  Pick<StreamTransformer, 'transform'>
> {
  // Typed as a jest.Mock matching StreamTransformer.transform(config) —
  // default implementation returns an empty fake async iterable.
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

// ---------------------------------------------------------------------------
// Fake Query object — satisfies the Query interface for use as sdkQuery in
// executeQuery() results. None of its methods are exercised by the adapter
// path; they exist only so StreamTransformer.transform() receives the exact
// reference passed in.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Harness — creates a fresh adapter wired up with all mocks so each spec is
// hermetic.
// ---------------------------------------------------------------------------

interface AdapterHarness {
  adapter: SdkAgentAdapter;
  logger: MockLogger;
  config: MockConfigManager;
  sentry: ReturnType<typeof createMockSentry>;
  metadataStore: ReturnType<typeof createMockMetadataStore>;
  authManager: ReturnType<typeof createMockAuthManager>;
  sessionLifecycle: ReturnType<typeof createMockSessionLifecycle>;
  configWatcher: ReturnType<typeof createMockConfigWatcher>;
  cliDetector: ReturnType<typeof createMockCliDetector>;
  streamTransformer: ReturnType<typeof createMockStreamTransformer>;
  moduleLoader: ReturnType<typeof createMockModuleLoader>;
  modelService: ReturnType<typeof createMockModelService>;
  platformInfo: IPlatformInfo;
}

function makeAdapter(
  options: {
    config?: Record<string, unknown>;
    platformInfo?: Partial<IPlatformInfo>;
  } = {},
): AdapterHarness {
  const logger = createMockLogger();
  const config = createMockConfigManager(options.config);
  const sentry = createMockSentry();
  const metadataStore = createMockMetadataStore();
  const authManager = createMockAuthManager();
  const sessionLifecycle = createMockSessionLifecycle();
  const configWatcher = createMockConfigWatcher();
  const cliDetector = createMockCliDetector();
  const streamTransformer = createMockStreamTransformer();
  const moduleLoader = createMockModuleLoader();
  const modelService = createMockModelService();
  const platformInfo = createMockPlatformInfo(options.platformInfo);

  const adapter = new SdkAgentAdapter(
    asLogger(logger),
    config as unknown as ConfigManager,
    metadataStore as unknown as SessionMetadataStore,
    authManager as unknown as AuthManager,
    sessionLifecycle as unknown as SessionLifecycleManager,
    configWatcher as unknown as ConfigWatcher,
    cliDetector as unknown as ClaudeCliDetector,
    streamTransformer as unknown as StreamTransformer,
    moduleLoader as unknown as SdkModuleLoader,
    modelService as unknown as SdkModelService,
    platformInfo,
    sentry as unknown as SentryService,
  );

  return {
    adapter,
    logger,
    config,
    sentry,
    metadataStore,
    authManager,
    sessionLifecycle,
    configWatcher,
    cliDetector,
    streamTransformer,
    moduleLoader,
    modelService,
    platformInfo,
  };
}

// Build a minimal AISessionConfig + tabId. projectPath is required by the
// chat-session path; other fields default to reasonable empties.
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

  // -------------------------------------------------------------------------
  // initialize()
  // -------------------------------------------------------------------------

  describe('initialize()', () => {
    it('registers config watchers BEFORE attempting authentication', async () => {
      const h = makeAdapter();
      let registeredBeforeAuth = false;
      h.configWatcher.registerWatchers.mockImplementationOnce(() => {
        // If auth has not been called yet, we're in the expected ordering.
        registeredBeforeAuth =
          h.authManager.configureAuthentication.mock.calls.length === 0;
      });

      await h.adapter.initialize();
      expect(registeredBeforeAuth).toBe(true);
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

      // path.join is OS-specific (backslashes on Windows, forward slashes
      // elsewhere) so match on the filename rather than an exact string.
      expect(h.adapter.getCliJsPath()).toEqual(
        expect.stringContaining('cli.js'),
      );
      // Verify the bundled-fallback branch was taken.
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
  });

  // -------------------------------------------------------------------------
  // startChatSession()
  // -------------------------------------------------------------------------

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
      // CRITICAL: the same AbortController instance must flow through so UI
      // cancellations reach the underlying SDK query.
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
      // StreamTransformer MUST NOT be reached when the query fails.
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

  // -------------------------------------------------------------------------
  // resumeSession()
  // -------------------------------------------------------------------------

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
      h.sessionLifecycle.getActiveSession.mockReturnValueOnce({
        sessionId: 'sess-1' as SessionId,
        query: existingQuery,
        config: {} as AISessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
      });

      await h.adapter.resumeSession(
        'sess-1' as SessionId,
        {
          tabId: 'tab-resume',
        } as AISessionConfig & { tabId: string },
      );

      // executeQuery is NOT called when a live session already exists.
      expect(h.sessionLifecycle.executeQuery).not.toHaveBeenCalled();
      expect(h.streamTransformer.transform).toHaveBeenCalledTimes(1);
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      expect(transformArg.sdkQuery).toBe(existingQuery);
      expect(transformArg.tabId).toBe('tab-resume');
    });

    it('dispatches a new executeQuery() when no active session exists, threading AbortController through', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.sessionLifecycle.getActiveSession.mockReturnValueOnce(undefined);
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

  // -------------------------------------------------------------------------
  // executeSlashCommand()
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Callback wiring
  // -------------------------------------------------------------------------

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
      expect(arg.onResultStats).toBe(onStats);
    });
  });

  // -------------------------------------------------------------------------
  // dispose() / reset()
  // -------------------------------------------------------------------------

  describe('dispose()', () => {
    it('disposes config watcher, clears auth, and clears the model cache', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.adapter.dispose();

      expect(h.configWatcher.dispose).toHaveBeenCalled();
      expect(h.sessionLifecycle.disposeAllSessions).toHaveBeenCalled();
      expect(h.authManager.clearAuthentication).toHaveBeenCalled();
      expect(h.modelService.clearCache).toHaveBeenCalled();
      expect(h.adapter.getCliJsPath()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // preloadSdk() — delegates to moduleLoader
  // -------------------------------------------------------------------------

  describe('preloadSdk()', () => {
    it('delegates to the SdkModuleLoader', async () => {
      const h = makeAdapter();
      await h.adapter.preloadSdk();
      expect(h.moduleLoader.preload).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // forkSession() — calls SDK's standalone forkSession export
  // -------------------------------------------------------------------------

  describe('forkSession()', () => {
    beforeEach(() => {
      getMockedForkSession().mockReset();
    });

    it('throws SdkError if not initialized', async () => {
      const h = makeAdapter();
      await expect(
        h.adapter.forkSession('source-id' as SessionId),
      ).rejects.toBeInstanceOf(SdkError);
      expect(getMockedForkSession()).not.toHaveBeenCalled();
    });

    it('delegates to SDK forkSession with upToMessageId and title', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      getMockedForkSession().mockResolvedValueOnce({
        sessionId: 'forked-uuid-123',
      });

      const result = await h.adapter.forkSession(
        'source-uuid' as SessionId,
        'msg-uuid-50',
        'My Fork',
      );

      expect(result).toEqual({ sessionId: 'forked-uuid-123' });
      expect(getMockedForkSession()).toHaveBeenCalledTimes(1);
      expect(getMockedForkSession()).toHaveBeenCalledWith('source-uuid', {
        upToMessageId: 'msg-uuid-50',
        title: 'My Fork',
      });
    });

    it('passes undefined upToMessageId/title when omitted (full copy)', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      getMockedForkSession().mockResolvedValueOnce({ sessionId: 'fork-2' });

      await h.adapter.forkSession('src' as SessionId);

      expect(getMockedForkSession()).toHaveBeenCalledWith('src', {
        upToMessageId: undefined,
        title: undefined,
      });
    });

    it('wraps SDK errors as SdkError with context and reports to Sentry', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      getMockedForkSession().mockRejectedValueOnce(
        new Error('boom: source not found'),
      );

      await expect(
        h.adapter.forkSession('src' as SessionId),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Failed to fork session src'),
      });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'SdkAgentAdapter.forkSession',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // rewindFiles() — delegates to active Query handle
  // -------------------------------------------------------------------------

  describe('rewindFiles()', () => {
    it('throws SdkError if not initialized', async () => {
      const h = makeAdapter();
      await expect(
        h.adapter.rewindFiles('s' as SessionId, 'msg-1'),
      ).rejects.toBeInstanceOf(SdkError);
    });

    it('throws SdkError when the session has no live Query handle', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      // Default getActiveSession returns undefined → no live query.
      h.sessionLifecycle.getActiveSession.mockReturnValueOnce(undefined);

      await expect(
        h.adapter.rewindFiles('dead-session' as SessionId, 'msg-1'),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          'session dead-session is not active or has no live Query handle',
        ),
      });
    });

    it('throws SdkError when session exists but query is null (pre-registered)', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.sessionLifecycle.getActiveSession.mockReturnValueOnce({
        sessionId: 'preregistered' as SessionId,
        query: null,
        config: makeSessionConfig(),
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(
        h.adapter.rewindFiles('preregistered' as SessionId, 'msg-1'),
      ).rejects.toBeInstanceOf(SdkError);
    });

    it('delegates to query.rewindFiles with userMessageId and dryRun', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const fakeQuery = createFakeQuery();
      const rewindMock = fakeQuery.rewindFiles as jest.Mock;
      rewindMock.mockResolvedValueOnce({
        canRewind: true,
        filesChanged: ['/a.ts', '/b.ts'],
        insertions: 12,
        deletions: 3,
      });

      h.sessionLifecycle.getActiveSession.mockReturnValueOnce({
        sessionId: 'live' as SessionId,
        query: fakeQuery,
        config: makeSessionConfig(),
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await h.adapter.rewindFiles(
        'live' as SessionId,
        'user-msg-uuid',
        true,
      );

      expect(rewindMock).toHaveBeenCalledTimes(1);
      expect(rewindMock).toHaveBeenCalledWith('user-msg-uuid', {
        dryRun: true,
      });
      expect(result.canRewind).toBe(true);
      expect(result.filesChanged).toEqual(['/a.ts', '/b.ts']);
      expect(result.insertions).toBe(12);
      expect(result.deletions).toBe(3);
    });

    it('wraps SDK errors as SdkError with context and reports to Sentry', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const fakeQuery = createFakeQuery();
      (fakeQuery.rewindFiles as jest.Mock).mockRejectedValueOnce(
        new Error('checkpointing not enabled'),
      );

      h.sessionLifecycle.getActiveSession.mockReturnValueOnce({
        sessionId: 'live' as SessionId,
        query: fakeQuery,
        config: makeSessionConfig(),
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        currentModel: 'claude-sonnet-4-20250514',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await expect(
        h.adapter.rewindFiles('live' as SessionId, 'msg'),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Failed to rewind files'),
      });
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'SdkAgentAdapter.rewindFiles',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // prewarm() — SDK startup() pre-warm with idempotency + silent failure
  // -------------------------------------------------------------------------

  describe('prewarm()', () => {
    beforeEach(() => {
      getMockedStartup().mockReset();
    });

    it('invokes SDK startup() once and closes the WarmQuery', async () => {
      const h = makeAdapter();
      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close });

      await h.adapter.prewarm();

      expect(getMockedStartup()).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — second call is a no-op (does not call startup() again)', async () => {
      const h = makeAdapter();
      getMockedStartup().mockResolvedValue({ close: jest.fn() });

      await h.adapter.prewarm();
      await h.adapter.prewarm();
      await h.adapter.prewarm();

      expect(getMockedStartup()).toHaveBeenCalledTimes(1);
    });

    it('swallows startup() failures with logger.warn — never throws upward', async () => {
      const h = makeAdapter();
      const failure = new Error('subprocess spawn failed');
      getMockedStartup().mockRejectedValueOnce(failure);

      await expect(h.adapter.prewarm()).resolves.toBeUndefined();

      // Logger.warn called — message is redacted/short form (Error name + sanitized message).
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SDK prewarm failed'),
      );
      // Sentry MUST NOT be invoked — prewarm is best-effort.
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('allows retry on failure — does not mark prewarmed when startup() rejects', async () => {
      const h = makeAdapter();
      getMockedStartup()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ close: jest.fn() });

      await h.adapter.prewarm();
      await h.adapter.prewarm();

      // Both calls execute — the failed first call must NOT block the retry.
      expect(getMockedStartup()).toHaveBeenCalledTimes(2);
    });

    it('passes pathToClaudeCodeExecutable into startup() options when CLI js path is resolved', async () => {
      const h = makeAdapter();
      h.cliDetector.findExecutable.mockResolvedValueOnce({
        path: '/bin/claude',
        source: 'path',
        cliJsPath: '/bin/cli.js',
        useDirectExecution: false,
      } as ClaudeInstallation);
      await h.adapter.initialize();

      const close = jest.fn();
      getMockedStartup().mockResolvedValueOnce({ close });

      await h.adapter.prewarm();

      expect(getMockedStartup()).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            pathToClaudeCodeExecutable: '/bin/cli.js',
          }),
        }),
      );
    });

    it('does not throw when WarmQuery.close() throws — logs warn and continues', async () => {
      const h = makeAdapter();
      const closeError = new Error('close failed');
      getMockedStartup().mockResolvedValueOnce({
        close: () => {
          throw closeError;
        },
      });

      await expect(h.adapter.prewarm()).resolves.toBeUndefined();
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('WarmQuery.close()'),
        closeError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // includePartialMessages — RPC opt-in passthrough
  // -------------------------------------------------------------------------

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
      h.sessionLifecycle.getActiveSession.mockReturnValueOnce(undefined);
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
