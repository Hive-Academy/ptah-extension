/**
 * TASK_2026_158 Batch 7 (QA) — end-to-end concurrent-task attribution.
 *
 * Closes a coverage gap between two existing suites:
 *  - `skill-candidate.store.spec.ts` R4.3 proves the STORE never cross-attributes
 *    two task_id-stamped rows for the same slug, using hand-constructed
 *    `reconcileSubagentEvent` calls against a real (in-memory) better-sqlite3 DB.
 *  - `spec-harvester.service.spec.ts` "real-store reconciliation provenance"
 *    proves the HARVESTER threads `spec.taskId` correctly end-to-end, but only
 *    ever exercises ONE spec folder per `harvest()` call.
 *
 * Neither test drives the harvester over TWO real `.ptah/specs/TASK_*` fixture
 * folders — same executor slug, overlapping file-mtime windows, distinct
 * task ids — in a SINGLE `harvest()` pass. That is the exact real-world shape
 * of R4.3 (two concurrent orchestrated tasks delegating to the same agent) and
 * the scenario this file adds, wired through the real `SkillCandidateStore`
 * against a real (in-memory) SQLite connection — no mocks on the store side.
 */
import 'reflect-metadata';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecHarvesterService } from './spec-harvester.service';
import { SkillCandidateStore } from './skill-candidate.store';

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
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
      task_id TEXT
    );
    CREATE INDEX idx_skill_inv_events_task
      ON skill_invocation_events(skill_slug, task_id);
  `);
  return db;
}

function makeRealStore(db: BetterSqliteDb): SkillCandidateStore {
  const connection = { db, vecExtensionLoaded: false, isOpen: true };
  const vecStatus = {
    available: false,
    getStatus: () => ({ available: false }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  };
  return new SkillCandidateStore(
    makeLogger() as never,
    connection as never,
    vecStatus as never,
  );
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
): VerdictRow {
  return db
    .prepare(
      `SELECT succeeded, is_error, reconciled_at, verdict_source
       FROM skill_invocation_events WHERE skill_slug = ? AND task_id = ?`,
    )
    .get(slug, taskId) as VerdictRow;
}

function recordSubagentRun(
  store: SkillCandidateStore,
  slug: string,
  invokedAt: number,
  taskId: string | null,
): void {
  store.recordSkillEvent({
    skillSlug: slug,
    sessionId: `sess-${slug}-${taskId ?? 'legacy'}-${invokedAt}`,
    contextId: null,
    source: 'subagent',
    succeeded: true, // optimistic, as onSubagentStop records it
    isError: false,
    invokedAt,
    taskId,
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

/** Write a completed spec folder whose sole batch is run by `slug`. */
async function writeSpecForSlug(
  specsRoot: string,
  taskId: string,
  slug: string,
  status: 'COMPLETE' | 'FAILED',
  mtimeStart: number,
  mtimeEnd: number,
): Promise<void> {
  const dir = join(specsRoot, taskId);
  await mkdir(dir, { recursive: true });
  const taskMdPath = join(dir, 'task.md');
  const tasksMdPath = join(dir, 'tasks.md');
  await writeFile(taskMdPath, taskMd(taskId, 'done'), 'utf8');
  await writeFile(
    tasksMdPath,
    `## Batch 1: Delegated work — ${status}\n\n**Recommended Executor**: ${slug}\n`,
    'utf8',
  );
  // windowStart/windowEnd derive from file mtimes (spec-extractor's readWindow).
  await utimes(taskMdPath, new Date(mtimeStart), new Date(mtimeStart));
  await utimes(tasksMdPath, new Date(mtimeEnd), new Date(mtimeEnd));
}

describe('SpecHarvesterService — end-to-end concurrent-task attribution (R4.3)', () => {
  let root: string;
  let specsRoot: string;
  let db: BetterSqliteDb;
  let store: SkillCandidateStore;
  let svc: SpecHarvesterService;

  beforeEach(async () => {
    if (!nativeAvailable) return;
    root = await mkdtemp(join(tmpdir(), 'spec-harvest-concurrent-'));
    specsRoot = join(root, '.ptah', 'specs');
    await mkdir(specsRoot, { recursive: true });
    db = createEventsDb();
    store = makeRealStore(db);
    svc = new SpecHarvesterService(
      makeLogger() as never,
      { getWorkspaceRoot: () => root } as never,
      store as never,
    );
  });

  afterEach(async () => {
    if (!nativeAvailable) return;
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  maybe(
    'two overlapping-window specs, same executor slug, distinct task_ids -> no cross-attribution',
    async () => {
      const slug = 'backend-developer';
      // Overlapping windows: 401 = [1_000, 3_000], 402 = [2_000, 4_000].
      // Any window-only (legacy) heuristic would be unable to disambiguate
      // events recorded in [2_000, 3_000] between the two tasks — the exact
      // (slug, task_id) pass must be what resolves them.
      await writeSpecForSlug(
        specsRoot,
        'TASK_2026_401',
        slug,
        'COMPLETE',
        1_000,
        3_000,
      );
      await writeSpecForSlug(
        specsRoot,
        'TASK_2026_402',
        slug,
        'FAILED',
        2_000,
        4_000,
      );

      // Both events land in the overlap zone [2_000, 3_000] — only task_id
      // stamping (not window) can tell them apart.
      recordSubagentRun(store, slug, 2_100, 'TASK_2026_401');
      recordSubagentRun(store, slug, 2_200, 'TASK_2026_402');
      // A legacy (unstamped) event also in the overlap zone — must be
      // reachable only by window fallback, and must not be stolen by the
      // exact pass for either task.
      recordSubagentRun(store, slug, 2_300, null);

      const result = await svc.harvest();

      // 2 batches (one per spec) reconciled by exact pass; the harvester does
      // not touch the legacy row (no exact task_id match for either spec).
      expect(result.harvested).toBe(2);
      expect(result.reconciled).toBe(2);

      const row401 = rowByTask(db, slug, 'TASK_2026_401');
      const row402 = rowByTask(db, slug, 'TASK_2026_402');

      // Each stamped row carries EXACTLY its own task's verdict — the bug
      // R4 fixes is one task's verdict leaking onto the other's row.
      expect(row401.verdict_source).toBe('spec:TASK_2026_401');
      expect(row401.succeeded).toBe(1); // COMPLETE
      expect(row402.verdict_source).toBe('spec:TASK_2026_402');
      expect(row402.succeeded).toBe(0); // FAILED
      expect(row402.is_error).toBe(1);

      // The legacy row is untouched by the exact passes (still unreconciled) —
      // proving the window-restricted fallback (task_id IS NULL only) is the
      // only path that could ever claim it, and exact passes never touch rows
      // stamped for a different task.
      const legacy = db
        .prepare(
          `SELECT verdict_source, reconciled_at FROM skill_invocation_events
           WHERE skill_slug = ? AND task_id IS NULL`,
        )
        .get(slug) as {
        verdict_source: string | null;
        reconciled_at: number | null;
      };
      expect(legacy.reconciled_at).toBeNull();
      expect(legacy.verdict_source).toBeNull();
    },
  );

  maybe(
    'reconciling twice across both concurrent specs stays idempotent',
    async () => {
      const slug = 'backend-developer';
      await writeSpecForSlug(
        specsRoot,
        'TASK_2026_411',
        slug,
        'COMPLETE',
        1_000,
        3_000,
      );
      await writeSpecForSlug(
        specsRoot,
        'TASK_2026_412',
        slug,
        'FAILED',
        2_000,
        4_000,
      );
      recordSubagentRun(store, slug, 2_100, 'TASK_2026_411');
      recordSubagentRun(store, slug, 2_200, 'TASK_2026_412');

      const first = await svc.harvest();
      expect(first.reconciled).toBe(2);

      const second = await svc.harvest();
      // Both specs now carry `.harvested.json` markers — nothing left to do.
      expect(second.harvested).toBe(0);
      expect(second.reconciled).toBe(0);

      const row411 = rowByTask(db, slug, 'TASK_2026_411');
      const row412 = rowByTask(db, slug, 'TASK_2026_412');
      expect(row411.verdict_source).toBe('spec:TASK_2026_411');
      expect(row412.verdict_source).toBe('spec:TASK_2026_412');
    },
  );
});
