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
  SubagentPromptCacheTtl,
} from '@ptah-extension/shared';

import { SessionControl } from './session-control.service';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type { IModelResolver } from '../../auth-env.port';
import type { SessionEndCallbackRegistry } from '../session-end-callback-registry';
import {
  SessionQueryExecutor,
  classifyUsageCostSource,
  resolveCapacityRoute,
  type CompactionCoordinatorSink,
} from './session-query-executor.service';
import type { SubagentBudgetSink } from './session-query-executor.service';
import { CompactionCoordinator } from '../compaction/compaction-coordinator';
import { SubagentBudgetMonitor } from '../compaction/subagent-budget-monitor';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import {
  COMPACTION_MAX_DWELL_MS,
  type CompactionTimers,
} from '../compaction/compaction-state.types';
import type {
  ContextUsageReading,
  IContextUsagePort,
} from '../compaction/context-usage.port';
import type { SDKMessage } from '../../types/sdk-types/claude-sdk.types';
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

function makeHarness(
  globalPermissionLevel: PermissionLevel,
  authEnv: AuthEnv = {} as AuthEnv,
  compaction: {
    coordinator?: CompactionCoordinatorSink;
    port?: IContextUsagePort;
    subagentMonitor?: SubagentBudgetSink;
    logger?: Logger;
    /** What the options build reports as the effective subagent cache TTL. */
    subagentCacheTtl?: SubagentPromptCacheTtl;
  } = {},
): Harness {
  const logger = compaction.logger ?? makeLogger();
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
        ...(compaction.subagentCacheTtl
          ? { subagentPromptCacheTtl: compaction.subagentCacheTtl }
          : {}),
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
    null,
    null,
    compaction.coordinator ?? null,
    compaction.port ?? null,
    compaction.subagentMonitor ?? null,
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

  it('builds the SDK query from the same auth snapshot that classified its capacity route', async () => {
    // The global env object is mutated in place on an auth change; one that
    // lands while the query is still initialising must not split the recorded
    // capacity route from the provider the SDK query actually talks to.
    const globalAuthEnv: AuthEnv = {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:418',
      ANTHROPIC_AUTH_TOKEN: 'codex-proxy-managed',
    };
    const { executor, buildSpy } = makeHarness('ask', globalAuthEnv);
    buildSpy.mockImplementationOnce(
      async (input: { authEnvOverride?: AuthEnv }) => {
        expect(input.authEnvOverride).toEqual({
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:418',
          ANTHROPIC_AUTH_TOKEN: 'codex-proxy-managed',
        });
        return {
          options: { model: 'test-model', cwd: '/tmp/test' },
          prompt: emptyAsyncIterable<SDKUserMessage>(),
        };
      },
    );
    const pending = executor.executeQuery(makeConfig('capacity-snapshot'));
    globalAuthEnv.ANTHROPIC_BASE_URL = 'https://openrouter.ai/api';
    globalAuthEnv.ANTHROPIC_AUTH_TOKEN = 'sk-or-live';

    const result = await pending;

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const buildInput = buildSpy.mock.calls[0][0] as {
      authEnvOverride?: AuthEnv;
    };
    expect(buildInput.authEnvOverride).toBe(result.accountingAuthEnv);
    expect(Object.isFrozen(buildInput.authEnvOverride)).toBe(true);
    expect(result.capacityRoute).toEqual({
      kind: 'proxy',
      providerId: 'openai-codex',
    });
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

// ---------------------------------------------------------------------------
// A8 compaction coordinator + context-usage port wiring (TASK_2026_597, 27b)
// ---------------------------------------------------------------------------

describe('SessionQueryExecutor — compaction coordinator wiring (TASK_2026_597 A8)', () => {
  const noTimers: CompactionTimers = {
    setTimeout: () => undefined,
    clearTimeout: () => undefined,
  };
  const REAL = 'sdk-real-uuid';

  function msg(value: Record<string, unknown>): SDKMessage {
    return value as unknown as SDKMessage;
  }
  const init = () => msg({ type: 'system', subtype: 'init', session_id: REAL });
  const result = () =>
    msg({
      type: 'result',
      subtype: 'success',
      session_id: REAL,
      parent_tool_use_id: null,
    });
  const compacting = () =>
    msg({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      session_id: REAL,
    });
  const boundary = (pre = 170_000, post = 30_000) =>
    msg({
      type: 'system',
      subtype: 'compact_boundary',
      session_id: REAL,
      compact_metadata: { trigger: 'auto', pre_tokens: pre, post_tokens: post },
    });

  function makePort(reading?: ContextUsageReading): {
    port: IContextUsagePort;
    readAtTurnEnd: jest.Mock;
    release: jest.Mock;
  } {
    const readAtTurnEnd = jest.fn().mockResolvedValue(reading);
    const release = jest.fn();
    return {
      port: { readAtTurnEnd, release, getLast: jest.fn() },
      readAtTurnEnd,
      release,
    };
  }

  /** A coordinator whose class decision is forced to "may act" for the spec. */
  function actingCoordinator(): CompactionCoordinator {
    const coordinator = new CompactionCoordinator(noTimers);
    const register = coordinator.register.bind(coordinator);
    jest
      .spyOn(coordinator, 'register')
      .mockImplementation((id) =>
        register(id, { codexProxy: false, e2Passed: true }),
      );
    return coordinator;
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('registers under the real SDK session id from the stream, not the tab id', async () => {
    const coordinator = new CompactionCoordinator(noTimers);
    const registerSpy = jest.spyOn(coordinator, 'register');
    const { executor } = makeHarness('ask', {} as AuthEnv, { coordinator });

    const run = await executor.executeQuery(
      makeConfig('tab_1', {
        sessionConfig: { tabId: 'tab_1', model: 'm' } as AISessionConfig,
      }),
    );
    run.activityWatchdog.observe(init());
    run.activityWatchdog.observe(init());

    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith(REAL, {
      codexProxy: false,
      e2Passed: null,
    });
    // No E2 has passed yet, so the session only observes.
    expect(coordinator.getState(REAL)).toBe('OBSERVE_ONLY');
    expect(coordinator.getState('tab_1')).toBeUndefined();
    run.abortController.abort();
  });

  it('classes the Codex proxy route as codexProxy', async () => {
    const coordinator = new CompactionCoordinator(noTimers);
    const registerSpy = jest.spyOn(coordinator, 'register');
    const { executor } = makeHarness(
      'ask',
      {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:418',
        ANTHROPIC_AUTH_TOKEN: 'codex-proxy-managed',
      } as AuthEnv,
      { coordinator },
    );

    const run = await executor.executeQuery(makeConfig('codex-tab'));
    run.activityWatchdog.observe(init());

    expect(registerSpy).toHaveBeenCalledWith(REAL, {
      codexProxy: true,
      e2Passed: null,
    });
    run.abortController.abort();
  });

  it('feeds status:compacting and compact_boundary to the coordinator', async () => {
    const coordinator = actingCoordinator();
    const { executor } = makeHarness('ask', {} as AuthEnv, { coordinator });
    const run = await executor.executeQuery(makeConfig('tab_2'));
    run.activityWatchdog.observe(init());
    coordinator.onPreCompact(REAL, 'auto'); // as the PreCompact hook does

    run.activityWatchdog.observe(compacting());
    expect(coordinator.getState(REAL)).toBe('COMPACTING');

    const boundarySpy = jest.spyOn(coordinator, 'onCompactBoundary');
    run.activityWatchdog.observe(boundary(170_000, 30_000));
    expect(boundarySpy).toHaveBeenCalledWith(REAL, {
      preTokens: 170_000,
      postTokens: 30_000,
    });
    expect(coordinator.getState(REAL)).toBe('COOLDOWN');
    run.abortController.abort();
  });

  it('ignores subagent messages', async () => {
    const coordinator = actingCoordinator();
    const { executor } = makeHarness('ask', {} as AuthEnv, { coordinator });
    const run = await executor.executeQuery(makeConfig('tab_3'));
    run.activityWatchdog.observe(init());
    coordinator.onPreCompact(REAL, 'auto');

    run.activityWatchdog.observe(
      msg({
        type: 'system',
        subtype: 'status',
        status: 'compacting',
        session_id: REAL,
        parent_tool_use_id: 'toolu_child',
      }),
    );

    expect(coordinator.getState(REAL)).toBe('TRIGGERED');
    run.abortController.abort();
  });

  it('calls the port exactly once per turn end, keyed on the real id, and feeds the reading', async () => {
    const coordinator = actingCoordinator();
    const reading: ContextUsageReading = {
      totalTokens: 170_000,
      maxTokens: 200_000,
      source: 'sdk-getContextUsage',
    };
    const { port, readAtTurnEnd } = makePort(reading);
    const { executor, sdkQuery } = makeHarness('ask', {} as AuthEnv, {
      coordinator,
      port,
    });
    const run = await executor.executeQuery(makeConfig('tab_4'));
    run.activityWatchdog.observe(init());
    run.activityWatchdog.observe(
      msg({ type: 'assistant', session_id: REAL, parent_tool_use_id: null }),
    );
    expect(readAtTurnEnd).not.toHaveBeenCalled();

    run.activityWatchdog.observe(result());
    await flush();

    expect(readAtTurnEnd).toHaveBeenCalledTimes(1);
    expect(readAtTurnEnd).toHaveBeenCalledWith(
      REAL,
      expect.any(String),
      sdkQuery,
    );
    expect(coordinator.getState(REAL)).toBe('ARMED');

    run.activityWatchdog.observe(result());
    await flush();
    expect(readAtTurnEnd).toHaveBeenCalledTimes(2);
    // Each turn end gets its own turn id.
    expect(readAtTurnEnd.mock.calls[0][1]).not.toBe(
      readAtTurnEnd.mock.calls[1][1],
    );
    run.abortController.abort();
  });

  it('releases the coordinator and the port on session end, idempotently', async () => {
    const coordinator = new CompactionCoordinator(noTimers);
    const { port, release, readAtTurnEnd } = makePort();
    const { executor } = makeHarness('ask', {} as AuthEnv, {
      coordinator,
      port,
    });
    const run = await executor.executeQuery(makeConfig('tab_5'));
    run.activityWatchdog.observe(init());
    expect(coordinator.getState(REAL)).toBeDefined();

    run.abortController.abort();
    run.abortController.abort();

    expect(coordinator.getState(REAL)).toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(REAL);

    // Nothing is fed after release.
    run.activityWatchdog.observe(init());
    run.activityWatchdog.observe(result());
    expect(coordinator.getState(REAL)).toBeUndefined();
    expect(readAtTurnEnd).not.toHaveBeenCalled();
  });

  it('releases on a normal stream end with no abort, and a resumed run registers afresh (TASK_2026_614 D.2)', async () => {
    const coordinator = new CompactionCoordinator(noTimers);
    const registerSpy = jest.spyOn(coordinator, 'register');
    const { port, release } = makePort();
    const monitorRelease = jest.fn();
    const monitor = {
      observe: jest.fn().mockResolvedValue(undefined),
      release: monitorRelease,
    } as unknown as SubagentBudgetSink;
    const { executor } = makeHarness('ask', {} as AuthEnv, {
      coordinator,
      port,
      subagentMonitor: monitor,
    });
    const run = await executor.executeQuery(makeConfig('tab_end'));
    run.activityWatchdog.observe(init());
    run.activityWatchdog.observe(
      msg({ type: 'assistant', session_id: REAL, parent_tool_use_id: 'tu_1' }),
    );
    expect(coordinator.getState(REAL)).toBeDefined();

    // What StreamTransformer's `finally` does when the stream simply ends.
    run.activityWatchdog.stop();
    run.activityWatchdog.stop();

    expect(run.abortController.signal.aborted).toBe(false);
    expect(coordinator.getState(REAL)).toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(REAL);
    expect(monitorRelease).toHaveBeenCalledTimes(1);
    expect(monitorRelease).toHaveBeenCalledWith(REAL);

    // A later abort of the ended run releases nothing twice.
    run.abortController.abort();
    expect(release).toHaveBeenCalledTimes(1);
    expect(monitorRelease).toHaveBeenCalledTimes(1);

    // The resumed run of the same SDK session finds no stale record.
    const resumed = await executor.executeQuery(
      makeConfig(REAL, { resumeSessionId: REAL }),
    );
    resumed.activityWatchdog.observe(init());
    expect(registerSpy).toHaveBeenCalledTimes(2);
    expect(coordinator.getState(REAL)).toBe('OBSERVE_ONLY');
    resumed.abortController.abort();
  });

  describe('compaction dwell bound scope (TASK_2026_597 S1)', () => {
    /** Starts the watchdog under fake timers and opens a root compaction. */
    async function openCompaction(
      coordinator: CompactionCoordinator,
      tabId: string,
    ) {
      const { executor, registry } = makeHarness('ask', {} as AuthEnv, {
        coordinator,
      });
      const run = await executor.executeQuery(makeConfig(tabId));
      startFirstTurn(registry, tabId);
      jest.useFakeTimers();
      run.activityWatchdog.start();
      run.activityWatchdog.observe(init());
      run.activityWatchdog.observe(compacting());
      return run;
    }

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('an OBSERVE_ONLY session survives a 400 s compaction (B8 behaviour)', async () => {
      const coordinator = new CompactionCoordinator(noTimers);
      const run = await openCompaction(coordinator, 'tab_dwell_observe');
      expect(coordinator.getState(REAL)).toBe('OBSERVE_ONLY');

      jest.advanceTimersByTime(400_000);
      expect(run.abortController.signal.aborted).toBe(false);

      run.activityWatchdog.observe(boundary());
      jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS - 1);
      expect(run.abortController.signal.aborted).toBe(false);
      run.activityWatchdog.stop();
      run.abortController.abort();
    });

    it('a controlled session times out at the 300 s bound with its own message', async () => {
      const coordinator = actingCoordinator();
      const run = await openCompaction(coordinator, 'tab_dwell_acting');
      expect(coordinator.getState(REAL)).not.toBe('OBSERVE_ONLY');

      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS - 1);
      expect(run.abortController.signal.aborted).toBe(false);
      jest.advanceTimersByTime(1);

      expect(run.abortController.signal.aborted).toBe(true);
      const message = (run.abortController.signal.reason as Error).message;
      expect(message).toContain(
        `Compaction did not finish within ${COMPACTION_MAX_DWELL_MS / 1000}s`,
      );
      expect(message.toLowerCase()).not.toContain('no stream activity');
      expect(message.toLowerCase()).not.toContain('abort');
    });

    it('a controlled session still completes a 216 s compaction (B8 measurement)', async () => {
      const coordinator = actingCoordinator();
      const run = await openCompaction(coordinator, 'tab_dwell_b8');

      jest.advanceTimersByTime(216_000);
      run.activityWatchdog.observe(boundary());
      jest.advanceTimersByTime(NO_ACTIVITY_TIMEOUT_MS - 1);

      expect(run.abortController.signal.aborted).toBe(false);
      run.activityWatchdog.stop();
      run.abortController.abort();
    });
  });

  it('is fail-open: a throwing coordinator or a rejecting port never breaks the turn', async () => {
    const logger = makeLogger();
    const boom = () => {
      throw new Error('coordinator boom');
    };
    const coordinator: CompactionCoordinatorSink = {
      register: jest.fn(boom),
      unregister: jest.fn(boom),
      getState: jest.fn(() => undefined),
      onStatusCompacting: jest.fn(boom),
      onCompactBoundary: jest.fn(boom),
      onTurnEnd: jest.fn(boom),
      onContextUsage: jest.fn(boom),
    };
    const readAtTurnEnd = jest.fn().mockRejectedValue(new Error('port boom'));
    const port: IContextUsagePort = {
      readAtTurnEnd,
      getLast: jest.fn(),
      release: jest.fn(),
    };
    const { executor } = makeHarness('ask', {} as AuthEnv, {
      coordinator,
      port,
      logger,
    });
    const run = await executor.executeQuery(makeConfig('tab_6'));

    expect(() => {
      run.activityWatchdog.observe(init());
      run.activityWatchdog.observe(compacting());
      run.activityWatchdog.observe(boundary());
      run.activityWatchdog.observe(result());
    }).not.toThrow();
    await flush();

    const warnTexts = (logger.warn as jest.Mock).mock.calls.map(
      (call) => call[0] as string,
    );
    // One line per failed event: register, status, boundary, turn end, port.
    expect(
      warnTexts.filter((t) => t.includes('the turn continues')),
    ).toHaveLength(5);
    expect(logger.error).not.toHaveBeenCalled();
    expect(readAtTurnEnd).toHaveBeenCalledTimes(1);
    expect(() => run.abortController.abort()).not.toThrow();
  });

  it('keeps no compaction bookkeeping without a coordinator or port', async () => {
    const { executor } = makeHarness('ask');
    const run = await executor.executeQuery(makeConfig('tab_7'));
    expect(() => {
      run.activityWatchdog.observe(init());
      run.activityWatchdog.observe(result());
    }).not.toThrow();
    run.abortController.abort();
  });
});

describe('SessionQueryExecutor — subagent budget monitor wiring (TASK_2026_597 28b)', () => {
  const REAL = 'sdk-real-uuid';
  const msg = (value: Record<string, unknown>) =>
    value as unknown as SDKMessage;
  const init = () => msg({ type: 'system', subtype: 'init', session_id: REAL });
  const mainAssistant = () =>
    msg({ type: 'assistant', session_id: REAL, parent_tool_use_id: null });
  const subAssistant = () =>
    msg({ type: 'assistant', session_id: REAL, parent_tool_use_id: 'toolu_1' });
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function makeMonitor(observe = jest.fn().mockResolvedValue(undefined)) {
    const release = jest.fn();
    const monitor = { observe, release } as unknown as SubagentBudgetSink;
    return { monitor, observe, release };
  }

  it('forwards a subagent message to the monitor and ignores a main-session one', async () => {
    const { monitor, observe } = makeMonitor();
    const { executor } = makeHarness('ask', {} as AuthEnv, {
      subagentMonitor: monitor,
    });
    const run = await executor.executeQuery(makeConfig('tab_m1'));
    run.activityWatchdog.observe(init());
    run.activityWatchdog.observe(mainAssistant());
    expect(observe).not.toHaveBeenCalled();
    const sub = subAssistant();
    run.activityWatchdog.observe(sub);
    expect(observe).toHaveBeenCalledTimes(1);
    // The build reported no TTL, so the monitor's own default applies.
    expect(observe).toHaveBeenCalledWith(REAL, sub, undefined);
    run.abortController.abort();
  });

  describe('effective subagent prompt-cache TTL (TASK_2026_614 D.7)', () => {
    /** A real monitor whose limits are never reached, so no stop fires. */
    function realMonitor(): SubagentBudgetMonitor {
      const config = {
        getConfig: () => ({
          subagentHandoffTokens: Number.MAX_SAFE_INTEGER,
          subagentStopWeightedTokens: Number.MAX_SAFE_INTEGER,
        }),
      } as unknown as CompactionConfigProvider;
      return new SubagentBudgetMonitor(
        makeLogger(),
        config,
        { stopSubagent: jest.fn() },
        {} as SubagentRegistryService,
        { find: jest.fn() },
      );
    }
    /** 1000 cache-write tokens and no `cache_creation` TTL split. */
    const unsplitWrite = () =>
      msg({
        type: 'assistant',
        session_id: REAL,
        parent_tool_use_id: 'toolu_ttl',
        message: {
          id: 'msg_ttl',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 1000,
          },
        },
      });

    async function weightedFor(
      ttl: SubagentPromptCacheTtl | undefined,
      tabId: string,
    ): Promise<number | undefined> {
      const monitor = realMonitor();
      const { executor } = makeHarness('ask', {} as AuthEnv, {
        subagentMonitor: monitor,
        subagentCacheTtl: ttl,
      });
      const run = await executor.executeQuery(makeConfig(tabId));
      run.activityWatchdog.observe(init());
      run.activityWatchdog.observe(unsplitWrite());
      await flush();
      const weighted = monitor.getSnapshot(REAL, 'toolu_ttl')?.weightedUsed;
      run.abortController.abort();
      return weighted;
    }

    it('a 1h-effective session prices an unsplit cache write at weight 2', async () => {
      expect(await weightedFor('1h', 'tab_ttl_1h')).toBe(2000);
    });

    it('stays on the 5m default (weight 1.25) when the build reports no TTL', async () => {
      expect(await weightedFor(undefined, 'tab_ttl_none')).toBe(1250);
    });
  });

  it('releases the monitor once on session end', async () => {
    const { monitor, release } = makeMonitor();
    const { executor } = makeHarness('ask', {} as AuthEnv, {
      subagentMonitor: monitor,
    });
    const run = await executor.executeQuery(makeConfig('tab_m2'));
    run.activityWatchdog.observe(init());
    run.activityWatchdog.observe(subAssistant());
    run.abortController.abort();
    run.abortController.abort();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(REAL);
  });

  it('a throwing or rejecting monitor does not break the turn', async () => {
    const logger = makeLogger();
    const throwing = makeMonitor(
      jest.fn(() => {
        throw new Error('sync boom');
      }),
    );
    const { executor } = makeHarness('ask', {} as AuthEnv, {
      subagentMonitor: throwing.monitor,
      logger,
    });
    const run = await executor.executeQuery(makeConfig('tab_m3'));
    run.activityWatchdog.observe(init());
    expect(() => run.activityWatchdog.observe(subAssistant())).not.toThrow();

    const rejecting = makeMonitor(jest.fn().mockRejectedValue(new Error('x')));
    const h2 = makeHarness('ask', {} as AuthEnv, {
      subagentMonitor: rejecting.monitor,
      logger,
    });
    const run2 = await h2.executor.executeQuery(makeConfig('tab_m4'));
    run2.activityWatchdog.observe(init());
    run2.activityWatchdog.observe(subAssistant());
    await flush();
    const lines = (logger.warn as jest.Mock).mock.calls.filter((c) =>
      (c[0] as string).includes('Subagent budget monitor failed'),
    );
    expect(lines).toHaveLength(2);
    expect(logger.error).not.toHaveBeenCalled();
    run.abortController.abort();
    run2.abortController.abort();
  });
});
