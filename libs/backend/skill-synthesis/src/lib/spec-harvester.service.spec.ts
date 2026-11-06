import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { normalizeWorkspaceRoot } from '@ptah-extension/platform-core';
import { SpecHarvesterService } from './spec-harvester.service';
import { SkillInvocationEventStore } from './skill-invocation-event.store';
import { extractSpec, HARVEST_MARKER_FILE } from './spec-extractor';
import { SkillTaskGradeStore } from './skill-task-grade.store';

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
  let store: { reconcileTaskEvents: jest.Mock };
  let svc: SpecHarvesterService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spec-harvest-'));
    specsRoot = join(root, '.ptah', 'specs');
    await mkdir(specsRoot, { recursive: true });
    store = { reconcileTaskEvents: jest.fn().mockReturnValue(1) };
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
      status?: 'done' | 'cancelled' | 'in_progress';
      harvestedAt?: number;
      review?: string;
    } = {},
  ): Promise<string> {
    const dir = join(specsRoot, taskId);
    await mkdir(dir, { recursive: true });
    const status = opts.status ?? (opts.completed === false ? 'in_progress' : 'done');
    const completed = status !== 'in_progress';
    // Completion is driven by the `task.md` frontmatter status (no-legacy).
    await writeFile(join(dir, 'task.md'), taskMd(taskId, status), 'utf8');
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

  it('harvests completed unharvested specs, reconciles the task once and writes a v3 marker', async () => {
    const dir = await writeSpec('TASK_2026_001', { review: 'Verdict: APPROVED' });

    const result = await svc.harvest();

    expect(result).toEqual({ scanned: 1, harvested: 1, reconciled: 1, pending: 0, skippedFolders: 0 });
    expect(store.reconcileTaskEvents).toHaveBeenCalledTimes(1);
    expect(store.reconcileTaskEvents).toHaveBeenCalledWith({
      taskId: 'TASK_2026_001',
      workspaceRoot: normalizeWorkspaceRoot(root),
      succeeded: true,
      verdictSource: 'spec:TASK_2026_001',
      reconciledAt: expect.any(Number),
    });
    const marker = JSON.parse(await readFile(join(dir, HARVEST_MARKER_FILE), 'utf8'));
    expect(marker).toMatchObject({ version: 3, taskId: 'TASK_2026_001', reconciledCount: 1 });
  });

  it('re-harvests a legacy marker to attach an artifact digest', async () => {
    await writeSpec('TASK_2026_002', { harvestedAt: 1 });
    const result = await svc.harvest();
    expect(result.harvested).toBe(1);
    // done without a work review: no task verdict, nothing reconciled.
    expect(store.reconcileTaskEvents).not.toHaveBeenCalled();
  });

  it('re-harvests a v2 marker once and reconciles on every run regardless of the marker', async () => {
    const dir = await writeSpec('TASK_2026_003', { review: 'Verdict: REJECTED' });
    const digest = (await extractSpec(dir, specsRoot))?.artifactDigest;
    await writeFile(join(dir, HARVEST_MARKER_FILE), JSON.stringify({
      version: 2, artifactDigest: digest, taskId: 'TASK_2026_003', harvestedAt: 1, reconciledCount: 0,
    }), 'utf8');

    expect(await svc.harvest()).toMatchObject({ harvested: 1, reconciled: 1 });
    expect(store.reconcileTaskEvents).toHaveBeenLastCalledWith(expect.objectContaining({ succeeded: false }));

    store.reconcileTaskEvents.mockReturnValue(0);
    expect(await svc.harvest()).toMatchObject({ harvested: 0, reconciled: 0 });
    expect(store.reconcileTaskEvents).toHaveBeenCalledTimes(2);
    const marker = JSON.parse(await readFile(join(dir, HARVEST_MARKER_FILE), 'utf8'));
    expect(marker).toMatchObject({ version: 3, artifactDigest: digest, reconciledCount: 1 });
  });

  it('replaces a grade after a corrected review and passes each verdict to the guarded reconcile', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([{ kind: 'agent', slug: 'backend-developer', runId: 'run-1', sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: null }]),
      upsert: jest.fn().mockReturnValue(true), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn().mockReturnValue(false),
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
    // The store's reconciled_at guard (not the harvester) stops a second flip.
    expect(store.reconcileTaskEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({ succeeded: false }));
    expect(store.reconcileTaskEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ succeeded: true }));
  });

  it('lets batch and lane verdicts outrank conflicting reviews', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([{
        kind: 'agent', slug: 'backend-developer', runId: 'run-1',
        sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: null,
      }]),
      upsert: jest.fn().mockReturnValue(true), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
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
    // Conflicting reviews resolve to the latest one by mtime.
    const latestDir = await writeSpec('TASK_2026_098', {
      tasksMd: '## Batch 1: Backend — IN PROGRESS\n\n**Recommended Executor**: backend-developer\n',
      review: 'Verdict: PASS',
    });
    await writeFile(join(latestDir, 'code-style-review.md'), 'Verdict: FAIL', 'utf8');
    await utimes(join(latestDir, 'code-logic-review.md'), 2_000, 2_000);
    await utimes(join(latestDir, 'code-style-review.md'), 1_000, 1_000);
    await svc.harvest();
    expect(grades.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      taskId: 'TASK_2026_098', verdict: 'pass', sourceFile: 'code-logic-review.md', evidenceSource: 'task-review',
    }));
    expect(logger.debug).toHaveBeenCalledWith(
      '[spec-harvester] conflicting review verdicts resolved to the latest review',
      expect.objectContaining({ taskId: 'TASK_2026_098', file: 'code-logic-review.md' }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith('[spec-harvester] conflicting review verdicts', expect.anything());

    // A tie on the latest mtime stays ambiguous: no grade is written.
    const reviewDir = await writeSpec('TASK_2026_095', {
      tasksMd: '## Batch 1: Backend — IN PROGRESS\n\n**Recommended Executor**: backend-developer\n',
      review: 'Verdict: FAIL',
    });
    await writeFile(join(reviewDir, 'code-style-review.md'), 'Verdict: PASS', 'utf8');
    await utimes(join(reviewDir, 'code-logic-review.md'), 3_000, 3_000);
    await utimes(join(reviewDir, 'code-style-review.md'), 3_000, 3_000);
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
      upsert: jest.fn().mockReturnValue(true), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
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
      upsert: jest.fn().mockReturnValue(true), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
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
      upsert: jest.fn().mockReturnValue(true), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
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

  it('reconciles by task verdict: cancelled fails, done follows the review, others stay pending', async () => {
    await writeSpec('TASK_2026_311', { status: 'cancelled', review: 'Verdict: APPROVED' });
    await writeSpec('TASK_2026_312', { review: 'Verdict: APPROVED' });
    await writeSpec('TASK_2026_313'); // done without a work review
    await writeSpec('TASK_2026_314', { status: 'in_progress', review: 'Verdict: APPROVED' });
    await mkdir(join(specsRoot, 'TASK_2026_315')); // no task.md carrier

    const result = await svc.harvest();

    expect(result).toEqual({ scanned: 4, harvested: 3, reconciled: 2, pending: 1, skippedFolders: 1 });
    const calls = store.reconcileTaskEvents.mock.calls.map(([input]) => input);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'TASK_2026_311', succeeded: false, verdictSource: 'spec:TASK_2026_311' }),
      expect.objectContaining({ taskId: 'TASK_2026_312', succeeded: true, verdictSource: 'spec:TASK_2026_312' }),
    ]));
    expect(calls).toHaveLength(2);
  });

  it('logs harvest complete at info with every count even when nothing was harvested', async () => {
    const logger = makeLogger();
    svc = new SpecHarvesterService(logger as never, { getWorkspaceRoot: () => root } as never, store as never);
    await writeSpec('TASK_2026_320', { completed: false });
    await mkdir(join(specsRoot, 'TASK_2026_321'));

    expect(await svc.harvest(undefined, { trigger: 'auto' })).toEqual({
      scanned: 1, harvested: 0, reconciled: 0, pending: 1, skippedFolders: 1,
    });
    expect(logger.info).toHaveBeenCalledWith('[spec-harvester] harvest complete', {
      trigger: 'auto', scanned: 1, harvested: 0, reconciled: 0, pending: 1, skippedFolders: 1,
    });
    await svc.harvest();
    expect(logger.info).toHaveBeenLastCalledWith('[spec-harvester] harvest complete', expect.objectContaining({
      trigger: 'unspecified',
    }));
  });

  it('does not keep a grade key owned by another workspace', async () => {
    const grades = {
      findAttributions: jest.fn().mockReturnValue([{
        kind: 'agent', slug: 'backend-developer', runId: 'run-1',
        sessionId: 'session-1', attributionKey: 'run:run-1', finalReview: 'approved',
      }]),
      upsert: jest.fn().mockReturnValue(false), removeAbsent: jest.fn().mockReturnValue(0), hasGradeForTask: jest.fn(),
    };
    const logger = makeLogger();
    svc = new SpecHarvesterService(logger as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    await writeSpec('TASK_2026_330');
    expect((await svc.harvest()).harvested).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('[spec-harvester] grade key owned by another workspace', {
      taskId: 'TASK_2026_330', slug: 'backend-developer',
    });
    expect(grades.removeAbsent).toHaveBeenCalledWith('TASK_2026_330', normalizeWorkspaceRoot(root), []);
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

      expect(result).toEqual({ scanned: 0, harvested: 0, reconciled: 0, pending: 0, skippedFolders: 0 });
      expect(store.reconcileTaskEvents).not.toHaveBeenCalled();
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

  it('looks up grades for findings in the current workspace only', async () => {
    const grades = {
      findAttributions: jest.fn(), upsert: jest.fn().mockReturnValue(true), removeAbsent: jest.fn(),
      hasGradeForTask: jest.fn().mockReturnValue(true),
    };
    svc = new SpecHarvesterService(makeLogger() as never, { getWorkspaceRoot: () => root } as never, store as never, grades as never);
    await writeSpec('TASK_2026_G', { review: 'VERDICT: graded writer finding' });

    expect(await svc.getRecentFindings('writer', 'agent')).toContain('graded writer finding');
    expect(grades.hasGradeForTask).toHaveBeenCalledWith('TASK_2026_G', 'writer', 'agent', normalizeWorkspaceRoot(root));
  });
});

// ─── Real-store task-level reconciliation ────────────────────────────────────
//
// The mock-store tests above prove the harvester passes the task verdict and
// workspace to the store. These tests wire a REAL SkillInvocationEventStore
// (and, for grades, a real SkillTaskGradeStore) against an in-memory
// better-sqlite3 DB so the stamped rows, the `reconciled_at` guard and the
// cross-workspace grade guard are observed end to end.
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

/** Add the grade table (0056) and the attribution tables `findAttributions` reads. */
function addGradeTables(db: BetterSqliteDb, agents: readonly string[]): void {
  const sql = MIGRATIONS.find((migration) => migration.version === 56)?.sql;
  const schema = sql?.match(/CREATE TABLE skill_task_grades \([\s\S]*?CREATE INDEX idx_skill_task_grades_run ON skill_task_grades\(run_id\);/)?.[0];
  if (!schema) throw new Error('Migration 0056 grade schema unavailable');
  db.exec(schema);
  db.exec(`CREATE TABLE skill_registry (slug TEXT, kind TEXT);
    CREATE TABLE session_task_links (workspace_root TEXT, session_id TEXT, task_id TEXT);
    CREATE TABLE lane_outcome_records (
      run_id TEXT, subagent_session_id TEXT, final_review TEXT, task_id TEXT,
      workspace_root TEXT, role TEXT, executor_kind TEXT
    );`);
  for (const slug of agents) db.prepare('INSERT INTO skill_registry (slug, kind) VALUES (?, ?)').run(slug, 'agent');
}

function makeRealStore(db: BetterSqliteDb): SkillInvocationEventStore {
  const connection = { db, vecExtensionLoaded: false, isOpen: true };
  return new SkillInvocationEventStore(makeLogger() as never, connection as never);
}

function makeRealGradeStore(db: BetterSqliteDb): SkillTaskGradeStore {
  const connection = { db, vecExtensionLoaded: false, isOpen: true };
  return new SkillTaskGradeStore(makeLogger() as never, connection as never);
}

/** Write a done spec folder whose final work review carries `verdict`. */
async function writeReviewedSpec(
  specsRoot: string,
  taskId: string,
  verdict: 'APPROVED' | 'REJECTED',
  status: 'done' | 'cancelled' = 'done',
): Promise<string> {
  const dir = join(specsRoot, taskId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.md'), taskMd(taskId, status), 'utf8');
  await writeFile(join(dir, 'code-logic-review.md'), `Verdict: ${verdict}`, 'utf8');
  return dir;
}

interface VerdictRow {
  invoked_at: number;
  succeeded: number;
  reconciled_at: number | null;
  verdict_source: string | null;
}

function eventRows(db: BetterSqliteDb): VerdictRow[] {
  return db
    .prepare(
      `SELECT invoked_at, succeeded, reconciled_at, verdict_source
       FROM skill_invocation_events ORDER BY invoked_at`,
    )
    .all() as VerdictRow[];
}

function recordRun(
  store: SkillInvocationEventStore,
  slug: string,
  invokedAt: number,
  taskId: string | null,
  workspaceRoot: string | null,
  options: { source?: string; runId?: string } = {},
): void {
  store.recordSkillEvent({
    skillSlug: slug,
    sessionId: `sess-${invokedAt}`,
    contextId: null,
    source: options.source ?? 'subagent',
    succeeded: true, // optimistic, as onSubagentStop records it
    isError: false,
    invokedAt,
    taskId,
    workspaceRoot,
    runId: options.runId ?? null,
  });
}

describe('SpecHarvesterService — real-store task reconciliation', () => {
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

  maybe('flips every event of a done task with a rejecting final review to failed', async () => {
    recordRun(store, 'backend-developer', 1, 'TASK_2026_001', root);
    recordRun(store, 'frontend-developer', 2, 'TASK_2026_001', `${root}${sep}`);
    recordRun(store, 'some-skill', 3, 'TASK_2026_001', root, { source: 'tool-use' });
    await writeReviewedSpec(specsRoot, 'TASK_2026_001', 'REJECTED');

    const result = await svc.harvest();

    expect(result).toMatchObject({ harvested: 1, reconciled: 3 });
    for (const row of eventRows(db)) {
      expect(row).toMatchObject({ succeeded: 0, verdict_source: 'spec:TASK_2026_001' });
      expect(row.reconciled_at).not.toBeNull();
    }
  });

  maybe('never reconciles NULL-task, NULL-root or other-workspace events (no time-window fallback)', async () => {
    const dir = await writeReviewedSpec(specsRoot, 'TASK_2026_002', 'APPROVED');
    recordRun(store, 'backend-developer', 1_700_000_000_000, null, root);
    recordRun(store, 'backend-developer', 1_700_000_000_001, 'TASK_2026_002', null);
    recordRun(store, 'backend-developer', 1_700_000_000_002, 'TASK_2026_002', join(tmpdir(), 'another-repo'));
    // The spec's file-mtime window brackets every event above.
    await utimes(join(dir, 'task.md'), new Date(1_699_999_990_000), new Date(1_699_999_990_000));

    expect(await svc.harvest()).toMatchObject({ harvested: 1, reconciled: 0 });
    for (const row of eventRows(db)) {
      expect(row).toMatchObject({ succeeded: 1, reconciled_at: null, verdict_source: null });
    }
  });

  maybe('does not double-reconcile across repeated harvests (reconciled_at guard)', async () => {
    recordRun(store, 'backend-developer', 1, 'TASK_2026_003', root);
    const dir = await writeReviewedSpec(specsRoot, 'TASK_2026_003', 'APPROVED');

    const first = await svc.harvest();
    expect(first).toMatchObject({ harvested: 1, reconciled: 1 });
    const [afterFirst] = eventRows(db);
    expect(afterFirst.succeeded).toBe(1);
    expect(afterFirst.reconciled_at).not.toBeNull();

    // Marker current: nothing to harvest, and the store finds no open rows.
    expect(await svc.harvest()).toMatchObject({ harvested: 0, reconciled: 0 });

    // Even with the marker gone and the verdict flipped, a reconciled row stays.
    await rm(join(dir, HARVEST_MARKER_FILE), { force: true });
    await writeFile(join(dir, 'code-logic-review.md'), 'Verdict: REJECTED', 'utf8');
    expect(await svc.harvest()).toMatchObject({ harvested: 1, reconciled: 0 });
    expect(eventRows(db)).toEqual([afterFirst]);
  });
});

describe('SpecHarvesterService — two workspaces sharing a task id (R7)', () => {
  const TASK = 'TASK_2026_001';
  const AGENTS = ['backend-developer', 'frontend-developer'] as const;
  let rootA: string;
  let rootB: string;
  let db: BetterSqliteDb;
  let events: SkillInvocationEventStore;
  let logger: ReturnType<typeof makeLogger>;
  let svc: SpecHarvesterService;

  beforeEach(async () => {
    if (!nativeAvailable) return;
    rootA = await mkdtemp(join(tmpdir(), 'spec-harvest-ws-a-'));
    rootB = await mkdtemp(join(tmpdir(), 'spec-harvest-ws-b-'));
    db = createEventsDb();
    addGradeTables(db, AGENTS);
    events = makeRealStore(db);
    logger = makeLogger();
    svc = new SpecHarvesterService(
      logger as never,
      { getWorkspaceRoot: () => rootA } as never,
      events as never,
      makeRealGradeStore(db),
    );
  });

  afterEach(async () => {
    if (!nativeAvailable) return;
    db.close();
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });

  /** A done + approved spec already carrying a v2 marker for its current digest. */
  async function writeV2HarvestedSpec(workspaceRoot: string): Promise<void> {
    const specsRoot = join(workspaceRoot, '.ptah', 'specs');
    const dir = await writeReviewedSpec(specsRoot, TASK, 'APPROVED');
    const digest = (await extractSpec(dir, specsRoot))?.artifactDigest;
    if (!digest) throw new Error('fixture spec did not parse');
    await writeFile(join(dir, HARVEST_MARKER_FILE), JSON.stringify({
      version: 2, artifactDigest: digest, taskId: TASK, harvestedAt: 1, reconciledCount: 0,
    }), 'utf8');
  }

  function gradeRows(): unknown[] {
    return db.prepare('SELECT * FROM skill_task_grades ORDER BY workspace_root, attribution_key').all();
  }

  function gradeCount(workspaceRoot: string): number {
    const row = db.prepare('SELECT COUNT(*) AS n FROM skill_task_grades WHERE workspace_root = ?')
      .get(normalizeWorkspaceRoot(workspaceRoot)) as { n: number };
    return row.n;
  }

  function openEvents(workspaceRoot: string): number {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM skill_invocation_events
      WHERE workspace_root = ? AND reconciled_at IS NULL`).get(workspaceRoot) as { n: number };
    return row.n;
  }

  maybe('upgrades v2 markers and keeps each workspace to its own grades and events', async () => {
    let at = 1;
    for (const [label, workspaceRoot] of [['a', rootA], ['b', rootB]] as const) {
      await writeV2HarvestedSpec(workspaceRoot);
      for (const slug of AGENTS) {
        recordRun(events, slug, at++, TASK, workspaceRoot, { runId: `run-${label}-${slug}` });
      }
    }

    // Round 1: A, then B. Each harvest touches only its own workspace.
    expect(await svc.harvest(rootA)).toMatchObject({ harvested: 1, reconciled: 2 });
    expect(openEvents(rootA)).toBe(0);
    expect(openEvents(rootB)).toBe(2);
    expect(gradeCount(rootA)).toBe(AGENTS.length);
    expect(gradeCount(rootB)).toBe(0);

    expect(await svc.harvest(rootB)).toMatchObject({ harvested: 1, reconciled: 2 });
    expect(openEvents(rootB)).toBe(0);
    expect(gradeCount(rootA)).toBe(AGENTS.length);
    expect(gradeCount(rootB)).toBe(AGENTS.length);
    expect(gradeRows()).toHaveLength(AGENTS.length * 2);
    const verdicts = db.prepare('SELECT DISTINCT succeeded, verdict_source FROM skill_invocation_events').all();
    expect(verdicts).toEqual([{ succeeded: 1, verdict_source: `spec:${TASK}` }]);

    // Round 2: both again. Nothing reconciles, no grade row moves or repeats.
    const grades = JSON.stringify(gradeRows());
    const eventsBefore = JSON.stringify(eventRows(db));
    expect(await svc.harvest(rootA)).toMatchObject({ harvested: 0, reconciled: 0 });
    expect(await svc.harvest(rootB)).toMatchObject({ harvested: 0, reconciled: 0 });
    expect(JSON.stringify(gradeRows())).toBe(grades);
    expect(JSON.stringify(eventRows(db))).toBe(eventsBefore);
    expect(logger.warn).not.toHaveBeenCalledWith('[spec-harvester] grade key owned by another workspace', expect.anything());
  });

  maybe('never overwrites a colliding grade key owned by the other workspace', async () => {
    let at = 1;
    for (const workspaceRoot of [rootA, rootB]) {
      await writeV2HarvestedSpec(workspaceRoot);
      // Same run id in both workspaces -> same grade key for backend-developer.
      recordRun(events, 'backend-developer', at++, TASK, workspaceRoot, { runId: 'run-shared' });
    }

    await svc.harvest(rootA);
    const owned = JSON.stringify(gradeRows());
    expect(gradeCount(rootA)).toBe(1);

    expect(await svc.harvest(rootB)).toMatchObject({ harvested: 1, reconciled: 1 });
    expect(logger.warn).toHaveBeenCalledWith('[spec-harvester] grade key owned by another workspace', {
      taskId: TASK, slug: 'backend-developer',
    });
    expect(JSON.stringify(gradeRows())).toBe(owned);
    expect(gradeCount(rootB)).toBe(0);
  });
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
      { reconcileTaskEvents: jest.fn().mockReturnValue(0) } as never,
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
