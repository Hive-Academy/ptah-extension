/**
 * R4 — drain starvation.
 *
 * The failure this pins is mundane and fatal: `ORDER BY enqueued_at` over the
 * whole queue. One busy project enqueues ten items, `maxItemsPerRun` is four,
 * and every other project on the machine never gets synthesized. The mitigation
 * is round-robin over `skill_synthesis_workspace_cursor` with
 * `perWorkspaceBatch = 1`, and the only way to prove it is against the real SQL
 * — the ordering lives in `ELIGIBLE_WORKSPACES_SQL`, not in the service.
 *
 * So this spec runs the REAL `SkillQueueStore` over a real SQLite file (via the
 * shared opener, which falls back to `node:sqlite` when `better-sqlite3` is
 * built for Electron's ABI) and the REAL drain on top of it.
 */
import 'reflect-metadata';
import { SkillQueueStore } from './skill-queue.store';
import { SkillDrainService, SKILL_DRAIN_KEYS } from './skill-drain.service';
import type { SkillQueueRow } from './skill-queue.types';
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

const BUSY = 'D:/repo-busy';
const QUIET_A = 'D:/repo-quiet-a';
const QUIET_B = 'D:/repo-quiet-b';

maybe('SkillDrainService — per-workspace fairness (R4)', () => {
  let db: TestDatabase;
  let store: SkillQueueStore;
  let handled: SkillQueueRow[];

  const makeDrainOver = (settings: Record<string, unknown> = {}) => {
    const drain = new SkillDrainService(
      noopLogger,
      store,
      makeBudgetStub(0).store,
      makeTracker(),
      makeWorkspace({
        [SKILL_DRAIN_KEYS.maxItemsPerRun]: 4,
        [SKILL_DRAIN_KEYS.perWorkspaceBatch]: 1,
        ...settings,
      }),
    );
    drain.registerStageHandler('prefilter', async (ctx) => {
      handled.push(ctx.row);
      return { outcome: 'done' };
    });
    return drain;
  };

  const seed = (workspaceRoot: string, count: number, from = 0): void => {
    for (let i = 0; i < count; i++) {
      store.enqueue({
        sessionId: `${workspaceRoot}#${from + i}`,
        stage: 'prefilter',
        source: 'session-end',
        workspaceRoot,
        turnCount: 6,
        enqueuedAt: 1_770_000_000_000 + from + i,
      });
    }
  };

  /** The round-robin cursor rows, read straight out of SQLite. */
  const cursors = (): Record<string, number> => {
    const rows = db
      .prepare(
        `SELECT workspace_root, last_drained_at
           FROM skill_synthesis_workspace_cursor`,
      )
      .all() as Array<{ workspace_root: string; last_drained_at: number }>;
    const out: Record<string, number> = {};
    for (const row of rows) out[row.workspace_root] = row.last_drained_at;
    return out;
  };

  beforeEach(() => {
    const open = opener as NonNullable<typeof opener>;
    db = openQueueDb(open, makeTempDbPath());
    store = new SkillQueueStore(noopLogger, asConnection(db));
    handled = [];
  });

  afterEach(() => {
    db.close();
  });

  it('yields 1/1/1 from three workspaces holding 10/1/1 items', async () => {
    seed(BUSY, 10);
    seed(QUIET_A, 1, 100);
    seed(QUIET_B, 1, 200);

    const summary = await makeDrainOver().drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    const perWorkspace = countByWorkspace(handled);
    expect(perWorkspace).toEqual({ [BUSY]: 1, [QUIET_A]: 1, [QUIET_B]: 1 });
    expect(summary).toMatchObject({
      skipped: false,
      claimed: 3,
      done: 3,
      workspacesVisited: 3,
    });
  });

  it('advances the cursor so the next tick starts at a different workspace', async () => {
    seed(BUSY, 10);
    seed(QUIET_A, 1, 100);

    const drain = makeDrainOver();
    // Tick 1 at t0; tick 2 one minute later. Distinct clocks so the cursor
    // ordering is unambiguous.
    await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: 1_770_000_100_000,
    });
    expect(countByWorkspace(handled)).toEqual({ [BUSY]: 1, [QUIET_A]: 1 });
    expect(cursors()).toEqual({
      [BUSY]: 1_770_000_100_000,
      [QUIET_A]: 1_770_000_100_000,
    });

    // QUIET_A is now empty, so tick 2 can only serve BUSY — and BUSY's cursor
    // must move again, which is what `listEligibleWorkspaces` orders on.
    await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: 1_770_000_160_000,
    });
    expect(countByWorkspace(handled)).toEqual({ [BUSY]: 2, [QUIET_A]: 1 });
    expect(cursors()).toEqual({
      [BUSY]: 1_770_000_160_000,
      [QUIET_A]: 1_770_000_100_000,
    });
    expect(store.listEligibleWorkspaces(1_770_000_200_000)).toEqual([BUSY]);
  });

  it('serves a brand-new workspace before one that was just drained', async () => {
    seed(BUSY, 10);

    const drain = makeDrainOver();
    await drain.drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: 1_770_000_100_000,
    });

    // A new project appears after the busy one already has a cursor row.
    seed(QUIET_A, 1, 100);
    expect(store.listEligibleWorkspaces(1_770_000_160_000)[0]).toBe(QUIET_A);
  });

  it('bumps the cursor of a workspace whose rows all belong to another tier', async () => {
    // An archaeology row is invisible to the frequent tier. If its workspace's
    // cursor were left untouched it would sit at the head of the round-robin
    // order forever and starve everyone behind it.
    store.enqueue({
      sessionId: 'nightly-only',
      stage: 'archaeology',
      source: 'session-end',
      workspaceRoot: QUIET_B,
      turnCount: 6,
      enqueuedAt: 1_770_000_000_000,
    });
    seed(BUSY, 2, 300);

    const summary = await makeDrainOver().drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
      now: 1_770_000_100_000,
    });

    expect(countByWorkspace(handled)).toEqual({ [BUSY]: 1 });
    expect(summary.workspacesVisited).toBe(2);
    // Cursor bumped for the yielded-nothing workspace too.
    expect(cursors()).toEqual({
      [BUSY]: 1_770_000_100_000,
      [QUIET_B]: 1_770_000_100_000,
    });
  });

  it('runs the nightly-only stage on the nightly tier', async () => {
    store.enqueue({
      sessionId: 'nightly-only',
      stage: 'archaeology',
      source: 'session-end',
      workspaceRoot: QUIET_B,
      turnCount: 6,
    });
    const drain = makeDrainOver();
    let archaeologyRuns = 0;
    drain.registerStageHandler('archaeology', async () => {
      archaeologyRuns++;
      return { outcome: 'done' };
    });

    await drain.drain({
      tier: 'nightly',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(archaeologyRuns).toBe(1);
  });

  it('never claims more than maxItemsPerRun in one tick', async () => {
    seed(BUSY, 3);
    seed(QUIET_A, 3, 100);
    seed(QUIET_B, 3, 200);

    const summary = await makeDrainOver({
      [SKILL_DRAIN_KEYS.maxItemsPerRun]: 2,
    }).drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(handled).toHaveLength(2);
    expect(summary.claimed).toBe(2);
  });

  it('marks an item skipped when no handler is registered for its stage', async () => {
    store.enqueue({
      sessionId: 'orphan',
      stage: 'clustering',
      source: 'idle',
      workspaceRoot: QUIET_A,
      turnCount: 6,
    });

    const summary = await makeDrainOver().drain({
      tier: 'frequent',
      signal: liveSignal(),
      onBattery: false,
    });

    expect(summary).toMatchObject({ claimed: 1, skippedItems: 1 });
    expect(store.findBySessionStage('orphan', 'clustering')).toMatchObject({
      status: 'skipped',
      reason: 'no handler for stage clustering',
    });
  });
});

function countByWorkspace(rows: SkillQueueRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.workspaceRoot] = (out[row.workspaceRoot] ?? 0) + 1;
  }
  return out;
}
