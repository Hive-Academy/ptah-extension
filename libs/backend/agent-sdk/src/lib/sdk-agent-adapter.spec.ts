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
import {
  SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
} from './helpers/session-id-resolved-callback-registry';
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
import { NoActivityWatchdog } from './helpers';
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
    | 'invalidateForAuthChange'
    | 'resolveModelId'
  >
> {
  return {
    getSupportedModels: jest.fn().mockResolvedValue([]),
    getDefaultModel: jest.fn().mockResolvedValue('claude-sonnet-4-20250514'),
    getApiModelsNormalized: jest.fn().mockResolvedValue([]),
    clearCache: jest.fn(),
    invalidateForAuthChange: jest.fn(),
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
    | 'markTurnEnded'
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
    markTurnEnded: jest.fn().mockReturnValue(true),
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

/**
 * `IWorkspaceProvider` stand-in with a MUTABLE folder list.
 *
 * `onDidChangeWorkspaceFolders` captures its listener — the adapter subscribes
 * from its constructor — and `__state.setFolders` mutates the list BEFORE
 * firing, which is the real contract: `ElectronWorkspaceProvider.removeFolder`
 * splices and only then calls `fireFoldersChange`, so a handler always observes
 * the POST-change folder list. A mock that fired first would let the
 * no-workspace guard pass on a stale count and silently pass the specs below.
 */
type MockWorkspaceProvider = jest.Mocked<IWorkspaceProvider> & {
  __state: { setFolders(folders: string[]): void };
};

function createMockWorkspaceProvider(
  root: string | null = '/fake/workspace-root',
): MockWorkspaceProvider {
  let folders: string[] = root ? [root] : [];
  const listeners: Array<() => void> = [];

  return {
    getWorkspaceRoot: jest.fn(() => folders[0]),
    getWorkspaceFolders: jest.fn(() => [...folders]),
    getConfiguration: jest.fn(<T>(_: string, __: string, def?: T) => def),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeWorkspaceFolders: jest.fn((listener: () => void) => {
      listeners.push(listener);
      return { dispose: jest.fn() };
    }),
    __state: {
      setFolders(next: string[]): void {
        folders = [...next];
        for (const listener of [...listeners]) {
          listener();
        }
      },
    },
  } as unknown as MockWorkspaceProvider;
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
  workspaceProvider: MockWorkspaceProvider;
  forkService: ReturnType<typeof createMockForkService>;
  events: SdkAdapterEvents;
  activityRegistry: SessionActivityRegistry;
  sessionIdResolvedRegistry: SessionIdResolvedCallbackRegistry;
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
  const sessionIdResolvedRegistry = new SessionIdResolvedCallbackRegistry(
    asLogger(logger),
  );

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
    sessionIdResolvedRegistry,
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
    activityRegistry,
    sessionIdResolvedRegistry,
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

/** The auth result shape the adapter awaits, taken from the port itself. */
type AuthConfigureResult = Awaited<
  ReturnType<IAuthEnvProvider['configureAuthentication']>
>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * A promise settled by hand.
 *
 * Every interleaving spec in this file is built on one: gating
 * `configureAuthentication` freezes an `initialize()` pass at a known point,
 * so the concurrent calls under test can be lined up before anything settles.
 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  // TASK_2026_306 Defect G — `initialize()` had no in-flight guard of any kind.
  // `initialized` is only assigned AFTER `configureAuthentication` and
  // `findExecutable()` have both returned, so the whole expensive window was
  // re-entrant. The boot OAuth token refresh writes `~/.codex/auth.json` while
  // the first pass is running, so the adapter raced itself on every cold start
  // with an expired token: `Initializing SDK adapter...` and `Detecting Claude
  // CLI installation...` each appeared twice.
  //
  // Shape mirrored from `AuthManager.configureAuthentication` — which is why
  // only the AUTH half of that race was already de-duplicated.
  describe('initialize() in-flight guard (TASK_2026_306)', () => {
    function countInfoLines(h: AdapterHarness, fragment: string): number {
      return (h.logger.info as jest.Mock).mock.calls.filter(
        ([message]: [unknown]) =>
          typeof message === 'string' && message.includes(fragment),
      ).length;
    }

    it('collapses two concurrent calls into one pass, resolving both to the same result', async () => {
      const h = makeAdapter();
      const gate = deferred<AuthConfigureResult>();
      h.authManager.configureAuthentication.mockReturnValueOnce(gate.promise);

      const first = h.adapter.initialize();
      const second = h.adapter.initialize();

      gate.resolve({ configured: true, details: [] });
      const [a, b] = await Promise.all([first, second]);

      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(1);
      expect(h.cliDetector.findExecutable).toHaveBeenCalledTimes(1);
      // The two doubled lines from the captured boot log.
      expect(countInfoLines(h, 'Initializing SDK adapter')).toBe(1);
      expect(countInfoLines(h, 'Detecting Claude CLI installation')).toBe(1);
    });

    it('is a concurrency guard, not a memo — sequential calls each run a real pass', async () => {
      const h = makeAdapter();

      await h.adapter.initialize();
      await h.adapter.initialize();

      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(2);
      expect(h.cliDetector.findExecutable).toHaveBeenCalledTimes(2);
    });

    it('does not latch after a failed pass — the guard is cleared in a finally', async () => {
      const h = makeAdapter();
      h.authManager.configureAuthentication.mockRejectedValueOnce(
        new Error('auth exploded'),
      );

      await expect(h.adapter.initialize()).resolves.toBe(false);
      // A `then`-cleared guard would hold the rejected promise forever and
      // every later caller would inherit the failure.
      await expect(h.adapter.initialize()).resolves.toBe(true);
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(2);
      expect(h.adapter.getHealth().status).toBe('available');
    });

    it('reset() still forces a genuine re-init even when a pass is in flight', async () => {
      const h = makeAdapter();
      const gate = deferred<AuthConfigureResult>();
      h.authManager.configureAuthentication.mockReturnValueOnce(gate.promise);

      const first = h.adapter.initialize();
      const resetting = h.adapter.reset();

      gate.resolve({ configured: true, details: [] });
      await first;
      await resetting;

      // Two real passes: the in-flight one, then the reset's own. A reset
      // answered by the guard would leave the adapter on pre-reset state.
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(2);
      expect(h.authManager.clearAuthentication).toHaveBeenCalledTimes(1);
      expect(h.cliDetector.findExecutable).toHaveBeenCalledTimes(2);
      expect(h.adapter.getHealth().status).toBe('available');
    });
  });

  // TASK_2026_308 F3-2 — `initialize`'s `finally` cleared `initInFlight`
  // unconditionally.
  //
  // HONEST NOTE ON REACHABILITY. There is no PUBLIC call sequence that puts a
  // foreign promise in the slot while a pass is in flight: the only writer is
  // `initialize` itself, and it writes only when the slot is null, so the
  // guard hands every concurrent caller the running pass instead of installing
  // a second one. That is precisely the defect — the invariant "a pass only
  // ever clears itself" is a property of microtask FIFO ordering plus the
  // current set of writers, not of the method. The second spec below therefore
  // drives the interleaving by writing the private slot directly. It is
  // white-box on purpose: it pins the invariant the identity check makes
  // local, which is the whole point of the change, and it goes red the instant
  // the check is removed.
  describe('initInFlight identity on clear (TASK_2026_308 F3-2)', () => {
    interface InitSlot {
      initInFlight: Promise<boolean> | null;
    }

    function slotOf(adapter: SdkAgentAdapter): InitSlot {
      return adapter as unknown as InitSlot;
    }

    it('clears the slot when it still holds its own settled pass', async () => {
      const h = makeAdapter();

      await h.adapter.initialize();

      // The half the identity check must NOT break: a normal pass still
      // releases the slot, so the next sequential call runs a real pass.
      expect(slotOf(h.adapter).initInFlight).toBeNull();
    });

    it('leaves a slot that no longer holds its own pass untouched', async () => {
      const h = makeAdapter();
      const gate = deferred<AuthConfigureResult>();
      h.authManager.configureAuthentication.mockReturnValueOnce(gate.promise);

      const first = h.adapter.initialize();
      const slot = slotOf(h.adapter);
      expect(slot.initInFlight).not.toBeNull();

      // The interleaving: while the first pass is parked on the gate, the slot
      // comes to hold somebody else's promise. An unconditional clear in the
      // `finally` destroys it and every later caller starts a duplicate pass
      // against a run that is still going.
      const foreign = Promise.resolve(true);
      slot.initInFlight = foreign;

      gate.resolve({ configured: true, details: [] });
      await expect(first).resolves.toBe(true);

      expect(slot.initInFlight).toBe(foreign);
    });
  });

  // TASK_2026_308 F3-3 — two concurrent resets broke `reset`'s own contract.
  //
  // `doReset` waits out an in-flight pass so a reset can never be ANSWERED by
  // the `initialize` guard. Two resets awaiting the SAME pass both proceed,
  // both `dispose()`, and the second's `initialize()` is then answered by the
  // guard holding the FIRST reset's fresh pass — the forbidden outcome,
  // reached from the other side. The second reset also disposed the adapter
  // while the pass it was about to be handed was still building it.
  describe('concurrent reset() serialisation (TASK_2026_308 F3-3)', () => {
    /**
     * The adapter's teardown/bring-up events in the order they really happened.
     *
     * `configureAuthentication` is called once per init pass and
     * `clearAuthentication` once per `dispose()`, both on the same mock object,
     * so jest's globally increasing `invocationCallOrder` interleaves them into
     * a single trace. That trace IS the contract: every `dispose` must be
     * followed by an `init` of its own before its caller returns.
     */
    function lifecycleTrace(h: AdapterHarness): string[] {
      const events: Array<{ order: number; label: string }> = [];
      for (const order of h.authManager.configureAuthentication.mock
        .invocationCallOrder) {
        events.push({ order, label: 'init' });
      }
      for (const order of h.authManager.clearAuthentication.mock
        .invocationCallOrder) {
        events.push({ order, label: 'dispose' });
      }
      return events
        .sort((a, b) => a.order - b.order)
        .map((event) => event.label);
    }

    it('gives each of two concurrent resets its own dispose and its own fresh pass', async () => {
      const h = makeAdapter();
      const gate = deferred<AuthConfigureResult>();
      h.authManager.configureAuthentication.mockReturnValueOnce(gate.promise);

      // Both resets see the SAME in-flight pass and both park on it. That is
      // the interleaving; nothing here depends on timing beyond the gate.
      const first = h.adapter.initialize();
      const resetA = h.adapter.reset();
      const resetB = h.adapter.reset();

      gate.resolve({ configured: true, details: [] });
      await Promise.all([first, resetA, resetB]);

      // Before the fix this was ['init', 'dispose', 'init', 'dispose'] — reset
      // B disposed and was then handed reset A's pass by the guard, so its own
      // init never happened and the trailing `dispose` was never answered.
      expect(lifecycleTrace(h)).toEqual([
        'init',
        'dispose',
        'init',
        'dispose',
        'init',
      ]);
      // Three real passes: the original, then one per reset.
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(3);
      expect(h.authManager.clearAuthentication).toHaveBeenCalledTimes(2);
      expect(h.adapter.getHealth().status).toBe('available');
    });

    // Not a reproduction of the defect — a guard on the mechanism that fixes
    // it. The chain is a promise every later reset awaits, so without the
    // `previous.catch(...)` inside it one failing reset would reject every
    // reset queued behind it forever after. Remove that `catch` and this spec
    // goes red.
    it('does not wedge the chain when the reset ahead of it fails', async () => {
      const h = makeAdapter();
      h.authManager.clearAuthentication.mockImplementationOnce(() => {
        throw new Error('teardown exploded');
      });

      const resetA = h.adapter.reset();
      const resetB = h.adapter.reset();

      await expect(resetA).rejects.toThrow('teardown exploded');
      await expect(resetB).resolves.toBeUndefined();

      // A died inside its dispose and never initialized. B still ran its own
      // dispose and its own pass.
      expect(lifecycleTrace(h)).toEqual(['dispose', 'dispose', 'init']);
      expect(h.adapter.getHealth().status).toBe('available');
    });
  });

  // TASK_2026_315 finding A1 — removing the LAST workspace folder started an
  // OAuth proxy.
  //
  // `handleWorkspaceChanged` guarded only on `initialized`. With zero folders
  // open `resolveActiveAuth()` has no workspace scope to read and falls through
  // to the GLOBAL default provider, which differs from the workspace-scoped one
  // that was active. The differing pair defeated the equality early-return in
  // `reconfigureAuthIfChanged`, so a full reconfigure ran: an OAuth token
  // refresh was burned and a translation proxy bound on 127.0.0.1 under the
  // GLOBAL scope, where the `disposeForScope(path)` in `workspace:removeFolder`
  // could not reach it. Nothing threw; a socket just stayed open for the rest
  // of the session. Only a test stops that recurring.
  describe('no-workspace guard on folder change (TASK_2026_315 A1)', () => {
    /** Let the fire-and-forget reconfigure chain settle before asserting. */
    function flush(): Promise<void> {
      return new Promise<void>((resolve) => setImmediate(resolve));
    }

    /**
     * What `ActiveProviderResolver.resolveActiveAuth` returns once there is no
     * workspace scope left to read: the global default, `openai-codex` in the
     * captured log, against an `apiKey`/`anthropic` session.
     */
    function resolveToGlobalDefault(h: AdapterHarness): void {
      h.authManager.resolveActiveAuth.mockReturnValue({
        authMethod: 'thirdParty',
        providerId: 'openai-codex',
      });
    }

    it('does not reconfigure auth when the last workspace folder is removed', async () => {
      const h = makeAdapter({ workspaceRoot: '/ws/a' });
      await h.adapter.initialize();
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(1);

      resolveToGlobalDefault(h);
      h.workspaceProvider.__state.setFolders([]);
      await flush();

      // The whole finding in one assertion: no second configure means no OAuth
      // refresh and no proxy bind on the way to zero folders.
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(1);
      // And the provider-keyed caches stay warm — see decision note (b).
      expect(h.cliDetector.clearCache).not.toHaveBeenCalled();
      expect(h.modelService.clearCache).not.toHaveBeenCalled();
      expect(h.modelService.invalidateForAuthChange).not.toHaveBeenCalled();
    });

    // Companion positive case: the guard must not be widened into a regression
    // that freezes auth across a GENUINE switch.
    it('still reconfigures on a switch from folder A to folder B with a different provider', async () => {
      const h = makeAdapter({ workspaceRoot: '/ws/a' });
      await h.adapter.initialize();
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(1);

      h.authManager.resolveActiveAuth.mockReturnValue({
        authMethod: 'thirdParty',
        providerId: 'ollama-cloud',
      });
      h.workspaceProvider.__state.setFolders(['/ws/b']);
      await flush();

      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(2);
      expect(h.cliDetector.clearCache).toHaveBeenCalledTimes(1);
      // SCOPED, not blanket (judge round 1, TASK_2026_353). The model catalogs
      // are keyed per auth identity, so the incoming provider cannot read the
      // outgoing one's list; wiping them would only make the switch BACK pay
      // another multi-second SDK-bridge spawn.
      expect(h.modelService.invalidateForAuthChange).toHaveBeenCalledTimes(1);
      expect(h.modelService.clearCache).not.toHaveBeenCalled();
    });

    // Pins decision note (a): FREEZING rather than tearing down keeps
    // `lastConfiguredAuth` an accurate record of what the auth env holds, so
    // re-adding a folder that resolves to the SAME provider is correctly a
    // no-op. A teardown variant would have nulled it and reconfigured here —
    // the same OAuth refresh, merely deferred.
    it('re-adding a folder with the same provider does not reconfigure', async () => {
      const h = makeAdapter({ workspaceRoot: '/ws/a' });
      await h.adapter.initialize();

      resolveToGlobalDefault(h);
      h.workspaceProvider.__state.setFolders([]);
      await flush();

      h.authManager.resolveActiveAuth.mockReturnValue({
        authMethod: 'apiKey',
        providerId: 'anthropic',
      });
      h.workspaceProvider.__state.setFolders(['/ws/a']);
      await flush();

      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(1);
    });

    // Pins decision note (a), other half: the frozen record does not suppress a
    // real change. A folder re-added with a DIFFERENT provider reconfigures.
    it('re-adding a folder with a different provider reconfigures', async () => {
      const h = makeAdapter({ workspaceRoot: '/ws/a' });
      await h.adapter.initialize();

      resolveToGlobalDefault(h);
      h.workspaceProvider.__state.setFolders([]);
      await flush();
      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(1);

      h.workspaceProvider.__state.setFolders(['/ws/b']);
      await flush();

      expect(h.authManager.configureAuthentication).toHaveBeenCalledTimes(2);
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
      } as AISessionConfig & {
        tabId: string;
        prompt: string;
      };
      await h.adapter.startChatSession(cfg);

      expect(h.sessionLifecycle.executeQuery).toHaveBeenCalledTimes(1);
      const callArg = h.sessionLifecycle.executeQuery.mock.calls[0][0];
      expect(callArg).toMatchObject({
        sessionId: 'tab_1',
        mcpServerRunning: true,
      });
      expect(callArg.initialPrompt).toMatchObject({
        content: 'Write a spec',
      });
    });

    it('threads the no-activity watchdog from executeQuery() into StreamTransformer.transform()', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const sdkQuery = createFakeQuery();
      const abortController = new AbortController();
      const activityWatchdog = new NoActivityWatchdog(100000, () => undefined);
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery,
        initialModel: 'claude-sonnet-4-20250514',
        abortController,
        activityWatchdog,
      } as ExecuteQueryResult);

      await h.adapter.startChatSession(makeSessionConfig());

      expect(h.streamTransformer.transform).toHaveBeenCalledTimes(1);
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      expect(transformArg.activityWatchdog).toBe(activityWatchdog);
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
        token: 'record-token-1',
        tabId: 'sess-1',
        realSessionId: null,
        query: existingQuery,
        config: {} as AISessionConfig,
        abortController: new AbortController(),
        messageQueue: [],
        resolveNext: null,
        turnInFlight: false,
        activityHold: null,
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

    it('dispatches a new executeQuery() when no active session exists, threading the watchdog through', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      h.sessionLifecycle.find.mockReturnValueOnce(undefined);
      const sdkQuery = createFakeQuery();
      const abortController = new AbortController();
      const activityWatchdog = new NoActivityWatchdog(100000, () => undefined);
      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery,
        initialModel: 'claude-sonnet-4-20250514',
        abortController,
        activityWatchdog,
      } as ExecuteQueryResult);

      await h.adapter.resumeSession('sess-1' as SessionId);

      expect(h.sessionLifecycle.executeQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          resumeSessionId: 'sess-1',
        }),
      );
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      expect(transformArg.activityWatchdog).toBe(activityWatchdog);
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

    it('delegates to executeSlashCommandQuery and threads the watchdog into the transformer', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();

      const sdkQuery = createFakeQuery();
      const abortController = new AbortController();
      const activityWatchdog = new NoActivityWatchdog(100000, () => undefined);
      h.sessionLifecycle.executeSlashCommandQuery.mockResolvedValueOnce({
        sdkQuery,
        initialModel: 'claude-sonnet-4-20250514',
        abortController,
        activityWatchdog,
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
      expect(transformArg.activityWatchdog).toBe(activityWatchdog);
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

  // TASK_2026_296 item 6 Part A — first-turn activity identity.
  //
  // A new session's first user activity used to be published from
  // startChatSession BEFORE the SDK's system `init` message arrived, so
  // `resolveActivityIds` could only answer with the tabId. Every LATER
  // activity, and every teardown, resolves `realSessionId ?? tabId` — the SDK
  // UUID. Consumer state was therefore armed under one key and cleared under
  // another, on the first turn only.
  //
  // The two ids are shape-indistinguishable (a tabId is a UUID v4), so no
  // consumer can detect the wrong one. These specs pin the emitter instead:
  // exactly one publication, under whichever id teardown will use.
  describe('first-turn activity identity (TASK_2026_296)', () => {
    const TAB_ID = '11111111-1111-4111-8111-111111111111';
    const REAL_ID = '22222222-2222-4222-8222-222222222222';
    const PROJECT_PATH = '/fake/workspace';

    interface FakeRecord {
      tabId: string;
      realSessionId: string | null;
      config: { projectPath?: string };
    }

    function asFoundRecord(
      rec: FakeRecord | undefined,
    ): ReturnType<SessionLifecycleManager['find']> {
      return rec as unknown as ReturnType<SessionLifecycleManager['find']>;
    }

    /**
     * A minimal stand-in for `SessionRegistry` + `SessionControlService`,
     * faithful on the three behaviours these specs depend on: `find` resolves
     * by either id, `bindRealSessionId` is set-once, and `endSession` reports
     * its teardown id as `realSessionId ?? tabId`
     * (`session-control.service.ts:126`).
     */
    function wireFakeRegistry(h: AdapterHarness) {
      const byTabId = new Map<string, FakeRecord>();
      const bySessionId = new Map<string, FakeRecord>();
      const teardownIds: string[] = [];

      h.sessionLifecycle.find.mockImplementation((id: string) =>
        asFoundRecord(byTabId.get(id) ?? bySessionId.get(id)),
      );
      h.sessionLifecycle.bindRealSessionId.mockImplementation(
        (tabId: string, realSessionId: string) => {
          const rec = byTabId.get(tabId);
          if (!rec || rec.realSessionId !== null) {
            return;
          }
          rec.realSessionId = realSessionId;
          bySessionId.set(realSessionId, rec);
        },
      );
      h.sessionLifecycle.endSession.mockImplementation(async (id) => {
        const rec = byTabId.get(id as string) ?? bySessionId.get(id as string);
        if (!rec) {
          return;
        }
        teardownIds.push(rec.realSessionId ?? rec.tabId);
        byTabId.delete(rec.tabId);
        if (rec.realSessionId) {
          bySessionId.delete(rec.realSessionId);
        }
      });

      return {
        teardownIds,
        register(tabId: string): void {
          byTabId.set(tabId, {
            tabId,
            realSessionId: null,
            config: { projectPath: PROJECT_PATH },
          });
        },
      };
    }

    /**
     * Stand-in for the two real consumers, `MemoryTriggerService` and
     * `SkillTriggerService`. Both key their `sessions` map (and its idle
     * timer) by the id on the activity payload and clear it by the id on the
     * SessionEnd payload. `agent-sdk` must not import either lib, so the
     * contract is modelled here rather than reached for.
     */
    function makeTriggerConsumer(registry: SessionActivityRegistry) {
      const armed = new Set<string>();
      const published: Array<{ sessionId: string; role: string }> = [];
      registry.register((payload) => {
        published.push({ sessionId: payload.sessionId, role: payload.role });
        armed.add(payload.sessionId);
      });
      return {
        armed,
        published,
        onSessionEnd(sessionId: string): void {
          armed.delete(sessionId);
        },
      };
    }

    async function startSessionWithPrompt(
      h: AdapterHarness,
      registry: ReturnType<typeof wireFakeRegistry>,
      options: { prompt?: string } = { prompt: 'first turn' },
    ): Promise<void> {
      h.sessionLifecycle.executeQuery.mockImplementationOnce(async () => {
        registry.register(TAB_ID);
        return {
          sdkQuery: createFakeQuery(),
          initialModel: 'claude-sonnet-4-20250514',
          abortController: new AbortController(),
        } as ExecuteQueryResult;
      });

      await h.adapter.startChatSession({
        ...makeSessionConfig({ tabId: TAB_ID }),
        prompt: options.prompt,
      });
    }

    /**
     * Deliver the SDK's system `init` message through the callback the adapter
     * handed to `StreamTransformer`. The published signature returns `void`
     * while the implementation is async, so awaiting it needs a cast.
     */
    async function deliverInit(
      h: AdapterHarness,
      realSessionId: string,
    ): Promise<void> {
      const transformArg = h.streamTransformer.transform.mock.calls[0][0];
      await (
        transformArg.onSessionIdResolved as unknown as (
          tabId: string | undefined,
          realSessionId: string,
        ) => Promise<void>
      )(TAB_ID, realSessionId);
    }

    it('publishes the first turn once under the SDK UUID, never under the tabId, and SessionEnd clears it', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      const registry = wireFakeRegistry(h);
      const consumer = makeTriggerConsumer(h.activityRegistry);

      await startSessionWithPrompt(h, registry);

      // The window the defect lived in: nothing may be published while the
      // tabId is the only id available.
      expect(consumer.published).toEqual([]);

      await deliverInit(h, REAL_ID);

      expect(consumer.published).toEqual([
        { sessionId: REAL_ID, role: 'user' },
      ]);
      expect(Array.from(consumer.armed)).toEqual([REAL_ID]);

      h.adapter.endSession(REAL_ID as SessionId);

      // Exactly once: teardown must not re-publish an already-flushed turn.
      expect(consumer.published).toHaveLength(1);
      expect(registry.teardownIds).toEqual([REAL_ID]);
      consumer.onSessionEnd(registry.teardownIds[0]);
      expect(consumer.armed.size).toBe(0);
    });

    // Paired-isolation sibling: the legitimate path where no id ever resolves
    // must still arm and tear down consistently — under the tabId, which is
    // exactly what `realSessionId ?? tabId` yields at teardown.
    it('publishes under the tabId when the session ends without ever resolving', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      const registry = wireFakeRegistry(h);
      const consumer = makeTriggerConsumer(h.activityRegistry);

      await startSessionWithPrompt(h, registry);
      expect(consumer.published).toEqual([]);

      h.adapter.endSession(TAB_ID as SessionId);

      expect(consumer.published).toEqual([{ sessionId: TAB_ID, role: 'user' }]);
      expect(registry.teardownIds).toEqual([TAB_ID]);
      consumer.onSessionEnd(registry.teardownIds[0]);
      expect(consumer.armed.size).toBe(0);
    });

    // The §0 init-callback blank refusal (`sdk-agent-adapter.ts`, guarded by
    // `blankToUndefined`) stops before the bind, so the buffered turn must
    // stay buffered and fall through to the tabId teardown flush — not be
    // published under a blank id.
    it('does not publish on a blank SDK init id, and still flushes under the tabId at teardown', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      const registry = wireFakeRegistry(h);
      const consumer = makeTriggerConsumer(h.activityRegistry);

      await startSessionWithPrompt(h, registry);
      await deliverInit(h, '   ');

      expect(consumer.published).toEqual([]);
      expect(h.sessionLifecycle.bindRealSessionId).not.toHaveBeenCalled();

      h.adapter.endSession(TAB_ID as SessionId);

      expect(consumer.published).toEqual([{ sessionId: TAB_ID, role: 'user' }]);
      expect(registry.teardownIds).toEqual([TAB_ID]);
    });

    it('publishes nothing for a session started without a prompt', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      const registry = wireFakeRegistry(h);
      const consumer = makeTriggerConsumer(h.activityRegistry);

      await startSessionWithPrompt(h, registry, { prompt: undefined });
      await deliverInit(h, REAL_ID);
      h.adapter.endSession(REAL_ID as SessionId);

      expect(consumer.published).toEqual([]);
    });

    // --- Part B (Batch 5b): the rekey signal, fired from BOTH emit sites ---

    function captureResolved(h: AdapterHarness): SessionIdResolvedPayload[] {
      const seen: SessionIdResolvedPayload[] = [];
      h.sessionIdResolvedRegistry.register((payload) => {
        seen.push(payload);
      });
      return seen;
    }

    it('notifies the SessionIdResolved registry ALONGSIDE the single-slot setter on the new-session path', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      const registry = wireFakeRegistry(h);
      const seen = captureResolved(h);
      const singleSlot = jest.fn();
      h.adapter.setSessionIdResolvedCallback(singleSlot);

      await startSessionWithPrompt(h, registry);
      expect(seen).toEqual([]);

      await deliverInit(h, REAL_ID);

      // Alongside, never instead of: the port's single-slot setter still fires
      // with its original arguments, unchanged.
      expect(singleSlot).toHaveBeenCalledWith(TAB_ID, REAL_ID);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual(
        expect.objectContaining({ tabId: TAB_ID, realSessionId: REAL_ID }),
      );
      expect(typeof seen[0].timestamp).toBe('number');
    });

    it('notifies the SessionIdResolved registry ALONGSIDE the single-slot setter on the resume path', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      const seen = captureResolved(h);
      const singleSlot = jest.fn();
      h.adapter.setSessionIdResolvedCallback(singleSlot);

      h.sessionLifecycle.executeQuery.mockResolvedValueOnce({
        sdkQuery: createFakeQuery(),
        initialModel: 'claude-sonnet-4-20250514',
        abortController: new AbortController(),
      } as ExecuteQueryResult);

      await h.adapter.resumeSession(
        REAL_ID as SessionId,
        makeSessionConfig({ tabId: TAB_ID }),
      );
      await deliverInit(h, REAL_ID);

      expect(singleSlot).toHaveBeenCalledWith(TAB_ID, REAL_ID);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual(
        expect.objectContaining({ tabId: TAB_ID, realSessionId: REAL_ID }),
      );
    });

    // Paired-isolation sibling for the two above: the §0 init-callback blank
    // refusal returns before the notify, so a blank SDK id publishes no rekey
    // signal at all — the reconciliation must never be asked to migrate onto
    // a non-id.
    it('does not notify the SessionIdResolved registry on a blank SDK init id', async () => {
      const h = makeAdapter();
      await h.adapter.initialize();
      const registry = wireFakeRegistry(h);
      const seen = captureResolved(h);

      await startSessionWithPrompt(h, registry);
      await deliverInit(h, '   ');

      expect(seen).toEqual([]);
    });
  });
});
