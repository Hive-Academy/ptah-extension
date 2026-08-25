import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql as sql0016ObservationQueue } from './0016_observation_queue';
import { sql as sql0032SkillSynthesisQueue } from './0032_skill_synthesis_queue';
import { sql as sql0039ReapOrphanedQueueRows } from './0039_reap_orphaned_queue_rows';
import { MIGRATIONS } from './index';
import { SqliteMigrationRunner } from '../migration-runner';
import type { SqliteDatabase } from '../sqlite-connection.service';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Comfortably outside the migration's 30-day retention window. */
const ANCIENT = Date.now() - 60 * DAY_MS;
/** Comfortably inside it — a live install upgrading mid-session. */
const RECENT = Date.now() - 1 * DAY_MS;

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0039-test-'));
  return path.join(dir, 'ptah.db');
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('migration 0039_reap_orphaned_queue_rows — registry entry', () => {
  it('is registered as version 39, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 39);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0039_reap_orphaned_queue_rows');
    expect(entry?.sql).toBe(sql0039ReapOrphanedQueueRows);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is the highest bundled version', () => {
    // Bumped to 40 when TASK_2026_322 appended
    // 0040_skill_candidate_workspace_root (39 was TASK_2026_296's own
    // 0039_reap_orphaned_queue_rows). Tracks the current highest version and
    // moves forward with every appended migration (0038 precedent).
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(40);
  });

  it('contains no id-shape predicate — a tabId is a UUID v4', () => {
    // The `tab_<ts>_<id>` format is retired, and a current tabId is
    // indistinguishable from an SDK session UUID. A LIKE predicate on the
    // legacy prefix would match only long-dead rows and is wrong by
    // construction, so its absence is pinned rather than assumed.
    expect(sql0039ReapOrphanedQueueRows).not.toMatch(/LIKE/i);
    expect(sql0039ReapOrphanedQueueRows).not.toContain('tab_');
  });

  it('deletes from exactly the two work-queue tables and nothing else', () => {
    const deleted = Array.from(
      sql0039ReapOrphanedQueueRows.matchAll(/DELETE FROM (\w+)/g),
      (m) => m[1],
    );
    expect(deleted).toEqual(['observation_queue', 'skill_synthesis_queue']);
  });
});

/**
 * WHY A FALLBACK BINDING, unlike `0038`'s better-sqlite3-only probe:
 * `better-sqlite3` is rebuilt against Electron's ABI by postinstall and cannot
 * load in the Jest/Node runner on a normal dev machine, so a native-only gate
 * would leave THIS migration's behaviour — which rows it deletes and, far more
 * importantly, which rows it provably does not — permanently unverified. The
 * fallback is Node's built-in `node:sqlite`: the same SQLite engine behind a
 * different binding, and the same reasoning `queue/queue-db.test-support.ts`
 * records on the skill-synthesis side. Only if BOTH are missing do these skip.
 */
describe('migration 0039_reap_orphaned_queue_rows — behavior', () => {
  type DbOpener = (file: string) => DatabaseShape;

  function resolveOpener(): DbOpener | null {
    try {
      const Database = require('better-sqlite3') as new (
        file: string,
      ) => DatabaseShape;
      new Database(':memory:').close();
      return (file) => new Database(file);
    } catch {
      // Falls through to the built-in binding.
    }
    try {
      const { DatabaseSync } = require('node:sqlite') as {
        DatabaseSync: new (file: string) => DatabaseShape;
      };
      new DatabaseSync(':memory:').close();
      return (file) => new DatabaseSync(file);
    } catch {
      return null;
    }
  }

  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  function openDb(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec(sql0016ObservationQueue);
    db.exec(sql0032SkillSynthesisQueue);
    return db;
  }

  function seedObservation(
    db: DatabaseShape,
    args: { id: number; capturedAt: number; processedAt: number | null },
  ): void {
    db.prepare(
      `INSERT INTO observation_queue
         (id, session_id, workspace_root, prompt_number, kind, tool_name,
          tool_input_json, tool_response_text, assistant_message, user_prompt,
          file_path, captured_at, processed_at)
       VALUES (?, ?, '/ws', NULL, 'tool-use', 'Bash',
               NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    ).run(
      args.id,
      'de305d54-75b4-431b-adb2-eb6b9e546014',
      args.capturedAt,
      args.processedAt,
    );
  }

  function seedQueueRow(
    db: DatabaseShape,
    args: {
      id: string;
      status: string;
      attemptCount?: number;
      finishedAt?: number | null;
      enqueuedAt: number;
      dependsOn?: string | null;
      stage?: string;
    },
  ): void {
    db.prepare(
      `INSERT INTO skill_synthesis_queue
         (id, session_id, workspace_root, transcript_path, source, stage,
          depends_on, status, turn_count, attempt_count, enqueued_at,
          not_before, lane, payload)
       VALUES (?, ?, '/ws', NULL, 'idle', ?,
               ?, ?, 5, ?, ?, 0, NULL, '{}')`,
    ).run(
      args.id,
      'session-'.concat(args.id),
      args.stage ?? 'prefilter',
      args.dependsOn ?? null,
      args.status,
      args.attemptCount ?? 0,
      args.enqueuedAt,
    );
    if (args.finishedAt !== undefined && args.finishedAt !== null) {
      db.prepare(
        `UPDATE skill_synthesis_queue SET finished_at = ? WHERE id = ?`,
      ).run(args.finishedAt, args.id);
    }
  }

  function survivingObservationIds(db: DatabaseShape): number[] {
    return (
      db.prepare('SELECT id FROM observation_queue ORDER BY id') as {
        all(): unknown[];
      }
    )
      .all()
      .map((r) => (r as { id: number }).id);
  }

  function survivingQueueIds(db: DatabaseShape): string[] {
    return (
      db.prepare('SELECT id FROM skill_synthesis_queue ORDER BY id') as {
        all(): unknown[];
      }
    )
      .all()
      .map((r) => (r as { id: string }).id);
  }

  maybe('reaps only unprocessed observations older than the window', () => {
    const db = openDb();
    try {
      seedObservation(db, { id: 1, capturedAt: ANCIENT, processedAt: null });
      seedObservation(db, { id: 2, capturedAt: RECENT, processedAt: null });
      seedObservation(db, { id: 3, capturedAt: ANCIENT, processedAt: ANCIENT });
      seedObservation(db, { id: 4, capturedAt: RECENT, processedAt: RECENT });

      db.exec(sql0039ReapOrphanedQueueRows);

      // 1 is the orphan. 2 is inside the window (a live install upgrading
      // mid-session). 3 and 4 were processed, and processed rows are the
      // existing purge's business, never this migration's.
      expect(survivingObservationIds(db)).toEqual([2, 3, 4]);
    } finally {
      db.close();
    }
  });

  maybe('reaps only un-advanced queue rows older than the window', () => {
    const db = openDb();
    try {
      seedQueueRow(db, {
        id: 'a-stale',
        status: 'queued',
        enqueuedAt: ANCIENT,
      });
      seedQueueRow(db, {
        id: 'b-recent',
        status: 'queued',
        enqueuedAt: RECENT,
      });
      seedQueueRow(db, {
        id: 'c-attempted',
        status: 'queued',
        attemptCount: 2,
        enqueuedAt: ANCIENT,
      });
      seedQueueRow(db, {
        id: 'd-running',
        status: 'running',
        enqueuedAt: ANCIENT,
      });
      seedQueueRow(db, {
        id: 'e-done',
        status: 'done',
        finishedAt: ANCIENT,
        enqueuedAt: ANCIENT,
      });
      seedQueueRow(db, {
        id: 'f-unscored',
        status: 'unscored',
        enqueuedAt: ANCIENT,
      });

      db.exec(sql0039ReapOrphanedQueueRows);

      // Only `a-stale` is un-advanced AND outside the window. `f-unscored` RAN
      // and stays re-eligible under `not_before`; it is not an orphan.
      expect(survivingQueueIds(db)).toEqual([
        'b-recent',
        'c-attempted',
        'd-running',
        'e-done',
        'f-unscored',
      ]);
    } finally {
      db.close();
    }
  });

  maybe('never strands a dependent — ancestors and dependents survive', () => {
    const db = openDb();
    try {
      seedQueueRow(db, {
        id: 'ancestor',
        status: 'queued',
        enqueuedAt: ANCIENT,
      });
      seedQueueRow(db, {
        id: 'dependent',
        status: 'queued',
        enqueuedAt: ANCIENT,
        dependsOn: 'ancestor',
        stage: 'archaeology',
      });

      db.exec(sql0039ReapOrphanedQueueRows);

      // Both are stale and un-advanced, but the ancestor is depended upon and
      // the dependent has a non-NULL `depends_on`, so the reap declines both.
      // Missing an orphan is recoverable; stranding pending work is not.
      expect(survivingQueueIds(db)).toEqual(['ancestor', 'dependent']);
    } finally {
      db.close();
    }
  });

  maybe('is a no-op on a database with nothing stale', () => {
    // Paired-isolation sibling for the two reap specs: the legitimate path
    // where every row is live must come through completely untouched.
    const db = openDb();
    try {
      seedObservation(db, { id: 1, capturedAt: RECENT, processedAt: null });
      seedQueueRow(db, { id: 'live', status: 'queued', enqueuedAt: RECENT });

      db.exec(sql0039ReapOrphanedQueueRows);

      expect(survivingObservationIds(db)).toEqual([1]);
      expect(survivingQueueIds(db)).toEqual(['live']);
    } finally {
      db.close();
    }
  });

  maybe('re-run is a no-op via the runner ledger', async () => {
    const db = openDb();
    try {
      seedObservation(db, { id: 1, capturedAt: RECENT, processedAt: null });
      const runner = new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        fakeLogger,
      );
      const migration39 = [
        {
          version: 39,
          name: '0039_reap_orphaned_queue_rows',
          sql: sql0039ReapOrphanedQueueRows,
        },
      ];

      const first = await runner.applyAll(migration39);
      expect(first.appliedVersions).toEqual([39]);

      const second = await runner.applyAll(migration39);
      expect(second.appliedVersions).toEqual([]);
      expect(second.skippedVersions).toEqual([39]);

      expect(survivingObservationIds(db)).toEqual([1]);
    } finally {
      db.close();
    }
  });
});
