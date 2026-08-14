/**
 * P1-7 — `SkillLaneFailure` → queue-row transitions, inside the drain.
 *
 * This is the seam where Q2 ("unresolvable lane auth STALLS, it never falls
 * back") stops being a doc paragraph and becomes an observable row state. Four
 * things have to hold together, and asserting any three of them is not enough:
 *
 *  1. `drain()` RESOLVES. A lane failure is data, not an exception; a drain that
 *     rejected would take the cron handler down with it (global invariant 11).
 *  2. The row is back at `status='queued'` with `not_before` in the future — the
 *     stall, not a terminal death and not a `done`.
 *  3. Its `reason` is non-empty and names the lane, so the Activity surface can
 *     say WHY nothing happened.
 *  4. **A following eligible item in the same tick still ran.** Without this one
 *     the spec only proves the drain did not crash; it does not prove the tick
 *     survived. The two rows below are given explicit `enqueued_at` values so
 *     `ELIGIBLE_SQL`'s `ORDER BY enqueued_at ASC` is deterministic and the
 *     failing row is provably FIRST.
 *
 * Real SQLite throughout (`queue-db.test-support`), because every assertion here
 * is a property of a guarded UPDATE — `requeue`'s `status IN ('claimed',
 * 'running')` guard in particular — and a mocked store would assert only that
 * the drain called the method it was written to call.
 *
 * There is deliberately not a single provider id anywhere in this file. Lanes
 * differ by declared capability, never by vendor, and a spec that named one
 * would be the first code path to break that.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SkillQueueStore } from './skill-queue.store';
import { SkillDrainService, SKILL_DRAIN_KEYS } from './skill-drain.service';
import type { SkillLaneFailure } from '../lanes/lane.types';
import { LANE_AUTH_RETRY_MS } from '../lanes/lane.types';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  type TestDatabase,
} from './queue-db.test-support';
import {
  liveSignal,
  makeBudgetStub,
  makeLogger,
  makeTracker,
  makeWorkspace,
  type DrainSettings,
} from './skill-drain.test-support';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

/** `src/`, from `src/lib/queue/`. */
const SRC_ROOT = path.resolve(__dirname, '..', '..');

/** Every production `.ts` under `src/`, spec + test-support excluded. */
function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...productionSources(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts')) continue;
    if (entry.name.endsWith('.test-support.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * The seam is SINGLE-OWNER, and this is the mechanical half of saying so.
 *
 * `LaneRunnerService.fail` writes `requeue` for the two transport failures, but
 * only when a caller supplies `LaneRunRequest.queueItemId`. The drain maps those
 * same failures itself (`applyLaneFailure`). Doing BOTH double-writes the row —
 * harmless in isolation because `requeue` is idempotent, and a real defect the
 * moment the drain's terminal ceiling fires, because the runner would already
 * have released the claim the terminal mark expects to hold.
 *
 * A prose comment does not survive the next person wiring a stage. This does:
 * the only file allowed to name `queueItemId` is the runner that declares it.
 */
describe('the lane-failure queue write has exactly one owner (P1-7)', () => {
  it('is referenced by no production file other than the runner that declares it', () => {
    const owner = path.join('lanes', 'lane-runner.service.ts');
    const offenders = productionSources()
      .filter((file) => !file.endsWith(owner))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('queueItemId'))
      .map((file) => path.relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});

const ROOT = 'D:/repo';
const STAGE = 'judge' as const;

/** The row that fails. Enqueued first AND stamped oldest, so it runs first. */
const STALLED = 'session-stalled';
/** The row behind it. Must still run — that is criterion 4. */
const FOLLOWER = 'session-follower';

/**
 * The reason carries the LANE id (`judge`), which is what the batch requires the
 * row's `reason` to contain. It is a lane id, not a provider id: the lane is the
 * capability record, and which endpoint sits behind it is not this file's
 * business.
 */
const AUTH_FAILURE: SkillLaneFailure = {
  kind: 'auth-unresolvable',
  reason: 'Lane judge: configured credentials could not be resolved',
  retryAfterMs: LANE_AUTH_RETRY_MS,
};

const TIMEOUT_FAILURE: SkillLaneFailure = {
  kind: 'timeout',
  reason: 'Lane judge: timed out',
  retryAfterMs: 120_000,
};

const PARSE_FAILURE: SkillLaneFailure = {
  kind: 'structured-output-unsupported',
  reason: 'Lane judge: no parseable JSON in the response',
  retryAfterMs: 90_000,
};

maybe('SkillDrainService — lane failures (P1-7)', () => {
  let file: string;
  let db: TestDatabase;
  let store: SkillQueueStore;
  let logger: ReturnType<typeof makeLogger>;
  /** Session ids in the order their handler actually ran. */
  let ran: string[];

  const makeDrain = (settings: DrainSettings = {}): SkillDrainService =>
    new SkillDrainService(
      logger,
      store,
      makeBudgetStub(0).store,
      makeTracker(),
      makeWorkspace({
        [SKILL_DRAIN_KEYS.maxItemsPerRun]: 8,
        [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 8,
        ...settings,
      }),
    );

  /** Stamp `enqueued_at` so `ORDER BY enqueued_at ASC` cannot tie-break. */
  const stampOrder = (sessionId: string, enqueuedAt: number): void => {
    db.prepare(
      'UPDATE skill_synthesis_queue SET enqueued_at = ? WHERE session_id = ?',
    ).run(enqueuedAt, sessionId);
  };

  /**
   * Pre-age a row's attempt ladder. `tryClaim` increments on top of this, so a
   * row stamped `n` is dispatched carrying `n + 1`.
   */
  const stampAttempts = (sessionId: string, attemptCount: number): void => {
    db.prepare(
      'UPDATE skill_synthesis_queue SET attempt_count = ? WHERE session_id = ?',
    ).run(attemptCount, sessionId);
  };

  const rowFor = (sessionId: string) =>
    store.findBySessionStage(sessionId, STAGE);

  beforeEach(() => {
    const open = opener as NonNullable<typeof opener>;
    file = makeTempDbPath();
    db = openQueueDb(open, file);
    store = new SkillQueueStore(noopLogger, asConnection(db));
    logger = makeLogger();
    ran = [];

    for (const sessionId of [STALLED, FOLLOWER]) {
      store.enqueue({
        sessionId,
        stage: STAGE,
        source: 'idle',
        workspaceRoot: ROOT,
        turnCount: 9,
      });
    }
    stampOrder(STALLED, 1_000);
    stampOrder(FOLLOWER, 2_000);
  });

  afterEach(() => {
    db.close();
  });

  it('stalls the row and lets the rest of the tick run when lane auth is unresolvable', async () => {
    const drain = makeDrain();
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      return ctx.row.sessionId === STALLED
        ? { outcome: 'lane-failed', failure: AUTH_FAILURE }
        : { outcome: 'done' };
    });

    const before = Date.now();
    // (1) RESOLVES. `await` alone would pass on a rejection under a missing
    // assertion, so the summary is asserted too.
    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary.error).toBeUndefined();
    expect(summary).toMatchObject({
      skipped: false,
      claimed: 2,
      stalled: 1,
      done: 1,
      failed: 0,
      unscored: 0,
    });

    // (2) back to `queued`, behind a backoff.
    const stalled = rowFor(STALLED);
    expect(stalled?.status).toBe('queued');
    expect(stalled?.notBefore).toBeGreaterThan(before);
    expect(stalled?.notBefore).toBeGreaterThanOrEqual(
      before + LANE_AUTH_RETRY_MS,
    );
    // The claim is released, so the next tick can take it — a stall, not a lock.
    expect(stalled?.claimedBy).toBeNull();

    // (3) a non-empty, lane-naming reason.
    expect(stalled?.reason).toBeTruthy();
    expect(stalled?.reason).toContain('judge');
    expect(stalled?.reason).toBe(AUTH_FAILURE.reason);

    // (4) THE assertion that makes the rest meaningful: the failing row ran
    // FIRST and the item behind it still ran, in the same tick.
    expect(ran).toEqual([STALLED, FOLLOWER]);
    expect(rowFor(FOLLOWER)?.status).toBe('done');
  });

  it('never falls back: a stalled lane leaves the row unfinished and re-eligible only after its backoff', async () => {
    const drain = makeDrain();
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      return { outcome: 'lane-failed', failure: AUTH_FAILURE };
    });

    await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    // Q2: no second attempt on someone else's credentials, so exactly one run
    // per row and no row reached a finished state.
    expect(ran).toEqual([STALLED, FOLLOWER]);
    for (const sessionId of [STALLED, FOLLOWER]) {
      const row = rowFor(sessionId);
      expect(row?.status).toBe('queued');
      expect(row?.finishedAt).toBeNull();
    }

    // Inside the backoff nothing is eligible; past it both come back. A stall
    // that never re-opened would be a terminal failure wearing `queued`.
    expect(store.listEligible(ROOT, 10, Date.now() + 1_000)).toHaveLength(0);
    expect(
      store.listEligible(ROOT, 10, Date.now() + LANE_AUTH_RETRY_MS + 1_000),
    ).toHaveLength(2);
  });

  it('requeues a timed-out lane behind the backoff the lane asked for', async () => {
    const drain = makeDrain();
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      return ctx.row.sessionId === STALLED
        ? { outcome: 'lane-failed', failure: TIMEOUT_FAILURE }
        : { outcome: 'done' };
    });

    const before = Date.now();
    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ stalled: 1, done: 1, failed: 0 });
    const row = rowFor(STALLED);
    expect(row?.status).toBe('queued');
    expect(row?.notBefore).toBeGreaterThanOrEqual(
      before + TIMEOUT_FAILURE.retryAfterMs,
    );
    // NOT the 30-minute auth backoff: the lane owns the delay, the drain owns
    // only the transition.
    expect(row?.notBefore).toBeLessThan(before + LANE_AUTH_RETRY_MS);
    expect(rowFor(FOLLOWER)?.status).toBe('done');
  });

  it('marks the row terminally failed once it exhausts maxAttempts, with the Activity event that goes with it', async () => {
    // `tryClaim` increments `attempt_count` before dispatch, so a claimed row
    // under `maxAttempts: 1` already carries attempt 1 — the ceiling, first go.
    const drain = makeDrain({ [SKILL_DRAIN_KEYS.maxAttempts]: 1 });
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      return ctx.row.sessionId === STALLED
        ? { outcome: 'lane-failed', failure: TIMEOUT_FAILURE }
        : { outcome: 'done' };
    });

    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ failed: 1, stalled: 0, done: 1 });

    const row = rowFor(STALLED);
    // Terminal, with NO backoff — `failed` re-opens only through `enqueue`.
    expect(row?.status).toBe('failed');
    expect(row?.finishedAt).not.toBeNull();
    // The row is not left re-eligible.
    expect(store.listEligible(ROOT, 10, Date.now() + 86_400_000)).toEqual([]);

    // The mark and the event are ONE write plus ONE line, landed together. Both
    // halves the Activity surface reads are populated: `last_error` is the
    // lane's own message, `reason` is the user-facing sentence naming the stage
    // and the attempt count. A terminal row with a null `reason` is exactly the
    // "dies silently" failure this pairing exists to prevent.
    expect(row?.lastError).toBe(TIMEOUT_FAILURE.reason);
    expect(row?.reason).toBeTruthy();
    expect(row?.reason).toContain(STAGE);
    expect(row?.reason).toContain('1 attempts');
    expect(row?.reason).toContain(TIMEOUT_FAILURE.reason);

    // Exactly one warn for the whole tick — the row that died. Per-attempt
    // stalls log at `debug`, so this count is the event, not a coincidence.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({
      stage: STAGE,
      kind: 'timeout',
      attempt: 1,
    });

    // Still a whole tick: the follower ran and finished.
    expect(ran).toEqual([STALLED, FOLLOWER]);
    expect(rowFor(FOLLOWER)?.status).toBe('done');
  });

  it('never marks an unresolvable-auth row terminal, however many attempts it has burned', async () => {
    // Far past any plausible ceiling, and stamped rather than accumulated so
    // the assertion does not depend on `maxAttempts`' default staying at 5.
    // With `maxAttempts: 1` the claimed row carries attempt 21 against a
    // ceiling of 1 — twenty attempts clear of it.
    stampAttempts(STALLED, 20);
    const drain = makeDrain({ [SKILL_DRAIN_KEYS.maxAttempts]: 1 });
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      return ctx.row.sessionId === STALLED
        ? { outcome: 'lane-failed', failure: AUTH_FAILURE }
        : { outcome: 'done' };
    });

    const before = Date.now();
    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    // Still a stall. Not `failed`, not `unscored`, not terminal.
    expect(summary).toMatchObject({ stalled: 1, failed: 0, unscored: 0 });

    const row = rowFor(STALLED);
    expect(row?.attemptCount).toBe(21);
    expect(row?.status).toBe('queued');
    expect(row?.status).not.toBe('failed');
    expect(row?.notBefore).toBeGreaterThan(before);
    expect(row?.notBefore).toBeGreaterThanOrEqual(before + LANE_AUTH_RETRY_MS);
    expect(row?.finishedAt).toBeNull();
    expect(row?.lastError).toBeNull();

    // No terminal Activity event either — nothing died, so nothing announces a
    // death. `failTerminally` is the only `warn` on this path.
    expect(logger.warn).not.toHaveBeenCalled();

    // And it is genuinely still recoverable: once the user fixes the provider
    // config, the next tick past the backoff picks it straight back up. That
    // recoverability is the whole reason the ceiling does not apply here — a
    // `failed` row re-opens only via `enqueue`, and a finished session that
    // never grows again would never re-enqueue.
    const eligible = store.listEligible(
      ROOT,
      10,
      Date.now() + LANE_AUTH_RETRY_MS + 1_000,
    );
    expect(eligible.map((r) => r.sessionId)).toContain(STALLED);
  });

  it('applies the attempt ceiling to a timeout but not to unresolvable auth, at the same attempt count', async () => {
    // The asymmetry, stated as one assertion pair. Both rows are equally far
    // past the ceiling; only the kind differs, and only the kind decides.
    stampAttempts(STALLED, 20);
    stampAttempts(FOLLOWER, 20);
    const drain = makeDrain({ [SKILL_DRAIN_KEYS.maxAttempts]: 1 });
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      return ctx.row.sessionId === STALLED
        ? { outcome: 'lane-failed', failure: AUTH_FAILURE }
        : { outcome: 'lane-failed', failure: TIMEOUT_FAILURE };
    });

    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ stalled: 1, failed: 1 });

    // A user-fixable configuration fault survives.
    expect(rowFor(STALLED)?.status).toBe('queued');
    // A transport fault that may never clear does not.
    expect(rowFor(FOLLOWER)?.status).toBe('failed');
    expect(rowFor(FOLLOWER)?.reason).toContain('gave up after 21 attempts');

    // Exactly one terminal event, for the one row that died.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toMatchObject({ kind: 'timeout' });
  });

  it('maps a capability failure to unscored rather than to a transport stall', async () => {
    const drain = makeDrain();
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      return ctx.row.sessionId === STALLED
        ? { outcome: 'lane-failed', failure: PARSE_FAILURE }
        : { outcome: 'done' };
    });

    const before = Date.now();
    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    // The endpoint ANSWERED; we just cannot use the answer. That is the judge's
    // `unscored`, not the transport `queued` stall and not a terminal failure.
    expect(summary).toMatchObject({ unscored: 1, stalled: 0, failed: 0 });
    const row = rowFor(STALLED);
    expect(row?.status).toBe('unscored');
    expect(row?.reason).toBe(PARSE_FAILURE.reason);
    expect(row?.notBefore).toBeGreaterThanOrEqual(
      before + PARSE_FAILURE.retryAfterMs,
    );
    expect(rowFor(FOLLOWER)?.status).toBe('done');
  });

  it('stops writing when the claim was reaped mid-stage instead of stomping the row', async () => {
    const drain = makeDrain();
    drain.registerStageHandler(STAGE, async (ctx) => {
      ran.push(ctx.row.sessionId);
      if (ctx.row.sessionId !== STALLED) return { outcome: 'done' };
      // Someone else reaped this claim while the lane was out. `requeue`'s
      // `status IN ('claimed','running')` guard now rejects our write.
      store.reapStale(0, Date.now() + 60_000);
      expect(ctx.touch()).toBe(false);
      return { outcome: 'lane-failed', failure: AUTH_FAILURE };
    });

    const summary = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    // Counted as a lost claim, not as a stall — nothing of ours was written.
    expect(summary).toMatchObject({ stalled: 0, failed: 0, unscored: 0 });
    expect(summary.lostClaims).toBeGreaterThanOrEqual(1);
    expect(summary.error).toBeUndefined();

    const row = rowFor(STALLED);
    expect(row?.status).toBe('queued');
    // The reaper's reason survives; ours never landed.
    expect(row?.reason).not.toBe(AUTH_FAILURE.reason);
    // And the backoff was not pushed out on a row we no longer held: the row is
    // eligible right now, not parked for half an hour.
    expect(store.listEligible(ROOT, 10, Date.now())).toHaveLength(1);
  });
});
