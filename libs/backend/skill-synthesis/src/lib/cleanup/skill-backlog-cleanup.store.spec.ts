import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import {
  asConnection,
  makeTempDbPath,
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import { SkillBacklogCleanupStore } from './skill-backlog-cleanup.store';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

function migration(version: number): string {
  const value = MIGRATIONS.find((item) => item.version === version)?.sql;
  if (!value) throw new Error(`missing migration ${version}`);
  return value;
}

function openDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(makeTempDbPath());
  for (const version of [3, 11, 32, 33, 34, 35, 36, 40, 45]) {
    db.exec(migration(version));
  }
  return db;
}

function candidate(
  db: TestDatabase,
  id: string,
  createdAt: number,
  status = 'candidate',
): void {
  db.prepare(
    `INSERT INTO skill_candidates
       (id, name, description, body_path, source_session_ids,
        trajectory_hash, status, created_at, workspace_root)
     VALUES (?, ?, 'description', '/tmp/body', ?, ?, ?, ?, '/workspace')`,
  ).run(id, `name-${id}`, JSON.stringify([`session-${id}`]), `hash-${id}`, status, createdAt);
}

describe('SkillBacklogCleanupStore', () => {
  let db: TestDatabase;
  let store: SkillBacklogCleanupStore;

  beforeEach(() => {
    if (!opener) return;
    db = openDb();
    store = new SkillBacklogCleanupStore(asConnection(db));
  });

  afterEach(() => db?.close());

  maybe('initializes and updates the singleton row in place', () => {
    const initial = store.initialize(1, 100);
    expect(initial).toMatchObject({ version: 1, cutoffCreatedAt: 100, startedAt: 100 });
    const progressed = store.writeProgress({
      cursorCreatedAt: 10,
      cursorId: 'a',
      finishedAt: null,
      lastRunAt: 110,
      lastOutcome: 'partial',
      lastReason: 'row-budget',
      counters: {
        examined: 1,
        keptEvidence: 1,
        keptVerdict: 0,
        keptDegradedVerdict: 0,
        rejectedNoEvidence: 0,
        rejectedTranscriptUnreadable: 0,
        invocationsDeleted: 0,
      },
    });
    expect(progressed).toMatchObject({
      version: 1,
      cutoffCreatedAt: 100,
      startedAt: 100,
      cursorId: 'a',
      lastReason: 'row-budget',
    });
  });

  maybe('pages candidates by created_at then id and carries the cursor', () => {
    store.initialize(1, 100);
    candidate(db, 'b', 10);
    candidate(db, 'a', 10);
    candidate(db, 'c', 20);
    candidate(db, 'after', 100);
    candidate(db, 'rejected', 5, 'rejected');
    const first = store.pageCandidates(100, null, null, 2);
    expect(first.map((row) => row.id)).toEqual(['a', 'b']);
    expect(store.pageCandidates(100, 10, 'b', 2).map((row) => row.id)).toEqual([
      'c',
    ]);
  });

  maybe('guards rejection against a concurrent status change', () => {
    candidate(db, 'candidate', 10);
    candidate(db, 'promoted', 11);
    db.prepare(`UPDATE skill_candidates SET status = 'promoted' WHERE id = ?`).run(
      'promoted',
    );
    expect(
      store.rejectBatch(
        [
          { id: 'candidate', reason: 'cleanup' },
          { id: 'promoted', reason: 'cleanup' },
        ],
        200,
      ),
    ).toBe(1);
    const rows = db
      .prepare(`SELECT id, status FROM skill_candidates ORDER BY id`)
      .all() as Array<{ id: string; status: string }>;
    expect(rows).toEqual([
      { id: 'candidate', status: 'rejected' },
      { id: 'promoted', status: 'promoted' },
    ]);
  });

  maybe('rolls back the whole reject batch when one statement throws', () => {
    candidate(db, 'first', 10);
    candidate(db, 'boom', 11);
    db.exec(`CREATE TRIGGER reject_boom BEFORE UPDATE ON skill_candidates
      WHEN NEW.id = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    expect(() =>
      store.rejectBatch(
        [
          { id: 'first', reason: 'cleanup' },
          { id: 'boom', reason: 'cleanup' },
        ],
        200,
      ),
    ).toThrow('boom');
    const first = db
      .prepare(`SELECT status FROM skill_candidates WHERE id = ?`)
      .get('first') as { status: string };
    expect(first.status).toBe('candidate');
  });

  maybe('deletes only fake invocations in bounded pages', () => {
    candidate(db, 'skill', 10);
    const insert = db.prepare(
      `INSERT INTO skill_invocations
         (id, skill_id, session_id, succeeded, invoked_at, context_id)
       VALUES (?, 'skill', ?, 1, 10, ?)`,
    );
    insert.run('tracker', 'tracker-session', null);
    insert.run('fake-1', 'fake-session-1', 'ctx-1');
    insert.run('fake-2', 'fake-session-2', 'ctx-2');
    expect(store.deleteFakeInvocations(1)).toBe(1);
    expect(store.deleteFakeInvocations(1)).toBe(1);
    expect(store.deleteFakeInvocations(1)).toBe(0);
    const rows = db.prepare(`SELECT id FROM skill_invocations`).all() as Array<{
      id: string;
    }>;
    expect(rows).toEqual([{ id: 'tracker' }]);
  });
});
