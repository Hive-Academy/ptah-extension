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
  SessionId,
  AuthEnv,
  ISdkPermissionHandler,
  PermissionLevel,
} from '@ptah-extension/shared';

import { SessionControl } from './session-control.service';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type { IModelResolver } from '../../auth-env.port';
import type { SessionEndCallbackRegistry } from '../session-end-callback-registry';
import {
  SessionQueryExecutor,
  classifyUsageCostSource,
  resolveCapacityRoute,
} from './session-query-executor.service';
import { NO_ACTIVITY_TIMEOUT_MS } from '../no-activity-watchdog';
import { SessionRegistry } from './session-registry.service';
import { SessionStreamPump } from './session-stream-pump.service';
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

  const streamPump = new SessionStreamPump(
    logger,
    registry,
    {} as SdkMessageFactory,
  );

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
    createUserMessage: jest.fn().mockResolvedValue({
      type: 'user',
      session_id: 's',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
    }),
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
  it('freezes the exact effective profile capacity route on the query record', async () => {
    const { executor, registry } = makeHarness('ask');
    const authEnvOverride = {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:418',
      ANTHROPIC_AUTH_TOKEN: 'codex-proxy-managed',
    };
    const result = await executor.executeQuery(
      makeConfig('capacity-profile', { authEnvOverride }),
    );
    authEnvOverride.ANTHROPIC_AUTH_TOKEN = 'openrouter-proxy-token';
    expect(result.capacityRoute).toEqual({
      kind: 'proxy',
      providerId: 'openai-codex',
    });
    expect(registry.find('capacity-profile')?.capacityRoute).toBe(
      result.capacityRoute,
    );
    expect(Object.isFrozen(result.capacityRoute)).toBe(true);
  });

  it('rejects route substrings and remote proxy-token impersonation for capacity', () => {
    expect(resolveCapacityRoute({})).toEqual({
      kind: 'native',
      providerId: 'anthropic',
    });
    expect(
      resolveCapacityRoute({
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      }),
    ).toEqual({ kind: 'proxy', providerId: 'openrouter' });
    for (const url of [
      'https://api.anthropic.com.evil.test',
      'https://evil.test/openrouter.ai',
      'https://openrouter.ai/api/v1/custom',
      'not-a-url',
    ]) {
      expect(
        resolveCapacityRoute({
          ANTHROPIC_BASE_URL: url,
          ANTHROPIC_AUTH_TOKEN: 'codex-proxy-managed',
        }),
      ).toEqual({ kind: 'proxy', providerId: null });
    }
  });
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
// Cost authority frozen at query creation (TASK_2026_533)
// ---------------------------------------------------------------------------

describe('SessionQueryExecutor — usage cost authority (TASK_2026_533)', () => {
  it('classifies the route: native SDK-priced -> reported; translated or custom -> unreported', () => {
    expect(classifyUsageCostSource({} as AuthEnv)).toBe('reported');
    expect(
      classifyUsageCostSource({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      } as AuthEnv),
    ).toBe('reported');
    expect(
      classifyUsageCostSource({
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123',
      } as AuthEnv),
    ).toBe('unreported');
  });

  it('freezes the authority of the EFFECTIVE route on the record and returns it with the run token', async () => {
    const { executor, registry } = makeHarness('ask');

    const direct = await executor.executeQuery(makeConfig('tab-direct'));
    const proxied = await executor.executeQuery(
      makeConfig('tab-proxied', {
        authEnvOverride: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123',
        } as AuthEnv,
      }),
    );

    expect(direct.usageCostSource).toBe('reported');
    expect(registry.find('tab-direct')?.usageCostSource).toBe('reported');
    // The per-session provider profile wins over the global route.
    expect(proxied.usageCostSource).toBe('unreported');
    expect(registry.find('tab-proxied')?.usageCostSource).toBe('unreported');
    expect(proxied.sessionToken).toBe(registry.find('tab-proxied')?.token);
  });

  // Review F4: pricing alias resolution uses a frozen COPY of the effective
  // env, so mutating the source env later cannot re-price the running query.
  it('freezes a copy of the effective auth env for pricing', async () => {
    const { executor, registry } = makeHarness('ask');
    const override = {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'model-a',
    } as AuthEnv;

    const result = await executor.executeQuery(
      makeConfig('tab-frozen', { authEnvOverride: override }),
    );
    (override as Record<string, string>)['ANTHROPIC_DEFAULT_SONNET_MODEL'] =
      'model-b';

    expect(result.accountingAuthEnv).not.toBe(override);
    expect(result.accountingAuthEnv['ANTHROPIC_DEFAULT_SONNET_MODEL']).toBe(
      'model-a',
    );
    expect(Object.isFrozen(result.accountingAuthEnv)).toBe(true);
    expect(registry.find('tab-frozen')?.accountingAuthEnv).toBe(
      result.accountingAuthEnv,
    );
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
// the record and takes the initial idle hold only when the prompt is EMPTY;
// the pump's first yield (`markTurnStarted`) releases it and `markTurnEnded`
// re-takes it. A queued initial prompt is startup work, not between-turn idle,
// so it takes no hold — and since TASK_2026_472 a slash command is a queued
// prompt like any other, so it lands on that same branch.

describe('SessionQueryExecutor — idle watchdog hold (TASK_2026_363)', () => {
  it('a non-slash prompt: the record owns the watchdog and it is held until the first turn starts', async () => {
    const { executor, registry } = makeHarness('ask');

    const result = await executor.executeQuery(
      makeConfig('tab-idle', { initialPrompt: { content: 'hello' } }),
    );

    const rec = registry.find('tab-idle');
    expect(rec?.activityHold).toBe(result.activityWatchdog);
    expect(result.activityWatchdog.isHeld).toBe(false);

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

  it('a slash-command prompt hands the watchdog to the record but takes no idle hold (it is queued content, TASK_2026_472)', async () => {
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

describe('real watchdog query ownership regressions', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('bounds initial startup even when SDK never consumes input', async () => {
    const { executor } = makeHarness('ask');
    const result = await executor.executeQuery(
      makeConfig('startup', { initialPrompt: { content: 'hello' } }),
    );
    result.activityWatchdog.start();
    jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS);
    expect(result.abortController.signal.aborted).toBe(true);
  });

  it('real pump starts a turn, result protects idle, and pending approval protects long wait', async () => {
    const { executor, registry } = makeHarness('ask');
    const result = await executor.executeQuery(
      makeConfig('pump', { initialPrompt: { content: 'hello' } }),
    );
    const pump = new SessionStreamPump(
      makeLogger(),
      registry,
      {} as SdkMessageFactory,
    );
    result.activityWatchdog.start();
    const stream = pump.createUserMessageStream(
      'pump' as SessionId,
      result.abortController,
    );
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    expect(registry.find('pump')?.turnInFlight).toBe(true);
    result.activityWatchdog.hold();
    jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS * 5);
    expect(result.abortController.signal.aborted).toBe(false);
    result.activityWatchdog.release();
    registry.markTurnEnded('pump');
    jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS * 5);
    expect(result.abortController.signal.aborted).toBe(false);
    result.abortController.abort();
    await iterator.return?.();
  });

  it.each(['reject', 'timeout'])(
    'retires %s interrupt query; delayed A hooks cannot protect replacement B',
    async (mode) => {
      const { executor, registry, sdkQuery } = makeHarness('ask');
      const a = await executor.executeQuery(
        makeConfig('same', { initialPrompt: { content: 'A' } }),
      );
      a.activityWatchdog.start();
      const oldHook =
        a.activityWatchdog.lifecycleHooks().PreToolUse![0].hooks[0];
      const input = {
        hook_event_name: 'PreToolUse' as const,
        session_id: 'same',
        cwd: '/ws',
        transcript_path: '/ws/a',
        tool_name: 'Agent',
        tool_use_id: 'old',
        tool_input: {},
      };
      const opts = { signal: new AbortController().signal };
      sdkQuery.interrupt =
        mode === 'reject'
          ? jest.fn().mockRejectedValue(new Error('transport failed'))
          : jest.fn().mockReturnValue(new Promise(() => undefined));
      const cleanup = jest.fn(() => {
        if (mode === 'reject') throw new Error('cleanup failed');
      });
      const children = {
        beginSessionTeardown: jest.fn(),
        markAllInterrupted: jest.fn(),
        endSessionTeardown: jest.fn(),
      };
      const control = new SessionControl(
        makeLogger(),
        registry,
        {
          cleanupPendingPermissions: cleanup,
        } as unknown as ISdkPermissionHandler,
        children as unknown as SubagentRegistryService,
        {} as IModelResolver,
        {} as SessionEndCallbackRegistry,
      );
      const interruption = control.interruptCurrentTurn('same' as SessionId);
      if (mode === 'timeout') await jest.advanceTimersByTimeAsync(3000);
      expect(await interruption).toBe(false);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(children.markAllInterrupted).toHaveBeenCalledTimes(1);
      expect(children.endSessionTeardown).toHaveBeenCalledTimes(1);
      expect(a.abortController.signal.aborted).toBe(true);
      expect(registry.find('same')).toBeUndefined();
      await oldHook(input, 'old', opts);
      const b = await executor.executeQuery(
        makeConfig('same', { initialPrompt: { content: 'B' } }),
      );
      b.activityWatchdog.start();
      await oldHook(input, 'old', opts);
      jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS);
      expect(b.abortController.signal.aborted).toBe(true);
    },
  );
});
