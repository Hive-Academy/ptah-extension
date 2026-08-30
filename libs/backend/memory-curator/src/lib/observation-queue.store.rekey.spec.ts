/**
 * TASK_2026_296 item 6, Part B — `ObservationQueueStore.backfillSessionId`.
 *
 * A residual hook path (one whose payload genuinely lacks `session_id` and
 * falls back to the tabId-bearing closure) captures observations under the
 * **tabId**. Every read path here filters `WHERE session_id = ?` with the
 * canonical id, so those rows are un-drainable — and `purgeOlderThan` only
 * deletes rows that WERE processed, so they are un-reapable too. Re-pointing
 * them when the SDK resolves the UUID is what makes them curatable again.
 *
 * Both ids are real UUID v4 strings. A tabId IS a UUID v4, so `tab_N` would
 * make these pass for the wrong reason.
 *
 * WHY A FALLBACK BINDING: `better-sqlite3` is rebuilt against Electron's ABI by
 * postinstall and cannot load in the Jest/Node runner on a normal dev machine.
 * These assertions are the whole point of the backfill, so the opener falls
 * back to Node's built-in `node:sqlite` — the same SQLite engine behind a
 * different binding — exactly as `queue/queue-db.test-support.ts` does on the
 * skill-synthesis side. Only if BOTH are missing do the tests skip.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { ObservationQueueStore } from './observation-queue.store';

const TAB_ID = '4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21';
const REAL_ID = 'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70';
const OTHER_ID = 'f31c8a2d-55b6-4e19-9a07-1d8c4b2e6f93';

interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type DbOpener = (file: string) => TestDatabase;

const sql0016 = MIGRATIONS.find((m) => m.version === 16)?.sql ?? '';

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => TestDatabase;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => TestDatabase;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-obs-rekey-'));
  return path.join(dir, 'ptah.db');
}

/**
 * Complete the double so it actually satisfies `SqliteDatabase`.
 *
 * `ObservationQueueStore.flush` writes its batch through `db.transaction(...)`,
 * which `SqliteDatabase` declares and better-sqlite3 provides — but the
 * `node:sqlite` `DatabaseSync` fallback (used whenever the better-sqlite3
 * native binary does not match the running Node ABI) has no `transaction`. Left
 * missing, every flush here threw and was swallowed as a persistence failure,
 * so the backfill assertions saw an empty table for reasons unrelated to what
 * they test.
 */
function asSqliteDatabase(db: TestDatabase): TestDatabase {
  const native = db as unknown as {
    transaction?: (fn: (...args: unknown[]) => unknown) => unknown;
  };
  if (typeof native.transaction === 'function') return db;
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
    transaction:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        db.exec('BEGIN');
        try {
          const out = fn(...args);
          db.exec('COMMIT');
          return out;
        } catch (error: unknown) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
  } as unknown as TestDatabase;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

maybe('ObservationQueueStore.backfillSessionId (TASK_2026_296)', () => {
  let db: TestDatabase;
  let store: ObservationQueueStore;

  beforeEach(() => {
    db = (opener as DbOpener)(makeTempDbPath());
    db.exec(sql0016);
    store = new ObservationQueueStore(noopLogger, {
      db: asSqliteDatabase(db),
    } as unknown as SqliteConnectionService);
  });

  afterEach(() => db.close());

  function capture(sessionId: string, kind: 'tool-use' | 'user-prompt'): void {
    store.enqueue({ sessionId, workspaceRoot: '/ws', kind });
  }

  it('re-points every row of the session and makes them drainable by the new id', () => {
    capture(TAB_ID, 'tool-use');
    capture(TAB_ID, 'user-prompt');

    expect(store.drainForSession(REAL_ID)).toHaveLength(0);

    expect(store.backfillSessionId(TAB_ID, REAL_ID)).toBe(2);

    expect(store.drainForSession(TAB_ID)).toHaveLength(0);
    expect(store.drainForSession(REAL_ID)).toHaveLength(2);
    expect(store.countUnprocessed(REAL_ID)).toBe(2);
  });

  it('joins rows already present under the destination id rather than replacing them', () => {
    // `observation_queue` has no UNIQUE on `session_id` (migration 0016), so
    // unlike `skill_synthesis_queue` there is nothing to collide: the migrated
    // rows join the existing ones and nothing is dropped.
    capture(REAL_ID, 'tool-use');
    capture(TAB_ID, 'user-prompt');

    expect(store.backfillSessionId(TAB_ID, REAL_ID)).toBe(1);
    expect(store.drainForSession(REAL_ID)).toHaveLength(2);
  });

  // Paired-isolation siblings.
  it('leaves every other session untouched', () => {
    capture(OTHER_ID, 'tool-use');

    expect(store.backfillSessionId(TAB_ID, REAL_ID)).toBe(0);
    expect(store.drainForSession(OTHER_ID)).toHaveLength(1);
  });

  it('is a no-op for a blank or identical id pair', () => {
    capture(TAB_ID, 'tool-use');

    expect(store.backfillSessionId('', REAL_ID)).toBe(0);
    expect(store.backfillSessionId(TAB_ID, '   ')).toBe(0);
    expect(store.backfillSessionId(TAB_ID, TAB_ID)).toBe(0);
    expect(store.drainForSession(TAB_ID)).toHaveLength(1);
  });

  it('still refuses a blank sessionId at insert — the §0 guard is intact', () => {
    // The backfill exists to rescue rows written under a REAL but
    // non-canonical id. It is not a licence to start writing blank ones: an
    // un-drainable, un-reapable row is still refused at the door.
    store.enqueue({ sessionId: '  ', workspaceRoot: '/ws', kind: 'tool-use' });
    const total = (
      db.prepare('SELECT COUNT(*) AS n FROM observation_queue').get() as {
        n: number;
      }
    ).n;
    expect(total).toBe(0);
  });

  it('contains no id-shape predicate — a tabId is a UUID v4', () => {
    const body = ObservationQueueStore.prototype.backfillSessionId.toString();
    expect(body).not.toMatch(/LIKE/i);
    expect(body).not.toContain('tab_');
  });
});
