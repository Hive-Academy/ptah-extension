/**
 * TASK_2026_296 item 6, Part B (R5) — `backfillSessionId` re-points queue rows
 * from a tabId onto the canonical SDK UUID without tripping
 * `UNIQUE(session_id, stage)`.
 *
 * The collision is the NORMAL case, not a corner: the same session very likely
 * enqueued the same stage under its canonical id once that id existed, so a row
 * for `(toId, stage)` is already there when the migration runs. A bare
 * `UPDATE ... SET session_id = ?` raises `SQLITE_CONSTRAINT_UNIQUE`, the
 * exception unwinds out of `SkillTriggerService.rekeySession`, and the
 * in-memory half of the migration is abandoned half-done.
 *
 * `UPDATE OR IGNORE` + `DELETE` of the un-migrated remainder is the resolution,
 * and the pre-existing `toId` row wins — the same refuse-overwrite rule the
 * in-memory maps follow.
 *
 * Both ids are real UUID v4 strings. A tabId IS a UUID v4, so `tab_N` would
 * make these pass for the wrong reason.
 */
import 'reflect-metadata';
import { SkillQueueStore } from './skill-queue.store';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  type TestDatabase,
} from './queue-db.test-support';

const TAB_ID = '4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21';
const REAL_ID = 'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70';
const OTHER_ID = 'f31c8a2d-55b6-4e19-9a07-1d8c4b2e6f93';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

maybe('SkillQueueStore.backfillSessionId (TASK_2026_296)', () => {
  let db: TestDatabase;
  let store: SkillQueueStore;

  beforeEach(() => {
    db = openQueueDb(opener as NonNullable<typeof opener>, makeTempDbPath());
    store = new SkillQueueStore(noopLogger, asConnection(db));
  });

  afterEach(() => db.close());

  function sessionIds(): string[] {
    return (
      db
        .prepare(
          'SELECT session_id FROM skill_synthesis_queue ORDER BY session_id, stage',
        )
        .all() as Array<{ session_id: string }>
    ).map((r) => r.session_id);
  }

  it('re-points a row when there is no collision', () => {
    store.enqueue({
      sessionId: TAB_ID,
      stage: 'prefilter',
      source: 'idle',
      workspaceRoot: 'D:/repo-a',
      turnCount: 7,
    });

    expect(store.backfillSessionId(TAB_ID, REAL_ID)).toEqual({
      migrated: 1,
      discarded: 0,
    });
    expect(sessionIds()).toEqual([REAL_ID]);
    expect(store.findBySessionStage(REAL_ID, 'prefilter')).toMatchObject({
      turnCount: 7,
    });
  });

  it('does not throw on a UNIQUE(session_id, stage) collision — the pre-existing toId row wins', () => {
    const stale = store.enqueue({
      sessionId: TAB_ID,
      stage: 'prefilter',
      source: 'idle',
      workspaceRoot: 'D:/repo-a',
      turnCount: 2,
    });
    store.enqueue({
      sessionId: REAL_ID,
      stage: 'prefilter',
      source: 'session-end',
      workspaceRoot: 'D:/repo-a',
      turnCount: 9,
    });

    // A bare UPDATE would raise here and abort the whole rekey.
    let result: { migrated: number; discarded: number } | null = null;
    expect(() => {
      result = store.backfillSessionId(TAB_ID, REAL_ID);
    }).not.toThrow();
    expect(result).toEqual({ migrated: 0, discarded: 1 });

    // Exactly one row survives, and it is the one enqueued under the canonical
    // id — so `turn_count` is still the value the re-open guard should compare
    // against, not the stale tabId row's lower count.
    expect(sessionIds()).toEqual([REAL_ID]);
    expect(store.findBySessionStage(REAL_ID, 'prefilter')).toMatchObject({
      source: 'session-end',
      turnCount: 9,
    });
    expect(store.findById(stale.row?.id ?? '')).toBeNull();
  });

  it('migrates the non-colliding stages and discards only the colliding one', () => {
    store.enqueue({
      sessionId: TAB_ID,
      stage: 'prefilter',
      source: 'idle',
      workspaceRoot: 'D:/repo-a',
    });
    store.enqueue({
      sessionId: TAB_ID,
      stage: 'archaeology',
      source: 'idle',
      workspaceRoot: 'D:/repo-a',
    });
    store.enqueue({
      sessionId: REAL_ID,
      stage: 'prefilter',
      source: 'session-end',
      workspaceRoot: 'D:/repo-a',
    });

    expect(store.backfillSessionId(TAB_ID, REAL_ID)).toEqual({
      migrated: 1,
      discarded: 1,
    });
    expect(store.findBySessionStage(REAL_ID, 'archaeology')).not.toBeNull();
    expect(store.findBySessionStage(REAL_ID, 'prefilter')).toMatchObject({
      source: 'session-end',
    });
    expect(sessionIds()).toEqual([REAL_ID, REAL_ID]);
  });

  // Paired-isolation siblings: the backfill must be inert where it has no
  // business acting, and must never touch another session's rows.
  it('leaves every other session untouched', () => {
    store.enqueue({
      sessionId: OTHER_ID,
      stage: 'prefilter',
      source: 'idle',
      workspaceRoot: 'D:/repo-b',
      turnCount: 4,
    });

    expect(store.backfillSessionId(TAB_ID, REAL_ID)).toEqual({
      migrated: 0,
      discarded: 0,
    });
    expect(sessionIds()).toEqual([OTHER_ID]);
    expect(store.findBySessionStage(OTHER_ID, 'prefilter')).toMatchObject({
      turnCount: 4,
    });
  });

  it('is a no-op for a blank or identical id pair', () => {
    store.enqueue({
      sessionId: TAB_ID,
      stage: 'prefilter',
      source: 'idle',
      workspaceRoot: 'D:/repo-a',
    });

    expect(store.backfillSessionId('', REAL_ID)).toEqual({
      migrated: 0,
      discarded: 0,
    });
    expect(store.backfillSessionId(TAB_ID, '   ')).toEqual({
      migrated: 0,
      discarded: 0,
    });
    expect(store.backfillSessionId(TAB_ID, TAB_ID)).toEqual({
      migrated: 0,
      discarded: 0,
    });
    expect(sessionIds()).toEqual([TAB_ID]);
  });

  it('contains no id-shape predicate — a tabId is a UUID v4', () => {
    // A `LIKE 'tab\\_%'` filter would match only the retired legacy format and
    // is wrong by construction. Pinned by reading the compiled method body
    // rather than by inspecting the diff.
    const body = SkillQueueStore.prototype.backfillSessionId.toString();
    expect(body).not.toMatch(/LIKE/i);
    expect(body).not.toContain('tab_');
  });
});
