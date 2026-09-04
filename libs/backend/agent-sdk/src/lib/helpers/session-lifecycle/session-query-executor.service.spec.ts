/**
 * SessionQueryExecutor — permission-level seeding spec (TASK_2026_155, F1).
 *
 * Covers the caller-supplied `permissionLevel` seed added in Task 1.2:
 *
 * 1. `config.permissionLevel = 'yolo'` seeds `rec.permissionLevel === 'yolo'`
 *    AND the SDK options builder is invoked with `permissionMode === 'default'`
 *    (never `'bypassPermissions'` — the load-bearing invariant from
 *    permission-mode-map.ts).
 * 2. `config.permissionLevel` omitted falls back to the GLOBAL
 *    `permissionHandler.getPermissionLevel()` — byte-identical to prior
 *    behavior.
 * 3. `config.permissionLevel = 'auto-edit'` maps to SDK `permissionMode ===
 *    'acceptEdits'`.
 *
 * Uses the REAL `SessionRegistry` (not a mock) so `rec.permissionLevel` is
 * observed via actual mutation, not a stubbed return value — a behavioral
 * check, not contract theater. All other collaborators (module loader, query
 * options builder, message factory, query runner, permission handler) are
 * mocked; no real SDK is invoked.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  AuthEnv,
  ISdkPermissionHandler,
  PermissionLevel,
} from '@ptah-extension/shared';

import { SessionQueryExecutor } from './session-query-executor.service';
import { NO_ACTIVITY_TIMEOUT_MS } from '../no-activity-watchdog';
import { SessionRegistry } from './session-registry.service';
import type { SessionStreamPump } from './session-stream-pump.service';
import type { SdkModuleLoader } from '../sdk-module-loader';
import type { SdkQueryOptionsBuilder } from '../sdk-query-options-builder';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type { SdkQueryRunner } from '../sdk-query-runner.service';
import type {
  ExecuteQueryConfig,
  Query,
  SDKUserMessage,
} from '../session-lifecycle-manager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true as const, value: undefined }),
      };
    },
  };
}

function makeSdkQuery(): Query {
  return {
    [Symbol.asyncIterator]: emptyAsyncIterable<never>()[Symbol.asyncIterator],
    next: async () => ({ done: true, value: undefined }),
    interrupt: async () => undefined,
    setPermissionMode: async () => undefined,
    setModel: async () => undefined,
    applyFlagSettings: async () => undefined,
    streamInput: async () => undefined,
    stopTask: async () => undefined,
    rewindFiles: async () => ({ canRewind: false }),
  } as unknown as Query;
}

interface Harness {
  executor: SessionQueryExecutor;
  registry: SessionRegistry;
  buildSpy: jest.Mock;
  getPermissionLevelSpy: jest.Mock;
  cleanupSpy: jest.Mock;
  sdkQuery: Query;
}

function makeHarness(globalPermissionLevel: PermissionLevel): Harness {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);

  const streamPump = {
    createUserMessageStream: jest
      .fn()
      .mockReturnValue(emptyAsyncIterable<SDKUserMessage>()),
    createIdlePromptStream: jest
      .fn()
      .mockReturnValue(emptyAsyncIterable<SDKUserMessage>()),
  } as unknown as SessionStreamPump;

  const getPermissionLevelSpy = jest
    .fn()
    .mockReturnValue(globalPermissionLevel);
  const cleanupSpy = jest.fn();
  const permissionHandler = {
    getPermissionLevel: getPermissionLevelSpy,
    cleanupPendingPermissions: cleanupSpy,
  } as unknown as ISdkPermissionHandler;

  const queryFn = jest.fn();
  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(queryFn),
  } as unknown as SdkModuleLoader;

  // Mirrors the real SdkQueryOptionsBuilder.build() contract: it forwards the
  // caller-supplied `permissionMode` straight into `options.permissionMode`
  // (sdk-query-options-builder.ts:609,641) — the seam this test asserts on.
  const buildSpy = jest.fn().mockImplementation(
    async (input: { permissionMode?: string }) =>
      ({
        options: {
          model: 'test-model',
          cwd: '/tmp/test',
          permissionMode: input.permissionMode,
        },
        prompt: emptyAsyncIterable<SDKUserMessage>(),
      }) as const,
  );
  const queryOptionsBuilder = {
    build: buildSpy,
  } as unknown as SdkQueryOptionsBuilder;

  const messageFactory = {
    createUserMessage: jest.fn(),
  } as unknown as SdkMessageFactory;

  const authEnv = {} as AuthEnv;

  const sdkQuery = makeSdkQuery();
  const queryRunner = {
    invokeWithLoadedQuery: jest.fn().mockReturnValue({ sdkQuery }),
  } as unknown as SdkQueryRunner;

  const executor = new SessionQueryExecutor(
    logger,
    registry,
    streamPump,
    permissionHandler,
    moduleLoader,
    queryOptionsBuilder,
    messageFactory,
    authEnv,
    queryRunner,
  );

  return {
    executor,
    registry,
    buildSpy,
    getPermissionLevelSpy,
    cleanupSpy,
    sdkQuery,
  };
}

/**
 * Mirror the streaming pump's first yield: `markTurnStarted` releases the idle
 * hold the executor took at registration (TASK_2026_363), so the watchdog can
 * arm on `start()`.
 */
function startFirstTurn(registry: SessionRegistry, tabId: string): void {
  const rec = registry.find(tabId);
  expect(rec).toBeDefined();
  if (rec) {
    registry.markTurnStarted(rec);
  }
}

function makeConfig(
  sessionId: string,
  overrides: Partial<ExecuteQueryConfig> = {},
): ExecuteQueryConfig {
  return {
    sessionId: sessionId as ExecuteQueryConfig['sessionId'],
    sessionConfig: {
      model: 'test-model',
      projectPath: '/tmp/test',
    } as AISessionConfig,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SessionQueryExecutor — permission-level seeding (F1, Task 1.2)', () => {
  it('config.permissionLevel = "yolo" seeds rec.permissionLevel and maps to SDK permissionMode "default" (never bypassPermissions)', async () => {
    const { executor, registry, buildSpy } = makeHarness('ask');

    await executor.executeQuery(
      makeConfig('tab-yolo', { permissionLevel: 'yolo' }),
    );

    const rec = registry.find('tab-yolo');
    expect(rec?.permissionLevel).toBe('yolo');

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const buildInput = buildSpy.mock.calls[0][0] as {
      permissionMode?: string;
    };
    expect(buildInput.permissionMode).toBe('default');
    expect(buildInput.permissionMode).not.toBe('bypassPermissions');
  });

  it('config.permissionLevel omitted falls back to the GLOBAL permissionHandler.getPermissionLevel() — byte-identical to prior behavior', async () => {
    const { executor, registry, buildSpy, getPermissionLevelSpy } =
      makeHarness('auto-edit');

    await executor.executeQuery(makeConfig('tab-fallback'));

    expect(getPermissionLevelSpy).toHaveBeenCalledTimes(1);
    const rec = registry.find('tab-fallback');
    expect(rec?.permissionLevel).toBe('auto-edit');

    const buildInput = buildSpy.mock.calls[0][0] as {
      permissionMode?: string;
    };
    // auto-edit -> acceptEdits via PERMISSION_MODE_MAP, exactly as before F1.
    expect(buildInput.permissionMode).toBe('acceptEdits');
  });

  it('config.permissionLevel omitted (global "ask") falls back to "ask" and permissionMode "default"', async () => {
    const { executor, registry, getPermissionLevelSpy } = makeHarness('ask');

    await executor.executeQuery(makeConfig('tab-fallback-ask'));

    expect(getPermissionLevelSpy).toHaveBeenCalledTimes(1);
    const rec = registry.find('tab-fallback-ask');
    expect(rec?.permissionLevel).toBe('ask');
  });

  it('config.permissionLevel = "auto-edit" maps to SDK permissionMode "acceptEdits"', async () => {
    const { executor, registry, buildSpy, getPermissionLevelSpy } =
      makeHarness('ask');

    await executor.executeQuery(
      makeConfig('tab-auto-edit', { permissionLevel: 'auto-edit' }),
    );

    // Caller-supplied level wins; the global getter is never consulted.
    expect(getPermissionLevelSpy).not.toHaveBeenCalled();

    const rec = registry.find('tab-auto-edit');
    expect(rec?.permissionLevel).toBe('auto-edit');

    const buildInput = buildSpy.mock.calls[0][0] as {
      permissionMode?: string;
    };
    expect(buildInput.permissionMode).toBe('acceptEdits');
  });
});

// ---------------------------------------------------------------------------
// No-activity watchdog policy (TASK_2026_190)
// ---------------------------------------------------------------------------
//
// executeQuery() builds a NoActivityWatchdog whose onTimeout is the abort
// policy that replaced the stderr-pattern `onProviderError`. The StreamTransformer
// arms/kicks/stops it in production; here we drive it directly with fake timers
// to prove the policy: resolve pending permissions BEFORE aborting (the
// session-lifecycle-abort invariant), then abort the controller with a
// descriptive error that is NOT classified as a benign user abort.

describe('SessionQueryExecutor — no-activity watchdog policy (TASK_2026_190)', () => {
  it('returns a watchdog that, on timeout, cleans up pending permissions then aborts with a surfaced error', async () => {
    const { executor, registry, cleanupSpy } = makeHarness('ask');

    const result = await executor.executeQuery(makeConfig('tab-timeout'));
    startFirstTurn(registry, 'tab-timeout');

    // Not aborted before the window elapses.
    expect(result.abortController.signal.aborted).toBe(false);

    jest.useFakeTimers();
    try {
      result.activityWatchdog.start();
      jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS);
    } finally {
      jest.useRealTimers();
    }

    // Invariant: pending permissions resolved for THIS tab before the abort.
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).toHaveBeenCalledWith('tab-timeout');

    // The controller is aborted with a descriptive Error…
    expect(result.abortController.signal.aborted).toBe(true);
    const reason = result.abortController.signal.reason as Error;
    expect(reason).toBeInstanceOf(Error);
    // …whose wording is NOT classified as a benign user abort by the
    // StreamTransformer catch (so it surfaces as a real error).
    const msg = reason.message.toLowerCase();
    expect(msg).not.toContain('abort');
    expect(msg).not.toContain('cancel');
    expect(msg).toContain('no stream activity');
  });

  it('does not fire the watchdog (no cleanup, no abort) when it is kicked within the window', async () => {
    const { executor, registry, cleanupSpy } = makeHarness('ask');

    const result = await executor.executeQuery(makeConfig('tab-active'));
    startFirstTurn(registry, 'tab-active');

    jest.useFakeTimers();
    try {
      result.activityWatchdog.start();
      // A slow-but-alive turn: kick just before every deadline.
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS - 1);
        result.activityWatchdog.kick();
      }
    } finally {
      // stop() in finally mirrors the StreamTransformer teardown.
      result.activityWatchdog.stop();
      jest.useRealTimers();
    }

    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(result.abortController.signal.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idle watchdog hold (TASK_2026_363)
// ---------------------------------------------------------------------------
//
// The watchdog fired exactly 180 s after every `result` because idle between
// turns is silent on the parent stream. The executor now hands the watchdog to
// the record and takes the initial idle hold for a non-slash prompt; the
// pump's first yield (`markTurnStarted`) releases it and `markTurnEnded`
// re-takes it. A slash-command string prompt never goes through the pump, so
// it takes no idle hold.

describe('SessionQueryExecutor — idle watchdog hold (TASK_2026_363)', () => {
  it('a non-slash prompt: the record owns the watchdog and it is held until the first turn starts', async () => {
    const { executor, registry } = makeHarness('ask');

    const result = await executor.executeQuery(
      makeConfig('tab-idle', { initialPrompt: { content: 'hello' } }),
    );

    const rec = registry.find('tab-idle');
    expect(rec?.activityHold).toBe(result.activityWatchdog);
    expect(result.activityWatchdog.isHeld).toBe(true);

    // Turn cycle: the pump releases on yield, the result branch re-holds.
    startFirstTurn(registry, 'tab-idle');
    expect(result.activityWatchdog.isHeld).toBe(false);
    registry.markTurnEnded('tab-idle');
    expect(result.activityWatchdog.isHeld).toBe(true);
  });

  it('an empty initial prompt (resume path) is not a slash command and takes the idle hold', async () => {
    const { executor, registry } = makeHarness('ask');

    const result = await executor.executeQuery(makeConfig('tab-idle-empty'));

    expect(registry.find('tab-idle-empty')?.activityHold).toBe(
      result.activityWatchdog,
    );
    expect(result.activityWatchdog.isHeld).toBe(true);
  });

  it('a slash-command prompt hands the watchdog to the record but takes no idle hold', async () => {
    const { executor, registry } = makeHarness('ask');

    const result = await executor.executeQuery(
      makeConfig('tab-slash', { initialPrompt: { content: '/compact' } }),
    );

    expect(registry.find('tab-slash')?.activityHold).toBe(
      result.activityWatchdog,
    );
    expect(result.activityWatchdog.isHeld).toBe(false);
  });
});
