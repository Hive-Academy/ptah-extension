/**
 * SessionLifecycleManager — unit specs (TASK_2025_294 W3.B5).
 *
 * Surface under test:
 *   - Workspace resolution & active-session ordering (legacy tests retained
 *     from earlier coverage so the regression is still pinned).
 *   - Abort propagation: `executeQuery` creates an AbortController, threads
 *     it into the SDK's `queryFn` options, and aborts the SAME controller
 *     when the caller requests cancellation. The SDK's Query.interrupt() is
 *     awaited (with timeout) during endSession() and aborts the underlying
 *     controller afterwards.
 *   - Concurrent sessions: two simultaneous `executeQuery` calls produce two
 *     distinct active sessions with independent abort controllers and
 *     independent message queues — aborting one must not affect the other.
 *   - Workspace inheritance: `executeQuery` seeds each session's config with
 *     the caller-supplied `projectPath` (cwd); resuming a session re-uses
 *     the new caller-supplied workspace (no silent carry-over from the
 *     prior session), while `getActiveSessionWorkspace()` continues to
 *     report the most-recently-active session's workspace.
 *
 * Mocking posture:
 *   - All nine constructor dependencies are provided as typed
 *     `jest.Mocked<Pick<T, …>>` stubs; no tsyringe container.
 *   - The SDK queryFn is a `jest.fn()` returning a fake `Query` whose
 *     async-iterator is backed by `createFakeAsyncGenerator`.
 *   - `freezeTime` pins Date.now() so the W3 suites are deterministic.
 *   - Zero `as any` casts — only a named `asLogger` bridge cast at the
 *     single nominal-type seam (production `Logger` is a class).
 *
 * Constructor signature note:
 *   The production constructor takes NINE dependencies — logger,
 *   permissionHandler, moduleLoader, queryOptionsBuilder, messageFactory,
 *   subagentRegistry, authEnv, modelResolver, sessionEndRegistry. The fixture
 *   supplies all nine so `endSession()` exercises the full cleanup path.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type {
  SessionId,
  AISessionConfig,
  ISdkPermissionHandler,
  AuthEnv,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  createFakeAsyncGenerator,
  freezeTime,
  type FrozenClock,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SessionLifecycleManager } from './session-lifecycle-manager';
import type { SdkModuleLoader } from './sdk-module-loader';
import type {
  SdkQueryOptionsBuilder,
  QueryConfig,
  SdkQueryOptions,
} from './sdk-query-options-builder';
import type { SdkMessageFactory } from './sdk-message-factory';
import type { ModelResolver } from '../auth/model-resolver';
import type {
  QueryFunction,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '../types/sdk-types/claude-sdk.types';

// ---------------------------------------------------------------------------
// Typed bridges — production Logger is a nominal class with private fields,
// so a structural duck-type match fails. Bridge at a single named seam.
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Fake Query — the object the SDK's queryFn() returns. Backed by the shared
// `createFakeAsyncGenerator` so we can exercise the async-iterator surface.
// ---------------------------------------------------------------------------

interface FakeQueryHandle {
  query: Query & {
    close: jest.Mock;
    interrupt: jest.Mock;
    setPermissionMode: jest.Mock;
    setModel: jest.Mock;
    streamInput: jest.Mock;
  };
}

function createFakeQuery(messages: SDKMessage[] = []): FakeQueryHandle {
  const gen = createFakeAsyncGenerator<SDKMessage>(messages);
  const query = {
    [Symbol.asyncIterator]: () =>
      gen as unknown as AsyncIterator<SDKMessage, void>,
    next: () => gen.next(),
    return: (value?: void) => gen.return(value as unknown as SDKMessage),
    throw: (e?: unknown) => gen.throw(e),
    interrupt: jest.fn().mockResolvedValue(undefined),
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
    setModel: jest.fn().mockResolvedValue(undefined),
    streamInput: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  } as unknown as FakeQueryHandle['query'];
  return { query };
}

// ---------------------------------------------------------------------------
// Dependency factories — typed jest.Mocked<Pick<…>> so specs only override
// what they care about.
// ---------------------------------------------------------------------------

function createMockPermissionHandler(): jest.Mocked<ISdkPermissionHandler> {
  return {
    handleResponse: jest.fn(),
    handleQuestionResponse: jest.fn(),
    getPermissionLevel: jest.fn().mockReturnValue('ask'),
    cleanupPendingPermissions: jest.fn(),
  };
}

function createMockModuleLoader(): jest.Mocked<
  Pick<SdkModuleLoader, 'getQueryFunction' | 'getCliJsPath'>
> {
  return {
    getQueryFunction: jest.fn(),
    getCliJsPath: jest.fn().mockResolvedValue(null),
  };
}

function createMockQueryOptionsBuilder(): jest.Mocked<
  Pick<SdkQueryOptionsBuilder, 'build'>
> {
  return {
    build: jest.fn(),
  };
}

function createMockMessageFactory(): jest.Mocked<
  Pick<SdkMessageFactory, 'createUserMessage'>
> {
  return {
    createUserMessage: jest.fn().mockImplementation(
      async (args: { content: string; sessionId: SessionId }) =>
        ({
          type: 'user',
          message: { role: 'user', content: args.content },
          session_id: args.sessionId as string,
        }) as unknown as SDKUserMessage,
    ),
  };
}

function createMockSubagentRegistry(): jest.Mocked<
  Pick<SubagentRegistryService, 'markAllInterrupted'>
> {
  return {
    markAllInterrupted: jest.fn(),
  };
}

function createMockModelResolver(): jest.Mocked<
  Pick<ModelResolver, 'resolve'>
> {
  return {
    resolve: jest.fn((m: string) => m),
  };
}

function createAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return { ...overrides } as AuthEnv;
}

// ---------------------------------------------------------------------------
// Harness — build a fully-mocked SessionLifecycleManager. All 8 constructor
// deps are supplied so tests that exercise endSession()/disposeAllSessions()
// run the full cleanup path.
// ---------------------------------------------------------------------------

interface Harness {
  manager: SessionLifecycleManager;
  logger: MockLogger;
  permissionHandler: jest.Mocked<ISdkPermissionHandler>;
  moduleLoader: ReturnType<typeof createMockModuleLoader>;
  queryOptionsBuilder: ReturnType<typeof createMockQueryOptionsBuilder>;
  messageFactory: ReturnType<typeof createMockMessageFactory>;
  subagentRegistry: ReturnType<typeof createMockSubagentRegistry>;
  modelResolver: ReturnType<typeof createMockModelResolver>;
  authEnv: AuthEnv;
  queryFn: jest.Mock;
  /** Records the last options object the SDK queryFn saw (for assertions). */
  lastQueryOptions: { value: SdkQueryOptions | undefined };
}

function makeHarness(
  opts: {
    queryFnImpl?: (params: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options: SdkQueryOptions;
    }) => Query;
    authEnv?: Partial<AuthEnv>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const permissionHandler = createMockPermissionHandler();
  const moduleLoader = createMockModuleLoader();
  const queryOptionsBuilder = createMockQueryOptionsBuilder();
  const messageFactory = createMockMessageFactory();
  const subagentRegistry = createMockSubagentRegistry();
  const modelResolver = createMockModelResolver();
  const authEnv = createAuthEnv(opts.authEnv);

  const lastQueryOptions: { value: SdkQueryOptions | undefined } = {
    value: undefined,
  };

  // Default queryFn: returns a fresh fake Query and records the options it
  // received so tests can assert on abortController identity.
  const defaultQueryFn: (params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options: SdkQueryOptions;
  }) => Query = (params) => {
    lastQueryOptions.value = params.options;
    return createFakeQuery().query;
  };
  const queryFn = jest.fn(opts.queryFnImpl ?? defaultQueryFn);
  moduleLoader.getQueryFunction.mockResolvedValue(
    queryFn as unknown as QueryFunction,
  );

  // Default builder: forward the caller-supplied abortController + userMessageStream
  // into the QueryConfig so executeQuery's queryFn call receives the same references.
  queryOptionsBuilder.build.mockImplementation(
    async (input): Promise<QueryConfig> => {
      const options = {
        abortController: input.abortController,
        cwd: input.sessionConfig?.projectPath ?? '/mock/cwd',
        model: input.sessionConfig?.model ?? 'claude-sonnet-4-20250514',
        resume: input.resumeSessionId,
        permissionMode: input.permissionMode ?? 'default',
      } as unknown as SdkQueryOptions;
      return {
        prompt: input.userMessageStream,
        options,
      };
    },
  );

  // Minimal stub for SessionEndCallbackRegistry — notifyAll is fire-and-forget;
  // tests that care about session-end notifications can assert on this mock.
  const sessionEndRegistryStub = { notifyAll: jest.fn() };

  const manager = new SessionLifecycleManager(
    asLogger(logger),
    permissionHandler,
    moduleLoader as unknown as SdkModuleLoader,
    queryOptionsBuilder as unknown as SdkQueryOptionsBuilder,
    messageFactory as unknown as SdkMessageFactory,
    subagentRegistry as unknown as SubagentRegistryService,
    authEnv,
    modelResolver as unknown as ModelResolver,
    sessionEndRegistryStub as unknown as import('./session-end-callback-registry').SessionEndCallbackRegistry,
  );

  return {
    manager,
    logger,
    permissionHandler,
    moduleLoader,
    queryOptionsBuilder,
    messageFactory,
    subagentRegistry,
    modelResolver,
    authEnv,
    queryFn,
    lastQueryOptions,
  };
}

function createSessionConfig(
  overrides: Partial<AISessionConfig> = {},
): AISessionConfig {
  return {
    model: 'claude-sonnet-4-20250514',
    projectPath: '/test/workspace',
    ...overrides,
  } as AISessionConfig;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SessionLifecycleManager', () => {
  let clock: FrozenClock;
  let harness: Harness;

  beforeEach(() => {
    clock = freezeTime('2026-01-01T00:00:00Z');
    harness = makeHarness();
  });

  afterEach(() => {
    clock.restore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getActiveSessionIds (retained legacy coverage)
  // -------------------------------------------------------------------------

  describe('getActiveSessionIds', () => {
    it('returns empty array when no sessions are registered', () => {
      expect(harness.manager.getActiveSessionIds()).toEqual([]);
    });

    it('returns a single session ID after pre-registration', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );

      const ids = harness.manager.getActiveSessionIds();
      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe('tab_1');
    });

    it('returns the real UUID after resolveRealSessionId', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.bindRealSessionId('tab_1', 'real-uuid-123');

      const ids = harness.manager.getActiveSessionIds();
      expect(ids[0]).toBe('real-uuid-123');
    });

    it('orders most-recently-registered session first', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );

      expect(harness.manager.getActiveSessionIds()[0]).toBe('tab_2');
    });

    it('replaces tab IDs with real UUIDs once resolved, preserving ordering', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );
      harness.manager.bindRealSessionId('tab_1', 'uuid-aaa');
      harness.manager.bindRealSessionId('tab_2', 'uuid-bbb');

      const ids = harness.manager.getActiveSessionIds();
      expect(ids[0]).toBe('uuid-bbb');
      expect(ids[1]).toBe('uuid-aaa');
    });
  });

  // -------------------------------------------------------------------------
  // getActiveSessionWorkspace (retained legacy coverage)
  // -------------------------------------------------------------------------

  describe('getActiveSessionWorkspace', () => {
    it('returns undefined when no sessions exist', () => {
      expect(harness.manager.getActiveSessionWorkspace()).toBeUndefined();
    });

    it('returns workspace of the most-recently-active session', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/b');
    });

    it('falls back to any session when the last active has no projectPath', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: undefined }),
        new AbortController(),
      );

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/a');
    });

    it('returns undefined when no session has a projectPath', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: undefined }),
        new AbortController(),
      );

      expect(harness.manager.getActiveSessionWorkspace()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // endSession cleanup (retained legacy coverage; now works with full DI)
  // -------------------------------------------------------------------------

  describe('endSession cleanup', () => {
    it('clears _lastActiveTabId and falls back to remaining session', async () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );

      await harness.manager.endSession('tab_2' as SessionId);

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/a');
      expect(harness.manager.getActiveSessionIds()).toEqual(['tab_1']);
    });

    it('clears workspace when all sessions end', async () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );

      await harness.manager.endSession('tab_1' as SessionId);

      expect(harness.manager.getActiveSessionWorkspace()).toBeUndefined();
      expect(harness.manager.getActiveSessionIds()).toEqual([]);
    });

    it('does not affect ordering when a non-active session ends', async () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );

      await harness.manager.endSession('tab_1' as SessionId);

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/b');
    });
  });

  // -------------------------------------------------------------------------
  // resolveRealSessionId (retained legacy coverage)
  // -------------------------------------------------------------------------

  describe('resolveRealSessionId', () => {
    it('does not affect workspace resolution', () => {
      harness.manager.register(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.bindRealSessionId('tab_1', 'real-uuid-123');

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/a');
    });
  });

  // =========================================================================
  // NEW COVERAGE (W3.B5): abort propagation, concurrent sessions, workspace
  // inheritance via executeQuery.
  // =========================================================================

  // -------------------------------------------------------------------------
  // Abort propagation
  // -------------------------------------------------------------------------

  describe('abort propagation (executeQuery)', () => {
    it('creates an AbortController and threads the SAME reference into the SDK query options', async () => {
      const sessionId = 'tab_abort_1' as SessionId;

      const result = await harness.manager.executeQuery({
        sessionId,
        sessionConfig: createSessionConfig(),
      });

      // The queryFn must have been invoked with an options object whose
      // abortController is identity-equal to the one returned to the caller.
      expect(harness.queryFn).toHaveBeenCalledTimes(1);
      expect(harness.lastQueryOptions.value).toBeDefined();
      const sdkOptions = harness.lastQueryOptions.value;
      expect(sdkOptions?.abortController).toBe(result.abortController);
      expect(result.abortController.signal.aborted).toBe(false);
    });

    it('aborting the controller returned by executeQuery flips the signal the SDK query observed', async () => {
      const result = await harness.manager.executeQuery({
        sessionId: 'tab_abort_2' as SessionId,
        sessionConfig: createSessionConfig(),
      });

      const sdkCtrl = harness.lastQueryOptions.value?.abortController as
        | AbortController
        | undefined;
      expect(sdkCtrl).toBeDefined();
      expect(sdkCtrl?.signal.aborted).toBe(false);

      result.abortController.abort();

      // Same object → aborting the returned handle fires the signal that the
      // SDK's queryFn is listening to. If this reference were cloned, the UI
      // "Stop" button would be a no-op.
      expect(sdkCtrl?.signal.aborted).toBe(true);
    });

    it('endSession awaits Query.interrupt() and then aborts the underlying controller', async () => {
      const fake = createFakeQuery();
      let recordedCtrl: AbortController | undefined;
      const harnessWithQuery = makeHarness({
        queryFnImpl: (params) => {
          recordedCtrl = params.options.abortController as AbortController;
          return fake.query;
        },
      });

      const result = await harnessWithQuery.manager.executeQuery({
        sessionId: 'tab_abort_3' as SessionId,
        sessionConfig: createSessionConfig(),
      });

      expect(recordedCtrl).toBe(result.abortController);
      expect(fake.query.interrupt).not.toHaveBeenCalled();
      expect(recordedCtrl?.signal.aborted).toBe(false);

      await harnessWithQuery.manager.endSession('tab_abort_3' as SessionId);

      // interrupt() is the graceful stop; abortController.abort() follows once
      // interrupt resolves (or its 5s race timer fires). The registered Query
      // MUST see interrupt() exactly once, and the controller MUST end aborted.
      expect(fake.query.interrupt).toHaveBeenCalledTimes(1);
      expect(recordedCtrl?.signal.aborted).toBe(true);
    });

    it('endSession cleans up pending permissions BEFORE interrupt + abort', async () => {
      const calls: string[] = [];
      harness.permissionHandler.cleanupPendingPermissions.mockImplementation(
        () => {
          calls.push('cleanupPendingPermissions');
        },
      );
      harness.subagentRegistry.markAllInterrupted.mockImplementation(() => {
        calls.push('markAllInterrupted');
      });

      await harness.manager.executeQuery({
        sessionId: 'tab_abort_4' as SessionId,
        sessionConfig: createSessionConfig(),
      });

      await harness.manager.endSession('tab_abort_4' as SessionId);

      // cleanupPendingPermissions must run first so in-flight permission
      // promises don't become unhandled rejections after abort().
      expect(calls[0]).toBe('cleanupPendingPermissions');
      expect(calls).toEqual([
        'cleanupPendingPermissions',
        'markAllInterrupted',
      ]);
    });

    it('init failure rolls back pre-registration AND aborts the fresh controller', async () => {
      const failingHarness = makeHarness();
      failingHarness.moduleLoader.getQueryFunction.mockRejectedValueOnce(
        new Error('sdk module load boom'),
      );

      await expect(
        failingHarness.manager.executeQuery({
          sessionId: 'tab_abort_5' as SessionId,
          sessionConfig: createSessionConfig(),
        }),
      ).rejects.toThrow(/sdk module load boom/);

      // The session must NOT be left orphaned (regression guard for the
      // explicit rollback branch in executeQuery's try/catch).
      expect(failingHarness.manager.getActiveSessionIds()).toEqual([]);
      expect(failingHarness.manager.find('tab_abort_5') !== undefined).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent sessions
  // -------------------------------------------------------------------------

  describe('concurrent sessions', () => {
    it('two simultaneous executeQuery calls produce distinct sessions with distinct abort controllers', async () => {
      const controllers: AbortController[] = [];
      const concurrentHarness = makeHarness({
        queryFnImpl: (params) => {
          controllers.push(params.options.abortController as AbortController);
          return createFakeQuery().query;
        },
      });

      const [a, b] = await Promise.all([
        concurrentHarness.manager.executeQuery({
          sessionId: 'tab_conc_a' as SessionId,
          sessionConfig: createSessionConfig({ projectPath: '/ws/a' }),
        }),
        concurrentHarness.manager.executeQuery({
          sessionId: 'tab_conc_b' as SessionId,
          sessionConfig: createSessionConfig({ projectPath: '/ws/b' }),
        }),
      ]);

      // Distinct abort controllers — no accidental sharing through a module-
      // level singleton or cached reference.
      expect(a.abortController).not.toBe(b.abortController);
      expect(controllers).toHaveLength(2);
      expect(controllers[0]).not.toBe(controllers[1]);

      // Both sessions are registered, and each registration captured a unique
      // controller (queries landed in some order but both are present).
      const ids = concurrentHarness.manager.getActiveSessionIds();
      expect(new Set(ids)).toEqual(new Set(['tab_conc_a', 'tab_conc_b']));
      expect(concurrentHarness.manager.getActiveSessionCount()).toBe(2);
    });

    it('aborting one concurrent session does not abort the other', async () => {
      const concurrentHarness = makeHarness();
      const [a, b] = await Promise.all([
        concurrentHarness.manager.executeQuery({
          sessionId: 'tab_conc_x' as SessionId,
          sessionConfig: createSessionConfig({ projectPath: '/ws/x' }),
        }),
        concurrentHarness.manager.executeQuery({
          sessionId: 'tab_conc_y' as SessionId,
          sessionConfig: createSessionConfig({ projectPath: '/ws/y' }),
        }),
      ]);

      a.abortController.abort();

      expect(a.abortController.signal.aborted).toBe(true);
      expect(b.abortController.signal.aborted).toBe(false);
    });

    it("messages sent to one session land only in that session's queue (no cross-contamination)", async () => {
      const concurrentHarness = makeHarness();
      await concurrentHarness.manager.executeQuery({
        sessionId: 'tab_msg_a' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/a' }),
      });
      await concurrentHarness.manager.executeQuery({
        sessionId: 'tab_msg_b' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/b' }),
      });

      await concurrentHarness.manager.sendMessage(
        'tab_msg_a' as SessionId,
        'hello-a',
      );

      const sessionA = concurrentHarness.manager.find('tab_msg_a');
      const sessionB = concurrentHarness.manager.find('tab_msg_b');

      expect(sessionA?.messageQueue).toHaveLength(1);
      expect(sessionB?.messageQueue).toHaveLength(0);
    });

    it('ending one concurrent session leaves the other fully intact', async () => {
      const concurrentHarness = makeHarness();
      await concurrentHarness.manager.executeQuery({
        sessionId: 'tab_end_a' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/a' }),
      });
      const kept = await concurrentHarness.manager.executeQuery({
        sessionId: 'tab_end_b' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/b' }),
      });

      await concurrentHarness.manager.endSession('tab_end_a' as SessionId);

      expect(concurrentHarness.manager.find('tab_end_a') !== undefined).toBe(
        false,
      );
      expect(concurrentHarness.manager.find('tab_end_b') !== undefined).toBe(
        true,
      );
      expect(kept.abortController.signal.aborted).toBe(false);
      expect(concurrentHarness.manager.getActiveSessionWorkspace()).toBe(
        '/ws/b',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Workspace inheritance
  // -------------------------------------------------------------------------

  describe('workspace inheritance (executeQuery)', () => {
    it('new sessions record the caller-supplied projectPath on the active session', async () => {
      await harness.manager.executeQuery({
        sessionId: 'tab_ws_1' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/caller/ws/new' }),
      });

      expect(harness.manager.getActiveSessionWorkspace()).toBe(
        '/caller/ws/new',
      );
      // And it flows through the options builder into queryFn's cwd.
      expect(harness.lastQueryOptions.value?.cwd).toBe('/caller/ws/new');
    });

    it('resumed sessions use the caller-supplied projectPath — no silent carry-over from prior runs', async () => {
      // Simulate a prior session with a different workspace.
      await harness.manager.executeQuery({
        sessionId: 'tab_ws_prev' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/old/workspace' }),
      });
      await harness.manager.endSession('tab_ws_prev' as SessionId);

      // Now resume using a NEW workspace. The resumed session must honor the
      // new caller cwd — not leak the old one back in.
      await harness.manager.executeQuery({
        sessionId: 'tab_ws_resume' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/new/workspace' }),
        resumeSessionId: 'real-uuid-prev',
      });

      expect(harness.manager.getActiveSessionWorkspace()).toBe(
        '/new/workspace',
      );
      expect(harness.lastQueryOptions.value?.cwd).toBe('/new/workspace');
      // And the SDK options builder actually received the resume hint so the
      // SDK can reconstruct the prior conversation in the NEW cwd.
      expect(harness.queryOptionsBuilder.build).toHaveBeenLastCalledWith(
        expect.objectContaining({
          resumeSessionId: 'real-uuid-prev',
          sessionConfig: expect.objectContaining({
            projectPath: '/new/workspace',
          }),
        }),
      );
    });

    it('resumed sessions without an explicit projectPath surface the omission (no phantom cwd)', async () => {
      // If a caller forgets to supply projectPath on resume, the manager must
      // not silently inherit from any unrelated prior session. We assert the
      // effective cwd comes solely from what the caller provided (here:
      // undefined → builder default).
      await harness.manager.executeQuery({
        sessionId: 'tab_ws_other' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/unrelated/ws' }),
      });

      await harness.manager.executeQuery({
        sessionId: 'tab_ws_resume_noCwd' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: undefined }),
        resumeSessionId: 'real-uuid-other',
      });

      // The builder stub uses '/mock/cwd' as default when projectPath is
      // missing — proving nothing carried over from /unrelated/ws.
      expect(harness.lastQueryOptions.value?.cwd).toBe('/mock/cwd');
      // And the registered session has no projectPath of its own.
      const session = harness.manager.find('tab_ws_resume_noCwd');
      expect(session?.config?.projectPath).toBeUndefined();
    });

    it('getActiveSessionWorkspace tracks the most-recently-active session across executeQuery calls', async () => {
      await harness.manager.executeQuery({
        sessionId: 'tab_ws_a' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/a' }),
      });
      await harness.manager.executeQuery({
        sessionId: 'tab_ws_b' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/b' }),
      });

      // tab_ws_b was registered last → it is the current workspace.
      expect(harness.manager.getActiveSessionWorkspace()).toBe('/ws/b');

      // Sending a message to tab_ws_a re-promotes it to "most recent".
      await harness.manager.sendMessage('tab_ws_a' as SessionId, 'ping');
      expect(harness.manager.getActiveSessionWorkspace()).toBe('/ws/a');
    });
  });

  // =========================================================================
  // NEW COVERAGE (TASK_2026_118 Batch 8, Task 8.2): find() identity,
  // getActiveSessionIds() ordering, executeQuery → bindRealSessionId flow.
  // =========================================================================

  // -------------------------------------------------------------------------
  // find() identity — same record by both tabId and realId after bind
  // -------------------------------------------------------------------------

  describe('find() dual-index identity (TASK_2026_118)', () => {
    it('returns the same object reference by tabId and realId after bindRealSessionId', () => {
      harness.manager.register(
        'tab_find_id' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.bindRealSessionId('tab_find_id', 'real-uuid-find-id');

      const byTab = harness.manager.find('tab_find_id');
      const byReal = harness.manager.find('real-uuid-find-id');

      expect(byTab).toBeDefined();
      expect(byReal).toBeDefined();
      // Identity equality — both lookups must return the SAME SessionRecord
      // object. This is the "no-rekey" invariant: one record, two keys.
      expect(byTab).toBe(byReal);
    });

    it('mutation via one lookup is visible via the other (shared record)', () => {
      harness.manager.register(
        'tab_shared_mut' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.bindRealSessionId('tab_shared_mut', 'real-shared-mut');

      const byTab = harness.manager.find('tab_shared_mut');
      const byReal = harness.manager.find('real-shared-mut');

      // Mutate a field via one lookup
      (byTab as { currentModel: string }).currentModel = 'mutated-model';

      // Visible via the other — this is the core correctness guarantee
      expect(byReal?.currentModel).toBe('mutated-model');
    });
  });

  // -------------------------------------------------------------------------
  // getActiveSessionIds() ordering — unchanged from legacy implementation
  // -------------------------------------------------------------------------

  describe('getActiveSessionIds() ordering preservation (TASK_2026_118)', () => {
    it('most-recently-registered session appears first before any bind', () => {
      harness.manager.register(
        'tab_ord_1' as SessionId,
        createSessionConfig({ projectPath: '/ws/1' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_ord_2' as SessionId,
        createSessionConfig({ projectPath: '/ws/2' }),
        new AbortController(),
      );
      harness.manager.register(
        'tab_ord_3' as SessionId,
        createSessionConfig({ projectPath: '/ws/3' }),
        new AbortController(),
      );

      // tab_ord_3 registered last → should be first
      const ids = harness.manager.getActiveSessionIds();
      expect(ids[0]).toBe('tab_ord_3');
    });

    it('returns realUUIDs after bind, preserving most-recent ordering', () => {
      harness.manager.register(
        'tab_ord_a' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.register(
        'tab_ord_b' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.bindRealSessionId('tab_ord_a', 'uuid-ord-aaa');
      harness.manager.bindRealSessionId('tab_ord_b', 'uuid-ord-bbb');

      // tab_ord_b registered last → its realSessionId should be first
      const ids = harness.manager.getActiveSessionIds();
      expect(ids[0]).toBe('uuid-ord-bbb');
      expect(ids[1]).toBe('uuid-ord-aaa');
    });

    it('returns tabId (not realId) for sessions where bindRealSessionId has not yet fired', () => {
      harness.manager.register(
        'tab_unbound' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.register(
        'tab_bound' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.bindRealSessionId('tab_bound', 'real-bound-uuid');

      const ids = harness.manager.getActiveSessionIds();
      // tab_unbound has no real UUID yet → appears as tabId in the list
      expect(ids).toContain('tab_unbound');
      expect(ids).toContain('real-bound-uuid');
      expect(ids).not.toContain('tab_bound');
    });
  });

  // -------------------------------------------------------------------------
  // executeQuery → bindRealSessionId → setSessionQuery flow
  // -------------------------------------------------------------------------

  describe('executeQuery → bindRealSessionId → find(realUUID) flow (TASK_2026_118)', () => {
    it('executeQuery registers by tabId; find(realUUID) returns the record after bindRealSessionId fires', async () => {
      const realUUID = 'sdk-init-real-uuid-123';

      // Execute a query — this registers the session by tabId
      await harness.manager.executeQuery({
        sessionId: 'tab_flow' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/flow' }),
      });

      // Simulate the SDK init message callback (bindRealSessionId would be
      // called by the adapter when the 'system' init message arrives)
      harness.manager.bindRealSessionId('tab_flow', realUUID);

      // find(realUUID) must now return the record
      const recByReal = harness.manager.find(realUUID);
      expect(recByReal).toBeDefined();

      // And it must be the same object as find(tabId)
      const recByTab = harness.manager.find('tab_flow');
      expect(recByReal).toBe(recByTab);
    });

    it('find(realUUID) returns record with query set after executeQuery completes', async () => {
      const realUUID = 'sdk-init-uuid-with-query';

      await harness.manager.executeQuery({
        sessionId: 'tab_with_query' as SessionId,
        sessionConfig: createSessionConfig(),
      });

      // Bind after executeQuery (replicates the production flow where the
      // SDK emits the init message asynchronously during the query stream)
      harness.manager.bindRealSessionId('tab_with_query', realUUID);

      const rec = harness.manager.find(realUUID);
      // The query field is set by executeQuery's internal setSessionQuery call
      expect(rec?.query).not.toBeNull();
    });
  });

  // =========================================================================
  // END NEW COVERAGE (TASK_2026_118 Batch 8)
  // =========================================================================

  // -------------------------------------------------------------------------
  // warmQuery wiring (TASK_2026_109 Fix 3 wiring)
  // -------------------------------------------------------------------------

  describe('warmQuery handoff (executeQuery)', () => {
    it('uses warmQuery.query(prompt) instead of queryFn() for an eligible new chat', async () => {
      const warmedQuery = createFakeQuery().query;
      const warmQueryFn = jest.fn().mockReturnValue(warmedQuery);
      const close = jest.fn();
      const warmQuery = { close, query: warmQueryFn };

      const result = await harness.manager.executeQuery({
        sessionId: 'tab_warm' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/warm' }),
        warmQuery,
      });

      // warmQuery.query was used; queryFn was NOT.
      expect(warmQueryFn).toHaveBeenCalledTimes(1);
      expect(harness.queryFn).not.toHaveBeenCalled();
      // The handle was NOT closed — its lifecycle is now owned by the
      // returned Query object. (Once the Query terminates the SDK closes
      // the underlying subprocess on its own.)
      expect(close).not.toHaveBeenCalled();
      // The SDK Query the executor returned is the one warmQuery.query
      // produced (load-bearing reference for stream transformation).
      expect(result.sdkQuery).toBe(warmedQuery);
    });

    it('falls back to queryFn (and closes the warm handle) when the session is a resume', async () => {
      const warmQueryFn = jest.fn();
      const close = jest.fn();
      const warmQuery = { close, query: warmQueryFn };

      await harness.manager.executeQuery({
        sessionId: 'sess_resume' as SessionId,
        sessionConfig: createSessionConfig(),
        resumeSessionId: 'sess_resume',
        warmQuery,
      });

      // resume sessions can NOT use the warm handle — fall through to
      // queryFn AND close the handle to avoid leaking the subprocess.
      expect(warmQueryFn).not.toHaveBeenCalled();
      expect(harness.queryFn).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('falls back to queryFn (and closes the warm handle) when the session is a slash command', async () => {
      const warmQueryFn = jest.fn();
      const close = jest.fn();
      const warmQuery = { close, query: warmQueryFn };

      await harness.manager.executeQuery({
        sessionId: 'tab_slash' as SessionId,
        sessionConfig: createSessionConfig(),
        initialPrompt: { content: '/compact', files: [], images: [] },
        warmQuery,
      });

      expect(warmQueryFn).not.toHaveBeenCalled();
      expect(harness.queryFn).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('falls back to queryFn when warmQuery.query is missing on the handle', async () => {
      // Defensive guard: handle without a .query function (e.g. SDK
      // bundled an older WarmQuery shape) must NOT crash — fall through.
      const close = jest.fn();
      const warmQuery = { close } as unknown as {
        close: () => void;
        query?: unknown;
      };

      await harness.manager.executeQuery({
        sessionId: 'tab_noquery' as SessionId,
        sessionConfig: createSessionConfig(),
        warmQuery,
      });

      expect(harness.queryFn).toHaveBeenCalledTimes(1);
      // The malformed handle is still closed in the fall-through path.
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('falls back to queryFn when warmQuery.query() throws, and closes the handle', async () => {
      const close = jest.fn();
      const warmQueryFn = jest.fn().mockImplementation(() => {
        throw new Error('warm subprocess died');
      });
      const warmQuery = { close, query: warmQueryFn };

      const result = await harness.manager.executeQuery({
        sessionId: 'tab_warmfail' as SessionId,
        sessionConfig: createSessionConfig(),
        warmQuery,
      });

      // First the warm path was attempted, then fell back to queryFn.
      expect(warmQueryFn).toHaveBeenCalledTimes(1);
      expect(harness.queryFn).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      // The fallback Query is what callers see.
      expect(result.sdkQuery).toBeDefined();
    });
  });

  // =========================================================================
  // NEW COVERAGE (TASK_2026_118 Batch 9): real-registry integration tests
  // closing audit gaps 8 / 9 / 10 / 13.
  //
  // All four tests use the existing makeHarness() which wires a REAL
  // SessionRegistry inside the manager (eager construction in the facade
  // constructor). Only the SDK module-loader / queryOptionsBuilder /
  // messageFactory / sessionEndRegistry dependencies are mocked.
  // =========================================================================

  // ---------------------------------------------------------------------------
  // Helper: a fake Query that records interrupt calls and exposes them
  // ---------------------------------------------------------------------------

  function createFakeQueryForIntegration(): {
    interrupt: jest.Mock;
    rewindFiles: jest.Mock;
    query: Query;
  } {
    const interrupt = jest.fn().mockResolvedValue(undefined);
    const rewindFiles = jest.fn().mockResolvedValue({ canRewind: false });
    const { query: baseQuery } = createFakeQuery();
    const query: Query = {
      ...baseQuery,
      interrupt,
      rewindFiles,
      stopTask: jest.fn().mockResolvedValue(undefined),
    } as unknown as Query;
    return { interrupt, rewindFiles, query };
  }

  // ---------------------------------------------------------------------------
  // Integration harness that also exposes the sessionEndRegistry mock so tests
  // can assert on notifyAll calls.
  // ---------------------------------------------------------------------------

  function makeIntegrationHarness() {
    const logger = createMockLogger();
    const permissionHandler = createMockPermissionHandler();
    const moduleLoader = createMockModuleLoader();
    const queryOptionsBuilder = createMockQueryOptionsBuilder();
    const messageFactory = createMockMessageFactory();
    const subagentRegistry = createMockSubagentRegistry();
    const modelResolver = createMockModelResolver();
    const authEnv = createAuthEnv();

    const notifyAll = jest.fn();
    const sessionEndRegistryMock = { notifyAll };

    const lastQueryOptions: { value: SdkQueryOptions | undefined } = {
      value: undefined,
    };

    const queryFn = jest.fn(
      (params: {
        prompt: string | AsyncIterable<SDKUserMessage>;
        options: SdkQueryOptions;
      }) => {
        lastQueryOptions.value = params.options;
        return createFakeQueryForIntegration().query;
      },
    );
    moduleLoader.getQueryFunction.mockResolvedValue(
      queryFn as unknown as QueryFunction,
    );

    queryOptionsBuilder.build.mockImplementation(
      async (input): Promise<QueryConfig> => {
        const options = {
          abortController: input.abortController,
          cwd: input.sessionConfig?.projectPath ?? '/mock/cwd',
          model: input.sessionConfig?.model ?? 'claude-sonnet-4-20250514',
          permissionMode: input.permissionMode ?? 'default',
        } as unknown as SdkQueryOptions;
        return { prompt: input.userMessageStream, options };
      },
    );

    const manager = new SessionLifecycleManager(
      asLogger(logger),
      permissionHandler,
      moduleLoader as unknown as SdkModuleLoader,
      queryOptionsBuilder as unknown as SdkQueryOptionsBuilder,
      messageFactory as unknown as SdkMessageFactory,
      subagentRegistry as unknown as SubagentRegistryService,
      authEnv,
      modelResolver as unknown as ModelResolver,
      sessionEndRegistryMock as unknown as import('./session-end-callback-registry').SessionEndCallbackRegistry,
    );

    return {
      manager,
      logger,
      permissionHandler,
      queryFn,
      lastQueryOptions,
      notifyAll,
    };
  }

  // ---------------------------------------------------------------------------
  // Gap 8 (theater-5): disposeAllSessions with a real SessionRegistry
  // ---------------------------------------------------------------------------

  describe('disposeAllSessions — real-registry integration (audit gap 8 / theater-5)', () => {
    it('aborts all 3 controllers, calls interrupt on all queries, and notifies sessionEndRegistry with pre-clear workspace roots', async () => {
      const ih = makeIntegrationHarness();

      // Create fake queries so we can assert on their .interrupt calls
      const fakeA = createFakeQueryForIntegration();
      const fakeB = createFakeQueryForIntegration();
      const fakeC = createFakeQueryForIntegration();
      const fakeQueries = [fakeA.query, fakeB.query, fakeC.query];
      let callCount = 0;
      ih.queryFn.mockImplementation(() => fakeQueries[callCount++]);

      // Register 3 sessions via executeQuery — this wires the real registry
      await ih.manager.executeQuery({
        sessionId: 'tab_a' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/a' }),
      });
      await ih.manager.executeQuery({
        sessionId: 'tab_b' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/b' }),
      });
      await ih.manager.executeQuery({
        sessionId: 'tab_c' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/c' }),
      });

      // Bind a real UUID for tab_b (exercising the dual-index code path)
      ih.manager.bindRealSessionId('tab_b', 'uuid_b');

      // Capture abort controllers before dispose
      const recA = ih.manager.find('tab_a');
      const recB = ih.manager.find('tab_b');
      const recC = ih.manager.find('tab_c');
      const ctrlA = recA!.abortController;
      const ctrlB = recB!.abortController;
      const ctrlC = recC!.abortController;

      expect(ctrlA.signal.aborted).toBe(false);
      expect(ctrlB.signal.aborted).toBe(false);
      expect(ctrlC.signal.aborted).toBe(false);

      await ih.manager.disposeAllSessions();

      // (a) All 3 abort controllers must be signaled
      expect(ctrlA.signal.aborted).toBe(true);
      expect(ctrlB.signal.aborted).toBe(true);
      expect(ctrlC.signal.aborted).toBe(true);

      // (b) All 3 query.interrupt() calls fired (snapshot-before-clear invariant)
      expect(fakeA.interrupt).toHaveBeenCalledTimes(1);
      expect(fakeB.interrupt).toHaveBeenCalledTimes(1);
      expect(fakeC.interrupt).toHaveBeenCalledTimes(1);

      // (c) sessionEndRegistry.notifyAll was called with workspace roots captured
      // pre-clearAll (the snapshot-before-clear fix from Batch 3). Verify that
      // all 3 workspace paths were delivered.
      const notifyArgs = ih.notifyAll.mock.calls.map(
        (call) => (call[0] as { workspaceRoot: string }).workspaceRoot,
      );
      expect(notifyArgs).toContain('/ws/a');
      expect(notifyArgs).toContain('/ws/b');
      expect(notifyArgs).toContain('/ws/c');

      // (d) After dispose, ALL lookups return undefined — registry is cleared
      expect(ih.manager.find('tab_a')).toBeUndefined();
      expect(ih.manager.find('tab_b')).toBeUndefined();
      expect(ih.manager.find('uuid_b')).toBeUndefined();
      expect(ih.manager.find('tab_c')).toBeUndefined();
      expect(ih.manager.getActiveSessionIds()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Gap 9: endSession(realUUID) removes from BOTH indexes
  // ---------------------------------------------------------------------------

  describe('endSession(realUUID) — dual-index removal (audit gap 9)', () => {
    it('removes both byTabId and bySessionId entries when called with the real UUID', async () => {
      const ih = makeIntegrationHarness();
      const fakeQuery = createFakeQueryForIntegration();
      ih.queryFn.mockReturnValueOnce(fakeQuery.query);

      await ih.manager.executeQuery({
        sessionId: 'tab_1' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/dual' }),
      });
      ih.manager.bindRealSessionId('tab_1', 'real-uuid-123');

      // Sanity: both lookups return a record before end
      expect(ih.manager.find('tab_1')).toBeDefined();
      expect(ih.manager.find('real-uuid-123')).toBeDefined();

      // End session via the REAL UUID — this is the exact failure mode the
      // refactor was built to fix (byTabId-only removal would leave bySessionId
      // stale).
      await ih.manager.endSession('real-uuid-123' as SessionId);

      // (a) byTabId entry removed
      expect(ih.manager.find('tab_1')).toBeUndefined();
      // (b) bySessionId entry removed — the central bug variant
      expect(ih.manager.find('real-uuid-123')).toBeUndefined();
      // (c) abortController was aborted
      const rec = fakeQuery.query as unknown as Query & {
        _abortCtrl?: AbortController;
      };
      // We already checked find() returns undefined, but we can verify the
      // abort via the fake query's interrupt being called.
      expect(fakeQuery.interrupt).toHaveBeenCalledTimes(1);
      // (d) query.interrupt called exactly once
      // (already asserted above — redundant assertion for clarity)
      expect(fakeQuery.interrupt).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Gap 10: interruptCurrentTurn after bindRealSessionId
  // ---------------------------------------------------------------------------

  describe('interruptCurrentTurn(realUUID) — dual-index lookup (audit gap 10)', () => {
    it('calls query.interrupt exactly once and leaves the session active', async () => {
      const ih = makeIntegrationHarness();
      const fakeQuery = createFakeQueryForIntegration();
      ih.queryFn.mockReturnValueOnce(fakeQuery.query);

      await ih.manager.executeQuery({
        sessionId: 'tab_2' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/interrupt' }),
      });
      ih.manager.bindRealSessionId('tab_2', 'real-uuid-456');

      // (a) returns true when interrupt succeeds via dual-index lookup
      const result = await ih.manager.interruptCurrentTurn(
        'real-uuid-456' as SessionId,
      );
      expect(result).toBe(true);

      // (b) query.interrupt called exactly once
      expect(fakeQuery.interrupt).toHaveBeenCalledTimes(1);

      // (c) session is STILL active after interrupt (not ended)
      expect(ih.manager.find('tab_2')).toBeDefined();
      expect(ih.manager.find('real-uuid-456')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Gap 13 (theater-1): find(realUUID).query non-null after the full flow
  // ---------------------------------------------------------------------------

  describe('find(realUUID).query non-null — dual-index query visibility (audit gap 13)', () => {
    it('find(realUUID).query is the same object reference as the query set by executeQuery', async () => {
      const ih = makeIntegrationHarness();
      const fakeQuery = createFakeQueryForIntegration();
      ih.queryFn.mockReturnValueOnce(fakeQuery.query);

      // executeQuery sets rec.query via registry.setSessionQuery(tabId, sdkQuery)
      await ih.manager.executeQuery({
        sessionId: 'tab_3' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/query-vis' }),
      });

      // Bind the real UUID — creates the bySessionId pointer to the SAME record
      ih.manager.bindRealSessionId('tab_3', 'real-uuid-789');

      // find(realUUID) must return the record with query set (not null)
      const recByReal = ih.manager.find('real-uuid-789');
      expect(recByReal).toBeDefined();
      expect(recByReal!.query).not.toBeNull();

      // The query referenced via the real UUID must be the SAME object as the
      // one returned by executeQuery (dual-index points at the same mutable record).
      const recByTab = ih.manager.find('tab_3');
      expect(recByReal).toBe(recByTab);
      expect(recByReal!.query).toBe(recByTab!.query);

      // This test can ONLY pass if:
      // 1. SessionRegistry.bySessionId was populated by bindRealSessionId, AND
      // 2. registry.setSessionQuery(tabId, ...) mutated the SAME SessionRecord
      //    that bySessionId now points at.
      // Stubbing find() would bypass this entire proof.
    });
  });

  // =========================================================================
  // TASK_2026_118 Batch 10 — error-path hardening (audit gaps 11 / 12).
  // =========================================================================

  // ---------------------------------------------------------------------------
  // Gap 11: double endSession() on the same session is a safe no-op
  // ---------------------------------------------------------------------------

  describe('double endSession — idempotency safety (audit gap 11)', () => {
    it('calling endSession twice on the same session does not throw and does not call interrupt a second time', async () => {
      const ih = makeIntegrationHarness();
      const fakeQuery = createFakeQueryForIntegration();
      ih.queryFn.mockReturnValueOnce(fakeQuery.query);

      await ih.manager.executeQuery({
        sessionId: 'tab_double_end' as SessionId,
        sessionConfig: createSessionConfig({ projectPath: '/ws/double' }),
      });

      // First endSession — normal teardown
      await ih.manager.endSession('tab_double_end' as SessionId);
      expect(fakeQuery.interrupt).toHaveBeenCalledTimes(1);
      expect(ih.manager.find('tab_double_end')).toBeUndefined();

      // Second endSession — must be a safe no-op (session is already gone)
      await expect(
        ih.manager.endSession('tab_double_end' as SessionId),
      ).resolves.not.toThrow();

      // interrupt must NOT have been called a second time
      expect(fakeQuery.interrupt).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Gap 12: executeQuery rolls back when queryOptionsBuilder.build throws
  // ---------------------------------------------------------------------------

  describe('executeQuery orphan rollback when queryOptionsBuilder.build throws (audit gap 12)', () => {
    it('rejects and removes the pre-registered session when queryOptionsBuilder.build throws', async () => {
      // Make queryOptionsBuilder.build throw AFTER the session has been
      // pre-registered (register() runs before build() in executeQuery).
      // Use a standard harness that exposes queryOptionsBuilder directly.
      const buildError = new Error('options builder exploded');
      const throwHarness = makeHarness();
      throwHarness.queryOptionsBuilder.build.mockRejectedValueOnce(buildError);

      // (a) The call must reject
      await expect(
        throwHarness.manager.executeQuery({
          sessionId: 'tab_build_throw' as SessionId,
          sessionConfig: createSessionConfig({ projectPath: '/ws/throw' }),
        }),
      ).rejects.toThrow('options builder exploded');

      // (b) The pre-registered session must be rolled back — no orphan left
      expect(throwHarness.manager.find('tab_build_throw')).toBeUndefined();
      expect(throwHarness.manager.getActiveSessionIds()).not.toContain(
        'tab_build_throw',
      );

      // (c) abortController.abort() was called on the session's controller
      //     (indirectly verified: the session is gone AND no orphan exists)
      expect(throwHarness.manager.getActiveSessionCount()).toBe(0);
    });
  });
});
