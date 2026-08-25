/**
 * Unit tests for JobStore.upsert.
 *
 * Uses an in-memory map-based fake SqliteConnectionService so the tests run
 * without better-sqlite3 native bindings (which are compiled for Electron's
 * Node ABI and cannot be loaded in the Jest/Node.js test runner).
 *
 * The fake implements only the `scheduled_jobs` INSERT / INSERT-OR-UPDATE /
 * SELECT statement patterns that JobStore exercises. This is sufficient to
 * verify the upsert idempotency contract without needing a real SQLite file.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import { JobStore } from './job.store';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';

// ── Fake statement types ──────────────────────────────────────────────────────

interface FakeRow {
  id: string;
  name: string;
  cron_expr: string;
  timezone: string;
  prompt: string;
  workspace_root: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
}

/**
 * Minimal fake SqliteDatabase for the scheduled_jobs CRUD patterns.
 *
 * Supports:
 *  - INSERT INTO scheduled_jobs ... VALUES (...) (the create path)
 *  - INSERT INTO scheduled_jobs ... ON CONFLICT(id) DO UPDATE ... (the upsert path)
 *  - SELECT * FROM scheduled_jobs WHERE id = ?
 *  - UPDATE scheduled_jobs SET last_run_at = ... WHERE id = ? (used in test setup)
 *  - Any other statement: no-op (not used by JobStore)
 */
class FakeScheduledJobsDatabase {
  private readonly rows = new Map<string, FakeRow>();

  // Arrow-function form avoids `const self = this` aliasing.
  prepare = (sql: string) => {
    const rows = this.rows;

    // ── INSERT ... ON CONFLICT ... DO UPDATE (upsert) ─────────────────────
    if (/INSERT INTO scheduled_jobs/i.test(sql) && /ON CONFLICT/i.test(sql)) {
      return {
        run(...params: unknown[]) {
          const [
            id,
            name,
            cron_expr,
            timezone,
            prompt,
            workspace_root,
            enabled,
            created_at,
            updated_at,
            next_run_at,
          ] = params as [
            string,
            string,
            string,
            string,
            string,
            string | null,
            number,
            number,
            number,
            number | null,
          ];
          const existing = rows.get(id);
          if (existing) {
            // ON CONFLICT DO UPDATE — does NOT touch last_run_at or created_at
            existing.name = name;
            existing.cron_expr = cron_expr;
            existing.timezone = timezone;
            existing.prompt = prompt;
            existing.workspace_root = workspace_root;
            existing.enabled = enabled;
            existing.updated_at = updated_at;
            existing.next_run_at = next_run_at;
          } else {
            rows.set(id, {
              id,
              name,
              cron_expr,
              timezone,
              prompt,
              workspace_root,
              enabled,
              created_at,
              updated_at,
              last_run_at: null,
              next_run_at,
            });
          }
          return { changes: 1, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
        iterate: () => [][Symbol.iterator](),
      };
    }

    // ── INSERT without ON CONFLICT (create path) ──────────────────────────
    if (/INSERT INTO scheduled_jobs/i.test(sql)) {
      return {
        run(...params: unknown[]) {
          const [
            id,
            name,
            cron_expr,
            timezone,
            prompt,
            workspace_root,
            enabled,
            created_at,
            updated_at,
            next_run_at,
          ] = params as [
            string,
            string,
            string,
            string,
            string,
            string | null,
            number,
            number,
            number,
            number | null,
          ];
          rows.set(id, {
            id,
            name,
            cron_expr,
            timezone,
            prompt,
            workspace_root,
            enabled,
            created_at,
            updated_at,
            last_run_at: null,
            next_run_at,
          });
          return { changes: 1, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
        iterate: () => [][Symbol.iterator](),
      };
    }

    // ── SELECT * FROM scheduled_jobs WHERE id = ? ─────────────────────────
    if (/SELECT \* FROM scheduled_jobs WHERE id/i.test(sql)) {
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get(...params: unknown[]) {
          const id = params[0] as string;
          return rows.get(id) ?? undefined;
        },
        all: () => [],
        iterate: () => [][Symbol.iterator](),
      };
    }

    // ── SELECT * FROM scheduled_jobs [WHERE ...] ORDER BY ... ─────────────
    if (/SELECT \* FROM scheduled_jobs/i.test(sql)) {
      const filterEnabled = /enabled = 1/i.test(sql);
      const filterWorkspace = /workspace_root = \?/i.test(sql);
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => undefined,
        all(...params: unknown[]) {
          // `workspace_root = ?` is the only parameterized condition, so the
          // workspace root (when present) is always the first bound param.
          const wantedWorkspace = filterWorkspace
            ? (params[0] as string)
            : undefined;
          return Array.from(rows.values()).filter((row) => {
            if (filterEnabled && row.enabled !== 1) return false;
            if (filterWorkspace && row.workspace_root !== wantedWorkspace) {
              return false;
            }
            return true;
          });
        },
        iterate: () => rows.values(),
      };
    }

    // ── UPDATE scheduled_jobs SET last_run_at ... ─────────────────────────
    if (/UPDATE scheduled_jobs/i.test(sql)) {
      return {
        run(...params: unknown[]) {
          // Minimal: set last_run_at from the first param, id from last.
          if (params.length >= 2) {
            const id = params[params.length - 1] as string;
            const row = rows.get(id);
            if (row && /last_run_at/i.test(sql)) {
              row.last_run_at = params[0] as number | null;
            }
          }
          return { changes: 1, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
        iterate: () => [][Symbol.iterator](),
      };
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (/DELETE FROM scheduled_jobs/i.test(sql)) {
      return {
        run(...params: unknown[]) {
          const id = params[0] as string;
          const deleted = rows.delete(id);
          return { changes: deleted ? 1 : 0, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
        iterate: () => [][Symbol.iterator](),
      };
    }

    // ── Fallback: no-op for unrecognised statements ────────────────────────
    return {
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      get: () => undefined,
      all: () => [],
      iterate: () => [][Symbol.iterator](),
    };
  };

  /** Direct accessor for test assertions. */
  getRow(id: string): FakeRow | undefined {
    return this.rows.get(id);
  }

  /** Direct setter for test setup (simulates a completed run). */
  setLastRunAt(id: string, value: number): void {
    const row = this.rows.get(id);
    if (row) row.last_run_at = value;
  }

  rowCount(): number {
    return this.rows.size;
  }

  // Required by SqliteDatabase shape but unused in these tests.
  exec() {
    return undefined;
  }
  pragma() {
    return [];
  }
  close() {
    return undefined;
  }
  get open() {
    return true;
  }
  get inTransaction() {
    return false;
  }
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return fn;
  }
}

// ── Logger stub ───────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as Logger;
}

// ── Factory ───────────────────────────────────────────────────────────────────

function buildStore() {
  const fakeDb = new FakeScheduledJobsDatabase();
  const connection = { db: fakeDb } as unknown as SqliteConnectionService;
  const store = new JobStore(connection, makeLogger());
  return { store, fakeDb };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('JobStore.upsert', () => {
  it('inserts a new row when the id does not exist', () => {
    const { store, fakeDb } = buildStore();

    store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      prompt: 'handler:backup:daily',
      enabled: true,
    });

    const row = fakeDb.getRow('@ptah/daily-backup');
    expect(row).toBeDefined();
    expect(row?.name).toBe('Daily SQLite Backup');
    expect(row?.cron_expr).toBe('0 3 * * *');
    expect(row?.enabled).toBe(1);
    expect(row?.timezone).toBe('UTC');
  });

  it('replaces an existing row when the id already exists', () => {
    const { store, fakeDb } = buildStore();

    store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      prompt: 'handler:backup:daily',
    });

    // Call upsert again with a different cron expression.
    store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 4 * * *',
      prompt: 'handler:backup:daily',
    });

    const row = fakeDb.getRow('@ptah/daily-backup');
    expect(row?.cron_expr).toBe('0 4 * * *');
  });

  it('is idempotent: calling upsert three times produces exactly one row', () => {
    const { store, fakeDb } = buildStore();

    for (let i = 0; i < 3; i++) {
      store.upsert({
        id: '@ptah/daily-backup',
        name: 'Daily SQLite Backup',
        cronExpr: '0 3 * * *',
        prompt: 'handler:backup:daily',
      });
    }

    expect(fakeDb.rowCount()).toBe(1);
  });

  it('returns a ScheduledJob with the correct field values', () => {
    const { store } = buildStore();

    const job = store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      timezone: 'Europe/London',
      prompt: 'handler:backup:daily',
      workspaceRoot: null,
      enabled: false,
      nextRunAt: 12345,
    });

    expect(job.name).toBe('Daily SQLite Backup');
    expect(job.cronExpr).toBe('0 3 * * *');
    expect(job.timezone).toBe('Europe/London');
    expect(job.enabled).toBe(false);
    expect(job.nextRunAt).toBe(12345);
    expect(job.lastRunAt).toBeNull();
    expect(String(job.id)).toBe('@ptah/daily-backup');
  });

  it('preserves last_run_at of the existing row during an update', () => {
    const { store, fakeDb } = buildStore();

    // Initial upsert.
    store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      prompt: 'handler:backup:daily',
    });

    // Simulate a completed run.
    fakeDb.setLastRunAt('@ptah/daily-backup', 9999999);

    // Second upsert — ON CONFLICT SET must NOT touch last_run_at.
    store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      prompt: 'handler:backup:daily',
    });

    const row = fakeDb.getRow('@ptah/daily-backup');
    expect(row?.last_run_at).toBe(9999999);
  });

  it('defaults timezone to UTC when not specified', () => {
    const { store, fakeDb } = buildStore();

    store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      prompt: 'handler:backup:daily',
    });

    const row = fakeDb.getRow('@ptah/daily-backup');
    expect(row?.timezone).toBe('UTC');
  });

  it('defaults enabled to true when not specified', () => {
    const { store, fakeDb } = buildStore();

    store.upsert({
      id: '@ptah/daily-backup',
      name: 'Daily SQLite Backup',
      cronExpr: '0 3 * * *',
      prompt: 'handler:backup:daily',
    });

    const row = fakeDb.getRow('@ptah/daily-backup');
    expect(row?.enabled).toBe(1);
  });
});

describe('JobStore.list', () => {
  function seedThreeJobs(store: JobStore) {
    store.create({
      name: 'job-a',
      cronExpr: '0 * * * *',
      prompt: 'a',
      workspaceRoot: '/ws-a',
      enabled: true,
      nextRunAt: null,
    });
    store.create({
      name: 'job-b',
      cronExpr: '0 * * * *',
      prompt: 'b',
      workspaceRoot: '/ws-b',
      enabled: false,
      nextRunAt: null,
    });
    store.create({
      name: 'job-global',
      cronExpr: '0 * * * *',
      prompt: 'g',
      workspaceRoot: null,
      enabled: true,
      nextRunAt: null,
    });
  }

  it('returns every job when no filter is provided', () => {
    const { store } = buildStore();
    seedThreeJobs(store);

    const jobs = store.list();
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.name).sort()).toEqual([
      'job-a',
      'job-b',
      'job-global',
    ]);
  });

  it('filters to a single workspace when workspaceRoot is provided', () => {
    const { store } = buildStore();
    seedThreeJobs(store);

    const jobs = store.list({ workspaceRoot: '/ws-a' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('job-a');
    expect(jobs[0].workspaceRoot).toBe('/ws-a');
  });

  it('returns an empty list when no job matches the workspaceRoot', () => {
    const { store } = buildStore();
    seedThreeJobs(store);

    expect(store.list({ workspaceRoot: '/ws-unknown' })).toEqual([]);
  });

  it('combines enabledOnly with the workspaceRoot filter', () => {
    const { store } = buildStore();
    seedThreeJobs(store);

    // job-b is in /ws-b but disabled → excluded by enabledOnly.
    expect(store.list({ enabledOnly: true, workspaceRoot: '/ws-b' })).toEqual(
      [],
    );
    // job-a is in /ws-a and enabled → included.
    const enabledInA = store.list({
      enabledOnly: true,
      workspaceRoot: '/ws-a',
    });
    expect(enabledInA).toHaveLength(1);
    expect(enabledInA[0].name).toBe('job-a');
  });

  it('still honors enabledOnly with no workspace filter', () => {
    const { store } = buildStore();
    seedThreeJobs(store);

    const enabled = store.list({ enabledOnly: true });
    expect(enabled.map((j) => j.name).sort()).toEqual(['job-a', 'job-global']);
  });
});

describe('JobStore.list workspaceRoot normalization', () => {
  const winIt = process.platform === 'win32' ? it : it.skip;

  it('matches a stored root that differs only by a trailing separator', () => {
    const { store } = buildStore();
    // Portable absolute base; stored WITH a trailing separator (as a renderer
    // that appended `path.sep` would produce), queried WITHOUT one.
    const base = path.resolve('trailing-sep-ws');
    store.create({
      name: 'job-trailing',
      cronExpr: '0 * * * *',
      prompt: 'p',
      workspaceRoot: base + path.sep,
      enabled: true,
      nextRunAt: null,
    });

    const jobs = store.list({ workspaceRoot: base });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('job-trailing');
  });

  it('matches legacy rows holding an un-normalized workspace_root', () => {
    const { store } = buildStore();
    const base = path.resolve('legacy-ws');
    // Simulate a legacy row written before normalization existed: raw value
    // with a redundant `.` segment + trailing separator. path.resolve collapses
    // the `.` so the query below is still the same logical workspace.
    store.create({
      name: 'job-legacy',
      cronExpr: '0 * * * *',
      prompt: 'p',
      workspaceRoot: path.join(base, '.') + path.sep,
      enabled: true,
      nextRunAt: null,
    });

    expect(store.list({ workspaceRoot: base })).toHaveLength(1);
  });

  winIt(
    'folds drive-letter case + separator drift but preserves segment case (D:\\Foo\\ ↔ d:/Foo)',
    () => {
      const { store } = buildStore();
      store.create({
        name: 'job-win',
        cronExpr: '0 * * * *',
        prompt: 'p',
        workspaceRoot: 'D:\\Foo\\',
        enabled: true,
        nextRunAt: null,
      });

      // Different drive case + forward slashes + trailing slash → same root.
      expect(store.list({ workspaceRoot: 'd:/Foo' })).toHaveLength(1);
      // Path-segment case is NOT folded — only the drive letter is.
      expect(store.list({ workspaceRoot: 'd:/foo' })).toHaveLength(0);
    },
  );
});
