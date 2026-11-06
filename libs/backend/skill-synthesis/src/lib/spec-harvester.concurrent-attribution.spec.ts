/**
 * End-to-end concurrent-task attribution at task level (TASK_2026_878 P3/P4).
 *
 * Drives the harvester over TWO real `.ptah/specs/TASK_*` fixture folders that
 * share an executor slug and overlapping file-mtime windows, wired through the
 * real `SkillInvocationEventStore` on an in-memory SQLite connection (no mocks
 * on the store side). It proves:
 *  - each task's events take exactly that task's verdict (by task id, never by
 *    time window), across every event source;
 *  - unstamped (NULL task) and other-workspace events are never claimed;
 *  - repeated and overlapping harvests (manual and auto at once) reconcile
 *    each event exactly once.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecHarvesterService } from './spec-harvester.service';
import { SkillInvocationEventStore } from './skill-invocation-event.store';

interface BetterSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  close(): void;
}

let nativeAvailable = false;
try {
  const DB = require('better-sqlite3') as new (path: string) => {
    close(): void;
  };
  const probe = new DB(':memory:');
  probe.close();
  nativeAvailable = true;
} catch {
  nativeAvailable = false;
}

const maybe = nativeAvailable ? it : it.skip;

const DatabaseCtor = nativeAvailable
  ? (require('better-sqlite3') as new (path: string) => BetterSqliteDb)
  : null;

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createEventsDb(): BetterSqliteDb {
  if (!DatabaseCtor) throw new Error('native not available');
  const db = new DatabaseCtor(':memory:');
  db.exec(`
    CREATE TABLE skill_invocation_events (
      id TEXT PRIMARY KEY,
      skill_slug TEXT NOT NULL,
      session_id TEXT NOT NULL,
      context_id TEXT,
      source TEXT NOT NULL,
      succeeded INTEGER NOT NULL,
      is_error INTEGER NOT NULL,
      invoked_at INTEGER NOT NULL,
      reconciled_at INTEGER,
      verdict_source TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cost_usd REAL,
      duration_ms INTEGER,
      tool_count INTEGER,
      task_id TEXT,
      -- Migration 0037 appends this last, nullable, with no default.
      workspace_root TEXT
    );
    CREATE INDEX idx_skill_inv_events_task
      ON skill_invocation_events(skill_slug, task_id);
  `);
  db.exec(MIGRATIONS.find((m) => m.version === 55)?.sql ?? '');
  return db;
}

function makeRealStore(db: BetterSqliteDb): SkillInvocationEventStore {
  const connection = { db, vecExtensionLoaded: false, isOpen: true };
  return new SkillInvocationEventStore(makeLogger() as never, connection as never);
}

interface VerdictRow {
  succeeded: number;
  is_error: number;
  reconciled_at: number | null;
  verdict_source: string | null;
}

function rowByTask(
  db: BetterSqliteDb,
  slug: string,
  taskId: string,
  workspaceRoot: string,
): VerdictRow {
  return db
    .prepare(
      `SELECT succeeded, is_error, reconciled_at, verdict_source
       FROM skill_invocation_events
       WHERE skill_slug = ? AND task_id = ? AND workspace_root = ?`,
    )
    .get(slug, taskId, workspaceRoot) as VerdictRow;
}

function recordRun(
  store: SkillInvocationEventStore,
  slug: string,
  invokedAt: number,
  taskId: string | null,
  workspaceRoot: string | null,
  source = 'subagent',
): void {
  store.recordSkillEvent({
    skillSlug: slug,
    sessionId: `sess-${slug}-${taskId ?? 'legacy'}-${invokedAt}`,
    contextId: null,
    source,
    succeeded: true, // optimistic, as onSubagentStop records it
    isError: false,
    invokedAt,
    taskId,
    workspaceRoot,
  });
}

function taskMd(id: string, status: string): string {
  return `---
id: ${id}
status: ${status}
type: FEATURE
title: Example task ${id}
created: 2026-07-14T10:00:00.000Z
updated: 2026-07-14T10:00:00.000Z
---

## Description

Example body for ${id}.
`;
}

/**
 * Write a finished spec folder whose final work review carries `verdict`, with
 * a batch run by `slug` and file mtimes spanning [mtimeStart, mtimeEnd].
 */
async function writeSpecForSlug(
  specsRoot: string,
  taskId: string,
  slug: string,
  verdict: 'APPROVED' | 'REJECTED',
  mtimeStart: number,
  mtimeEnd: number,
  status: 'done' | 'cancelled' = 'done',
): Promise<void> {
  const dir = join(specsRoot, taskId);
  await mkdir(dir, { recursive: true });
  const taskMdPath = join(dir, 'task.md');
  const batchesPath = join(dir, 'batches.md');
  const reviewPath = join(dir, 'code-logic-review.md');
  await writeFile(taskMdPath, taskMd(taskId, status), 'utf8');
  await writeFile(
    batchesPath,
    `## Batch 1: Delegated work — COMPLETE\n\n**Recommended Executor**: ${slug}\n`,
    'utf8',
  );
  await writeFile(reviewPath, `Verdict: ${verdict}`, 'utf8');
  await utimes(taskMdPath, new Date(mtimeStart), new Date(mtimeStart));
  await utimes(batchesPath, new Date(mtimeStart), new Date(mtimeStart));
  await utimes(reviewPath, new Date(mtimeEnd), new Date(mtimeEnd));
}

describe('SpecHarvesterService — end-to-end concurrent-task attribution (task level)', () => {
  const slug = 'backend-developer';
  let root: string;
  let specsRoot: string;
  let db: BetterSqliteDb;
  let store: SkillInvocationEventStore;
  let svc: SpecHarvesterService;

  function harvester(): SpecHarvesterService {
    return new SpecHarvesterService(
      makeLogger() as never,
      { getWorkspaceRoot: () => root } as never,
      store as never,
    );
  }

  beforeEach(async () => {
    if (!nativeAvailable) return;
    root = await mkdtemp(join(tmpdir(), 'spec-harvest-concurrent-'));
    specsRoot = join(root, '.ptah', 'specs');
    await mkdir(specsRoot, { recursive: true });
    db = createEventsDb();
    store = makeRealStore(db);
    svc = harvester();
  });

  afterEach(async () => {
    if (!nativeAvailable) return;
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  maybe(
    'two overlapping-window tasks, same slug, distinct task ids -> each takes its own verdict',
    async () => {
      // Overlapping windows: 401 = [1_000, 3_000], 402 = [2_000, 4_000].
      await writeSpecForSlug(specsRoot, 'TASK_2026_401', slug, 'APPROVED', 1_000, 3_000);
      await writeSpecForSlug(specsRoot, 'TASK_2026_402', slug, 'REJECTED', 2_000, 4_000);

      // Every event lands in the overlap zone [2_000, 3_000]; only the task id
      // can tell them apart.
      recordRun(store, slug, 2_100, 'TASK_2026_401', root);
      recordRun(store, 'some-skill', 2_150, 'TASK_2026_401', root, 'tool-use');
      recordRun(store, slug, 2_200, 'TASK_2026_402', root);
      // Never claimed: an unstamped legacy event and the same task id in
      // another workspace.
      recordRun(store, slug, 2_300, null, root);
      recordRun(store, slug, 2_400, 'TASK_2026_401', join(tmpdir(), 'another-repo'));

      const result = await svc.harvest();

      expect(result).toMatchObject({ harvested: 2, reconciled: 3 });
      expect(rowByTask(db, slug, 'TASK_2026_401', root)).toMatchObject({
        succeeded: 1, verdict_source: 'spec:TASK_2026_401',
      });
      expect(rowByTask(db, 'some-skill', 'TASK_2026_401', root)).toMatchObject({
        succeeded: 1, verdict_source: 'spec:TASK_2026_401',
      });
      expect(rowByTask(db, slug, 'TASK_2026_402', root)).toMatchObject({
        succeeded: 0, is_error: 0, verdict_source: 'spec:TASK_2026_402',
      });
      const untouched = db
        .prepare(
          `SELECT reconciled_at, verdict_source FROM skill_invocation_events
           WHERE task_id IS NULL OR workspace_root <> ?`,
        )
        .all(root);
      expect(untouched).toEqual([
        { reconciled_at: null, verdict_source: null },
        { reconciled_at: null, verdict_source: null },
      ]);
    },
  );

  maybe('a cancelled task fails its events even with an approving review', async () => {
    await writeSpecForSlug(specsRoot, 'TASK_2026_421', slug, 'APPROVED', 1_000, 3_000, 'cancelled');
    recordRun(store, slug, 2_100, 'TASK_2026_421', root);

    expect(await svc.harvest()).toMatchObject({ reconciled: 1 });
    expect(rowByTask(db, slug, 'TASK_2026_421', root)).toMatchObject({
      succeeded: 0, verdict_source: 'spec:TASK_2026_421',
    });
  });

  maybe('reconciling twice across both concurrent specs stays idempotent', async () => {
    await writeSpecForSlug(specsRoot, 'TASK_2026_411', slug, 'APPROVED', 1_000, 3_000);
    await writeSpecForSlug(specsRoot, 'TASK_2026_412', slug, 'REJECTED', 2_000, 4_000);
    recordRun(store, slug, 2_100, 'TASK_2026_411', root);
    recordRun(store, slug, 2_200, 'TASK_2026_412', root);

    expect(await svc.harvest()).toMatchObject({ reconciled: 2 });
    const before = [rowByTask(db, slug, 'TASK_2026_411', root), rowByTask(db, slug, 'TASK_2026_412', root)];

    expect(await svc.harvest()).toMatchObject({ harvested: 0, reconciled: 0 });
    expect([rowByTask(db, slug, 'TASK_2026_411', root), rowByTask(db, slug, 'TASK_2026_412', root)]).toEqual(before);
  });

  maybe('overlapping manual and auto harvests reconcile each event exactly once', async () => {
    await writeSpecForSlug(specsRoot, 'TASK_2026_431', slug, 'APPROVED', 1_000, 3_000);
    await writeSpecForSlug(specsRoot, 'TASK_2026_432', slug, 'REJECTED', 2_000, 4_000);
    for (let i = 0; i < 5; i++) {
      recordRun(store, slug, 2_100 + i, 'TASK_2026_431', root);
      recordRun(store, slug, 2_200 + i, 'TASK_2026_432', root);
    }

    const [manual, auto] = await Promise.all([
      svc.harvest(undefined, { trigger: 'manual' }),
      harvester().harvest(undefined, { trigger: 'auto' }),
    ]);

    expect(manual.reconciled + auto.reconciled).toBe(10);
    const counts = db
      .prepare(
        `SELECT task_id, succeeded, COUNT(*) AS n FROM skill_invocation_events
         WHERE reconciled_at IS NOT NULL GROUP BY task_id, succeeded ORDER BY task_id`,
      )
      .all();
    expect(counts).toEqual([
      { task_id: 'TASK_2026_431', succeeded: 1, n: 5 },
      { task_id: 'TASK_2026_432', succeeded: 0, n: 5 },
    ]);
  });
});
