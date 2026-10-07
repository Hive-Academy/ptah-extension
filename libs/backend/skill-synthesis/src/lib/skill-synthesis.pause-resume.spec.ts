/**
 * TASK_2026_620 B-P — the skills pause/resume semantics on
 * `SkillSynthesisService`.
 *
 * `skillSynthesis.enabled` is THE skills switch. Pause means: a host that
 * booted paused does none of the boot work (S1/S8 — no session-end
 * subscription, no curator interval, no embedding-backfill row), and nothing
 * new starts until the switch comes back on. Resume means NO RESTART, in
 * either direction and by either write path:
 *
 *  - by EVENT — the in-process writes (tray, Thoth tab, RPC) all fire
 *    `onDidChangeConfiguration`, and the listener registered above `start()`'s
 *    early returns completes the deferred boot work;
 *  - LAZILY — an external edit of `~/.ptah/settings.json` fires no event, so
 *    the first `enqueueAnalyze` after the flip completes it instead.
 *
 * The drain's per-item re-read and the prefilter's `unscored` mapping are
 * pinned where they live: `queue/skill-drain.gates.spec.ts` (S6,
 * `paused-mid-run`) and `skill-synthesis.stage-handlers.spec.ts` (S7,
 * `analyzer-not-started`). The curator tick's live settings read and its
 * clear-before-arm are pinned in `skill-curator.service.spec.ts`.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SkillSynthesisService } from './skill-synthesis.service';
import { SkillCuratorService } from './skill-curator.service';
import type { SkillRetirementResult } from './lifecycle/skill-retirement.service';
import type {
  SkillUmbrellaMergeService,
  UmbrellaPassResult,
} from './lifecycle/skill-umbrella-merge.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillMdGenerator } from './skill-md-generator';
import type { SkillPromotionService } from './skill-promotion.service';
import type { TrajectoryExtractor } from './trajectory-extractor';
import type { SkillCandidateRow, SkillSynthesisSettings } from './types';

/** The event shape `onDidChangeConfiguration` subscribers receive. */
interface ConfigEvent {
  affectsConfiguration: (section: string) => boolean;
}

type SessionEndCallback = (data: {
  sessionId: string;
  workspaceRoot: string;
}) => void;

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeSettings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinToolUses: 2,
    judgeEnabled: false,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 1,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
    ...overrides,
  };
}

function umbrellaResult(): UmbrellaPassResult {
  return {
    umbrellasCreated: 0,
    umbrellasRejected: 0,
    judgeRejectedMembers: 0,
    singletonsSurfaced: 0,
    candidatesMerged: 0,
    suggestionsMerged: 0,
    purged: 0,
    purgeSkippedReason: 'already-complete',
    clustersRemaining: 0,
    rateLimited: false,
    mergedIds: [],
    purgedIds: [],
  };
}

/**
 * The REAL `SkillCuratorService` over mocked collaborators, so the curator
 * half of pause/resume (the interval, the pass, the callbacks) is exercised
 * as wired, not as a mock of itself. Same shape the curator's own spec uses.
 */
function makeCurator() {
  const retirement = {
    run: jest.fn(async (): Promise<SkillRetirementResult> => ({
      dormant: 0,
      retired: 0,
      skippedPinned: 0,
      skippedExempt: 0,
      skippedUncontained: 0,
      dormantSlugs: [],
      retiredSlugs: [],
    })),
    removeMaterializations: jest.fn(
      async (rows: readonly SkillCandidateRow[]) => rows.map((r) => r.name),
    ),
  };
  const suggestions = {
    listAcceptedWithoutPromotedCandidate: jest.fn(() => []),
    findById: jest.fn(() => null),
    dismiss: jest.fn(),
    listByStatus: jest.fn(() => []),
  };
  const svc = new SkillCuratorService(
    makeLogger(),
    {
      listByStatus: jest.fn(() => []),
      getInvocationStats: jest.fn(() => ({
        total: 0,
        succeeded: 0,
        failed: 0,
        distinctContexts: 0,
      })),
    } as unknown as SkillCandidateStore,
    { tryAcquire: () => ({ allowed: true }) } as never,
    { listAll: jest.fn(() => []) } as never,
    null,
    suggestions as never,
    {
      runPass: jest.fn(async () => umbrellaResult()),
    } as unknown as SkillUmbrellaMergeService,
    retirement as never,
    {} as SkillPromotionService,
    { activeRoot: () => '/a' } as unknown as SkillMdGenerator,
  );
  return { svc, retirement, suggestions };
}

/**
 * A workspace whose config is a mutable map AND whose config events are real:
 * `fireSkillSynthesisEnabled` is the in-process write path (value first, then
 * the event), and mutating the map without it is the external-edit path.
 */
function makeEventfulWorkspace(initial: Record<string, unknown>) {
  const cfg: Record<string, unknown> = { ...initial };
  const listeners: Array<(event: ConfigEvent) => void> = [];
  const onDidChangeConfiguration = jest.fn(
    (cb: (event: ConfigEvent) => void) => {
      listeners.push(cb);
      return { dispose: () => undefined };
    },
  );
  const workspace = {
    getWorkspaceRoot: () => '/ws',
    getWorkspaceFolders: () => ['/ws'],
    getConfiguration: jest.fn(
      (_section: string, key: string, def: unknown) => cfg[key] ?? def,
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    onDidChangeConfiguration,
    onDidChangeWorkspaceFolders: jest.fn(() => () => undefined),
  } as unknown as IWorkspaceProvider;
  return {
    workspace,
    /** The in-process write: the value lands, THEN the event fires. */
    fireSkillSynthesisEnabled(enabled: boolean) {
      cfg['skillSynthesis.enabled'] = enabled;
      for (const cb of listeners) {
        cb({
          // The predicate shape `ElectronWorkspaceProvider.setConfiguration`
          // fires: true for the full key and its prefixes only.
          affectsConfiguration: (s: string) =>
            s === 'ptah.skillSynthesis.enabled',
        });
      }
    },
    /** The external edit: the map flips with NO event. */
    setMaster(enabled: boolean) {
      cfg['skillSynthesis.enabled'] = enabled;
    },
    /** How many config listeners are live — the no-double-listener pin. */
    listenerRegistrations(): number {
      return onDidChangeConfiguration.mock.calls.length;
    },
  };
}

/** A readable trajectory the extractor can hand `enqueueAnalyze`. */
function trajectory(turnCount: number) {
  return {
    hash: `hash-${turnCount}`,
    canonicalText: 'canon',
    turnCount,
    sessionTurnCount: turnCount,
    shortDescription: 'do thing',
    slug: 'do-thing',
    editCount: 2,
    toolUseCount: 4,
    nonMcpToolUseCount: 4,
    bashTestPassed: false,
    charLength: 900,
    hasSuccessMarker: true,
  };
}

/**
 * The REAL `SkillSynthesisService` over the mocked collaborators above and
 * the REAL curator, with everything B-P touches observable: the session-end
 * subscription count, the embedding-backfill row, the curator interval.
 */
function buildHarness(opts: { enabled: boolean } = { enabled: true }) {
  const ws = makeEventfulWorkspace({
    'skillSynthesis.enabled': opts.enabled,
    // 1h, not the shipped 24h, so a fake-clock advance of one interval
    // elapse is exactly `3_600_000`.
    'skillSynthesis.curatorIntervalHours': 1,
  });
  const curator = makeCurator();

  let sessionEnd: SessionEndCallback | null = null;
  const sessionEndRegistry = {
    register: jest.fn((cb: SessionEndCallback) => {
      sessionEnd = cb;
      return jest.fn();
    }),
  } as unknown as ConstructorParameters<typeof SkillSynthesisService>[9];

  const enqueued: Array<{ sessionId: string; stage: string }> = [];
  const queue = {
    enqueue: jest.fn((input: { sessionId: string; stage: string }) => {
      enqueued.push(input);
      return { outcome: 'created' as const, row: null };
    }),
  };

  // No readable trajectory by default: an enqueue then costs nothing and
  // asserts nothing but its own gating. Tests that need a queued prefilter
  // row override the extractor.
  const extractor = {
    extract: jest.fn().mockResolvedValue(null),
  } as unknown as TrajectoryExtractor;

  // Mutable on purpose: a failed-start test flips `isOpen` so
  // `performStart()` reaches `openAndMigrate` and can reject there.
  const connection = {
    isOpen: true,
    openAndMigrate: jest.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof SkillSynthesisService>[1] & {
    isOpen: boolean;
    openAndMigrate: jest.Mock;
  };

  const svc = new SkillSynthesisService(
    makeLogger() as unknown as ConstructorParameters<
      typeof SkillSynthesisService
    >[0],
    connection,
    { available: false } as unknown as ConstructorParameters<
      typeof SkillSynthesisService
    >[2],
    ws.workspace,
    {} as unknown as SkillCandidateStore,
    // No `activeRoot`: the SKILL.md migration block degrades to a warn and
    // this spec stays off the real filesystem.
    { candidatesRoot: () => '/tmp/cands' } as unknown as SkillMdGenerator,
    {} as unknown as SkillPromotionService,
    extractor as unknown as ConstructorParameters<
      typeof SkillSynthesisService
    >[7],
    curator.svc,
    sessionEndRegistry,
    null,
    null,
    null,
    null,
    queue as unknown as ConstructorParameters<typeof SkillSynthesisService>[14],
  );

  /** Let the listener's fire-and-forget `ensureStarted()` settle. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  return {
    svc,
    ws,
    curator,
    extractor,
    connection,
    sessionEndRegistry,
    enqueued,
    settle,
    fireSessionEnd: (sessionId = 's1', workspaceRoot = '/repo') => {
      if (!sessionEnd) throw new Error('session-end callback not registered');
      sessionEnd({ sessionId, workspaceRoot });
    },
  };
}

describe('SkillSynthesisService — pause and resume (B-P)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a host that booted paused does none of the boot work', async () => {
    const h = buildHarness({ enabled: false });

    await h.svc.start();
    await h.settle();

    // S1/S8: no subscription, no curator interval, no backfill row — and the
    // reconcile (a skills write) is paused too.
    expect(h.sessionEndRegistry.register).not.toHaveBeenCalled();
    expect(h.curator.svc.isScheduled()).toBe(false);
    expect(h.enqueued).toHaveLength(0);
    expect(
      h.curator.suggestions.listAcceptedWithoutPromotedCandidate,
    ).not.toHaveBeenCalled();
  });

  it('resume by EVENT completes the deferred boot work: subscription, curator interval, backfill row', async () => {
    const h = buildHarness({ enabled: false });
    await h.svc.start();
    await h.settle();

    h.ws.fireSkillSynthesisEnabled(true);
    await h.settle();

    // Everything a paused boot skipped exists exactly once.
    expect(h.sessionEndRegistry.register).toHaveBeenCalledTimes(1);
    expect(h.curator.svc.isScheduled()).toBe(true);
    const backfill = h.enqueued.filter((r) => r.stage === 'embedding');
    expect(backfill).toHaveLength(1);
    // The session-end subscription WORKS after the resume (S1).
    (h.extractor.extract as jest.Mock).mockResolvedValue(trajectory(6));
    h.fireSessionEnd();
    await h.settle();
    expect(h.enqueued.filter((r) => r.stage === 'prefilter')).toHaveLength(1);
    // And the interval runs a pass (a real one, once per elapse).
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(h.curator.retirement.run).toHaveBeenCalledTimes(1);
  });

  it('resume LAZILY (external edit, no event) completes the same boot work', async () => {
    const h = buildHarness({ enabled: false });
    await h.svc.start();
    await h.settle();
    expect(h.sessionEndRegistry.register).not.toHaveBeenCalled();

    // The external edit fires nothing; the first enqueue after it is the only
    // signal. The extractor finds no trajectory, so nothing is queued — but
    // the boot work the pause skipped is completed by the same call.
    h.ws.setMaster(true);
    const outcome = await h.svc.enqueueAnalyze('s1', '/repo', {
      source: 'idle',
    });

    expect(outcome).toBeNull();
    expect(h.sessionEndRegistry.register).toHaveBeenCalledTimes(1);
    expect(h.curator.svc.isScheduled()).toBe(true);
    expect(h.enqueued.filter((r) => r.stage === 'embedding')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(h.curator.retirement.run).toHaveBeenCalledTimes(1);
  });

  it('two resumes → one subscription, one curator start, one interval', async () => {
    const h = buildHarness({ enabled: false });
    await h.svc.start();
    await h.settle();

    h.ws.fireSkillSynthesisEnabled(true);
    await h.settle();
    h.ws.fireSkillSynthesisEnabled(true);
    await h.settle();

    expect(h.sessionEndRegistry.register).toHaveBeenCalledTimes(1);
    // The reconcile runs once per curator start — the second resume must not
    // re-run it, and the interval must not double up.
    expect(
      h.curator.suggestions.listAcceptedWithoutPromotedCandidate,
    ).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2 * 3_600_000);
    // ONE interval: two elapses, two passes — not four.
    expect(h.curator.retirement.run).toHaveBeenCalledTimes(2);
  });

  it('restartCurator() keeps the pass/event callbacks wired (S13)', async () => {
    const h = buildHarness({ enabled: true });
    await h.svc.start();
    await h.settle();
    expect(h.curator.svc.isScheduled()).toBe(true);
    expect(h.svc.lastRunSummary().lastCuratorPassAt).toBeNull();

    // The RPC `updateSettings` path: a curator settings change restarts the
    // curator with the SAME options `start()` wired, so passes after the
    // change are still recorded and pushed.
    h.svc.restartCurator();
    expect(h.curator.svc.isScheduled()).toBe(true);

    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(h.curator.retirement.run).toHaveBeenCalledTimes(1);
    // onPassComplete survived the restart…
    expect(h.svc.lastRunSummary().lastCuratorPassAt).not.toBeNull();
    // …and so did onEvent: the pass was pushed onto the event ring.
    expect(h.svc.recentEvents(10).some((e) => e.kind === 'curator-pass')).toBe(
      true,
    );
  });

  it('restartCurator() while paused leaves the curator stopped, and the lazy resume re-arms it', async () => {
    const h = buildHarness({ enabled: true });
    await h.svc.start();
    await h.settle();
    expect(h.curator.svc.isScheduled()).toBe(true);

    // Paused by an external edit, then a curator settings change lands via
    // the RPC — the one path that stops the interval while the service is
    // up. The curator must NOT restart while paused: no reconcile (a skills
    // write), no interval.
    h.ws.setMaster(false);
    h.svc.restartCurator();
    expect(h.curator.svc.isScheduled()).toBe(false);
    expect(
      h.curator.suggestions.listAcceptedWithoutPromotedCandidate,
    ).toHaveBeenCalledTimes(1); // only the one from start()

    // The external resume (no event): the next enqueue re-arms the curator,
    // so resume still needs no restart.
    h.ws.setMaster(true);
    await h.svc.enqueueAnalyze('s1', '/repo', { source: 'idle' });
    expect(h.curator.svc.isScheduled()).toBe(true);
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(h.curator.retirement.run).toHaveBeenCalledTimes(1);
  });

  it('pause stops nothing that exists — but no further unit starts, and the tick no-ops', async () => {
    const h = buildHarness({ enabled: true });
    await h.svc.start();
    await h.settle();
    expect(h.curator.svc.isScheduled()).toBe(true);

    // The external pause: the interval stays armed and its tick no-ops.
    h.ws.setMaster(false);
    await jest.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(h.curator.retirement.run).not.toHaveBeenCalled();
    expect(h.curator.svc.isScheduled()).toBe(true);

    // The enqueue side no-ops while paused (S2, live read)…
    const outcome = await h.svc.enqueueAnalyze('s1', '/repo', {
      source: 'idle',
    });
    expect(outcome).toBeNull();
    expect(h.enqueued.filter((r) => r.stage === 'prefilter')).toHaveLength(0);

    // …and the external resume un-gates both on the next unit.
    h.ws.setMaster(true);
    (h.extractor.extract as jest.Mock).mockResolvedValue(trajectory(6));
    h.fireSessionEnd();
    await h.settle();
    expect(h.enqueued.filter((r) => r.stage === 'prefilter')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(h.curator.retirement.run).toHaveBeenCalledTimes(1);
  });

  /**
   * Review finding 2 — the join promise (`startRun`) must never become an
   * unhandled rejection.
   *
   * When `performStart()` rejects (here: `openAndMigrate` fails), the direct
   * caller sees the error from `await start()`, but the derived `startRun`
   * promise had no handler of its own — Node, which the CLI runs without an
   * `unhandledRejection` handler, terminates the process on it. Real timers
   * for this test: the unhandled-rejection machinery needs a genuine
   * macrotask boundary to surface anything.
   */
  it('a rejected boot-work run is never an unhandled rejection, and a later start retries (finding 2)', async () => {
    jest.useRealTimers();
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (err: unknown) => {
      unhandled.push(err);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const h = buildHarness({ enabled: true });
      h.connection.isOpen = false;
      (h.connection.openAndMigrate as jest.Mock).mockRejectedValueOnce(
        new Error('db locked'),
      );

      // The boot caller's own catch sees the error, exactly as before.
      await expect(h.svc.start()).rejects.toThrow('db locked');

      // A full microtask + macrotask drain: the join promise's rejection is
      // observed where it is created, so nothing surfaces here.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await h.settle();
      expect(unhandled).toHaveLength(0);

      // `startRun` was reset by the failed run, so a later start retries the
      // boot work and succeeds, bringing up everything a normal start does.
      await h.svc.start();
      expect(h.sessionEndRegistry.register).toHaveBeenCalledTimes(1);
      expect(h.curator.svc.isScheduled()).toBe(true);
      expect(h.enqueued.filter((r) => r.stage === 'embedding')).toHaveLength(1);
      h.svc.stop();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  /**
   * Review finding 4 — a failed start leaves the config listener in place AS
   * the retry path.
   *
   * The boot catch keeps its ref (so shutdown's `stop()` disposes the
   * listener) — disposing it on the failure would leave the
   * failed host with no resume path at all. The listener turns the next
   * pause→resume cycle into a retry that runs the FULL `performStart()`:
   * subscription, curator interval, backfill row, and no second listener.
   */
  it('a resume event after a failed start retries it and brings up everything a normal start does (finding 4)', async () => {
    jest.useRealTimers();
    const h = buildHarness({ enabled: true });
    h.connection.isOpen = false;
    (h.connection.openAndMigrate as jest.Mock).mockRejectedValueOnce(
      new Error('db locked'),
    );

    // The boot path: the rejection is caught outside, the ref nulled, the
    // listener left registered.
    await expect(h.svc.start()).rejects.toThrow('db locked');
    await h.settle();
    expect(h.sessionEndRegistry.register).not.toHaveBeenCalled();
    expect(h.curator.svc.isScheduled()).toBe(false);
    expect(h.ws.listenerRegistrations()).toBe(1);

    // Pause, then resume by event — the listener retries the failed start.
    h.ws.fireSkillSynthesisEnabled(false);
    await h.settle();
    h.ws.fireSkillSynthesisEnabled(true);
    await h.settle();

    // Everything a normal start brings up, exactly once each.
    expect(h.sessionEndRegistry.register).toHaveBeenCalledTimes(1);
    expect(h.curator.svc.isScheduled()).toBe(true);
    expect(h.enqueued.filter((r) => r.stage === 'embedding')).toHaveLength(1);
    // The retry reuses the ONE listener — `registerConfigListener` is guarded.
    expect(h.ws.listenerRegistrations()).toBe(1);
    h.svc.stop();
  });

  /**
   * B-P boot-retry review — `stop()` while a start is awaiting the database
   * must leave nothing behind: no session-end subscription, no curator
   * interval, no backfill row, no onStarted notification.
   */
  it('stop() during an in-flight start abandons the boot work', async () => {
    jest.useRealTimers();
    const h = buildHarness({ enabled: true });
    h.connection.isOpen = false;
    let openDb: () => void = () => undefined;
    (h.connection.openAndMigrate as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          openDb = resolve;
        }),
    );
    const started = jest.fn();
    h.svc.onStarted(started);

    const run = h.svc.start();
    await h.settle();
    h.svc.stop();
    openDb();
    await run;
    await h.settle();

    expect(h.sessionEndRegistry.register).not.toHaveBeenCalled();
    expect(h.curator.svc.isScheduled()).toBe(false);
    expect(h.enqueued.filter((r) => r.stage === 'embedding')).toHaveLength(0);
    expect(started).not.toHaveBeenCalled();
  });

  /**
   * B-P review N1 — the host boot subscribes to `onStarted` to bring up the
   * skill TRIGGER service. The boot's own `.then` never sees a start that
   * failed at boot and succeeded later through the listener retry, so the
   * notification must fire on THAT start too — once per successful start,
   * never on a failed one, and never after `stop()`.
   */
  it('onStarted fires on the retried start after a failed boot start, once, and not after stop() (N1)', async () => {
    jest.useRealTimers();
    const h = buildHarness({ enabled: true });
    h.connection.isOpen = false;
    (h.connection.openAndMigrate as jest.Mock).mockRejectedValueOnce(
      new Error('db locked'),
    );
    const started = jest.fn();
    h.svc.onStarted(started);

    await expect(h.svc.start()).rejects.toThrow('db locked');
    await h.settle();
    expect(started).not.toHaveBeenCalled();

    h.ws.fireSkillSynthesisEnabled(false);
    await h.settle();
    h.ws.fireSkillSynthesisEnabled(true);
    await h.settle();
    expect(started).toHaveBeenCalledTimes(1);

    // A second resume on a started service runs no boot work → no notification.
    h.ws.fireSkillSynthesisEnabled(true);
    await h.settle();
    expect(started).toHaveBeenCalledTimes(1);

    // stop() drops the subscription: a later start does not reach it.
    h.svc.stop();
    await h.svc.start();
    await h.settle();
    expect(started).toHaveBeenCalledTimes(1);
    h.svc.stop();
  });

  it('a disposed onStarted subscription is not notified', async () => {
    jest.useRealTimers();
    const h = buildHarness({ enabled: true });
    const started = jest.fn();
    h.svc.onStarted(started).dispose();

    await h.svc.start();
    await h.settle();

    expect(started).not.toHaveBeenCalled();
    h.svc.stop();
  });
});
