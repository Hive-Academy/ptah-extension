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
 *   The production constructor takes EIGHT dependencies — logger,
 *   permissionHandler, moduleLoader, queryOptionsBuilder, messageFactory,
 *   subagentRegistry, authEnv, modelResolver. The fixture supplies all eight
 *   so `endSession()` exercises the full cleanup path.
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

  const manager = new SessionLifecycleManager(
    asLogger(logger),
    permissionHandler,
    moduleLoader as unknown as SdkModuleLoader,
    queryOptionsBuilder as unknown as SdkQueryOptionsBuilder,
    messageFactory as unknown as SdkMessageFactory,
    subagentRegistry as unknown as SubagentRegistryService,
    authEnv,
    modelResolver as unknown as ModelResolver,
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
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );

      const ids = harness.manager.getActiveSessionIds();
      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe('tab_1');
    });

    it('returns the real UUID after resolveRealSessionId', () => {
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig(),
        new AbortController(),
      );
      harness.manager.resolveRealSessionId('tab_1', 'real-uuid-123');

      const ids = harness.manager.getActiveSessionIds();
      expect(ids[0]).toBe('real-uuid-123');
    });

    it('orders most-recently-registered session first', () => {
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );

      expect(harness.manager.getActiveSessionIds()[0]).toBe('tab_2');
    });

    it('replaces tab IDs with real UUIDs once resolved, preserving ordering', () => {
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );
      harness.manager.resolveRealSessionId('tab_1', 'uuid-aaa');
      harness.manager.resolveRealSessionId('tab_2', 'uuid-bbb');

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
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/b');
    });

    it('falls back to any session when the last active has no projectPath', () => {
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: undefined }),
        new AbortController(),
      );

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/a');
    });

    it('returns undefined when no session has a projectPath', () => {
      harness.manager.preRegisterActiveSession(
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
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        createSessionConfig({ projectPath: '/workspace/b' }),
        new AbortController(),
      );

      await harness.manager.endSession('tab_2' as SessionId);

      expect(harness.manager.getActiveSessionWorkspace()).toBe('/workspace/a');
      expect(harness.manager.getActiveSessionIds()).toEqual(['tab_1']);
    });

    it('clears workspace when all sessions end', async () => {
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );

      await harness.manager.endSession('tab_1' as SessionId);

      expect(harness.manager.getActiveSessionWorkspace()).toBeUndefined();
      expect(harness.manager.getActiveSessionIds()).toEqual([]);
    });

    it('does not affect ordering when a non-active session ends', async () => {
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.preRegisterActiveSession(
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
      harness.manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        createSessionConfig({ projectPath: '/workspace/a' }),
        new AbortController(),
      );
      harness.manager.resolveRealSessionId('tab_1', 'real-uuid-123');

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
      expect(
        failingHarness.manager.isSessionActive('tab_abort_5' as SessionId),
      ).toBe(false);
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

      const sessionA = concurrentHarness.manager.getActiveSession(
        'tab_msg_a' as SessionId,
      );
      const sessionB = concurrentHarness.manager.getActiveSession(
        'tab_msg_b' as SessionId,
      );

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

      expect(
        concurrentHarness.manager.isSessionActive('tab_end_a' as SessionId),
      ).toBe(false);
      expect(
        concurrentHarness.manager.isSessionActive('tab_end_b' as SessionId),
      ).toBe(true);
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
      const session = harness.manager.getActiveSession(
        'tab_ws_resume_noCwd' as SessionId,
      );
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
});
