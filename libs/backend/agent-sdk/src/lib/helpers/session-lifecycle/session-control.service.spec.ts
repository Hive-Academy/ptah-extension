/**
 * SessionControl — record-identity teardown spec.
 *
 * Surface under test: `endSessionIfTokenMatches`, the compare-and-end primitive
 * that lets a stream loop tear down the record it STREAMED without touching a
 * newer record registered under the same id.
 *
 * Why it has to exist: ids are reused. `executeSlashCommandQuery` ends the live
 * record and immediately registers a NEW one under the SAME id, then spends
 * seconds on harness preflight before the fresh SDK query starts. The old
 * broadcast loop sees that end as a thrown abort and reaches its `finally` in
 * that window; a presence check by id ("is anything registered?") answers yes,
 * so the old loop used to abort the REPLACEMENT's AbortController and the
 * follow-up slash command failed with "Operation aborted".
 *
 * Uses the REAL `SessionRegistry` so record identity is observed through actual
 * registration, not a stubbed return value. Collaborators that only receive
 * teardown notifications are jest mocks.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  ISdkPermissionHandler,
  SessionId,
} from '@ptah-extension/shared';

import { SessionControl } from './session-control.service';
import { SessionRegistry } from './session-registry.service';
import type { IModelResolver } from '../../auth-env.port';
import type { SessionEndCallbackRegistry } from '../session-end-callback-registry';
import type { CompactionConfig } from '../compaction-config-provider';
import { A1_DEFAULT_WINDOW } from '../auto-compact-control';

const KEY = 'tab_shared_key';
const KEY_ID = KEY as SessionId;

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeConfig(): AISessionConfig {
  return {
    model: 'test-model',
    projectPath: '/tmp/test',
  } as AISessionConfig;
}

interface Harness {
  control: SessionControl;
  registry: SessionRegistry;
  cleanupPendingPermissions: jest.Mock;
  markAllInterrupted: jest.Mock;
  notifyAll: jest.Mock;
  logger: Logger;
}

function makeHarness(
  getCompactionConfig: (() => CompactionConfig) | null = null,
  onTurnTerminal: ((sessionId: SessionId) => void) | null = null,
  mayInterrupt: ((sessionId: SessionId) => boolean) | null = null,
): Harness {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);

  const cleanupPendingPermissions = jest.fn();
  const permissionHandler = {
    cleanupPendingPermissions,
  } as unknown as ISdkPermissionHandler;

  const markAllInterrupted = jest.fn();
  const subagentRegistry = {
    beginSessionTeardown: jest.fn(),
    endSessionTeardown: jest.fn(),
    markAllInterrupted,
  } as unknown as SubagentRegistryService;

  const modelResolver = {
    resolve: (model: string) => model,
  } as unknown as IModelResolver;

  const notifyAll = jest.fn();
  const sessionEndRegistry = {
    notifyAll,
  } as unknown as SessionEndCallbackRegistry;

  const control = new SessionControl(
    logger,
    registry,
    permissionHandler,
    subagentRegistry,
    modelResolver,
    sessionEndRegistry,
    getCompactionConfig,
    onTurnTerminal,
    mayInterrupt,
  );

  return {
    control,
    registry,
    cleanupPendingPermissions,
    markAllInterrupted,
    notifyAll,
    logger,
  };
}

describe('SessionControl.interruptCurrentTurn', () => {
  it('notifies the terminal hook after a successful interrupt', async () => {
    const terminal = jest.fn();
    const h = makeHarness(null, terminal);
    const rec = h.registry.register(KEY, makeConfig(), new AbortController());
    rec.query = {
      interrupt: jest.fn().mockResolvedValue(undefined),
    } as unknown as typeof rec.query;

    await expect(h.control.interruptCurrentTurn(KEY_ID)).resolves.toBe(true);

    expect(terminal).toHaveBeenCalledWith(KEY_ID);
  });

  it('refuses an interrupt once handover owns the source', async () => {
    const h = makeHarness(null, null, () => false);
    const rec = h.registry.register(KEY, makeConfig(), new AbortController());
    const interrupt = jest.fn().mockResolvedValue(undefined);
    rec.query = {
      interrupt,
    } as unknown as typeof rec.query;

    await expect(h.control.interruptCurrentTurn(KEY_ID)).resolves.toBe(false);
    expect(interrupt).not.toHaveBeenCalled();
  });
});

describe('SessionControl.endSessionIfTokenMatches', () => {
  it('refuses a stale token and leaves the REPLACEMENT record intact', async () => {
    const h = makeHarness();

    // T1 is the record a broadcast loop streamed.
    const t1 = h.registry.register(KEY, makeConfig(), new AbortController());
    const t1Token = t1.token;
    await h.control.endSession(KEY_ID);

    // The slash-command re-query registers T2 under the SAME id.
    const t2 = h.registry.register(KEY, makeConfig(), new AbortController());
    expect(t2.token).not.toBe(t1Token);

    const ended = await h.control.endSessionIfTokenMatches(KEY_ID, t1Token);

    expect(ended).toBe(false);
    expect(t2.abortController.signal.aborted).toBe(false);
    expect(h.registry.find(KEY)).toBe(t2);
  });

  it('performs no teardown side effects when the token is stale', async () => {
    const h = makeHarness();

    const t1 = h.registry.register(KEY, makeConfig(), new AbortController());
    const t1Token = t1.token;
    await h.control.endSession(KEY_ID);
    h.registry.register(KEY, makeConfig(), new AbortController());

    h.cleanupPendingPermissions.mockClear();
    h.markAllInterrupted.mockClear();
    h.notifyAll.mockClear();

    await h.control.endSessionIfTokenMatches(KEY_ID, t1Token);

    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
    expect(h.markAllInterrupted).not.toHaveBeenCalled();
    expect(h.notifyAll).not.toHaveBeenCalled();
  });

  it('ends the session when the token still identifies the registered record', async () => {
    const h = makeHarness();

    const t1 = h.registry.register(KEY, makeConfig(), new AbortController());
    await h.control.endSession(KEY_ID);
    const t2 = h.registry.register(KEY, makeConfig(), new AbortController());

    const ended = await h.control.endSessionIfTokenMatches(KEY_ID, t2.token);

    expect(ended).toBe(true);
    expect(t2.abortController.signal.aborted).toBe(true);
    expect(h.registry.find(KEY)).toBeUndefined();
    // Non-vacuity: the first record's token is genuinely different, so the
    // refusal above was not a mismatch of two equal strings.
    expect(t1.token).not.toBe(t2.token);
  });

  it('runs the same teardown as endSession (permissions → subagents → notify)', async () => {
    const h = makeHarness();

    const rec = h.registry.register(KEY, makeConfig(), new AbortController());

    const ended = await h.control.endSessionIfTokenMatches(KEY_ID, rec.token);

    expect(ended).toBe(true);
    expect(h.cleanupPendingPermissions).toHaveBeenCalledWith(KEY);
    expect(h.markAllInterrupted).toHaveBeenCalledWith(KEY);
    expect(h.notifyAll).toHaveBeenCalledWith({
      sessionId: KEY,
      workspaceRoot: '/tmp/test',
    });
  });

  it('returns false when nothing is registered under the id', async () => {
    const h = makeHarness();

    const ended = await h.control.endSessionIfTokenMatches(
      KEY_ID,
      'token-for-a-record-that-never-existed',
    );

    expect(ended).toBe(false);
    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
  });
});

/**
 * `endSession` on an id nothing is registered under — the state
 * `executeSlashCommandQuery` now sees when `chat:continue` routes a slash
 * command WITHOUT resuming first (TASK_2026_350).
 *
 * This is the half of that fix which lives here: the reason it is safe to hand
 * `executeSlashCommandQuery` an inactive session is that its opening
 * `endSession` finds no record and returns before ever reaching the interrupt
 * race. The pre-fix path resumed first, so the record DID exist, and the
 * teardown spent the full 5 s on `Interrupt timed out (5s)` (log.log:2335).
 *
 * Fake timers, never advanced, are the assertion: a call that awaited the 5 s
 * race would not settle. No wall-clock budget is measured — that would test the
 * host, not the code.
 */
describe('SessionControl.endSession — unregistered id (TASK_2026_350)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves "already-ended" without waiting on any timer, runs no teardown, and does not warn', async () => {
    const h = makeHarness();

    const outcome = await h.control.endSession(KEY_ID);
    expect(outcome).toBe('already-ended');

    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
    expect(h.markAllInterrupted).not.toHaveBeenCalled();
    expect(h.notifyAll).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledWith(
      '[SessionLifecycle] Session already ended, nothing to interrupt',
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('non-vacuity — a REGISTERED record whose interrupt never settles does arm the 5s timer', async () => {
    const h = makeHarness();

    const rec = h.registry.register(KEY, makeConfig(), new AbortController());
    // A query whose interrupt() never settles: the only thing that can release
    // `endRecord` is the 5s leg of the Promise.race.
    rec.query = {
      interrupt: () => new Promise<void>(() => undefined),
    } as unknown as typeof rec.query;

    let settled = false;
    const pending = h.control.endSession(KEY_ID).then(() => {
      settled = true;
    });

    // Flush microtasks: without the timer, nothing can complete the race.
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(5000);
    await pending;

    expect(settled).toBe(true);
    expect(h.markAllInterrupted).toHaveBeenCalledWith(KEY);
  });
});

/**
 * The teardown must deregister the record even when it fails (judge round 2).
 *
 * `cleanupPendingPermissions`, `beginSessionTeardown` and `markAllInterrupted`
 * are synchronous calls into collaborators, and they used to sit OUTSIDE any
 * `try`. A throw from one of them rejected `endRecord` with the record still in
 * the registry — so the caller saw a failed teardown AND the id stayed live.
 * `executeSlashCommandQuery` always runs its own `endSession` next, which would
 * then find that live `rec` and pay a second full interrupt race: the exact
 * stall TASK_2026_350 exists to remove, reachable through the error path.
 *
 * Both halves are asserted together on purpose. "Registry empty" alone would
 * pass if the method swallowed the error, and swallowing is NOT wanted — the
 * caller must still learn the teardown failed.
 */
describe('SessionControl.endSession — teardown failure still deregisters', () => {
  it('a throwing cleanupPendingPermissions leaves the registry empty AND rejects', async () => {
    const h = makeHarness();
    const rec = h.registry.register(KEY, makeConfig(), new AbortController());
    h.cleanupPendingPermissions.mockImplementation(() => {
      throw new Error('permission handler exploded');
    });

    await expect(h.control.endSession(KEY_ID)).rejects.toThrow(
      'permission handler exploded',
    );

    expect(h.registry.find(KEY)).toBeUndefined();
    expect(rec.abortController.signal.aborted).toBe(true);
    // A failed teardown must not announce a clean session end.
    expect(h.notifyAll).not.toHaveBeenCalled();
  });

  it('a throwing markAllInterrupted — the deepest of the three — also deregisters and rejects', async () => {
    const h = makeHarness();
    const rec = h.registry.register(KEY, makeConfig(), new AbortController());
    h.markAllInterrupted.mockImplementation(() => {
      throw new Error('subagent registry exploded');
    });

    await expect(h.control.endSession(KEY_ID)).rejects.toThrow(
      'subagent registry exploded',
    );

    expect(h.registry.find(KEY)).toBeUndefined();
    expect(rec.abortController.signal.aborted).toBe(true);
  });

  it('deregisters exactly once on the happy path (the finally must not double-remove)', async () => {
    const h = makeHarness();
    const rec = h.registry.register(KEY, makeConfig(), new AbortController());
    const remove = jest.spyOn(h.registry, 'remove');

    const outcome = await h.control.endSession(KEY_ID);
    expect(outcome).toBe('ended');

    // `registry.remove` deletes by `rec.tabId` with no identity check, so a
    // second call is only harmless while no NEW record holds that key. Calling
    // it once is what makes that irrelevant.
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(rec);
    expect(h.notifyAll).toHaveBeenCalledTimes(1);
  });
});

describe('SessionControl.applyAutoCompactConfig — live compaction.threshold change (TASK_2026_597 A1)', () => {
  type FlagSettingsQuery = NonNullable<
    ReturnType<SessionRegistry['register']>['query']
  >;

  function attachQuery(
    h: Harness,
    tabId: string,
    baseUrl: string | undefined,
    applyFlagSettings: jest.Mock,
  ): void {
    const rec = h.registry.register(
      tabId,
      makeConfig(),
      new AbortController(),
      undefined,
      {
        usageCostSource: 'unreported',
        authEnv: baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {},
      },
    );
    rec.query = { applyFlagSettings } as unknown as FlagSettingsQuery;
  }

  it('applies the new window to every live session through the flag layer', async () => {
    const h = makeHarness();
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);
    attachQuery(h, 'tab_a', undefined, first);
    attachQuery(h, 'tab_b', 'http://127.0.0.1:8123', second);

    await h.control.applyAutoCompactConfig({
      enabled: true,
      contextTokenThreshold: 300_000,
      envWindow: null,
      toolOutputBudgetTokens: 2500,
      subagentHandoffTokens: 150_000,
      rotationSuggestTokens: 300_000,
      subagentStopWeightedTokens: 3_000_000,
    });

    expect(first).toHaveBeenCalledWith({ autoCompactWindow: 300_000 });
    expect(second).toHaveBeenCalledWith({ autoCompactWindow: 300_000 });
  });

  it('an unset threshold clears the flag-layer window (null) while class defaults are null', async () => {
    const h = makeHarness();
    const apply = jest.fn().mockResolvedValue(undefined);
    attachQuery(h, 'tab_a', undefined, apply);

    await h.control.applyAutoCompactConfig({
      enabled: true,
      contextTokenThreshold: null,
      envWindow: null,
      toolOutputBudgetTokens: 2500,
      subagentHandoffTokens: 150_000,
      rotationSuggestTokens: 300_000,
      subagentStopWeightedTokens: 3_000_000,
    });

    expect(apply).toHaveBeenCalledWith({ autoCompactWindow: null });
  });

  it('sends nothing while auto compaction is disabled', async () => {
    const h = makeHarness();
    const apply = jest.fn().mockResolvedValue(undefined);
    attachQuery(h, 'tab_a', undefined, apply);

    await h.control.applyAutoCompactConfig({
      enabled: false,
      contextTokenThreshold: 300_000,
      envWindow: null,
      toolOutputBudgetTokens: 2500,
      subagentHandoffTokens: 150_000,
      rotationSuggestTokens: 300_000,
      subagentStopWeightedTokens: 3_000_000,
    });

    expect(apply).not.toHaveBeenCalled();
  });

  it('skips a registered session whose query has not started', async () => {
    const h = makeHarness();
    h.registry.register('tab_pending', makeConfig(), new AbortController());
    const apply = jest.fn().mockResolvedValue(undefined);
    attachQuery(h, 'tab_live', undefined, apply);

    await h.control.applyAutoCompactConfig({
      enabled: true,
      contextTokenThreshold: 200_000,
      envWindow: null,
      toolOutputBudgetTokens: 2500,
      subagentHandoffTokens: 150_000,
      rotationSuggestTokens: 300_000,
      subagentStopWeightedTokens: 3_000_000,
    });

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('one session failing is logged and does not stop the others', async () => {
    const h = makeHarness();
    const failing = jest.fn().mockRejectedValue(new Error('control closed'));
    const healthy = jest.fn().mockResolvedValue(undefined);
    attachQuery(h, 'tab_fail', undefined, failing);
    attachQuery(h, 'tab_ok', undefined, healthy);

    await expect(
      h.control.applyAutoCompactConfig({
        enabled: true,
        contextTokenThreshold: 200_000,
        envWindow: null,
        toolOutputBudgetTokens: 2500,
        subagentHandoffTokens: 150_000,
        rotationSuggestTokens: 300_000,
        subagentStopWeightedTokens: 3_000_000,
      }),
    ).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalledWith({ autoCompactWindow: 200_000 });
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to apply auto-compact window for tab_fail',
      ),
      expect.any(Error),
    );
  });

  it('a session that never answers is abandoned after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const h = makeHarness();
      const hung = jest
        .fn()
        .mockReturnValue(new Promise<void>(() => undefined));
      attachQuery(h, 'tab_hung', undefined, hung);

      const done = h.control.applyAutoCompactConfig({
        enabled: true,
        contextTokenThreshold: 200_000,
        envWindow: null,
        toolOutputBudgetTokens: 2500,
        subagentHandoffTokens: 150_000,
        rotationSuggestTokens: 300_000,
        subagentStopWeightedTokens: 3_000_000,
      });
      await jest.advanceTimersByTimeAsync(5000);
      await done;

      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to apply auto-compact window for tab_hung',
        ),
        expect.objectContaining({
          message: expect.stringContaining('timed out'),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SessionControl.applySessionAutoCompactWindow — E2-gated tighten (TASK_2026_597 N7)', () => {
  type MirrorQuery = NonNullable<
    ReturnType<SessionRegistry['register']>['query']
  >;

  const TAB = 'tab_budget';
  const TAB_ID = TAB as SessionId;
  const TARGET = 200_000;

  function configOf(over: Partial<CompactionConfig> = {}): CompactionConfig {
    return {
      enabled: true,
      contextTokenThreshold: null,
      envWindow: null,
      toolOutputBudgetTokens: 2500,
      subagentHandoffTokens: 150_000,
      rotationSuggestTokens: 300_000,
      subagentStopWeightedTokens: 3_000_000,
      ...over,
    };
  }

  /**
   * A query whose read-back follows the flag layer when `honours` is true:
   * the threshold becomes the last window sent (minus a buffer), as the
   * runtime would compute it. When false it never moves (E2 failure).
   */
  function attachQuery(
    h: Harness,
    opts: {
      startThreshold?: number;
      honours?: boolean;
      withReadBack?: boolean;
      baseUrl?: string;
    } = {},
  ): {
    rec: ReturnType<SessionRegistry['register']>;
    applyFlagSettings: jest.Mock;
    getContextUsage: jest.Mock;
  } {
    const rec = h.registry.register(
      TAB,
      makeConfig(),
      new AbortController(),
      undefined,
      {
        usageCostSource: 'unreported',
        authEnv: opts.baseUrl ? { ANTHROPIC_BASE_URL: opts.baseUrl } : {},
      },
    );
    let threshold = opts.startThreshold ?? 967_000;
    const applyFlagSettings = jest.fn(
      async (s: { autoCompactWindow?: number | null }) => {
        if (opts.honours !== false && typeof s.autoCompactWindow === 'number') {
          threshold = s.autoCompactWindow - 13_000;
        }
      },
    );
    const getContextUsage = jest.fn(async () => ({
      autoCompactThreshold: threshold,
      isAutoCompactEnabled: true,
    }));
    rec.query = (opts.withReadBack === false
      ? { applyFlagSettings }
      : { applyFlagSettings, getContextUsage }) as unknown as MirrorQuery;
    return { rec, applyFlagSettings, getContextUsage };
  }

  it('applies the window, reads it back and reports it applied', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h);

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({ target: TARGET, applied: true });
    expect(q.applyFlagSettings).toHaveBeenCalledWith({
      autoCompactWindow: TARGET,
    });
    expect(q.getContextUsage).toHaveBeenCalledTimes(2);
    expect(q.rec.autoCompactOverride).toBe(TARGET);
  });

  it('keeps the override when a compaction.threshold change re-applies the config', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h);
    await h.control.applySessionAutoCompactWindow(TAB_ID, TARGET);
    q.applyFlagSettings.mockClear();

    await h.control.applyAutoCompactConfig(
      configOf({ contextTokenThreshold: 600_000 }),
    );

    expect(q.applyFlagSettings).toHaveBeenCalledWith({
      autoCompactWindow: TARGET,
    });
    expect(q.applyFlagSettings).not.toHaveBeenCalledWith({
      autoCompactWindow: 600_000,
    });
  });

  it('a read-back miss restores the configured window (never null), drops the override and reports not-honoured with the model class', async () => {
    const h = makeHarness(() => configOf({ contextTokenThreshold: 600_000 }));
    const q = attachQuery(h, {
      honours: false,
      baseUrl: 'http://127.0.0.1:8123',
    });

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({
      target: TARGET,
      applied: false,
      reason: 'not-honoured',
    });
    // Regression (PR 3 review S-4): the user's compaction.threshold is what
    // goes back, resolved exactly as restore resolves it.
    expect(q.applyFlagSettings.mock.calls.map((c) => c[0])).toEqual([
      { autoCompactWindow: TARGET },
      { autoCompactWindow: 600_000 },
    ]);
    expect(q.rec.autoCompactOverride).toBeNull();
    const warn = h.logger.warn as jest.Mock;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('NOT honoured'),
      expect.objectContaining({ modelClass: 'proxied', target: TARGET }),
    );
  });

  it('a read-back miss with no configured window sends null back (the runtime decides), as restore does', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h, { honours: false });

    await h.control.applySessionAutoCompactWindow(TAB_ID, TARGET);

    expect(q.applyFlagSettings.mock.calls.map((c) => c[0])).toEqual([
      { autoCompactWindow: TARGET },
      { autoCompactWindow: null },
    ]);
    expect(q.rec.autoCompactOverride).toBeNull();
  });

  it('a second read-back failure after the target was sent puts the configured window back and clears the override (M-2)', async () => {
    const h = makeHarness(() => configOf({ contextTokenThreshold: 600_000 }));
    const q = attachQuery(h);
    q.getContextUsage
      .mockResolvedValueOnce({
        autoCompactThreshold: 967_000,
        isAutoCompactEnabled: true,
      })
      .mockRejectedValueOnce(new Error('control closed'));

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({
      target: TARGET,
      applied: false,
      reason: 'failed',
    });
    expect(q.applyFlagSettings.mock.calls.map((c) => c[0])).toEqual([
      { autoCompactWindow: TARGET },
      { autoCompactWindow: 600_000 },
    ]);
    expect(q.rec.autoCompactOverride).toBeNull();
  });

  it('when the put-back fails too, the target stays recorded because the runtime holds it (M-2)', async () => {
    const h = makeHarness(() => configOf({ contextTokenThreshold: 600_000 }));
    const q = attachQuery(h);
    q.getContextUsage
      .mockResolvedValueOnce({
        autoCompactThreshold: 967_000,
        isAutoCompactEnabled: true,
      })
      .mockRejectedValueOnce(new Error('control closed'));
    q.applyFlagSettings
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('control closed'));

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({
      target: TARGET,
      applied: false,
      reason: 'failed',
    });
    expect(q.rec.autoCompactOverride).toBe(TARGET);

    // The record and the runtime agree, so restore has something to undo.
    q.applyFlagSettings.mockClear();
    await h.control.applySessionAutoCompactWindow(TAB_ID, null);
    expect(q.applyFlagSettings).toHaveBeenCalledWith({
      autoCompactWindow: 600_000,
    });
    expect(q.rec.autoCompactOverride).toBeNull();
  });

  it('a not-honoured put-back that fails keeps the target recorded and is not retried', async () => {
    const h = makeHarness(() => configOf({ contextTokenThreshold: 600_000 }));
    const q = attachQuery(h, { honours: false });
    q.applyFlagSettings
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('control closed'));

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({
      target: TARGET,
      applied: false,
      reason: 'failed',
    });
    expect(q.applyFlagSettings).toHaveBeenCalledTimes(2);
    expect(q.rec.autoCompactOverride).toBe(TARGET);
  });

  it('skips with env-override when CLAUDE_CODE_AUTO_COMPACT_WINDOW pins the window', async () => {
    const h = makeHarness(() => configOf({ envWindow: 400_000 }));
    const q = attachQuery(h);

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({
      target: TARGET,
      applied: false,
      reason: 'env-override',
    });
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
    expect(q.getContextUsage).not.toHaveBeenCalled();
    expect(q.rec.autoCompactOverride).toBeUndefined();
  });

  it('skips with already-lower when the read-back threshold is already at or below the target', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h, { startThreshold: TARGET });

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({
      target: TARGET,
      applied: false,
      reason: 'already-lower',
    });
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
    expect(q.rec.autoCompactOverride).toBeUndefined();
  });

  it('a timeout gives failed and the session keeps the window it had', async () => {
    jest.useFakeTimers();
    try {
      const h = makeHarness(() => configOf());
      const q = attachQuery(h);
      q.applyFlagSettings.mockReturnValue(new Promise<void>(() => undefined));

      const done = h.control.applySessionAutoCompactWindow(TAB_ID, TARGET);
      await jest.advanceTimersByTimeAsync(5000);
      const result = await done;

      expect(result).toEqual({
        target: TARGET,
        applied: false,
        reason: 'failed',
      });
      expect(q.rec.autoCompactOverride).toBeNull();
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to apply a session auto-compact window',
        ),
        expect.objectContaining({
          message: expect.stringContaining('timed out'),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('a query without getContextUsage gives failed and sends nothing', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h, { withReadBack: false });

    const result = await h.control.applySessionAutoCompactWindow(
      TAB_ID,
      TARGET,
    );

    expect(result).toEqual({
      target: TARGET,
      applied: false,
      reason: 'failed',
    });
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
  });

  it('an unknown session gives failed', async () => {
    const h = makeHarness(() => configOf());

    await expect(
      h.control.applySessionAutoCompactWindow(
        'tab_missing' as SessionId,
        TARGET,
      ),
    ).resolves.toEqual({ target: TARGET, applied: false, reason: 'failed' });
  });

  it('restore clears the override and sends the configured window', async () => {
    const h = makeHarness(() => configOf({ contextTokenThreshold: 600_000 }));
    const q = attachQuery(h);
    await h.control.applySessionAutoCompactWindow(TAB_ID, TARGET);
    q.applyFlagSettings.mockClear();

    const result = await h.control.applySessionAutoCompactWindow(TAB_ID, null);

    expect(result).toBeUndefined();
    expect(q.applyFlagSettings).toHaveBeenCalledWith({
      autoCompactWindow: 600_000,
    });
    expect(q.rec.autoCompactOverride).toBeNull();
  });

  it('restore sends null (runtime decides) when no window is configured, never a class default', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h);
    await h.control.applySessionAutoCompactWindow(TAB_ID, TARGET);
    q.applyFlagSettings.mockClear();

    await h.control.applySessionAutoCompactWindow(TAB_ID, null);

    expect(q.applyFlagSettings).toHaveBeenCalledWith({
      autoCompactWindow: null,
    });
  });

  it('restore with no override recorded sends nothing', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h);

    await expect(
      h.control.applySessionAutoCompactWindow(TAB_ID, null),
    ).resolves.toBeUndefined();
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
  });

  it('a failed restore keeps the override and reports restore-failed (the lowered window is still in force)', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h);
    await h.control.applySessionAutoCompactWindow(TAB_ID, TARGET);
    q.applyFlagSettings.mockRejectedValueOnce(new Error('control closed'));

    const result = await h.control.applySessionAutoCompactWindow(TAB_ID, null);

    expect(result).toEqual({
      target: TARGET,
      applied: true,
      reason: 'restore-failed',
    });
    expect(q.rec.autoCompactOverride).toBe(TARGET);
  });

  it('a restore with no live query keeps the override and reports restore-failed without sending', async () => {
    const h = makeHarness(() => configOf());
    const q = attachQuery(h);
    await h.control.applySessionAutoCompactWindow(TAB_ID, TARGET);
    q.applyFlagSettings.mockClear();
    q.rec.query = null;

    const result = await h.control.applySessionAutoCompactWindow(TAB_ID, null);

    expect(result).toEqual({
      target: TARGET,
      applied: true,
      reason: 'restore-failed',
    });
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
    expect(q.rec.autoCompactOverride).toBe(TARGET);
  });

  it('leaves the A1 class defaults null (E2 has not passed)', () => {
    expect(A1_DEFAULT_WINDOW).toEqual({ claude: null, proxied: null });
  });
});

describe('SessionControl.disposeSessionsForWorkspace — one workspace only', () => {
  function register(
    h: Harness,
    tabId: string,
    projectPath: string | undefined,
  ): { abort: AbortController } {
    const abort = new AbortController();
    h.registry.register(
      tabId,
      { model: 'test-model', projectPath } as AISessionConfig,
      abort,
    );
    return { abort };
  }

  it('ends the sessions of the given workspace and leaves every other workspace running', async () => {
    const h = makeHarness();
    const a1 = register(h, 'tab_a1', '/ws/project-a');
    const a2 = register(h, 'tab_a2', '/ws/project-a/');
    const b = register(h, 'tab_b', '/ws/project-b');
    const none = register(h, 'tab_none', undefined);

    expect(h.control.getSessionIdsForWorkspace('/ws/project-a').sort()).toEqual(
      ['tab_a1', 'tab_a2'],
    );

    await h.control.disposeSessionsForWorkspace('/ws/project-a');

    expect(a1.abort.signal.aborted).toBe(true);
    expect(a2.abort.signal.aborted).toBe(true);
    expect(h.registry.find('tab_a1')).toBeUndefined();
    expect(h.registry.find('tab_a2')).toBeUndefined();

    // Another workspace, and a session with no workspace, are untouched.
    expect(b.abort.signal.aborted).toBe(false);
    expect(none.abort.signal.aborted).toBe(false);
    expect(h.registry.find('tab_b')).toBeDefined();
    expect(h.registry.find('tab_none')).toBeDefined();
    expect(h.cleanupPendingPermissions).not.toHaveBeenCalledWith('tab_b');

    // Each ended session announces its own workspace end, and only those.
    expect(h.notifyAll).toHaveBeenCalledTimes(2);
    for (const [event] of h.notifyAll.mock.calls) {
      expect(event.workspaceRoot).toMatch(/project-a/);
    }
  });

  it('matches the workspace through path normalization (separators, trailing slash, drive-letter case)', async () => {
    const h = makeHarness();
    const win = process.platform === 'win32';
    // The stored and the requested spelling of the SAME workspace differ.
    const stored = win ? 'D:\\repo\\app' : '/repo//app';
    const requested = win ? 'd:/repo/app/' : '/repo/app/';
    const s = register(h, 'tab_norm', stored);

    expect(h.control.getSessionIdsForWorkspace(requested)).toEqual([
      'tab_norm',
    ]);

    await h.control.disposeSessionsForWorkspace(requested);
    expect(s.abort.signal.aborted).toBe(true);
  });

  it('is a no-op for an empty path or a workspace with no sessions', async () => {
    const h = makeHarness();
    const b = register(h, 'tab_b', '/ws/project-b');

    await h.control.disposeSessionsForWorkspace('');
    await h.control.disposeSessionsForWorkspace('/ws/project-z');

    expect(b.abort.signal.aborted).toBe(false);
    expect(h.registry.find('tab_b')).toBeDefined();
    expect(h.notifyAll).not.toHaveBeenCalled();
  });
});
