/**
 * RunStore.tryClaim — the at-most-once slot claim, pinned across the move of
 * `isUniqueConstraintError` into `@ptah-extension/persistence-sqlite`
 * (TASK_2026_180 B0.1).
 *
 * The predicate is now imported rather than declared here, and that import is
 * exactly the kind of change nothing else would notice: `tryClaim` still
 * compiles, still inserts, and only misbehaves in the one branch that fires
 * when two runners race for the same slot. So this file asserts the branch
 * directly — a UNIQUE violation becomes `SlotAlreadyClaimedError`, and every
 * other SQLite error keeps propagating untouched. If a future edit widened the
 * predicate, the second test is what fails.
 *
 * A map-backed fake stands in for better-sqlite3, which this repo rebuilds
 * against Electron's ABI and therefore cannot load in the Jest runner — the
 * same reason `job.store.spec.ts` fakes it.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { JobId } from '@ptah-extension/shared';
import { RunStore, SlotAlreadyClaimedError } from './run.store';

const JOB_ID = JobId.from('01ARZ3NDEKTSV4RRFFQ69G5FAV');

/** better-sqlite3's error surface for the two cases tryClaim distinguishes. */
function sqliteError(code: string): Error {
  return Object.assign(new Error(`sqlite failure: ${code}`), { code });
}

class FakeJobRunsDatabase {
  /** Keyed `${job_id}:${scheduled_for}` — the UNIQUE(job_id, scheduled_for). */
  private readonly slots = new Set<string>();
  /** When set, the next INSERT throws this instead of succeeding. */
  private nextInsertError: Error | null = null;

  failNextInsertWith(error: Error): void {
    this.nextInsertError = error;
  }

  get slotCount(): number {
    return this.slots.size;
  }

  prepare = (sql: string) => {
    const slots = this.slots;
    const takeError = (): Error | null => {
      const error = this.nextInsertError;
      this.nextInsertError = null;
      return error;
    };

    if (/INSERT INTO job_runs/i.test(sql)) {
      return {
        run: (...params: unknown[]) => {
          const error = takeError();
          if (error) throw error;
          const [, jobId, scheduledFor] = params as [string, string, number];
          const key = `${jobId}:${scheduledFor}`;
          if (slots.has(key)) {
            throw sqliteError('SQLITE_CONSTRAINT_UNIQUE');
          }
          slots.add(key);
          return { changes: 1, lastInsertRowid: 0 };
        },
        get: () => undefined,
        all: () => [],
        iterate: () => [][Symbol.iterator](),
      };
    }

    return {
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      get: () => undefined,
      all: () => [],
      iterate: () => [][Symbol.iterator](),
    };
  };

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

function buildStore() {
  const fakeDb = new FakeJobRunsDatabase();
  const connection = { db: fakeDb } as unknown as SqliteConnectionService;
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as Logger;
  return { store: new RunStore(connection, logger), fakeDb };
}

describe('RunStore.tryClaim', () => {
  it('claims a free slot and returns a pending run', () => {
    const { store, fakeDb } = buildStore();

    const run = store.tryClaim(JOB_ID, 1_770_000_000_000);

    expect(run.jobId).toBe(JOB_ID);
    expect(run.scheduledFor).toBe(1_770_000_000_000);
    expect(run.status).toBe('pending');
    expect(run.startedAt).toBeNull();
    expect(run.endedAt).toBeNull();
    expect(fakeDb.slotCount).toBe(1);
  });

  it('turns a UNIQUE violation into SlotAlreadyClaimedError', () => {
    const { store } = buildStore();
    store.tryClaim(JOB_ID, 1_770_000_000_000);

    // Second runner, same slot. This is the branch that routes through the
    // relocated `isUniqueConstraintError`.
    expect(() => store.tryClaim(JOB_ID, 1_770_000_000_000)).toThrow(
      SlotAlreadyClaimedError,
    );
  });

  it('claims independently per scheduled_for', () => {
    const { store, fakeDb } = buildStore();

    store.tryClaim(JOB_ID, 1_770_000_000_000);
    expect(() => store.tryClaim(JOB_ID, 1_770_000_060_000)).not.toThrow();
    expect(fakeDb.slotCount).toBe(2);
  });

  it('propagates every other SQLite error unchanged', () => {
    // A widened predicate would convert these into "another runner won" and
    // silently drop real failures on the floor.
    for (const code of [
      'SQLITE_BUSY',
      'SQLITE_CONSTRAINT',
      'SQLITE_CONSTRAINT_NOTNULL',
      'SQLITE_CONSTRAINT_FOREIGNKEY',
    ]) {
      const { store, fakeDb } = buildStore();
      fakeDb.failNextInsertWith(sqliteError(code));

      let thrown: unknown;
      try {
        store.tryClaim(JOB_ID, 1_770_000_000_000);
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(SlotAlreadyClaimedError);
      expect((thrown as Error).message).toBe(`sqlite failure: ${code}`);
      expect((thrown as { code?: unknown }).code).toBe(code);
    }
  });
});
