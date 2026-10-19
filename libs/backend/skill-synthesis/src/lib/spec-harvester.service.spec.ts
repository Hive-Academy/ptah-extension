import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { normalizeWorkspaceRoot } from '@ptah-extension/platform-core';
import { SpecHarvesterService } from './spec-harvester.service';
import { SkillInvocationEventStore } from './skill-invocation-event.store';
import { HARVEST_MARKER_FILE } from './spec-extractor';

const COMPLETED_TASKS_MD = `## Batch 1: Backend — COMPLETE

**Recommended Executor**: backend-developer

## Batch 2: Frontend — FAILED

**Recommended Executor**: frontend-developer
`;

const IN_PROGRESS_TASKS_MD = `## Batch 1: Backend — IN PROGRESS

**Recommended Executor**: backend-developer
`;

/** Build a valid `task.md` frontmatter carrier for the given status. */
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

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('SpecHarvesterService', () => {
  let root: string;
  let specsRoot: string;
  let store: { reconcileSubagentEvent: jest.Mock };
  let svc: SpecHarvesterService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spec-harvest-'));
    specsRoot = join(root, '.ptah', 'specs');
    await mkdir(specsRoot, { recursive: true });
    store = { reconcileSubagentEvent: jest.fn().mockReturnValue(true) };
    const workspaceProvider = { getWorkspaceRoot: jest.fn(() => root) };
    svc = new SpecHarvesterService(
      makeLogger() as never,
      workspaceProvider as never,
      store as never,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSpec(
    taskId: string,
    opts: {
      tasksMd?: string;
      completed?: boolean;
      harvestedAt?: number;
      review?: string;
    } = {},
  ): Promise<string> {
    const dir = join(specsRoot, taskId);
    await mkdir(dir, { recursive: true });
    const completed = opts.completed !== false;
    // Completion is driven by the `task.md` frontmatter status (no-legacy).
    await writeFile(
      join(dir, 'task.md'),
      taskMd(taskId, completed ? 'done' : 'in_progress'),
      'utf8',
    );
    const tasksMd =
      opts.tasksMd ?? (completed ? COMPLETED_TASKS_MD : IN_PROGRESS_TASKS_MD);
    await writeFile(join(dir, 'tasks.md'), tasksMd, 'utf8');
    if (opts.review) {
      await writeFile(join(dir, 'code-logic-review.md'), opts.review, 'utf8');
    }
    if (opts.harvestedAt !== undefined) {
      await writeFile(
        join(dir, HARVEST_MARKER_FILE),
        JSON.stringify({
          taskId,
          harvestedAt: opts.harvestedAt,
          reconciledCount: 0,
        }),
        'utf8',
      );
    }
    return dir;
  }

  it('harvests completed unharvested specs and writes a marker', async () => {
    const dir = await writeSpec('TASK_2026_001');

    const result = await svc.harvest();

    expect(result.harvested).toBe(1);
    expect(store.reconcileSubagentEvent).toHaveBeenCalledTimes(2);
    expect(store.reconcileSubagentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'backend-developer', succeeded: true }),
    );
    expect(store.reconcileSubagentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'frontend-developer', succeeded: false }),
    );
    for (const [input] of store.reconcileSubagentEvent.mock.calls) {
      expect(input).not.toHaveProperty('isError');
    }
    expect(await fileExists(join(dir, HARVEST_MARKER_FILE))).toBe(true);
  });

  it('re-harvests a legacy marker to attach an artifact digest', async () => {
    await writeSpec('TASK_2026_002', { harvestedAt: 1 });
    const result = await svc.harvest();
    expect(result.harvested).toBe(1);
    expect(store.reconcileSubagentEvent).not.toHaveBeenCalled();
  });

  it('replaces a grade after a corrected review without repeating the old reconciliation', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([{ kind: 'agent', slug: 'backend-developer', runId: 'run-1', sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: null }]),
      upsert: jest.fn(), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn().mockReturnValue(false),
    };
    svc = new SpecHarvesterService(makeLogger() as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    const dir = await writeSpec('TASK_2026_090', {
      tasksMd: '## Batch 1: Backend — IN PROGRESS\n\n**Recommended Executor**: backend-developer\n',
      review: 'Verdict: FAIL\nRun ID: run-1',
    });
    await svc.harvest();
    expect(grades.upsert).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'fail', sourceFile: 'code-logic-review.md' }));
    await expect(readFile(join(dir, HARVEST_MARKER_FILE), 'utf8')).resolves.toContain('artifactDigest');
    await writeFile(join(dir, 'code-logic-review.md'), 'Verdict: PASS\nRun ID: run-1', 'utf8');
    await svc.harvest();
    expect(grades.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'pass' }));
    expect(store.reconcileSubagentEvent).not.toHaveBeenCalled();
  });

  it('lets batch and lane verdicts outrank conflicting reviews', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([{
        kind: 'agent', slug: 'backend-developer', runId: 'run-1',
        sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: null,
      }]),
      upsert: jest.fn(), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
    };
    const logger = makeLogger();
    svc = new SpecHarvesterService(logger as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    const batchDir = await writeSpec('TASK_2026_091', { review: 'Verdict: FAIL' });
    await writeFile(join(batchDir, 'code-style-review.md'), 'Verdict: PASS', 'utf8');
    await svc.harvest();
    expect(grades.upsert).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'pass', evidenceSource: 'batch' }));

    grades.findAttributions.mockReturnValue([{
      kind: 'agent', slug: 'backend-developer', runId: 'run-1',
      sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: 'approved',
    }]);
    const laneDir = await writeSpec('TASK_2026_092', {
      tasksMd: '## Batch 1: Backend — IN PROGRESS\n\n**Recommended Executor**: backend-developer\n',
      review: 'Verdict: FAIL',
    });
    await writeFile(join(laneDir, 'code-style-review.md'), 'Verdict: PASS', 'utf8');
    await svc.harvest();
    expect(grades.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'pass', evidenceSource: 'lane-final-review' }));
    expect(logger.warn).not.toHaveBeenCalledWith('[spec-harvester] conflicting review verdicts', expect.anything());

    grades.findAttributions.mockReturnValue([{
      kind: 'agent', slug: 'backend-developer', runId: 'run-1',
      sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: null,
    }]);
    const reviewDir = await writeSpec('TASK_2026_095', {
      tasksMd: '## Batch 1: Backend — IN PROGRESS\n\n**Recommended Executor**: backend-developer\n',
      review: 'Verdict: FAIL',
    });
    await writeFile(join(reviewDir, 'code-style-review.md'), 'Verdict: PASS', 'utf8');
    const priorWrites = grades.upsert.mock.calls.length;
    grades.removeAbsent.mockReturnValueOnce(2);
    await svc.harvest();
    expect(grades.upsert).toHaveBeenCalledTimes(priorWrites);
    expect(logger.warn).toHaveBeenCalledWith('[spec-harvester] conflicting review verdicts', expect.objectContaining({ taskId: 'TASK_2026_095' }));
    expect(grades.removeAbsent).toHaveBeenCalledWith('TASK_2026_095', normalizeWorkspaceRoot(root), []);
    expect(logger.info).toHaveBeenCalledWith('[spec-harvester] pruned stale grades', {
      taskId: 'TASK_2026_095', removed: 2, kept: 0,
    });
  });

  it('passes the canonical workspace root to grade attribution and writes', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([{
        kind: 'agent', slug: 'backend-developer', runId: 'run-1',
        sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: 'approved',
      }]),
      upsert: jest.fn(), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
    };
    svc = new SpecHarvesterService(makeLogger() as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    await writeSpec('TASK_2026_093');
    const suppliedRoot = process.platform === 'win32'
      ? `${root.replace(/^[a-zA-Z]:/, (drive) => drive.toUpperCase())}${sep}`
      : `${root}${sep}`;
    await svc.harvest(suppliedRoot);
    const normalized = normalizeWorkspaceRoot(root);
    expect(grades.findAttributions).toHaveBeenCalledWith('TASK_2026_093', normalized);
    expect(grades.upsert).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: normalized }));
    expect(grades.removeAbsent).toHaveBeenCalledWith('TASK_2026_093', normalized, expect.any(Array));
  });

  it('warns once when a batched spec has no grade attributions and still marks it harvested', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([]),
      upsert: jest.fn(), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
    };
    const logger = makeLogger();
    svc = new SpecHarvesterService(logger as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    const dir = await writeSpec('TASK_2026_096');
    expect((await svc.harvest()).harvested).toBe(1);
    expect(logger.warn.mock.calls.filter(([message]) =>
      message === '[spec-harvester] no grade attributions for spec batches')).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[spec-harvester] no grade attributions for spec batches',
      { taskId: 'TASK_2026_096', batchCount: 2, attributionCount: 0 },
    );
    expect(await fileExists(join(dir, HARVEST_MARKER_FILE))).toBe(true);
  });

  it.each(['attribution', 'write'] as const)('retries after a failed grade %s without marking harvested', async (failure) => {
    const attribution = {
      kind: 'agent', slug: 'backend-developer', runId: 'run-1',
      sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: 'approved',
    };
    const grades = {
      findAttributions: jest.fn().mockReturnValue([attribution]),
      upsert: jest.fn(), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
    };
    if (failure === 'attribution') grades.findAttributions.mockImplementationOnce(() => { throw new Error('unavailable'); });
    else grades.upsert.mockImplementationOnce(() => { throw new Error('unavailable'); });
    svc = new SpecHarvesterService(makeLogger() as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    const dir = await writeSpec('TASK_2026_094');
    expect((await svc.harvest()).harvested).toBe(0);
    expect(await fileExists(join(dir, HARVEST_MARKER_FILE))).toBe(false);
    expect((await svc.harvest()).harvested).toBe(1);
    expect(grades.upsert).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'TASK_2026_094' }));
    expect(await fileExists(join(dir, HARVEST_MARKER_FILE))).toBe(true);
  });

  it('caps persistent grade-write attempts and warnings for an unchanged spec', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([{
        kind: 'agent', slug: 'backend-developer', runId: 'run-1',
        sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: 'approved',
      }]),
      upsert: jest.fn(() => { throw new Error('unavailable'); }),
      removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
    };
    const logger = makeLogger();
    svc = new SpecHarvesterService(logger as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    const dir = await writeSpec('TASK_2026_097');
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await svc.harvest()).harvested).toBe(0);
    }
    expect(grades.upsert).toHaveBeenCalledTimes(3);
    expect(logger.warn.mock.calls.filter(([message]) => message === '[spec-harvester] grade write unavailable')).toHaveLength(3);
    expect(await fileExists(join(dir, HARVEST_MARKER_FILE))).toBe(false);
  });

  // ─── Task 3.1: taskId + provenance threading (harvest → store) ─────────────
  it('threads spec.taskId and spec: provenance into every reconcile call', async () => {
    await writeSpec('TASK_2026_311');

    await svc.harvest();

    // Both batch verdicts must carry the spec's task id and base provenance so
    // the store's exact (slug, task_id) pass can fire (D4).
    expect(store.reconcileSubagentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'backend-developer',
        taskId: 'TASK_2026_311',
        succeeded: true,
        verdictSource: 'spec:TASK_2026_311',
      }),
    );
    expect(store.reconcileSubagentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'frontend-developer',
        taskId: 'TASK_2026_311',
        succeeded: false,
        verdictSource: 'spec:TASK_2026_311',
      }),
    );
  });

  // ─── Task 3.2: degradation — runtime without `.ptah/specs` ─────────────────
  it('reconciles nothing and does not throw when `.ptah/specs` is absent', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'spec-harvest-bare-'));
    try {
      const logger = makeLogger();
      const bareSvc = new SpecHarvesterService(
        logger as never,
        { getWorkspaceRoot: () => bare } as never,
        store as never,
      );

      // readSpecs' readdir catch → [] no-op; the taskId threading is unreached.
      const result = await bareSvc.harvest();

      expect(result).toEqual({ scanned: 0, harvested: 0, reconciled: 0 });
      expect(store.reconcileSubagentEvent).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('classifies specs for the cleanup UI', async () => {
    await writeSpec('TASK_2026_A', { completed: false }); // active
    await writeSpec('TASK_2026_B'); // complete-unharvested
    await writeSpec('TASK_2026_C', { harvestedAt: 1 }); // harvested

    const specs = await svc.listSpecs();
    const byId = Object.fromEntries(specs.map((s) => [s.taskId, s.status]));
    expect(byId['TASK_2026_A']).toBe('active');
    expect(byId['TASK_2026_B']).toBe('complete-unharvested');
    expect(byId['TASK_2026_C']).toBe('harvested');
  });

  it('archives stale harvested specs and leaves active ones untouched', async () => {
    const staleDir = await writeSpec('TASK_2026_OLD', { harvestedAt: 1 });
    const activeDir = await writeSpec('TASK_2026_LIVE', { completed: false });

    const result = await svc.clearStaleSpecs(undefined, {
      retentionDays: 0,
      mode: 'archive',
    });

    expect(result.cleared).toBe(1);
    expect(result.taskIds).toEqual(['TASK_2026_OLD']);
    expect(await fileExists(staleDir)).toBe(false);
    expect(await fileExists(join(specsRoot, '.archive', 'TASK_2026_OLD'))).toBe(
      true,
    );
    expect(await fileExists(activeDir)).toBe(true);
  });

  it('returns graded findings for a slug from completed specs', async () => {
    await writeSpec('TASK_2026_F', {
      review: 'VERDICT: backend missed a null check',
    });

    const findings = await svc.getRecentFindings('backend-developer');
    expect(findings).toContain('backend missed a null check');

    const none = await svc.getRecentFindings('unrelated-agent');
    expect(none).toBeNull();
  });
});

// ─── Real-store harvest reconciliation provenance (Task 3.1) ─────────────────
//
// The mock-store tests above prove the harvester THREADS taskId + provenance.
// These tests wire a REAL SkillInvocationEventStore against a temp better-sqlite3 DB
// so we can observe what the store actually STAMPS end-to-end: `spec:` on an
// exact (slug, task_id) hit vs `spec-window:` on the legacy NULL-task_id
// window fallback, plus `.harvested.json` + `reconciled_at` idempotency.
//
// Skipped when the native module can't load (ABI mismatch), matching
// skill-candidate.store.spec.ts.

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

/** Write a COMPLETE/backend + FAILED/frontend spec folder (unharvested). */
async function writeCompletedSpec(
  specsRoot: string,
  taskId: string,
): Promise<string> {
  const dir = join(specsRoot, taskId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.md'), taskMd(taskId, 'done'), 'utf8');
  await writeFile(join(dir, 'tasks.md'), COMPLETED_TASKS_MD, 'utf8');
  return dir;
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
  store: SkillInvocationEventStore,
  slug: string,
  invokedAt: number,
  taskId: string | null,
): void {
  store.recordSkillEvent({
    skillSlug: slug,
    sessionId: `sess-${invokedAt}`,
    contextId: null,
    source: 'subagent',
    succeeded: true, // optimistic, as onSubagentStop records it
    isError: false,
    invokedAt,
    taskId,
  });
}

describe('SpecHarvesterService — real-store reconciliation provenance', () => {
  let root: string;
  let specsRoot: string;
  let db: BetterSqliteDb;
  let store: SkillInvocationEventStore;
  let svc: SpecHarvesterService;

  beforeEach(async () => {
    if (!nativeAvailable) return;
    root = await mkdtemp(join(tmpdir(), 'spec-harvest-real-'));
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
    'stamps spec:TASK_X when a task_id-stamped event exists (exact pass, ignores window)',
    async () => {
      // Recorded far outside any file-mtime window — only the exact (slug,
      // task_id) pass can reach it, proving the harvester threads taskId.
      recordSubagentRun(store, 'backend-developer', 1, 'TASK_2026_001');
      await writeCompletedSpec(specsRoot, 'TASK_2026_001');

      const result = await svc.harvest();

      expect(result.harvested).toBe(1);
      expect(result.reconciled).toBe(1); // backend hit; frontend has no event
      const row = rowByTask(db, 'backend-developer', 'TASK_2026_001');
      expect(row.verdict_source).toBe('spec:TASK_2026_001');
      expect(row.succeeded).toBe(1); // COMPLETE verdict
      expect(row.reconciled_at).not.toBeNull();
    },
  );

  maybe(
    'stamps spec-window:TASK_X when only a legacy NULL-task_id row matches the window',
    async () => {
      const windowMid = 1_700_000_000_000;
      // Legacy telemetry with no task attribution.
      recordSubagentRun(store, 'backend-developer', windowMid, null);
      const dir = await writeCompletedSpec(specsRoot, 'TASK_2026_002');
      // Bracket the legacy invoked_at with the spec's file-mtime window so the
      // fallback query's BETWEEN matches (windowStart .. windowEnd).
      await utimes(
        join(dir, 'task.md'),
        new Date(windowMid - 10_000),
        new Date(windowMid - 10_000),
      );
      await utimes(
        join(dir, 'tasks.md'),
        new Date(windowMid + 10_000),
        new Date(windowMid + 10_000),
      );

      const result = await svc.harvest();

      expect(result.reconciled).toBe(1);
      const row = db
        .prepare(
          `SELECT succeeded, verdict_source, reconciled_at
           FROM skill_invocation_events
           WHERE skill_slug = ? AND task_id IS NULL`,
        )
        .get('backend-developer') as VerdictRow;
      // Heuristic attribution is rewritten to spec-window: for auditability.
      expect(row.verdict_source).toBe('spec-window:TASK_2026_002');
      expect(row.succeeded).toBe(1);
      expect(row.reconciled_at).not.toBeNull();
    },
  );

  maybe(
    'does not double-reconcile across repeated harvests (marker + reconciled_at guard)',
    async () => {
      recordSubagentRun(store, 'backend-developer', 1, 'TASK_2026_003');
      const dir = await writeCompletedSpec(specsRoot, 'TASK_2026_003');

      const first = await svc.harvest();
      expect(first.harvested).toBe(1);
      expect(first.reconciled).toBe(1);
      const afterFirst = rowByTask(db, 'backend-developer', 'TASK_2026_003');
      const reconciledAt = afterFirst.reconciled_at;
      expect(reconciledAt).not.toBeNull();

      // (1) Marker guard: the spec is now harvested → skipped wholesale.
      const second = await svc.harvest();
      expect(second.harvested).toBe(0);
      expect(second.reconciled).toBe(0);

      // (2) reconciled_at guard: even bypassing the marker, the store refuses to
      // re-flip an already-reconciled row.
      await rm(join(dir, HARVEST_MARKER_FILE), { force: true });
      const third = await svc.harvest();
      expect(third.reconciled).toBe(0);
      const afterThird = rowByTask(db, 'backend-developer', 'TASK_2026_003');
      expect(afterThird.reconciled_at).toBe(reconciledAt); // unchanged
      expect(afterThird.succeeded).toBe(1);
    },
  );
});

describe('SpecHarvesterService — carrier-less folder warning', () => {
  let root: string;
  let specsRoot: string;
  let logger: ReturnType<typeof makeLogger>;
  let svc: SpecHarvesterService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spec-harvest-warn-'));
    specsRoot = join(root, '.ptah', 'specs');
    await mkdir(specsRoot, { recursive: true });
    logger = makeLogger();
    svc = new SpecHarvesterService(
      logger as never,
      { getWorkspaceRoot: jest.fn(() => root) } as never,
      { reconcileSubagentEvent: jest.fn().mockReturnValue(true) } as never,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('warns exactly once, naming the carrier-less folder', async () => {
    await mkdir(join(specsRoot, 'TASK_2026_LEGACY'), { recursive: true });
    await writeFile(
      join(specsRoot, 'TASK_2026_LEGACY', 'context.md'),
      'prose but no carrier',
      'utf8',
    );

    await svc.harvest();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, payload] = logger.warn.mock.calls[0];
    expect(String(message)).toContain('task.md');
    expect((payload as { folders: string[] }).folders).toEqual([
      'TASK_2026_LEGACY',
    ]);
  });

  it('names every skipped folder in ONE warn, not one warn per folder', async () => {
    const names = ['TASK_2026_150', 'TASK_2026_151', 'TASK_2026_152'];
    for (const name of names) {
      await mkdir(join(specsRoot, name), { recursive: true });
    }

    await svc.harvest();

    // R8: a workspace with a dozen carrier-less folders must not produce a
    // dozen log lines.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const payload = logger.warn.mock.calls[0][1] as { folders: string[] };
    expect(payload.folders.sort()).toEqual(names);
  });

  it('stays silent when every TASK_* folder carries a valid task.md', async () => {
    const dir = join(specsRoot, 'TASK_2026_200');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'task.md'),
      taskMd('TASK_2026_200', 'done'),
      'utf8',
    );

    await svc.harvest();

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
