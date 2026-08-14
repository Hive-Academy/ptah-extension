/**
 * P4-3 (second half) and the drain-level half of P0-2.
 *
 * "Idempotent" for a cron drain means two things, and both are properties of
 * the queue rather than of the scheduler:
 *
 *  1. Running the SAME tier twice processes each item once — the second tick
 *     finds the rows `done` and they are no longer eligible.
 *  2. Two drain services racing the same database process each item once — the
 *     CAS claim decides, and the loser records a lost claim instead of throwing.
 *
 * Both need real SQL, so this spec runs the real stores over one real file, the
 * same shape as `skill-queue.store.claim.spec.ts`: two connections, two
 * `SkillDrainService` instances, one database.
 */
import 'reflect-metadata';
import { SkillQueueStore } from './skill-queue.store';
import { SkillDrainService, SKILL_DRAIN_KEYS } from './skill-drain.service';
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
  makeTracker,
  makeWorkspace,
} from './skill-drain.test-support';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

const ROOT = 'D:/repo';

maybe('SkillDrainService — idempotency (P4-3)', () => {
  let file: string;
  let dbA: TestDatabase;
  let dbB: TestDatabase;
  let storeA: SkillQueueStore;
  let storeB: SkillQueueStore;
  /** Session id → number of times a handler ran for it. */
  let runs: Map<string, number>;

  const makeDrainOn = (store: SkillQueueStore): SkillDrainService => {
    const drain = new SkillDrainService(
      noopLogger,
      store,
      makeBudgetStub(0).store,
      makeTracker(),
      makeWorkspace({
        [SKILL_DRAIN_KEYS.maxItemsPerRun]: 8,
        [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 8,
      }),
    );
    drain.registerStageHandler('replay', async (ctx) => {
      runs.set(ctx.row.sessionId, (runs.get(ctx.row.sessionId) ?? 0) + 1);
      return { outcome: 'done' };
    });
    return drain;
  };

  beforeEach(() => {
    const open = opener as NonNullable<typeof opener>;
    file = makeTempDbPath();
    dbA = openQueueDb(open, file);
    dbB = openQueueDb(open, file);
    storeA = new SkillQueueStore(noopLogger, asConnection(dbA));
    storeB = new SkillQueueStore(noopLogger, asConnection(dbB));
    runs = new Map();

    for (const sessionId of ['session-1', 'session-2']) {
      storeA.enqueue({
        sessionId,
        stage: 'replay',
        source: 'idle',
        workspaceRoot: ROOT,
        turnCount: 9,
      });
    }
  });

  afterEach(() => {
    dbA.close();
    dbB.close();
  });

  it('processes each item once across two runs of the same tier', async () => {
    const drain = makeDrainOn(storeA);

    const first = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });
    const second = await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(first).toMatchObject({ claimed: 2, done: 2 });
    expect(second).toMatchObject({ claimed: 0, done: 0, lostClaims: 0 });
    expect([...runs.values()]).toEqual([1, 1]);
    expect(storeA.findBySessionStage('session-1', 'replay')?.status).toBe(
      'done',
    );
  });

  it('processes each item once across two concurrent drain services', async () => {
    const drainA = makeDrainOn(storeA);
    const drainB = makeDrainOn(storeB);

    const [a, b] = await Promise.all([
      drainA.drain({ tier: 'weekly', signal: liveSignal(), onBattery: false }),
      drainB.drain({ tier: 'weekly', signal: liveSignal(), onBattery: false }),
    ]);

    expect(runs.get('session-1')).toBe(1);
    expect(runs.get('session-2')).toBe(1);
    // Between them they claimed both rows exactly once, and whatever the split,
    // neither run threw.
    expect(a.claimed + b.claimed).toBe(2);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
  });

  it('leaves an unscored item eligible for the next tick, with its backoff honoured', async () => {
    const drain = new SkillDrainService(
      noopLogger,
      storeA,
      makeBudgetStub(0).store,
      makeTracker(),
      makeWorkspace({ [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 8 }),
    );
    let attempts = 0;
    drain.registerStageHandler('replay', async () => {
      attempts++;
      return { outcome: 'unscored', reason: 'no verdict', retryInMs: 60_000 };
    });

    await drain.drain({
      tier: 'weekly',
      signal: liveSignal(),
      onBattery: false,
    });
    expect(attempts).toBe(2);

    // Still inside the backoff window: nothing is eligible.
    expect(storeA.listEligible(ROOT, 10, Date.now() + 1_000)).toHaveLength(0);
    // Past it: both rows come back, which is what makes `unscored` a retry
    // rather than a terminal state.
    expect(storeA.listEligible(ROOT, 10, Date.now() + 120_000)).toHaveLength(2);
  });

  it('stops mid-tick when the cron slot is aborted', async () => {
    const controller = new AbortController();
    const drain = new SkillDrainService(
      noopLogger,
      storeA,
      makeBudgetStub(0).store,
      makeTracker(),
      makeWorkspace({ [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 8 }),
    );
    drain.registerStageHandler('replay', async (ctx) => {
      runs.set(ctx.row.sessionId, (runs.get(ctx.row.sessionId) ?? 0) + 1);
      controller.abort();
      return { outcome: 'done' };
    });

    const summary = await drain.drain({
      tier: 'weekly',
      signal: controller.signal,
      onBattery: false,
    });

    expect(runs.size).toBe(1);
    expect(summary).toMatchObject({ skipped: false, claimed: 1, done: 1 });
  });
});
