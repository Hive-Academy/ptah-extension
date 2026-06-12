/**
 * Memory Curator e2e — TASK_2026_141 Batch 7, Task 7.1.
 *
 * Re-scope (recorded): PreCompact-driven seeding requires real API spend.
 * Replacement: one-shot `ptah memory stats` runs migrations, then rows are
 * seeded directly into the tmp SQLite via better-sqlite3 from repo
 * node_modules. All assertions drive real CLI spawns against the full
 * memory:* RPC/command surface.
 *
 * Curation trigger path (R3.3) stays covered by memory-curator unit and
 * integration tests.
 */

import * as path from 'node:path';

import { CliRunner, createTmpHome, type TmpHome } from './_harness';

interface SqliteDb {
  prepare(sql: string): { run(...args: unknown[]): void };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const openDatabase = require('better-sqlite3') as new (
  path: string,
  opts?: Record<string, unknown>,
) => SqliteDb;

jest.setTimeout(90_000);

interface MemoryStatsPayload {
  core: number;
  recall: number;
  archival: number;
  codeIndex: number;
  lastCuratedAt: number | null;
  degraded?: { vec?: boolean; embedder?: boolean };
}

interface MemoryListPayload {
  memories: Array<{
    id: string;
    tier: string;
    kind: string;
    content: string;
    pinned: boolean;
  }>;
  total: number;
  degraded?: { vec?: boolean; embedder?: boolean };
}

interface MemorySearchPayload {
  hits: Array<{ id: string; content: string; score: number }>;
  bm25Only: boolean;
  degraded?: { vec?: boolean; embedder?: boolean };
}

interface MemoryPinnedPayload {
  id: string;
  success: boolean;
  pinned: boolean;
}

interface MemoryForgottenPayload {
  id: string;
  success: boolean;
}

function now(): number {
  return Date.now();
}

function makeMemoryId(n: number): string {
  return `01MEMORY_E2E_TEST_${String(n).padStart(18, '0')}`;
}

async function seedMemoryRows(
  dbPath: string,
  rows: Array<{
    id: string;
    tier: string;
    kind: string;
    content: string;
  }>,
): Promise<void> {
  const db = new openDatabase(dbPath);
  const t = now();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO memories
      (id, session_id, workspace_root, tier, kind, subject, content,
       source_message_ids, salience, decay_rate, hits, pinned,
       created_at, updated_at, last_used_at)
    VALUES
      (?, 'e2e-session', NULL, ?, ?, 'e2e-subject', ?,
       '[]', 1.0, 0.01, 0, 0,
       ?, ?, ?)
  `);
  const insert = db.transaction(() => {
    for (const row of rows) {
      stmt.run(row.id, row.tier, row.kind, row.content, t, t, t);
    }
  });
  insert();
  db.close();
}

function findNotification<T = unknown>(
  lines: unknown[],
  method: string,
): T | undefined {
  for (const line of lines) {
    if (
      typeof line === 'object' &&
      line !== null &&
      (line as { method?: unknown }).method === method
    ) {
      return (line as { params: T }).params;
    }
  }
  return undefined;
}

describe('memory curator e2e (TASK_2026_141 Batch 7 — direct DB seed)', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome('ptah-e2e-mem-');
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('memory stats exits 0 and returns per-tier counts with degraded field', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'stats', '--json'],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<MemoryStatsPayload>(
      result.stdoutLines,
      'memory.stats',
    );
    expect(payload).toBeDefined();
    expect(typeof payload!.core).toBe('number');
    expect(typeof payload!.recall).toBe('number');
    expect(typeof payload!.archival).toBe('number');
    expect(payload!.degraded).toBeDefined();
    expect(typeof payload!.degraded!.vec).toBe('boolean');
    expect(typeof payload!.degraded!.embedder).toBe('boolean');
  });

  it('memory list returns seeded rows after direct DB insert', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'stats', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const dbPath = path.join(tmp.path, '.ptah', 'state', 'ptah.sqlite');
    await seedMemoryRows(dbPath, [
      {
        id: makeMemoryId(1),
        tier: 'recall',
        kind: 'fact',
        content: 'e2e-test memory row one',
      },
      {
        id: makeMemoryId(2),
        tier: 'core',
        kind: 'preference',
        content: 'e2e-test memory row two',
      },
    ]);

    const listResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'list', '--json'],
      timeoutMs: 60_000,
    });
    expect(listResult.exitCode).toBe(0);
    expect(listResult.hasMalformedStdout).toBe(false);

    const payload = findNotification<MemoryListPayload>(
      listResult.stdoutLines,
      'memory.list',
    );
    expect(payload).toBeDefined();
    expect(Array.isArray(payload!.memories)).toBe(true);
    const ids = payload!.memories.map((m) => m.id);
    expect(ids).toContain(makeMemoryId(1));
    expect(ids).toContain(makeMemoryId(2));
    expect(payload!.degraded).toBeDefined();
  });

  it('memory search returns BM25 hits for seeded content', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'stats', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const dbPath = path.join(tmp.path, '.ptah', 'state', 'ptah.sqlite');
    await seedMemoryRows(dbPath, [
      {
        id: makeMemoryId(3),
        tier: 'recall',
        kind: 'fact',
        content: 'unique-keyword-e2e-searchable content for memory test',
      },
    ]);

    const searchResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'search', 'unique-keyword-e2e-searchable', '--json'],
      timeoutMs: 60_000,
    });
    expect(searchResult.exitCode).toBe(0);
    expect(searchResult.hasMalformedStdout).toBe(false);

    const payload = findNotification<MemorySearchPayload>(
      searchResult.stdoutLines,
      'memory.search',
    );
    expect(payload).toBeDefined();
    expect(Array.isArray(payload!.hits)).toBe(true);
    expect(payload!.degraded).toBeDefined();
  });

  it('memory pin and unpin toggle the pinned flag on a seeded row', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'stats', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const dbPath = path.join(tmp.path, '.ptah', 'state', 'ptah.sqlite');
    const memId = makeMemoryId(4);
    await seedMemoryRows(dbPath, [
      { id: memId, tier: 'recall', kind: 'fact', content: 'pin-test row' },
    ]);

    const pinResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'pin', memId, '--json'],
      timeoutMs: 60_000,
    });
    expect(pinResult.exitCode).toBe(0);
    const pinPayload = findNotification<MemoryPinnedPayload>(
      pinResult.stdoutLines,
      'memory.pinned',
    );
    expect(pinPayload).toBeDefined();
    expect(pinPayload!.success).toBe(true);
    expect(pinPayload!.pinned).toBe(true);

    const unpinResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'unpin', memId, '--json'],
      timeoutMs: 60_000,
    });
    expect(unpinResult.exitCode).toBe(0);
    const unpinPayload = findNotification<MemoryPinnedPayload>(
      unpinResult.stdoutLines,
      'memory.pinned',
    );
    expect(unpinPayload).toBeDefined();
    expect(unpinPayload!.success).toBe(true);
    expect(unpinPayload!.pinned).toBe(false);
  });

  it('memory forget soft-deletes a row so it no longer appears in memory list', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'stats', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const dbPath = path.join(tmp.path, '.ptah', 'state', 'ptah.sqlite');
    const memId = makeMemoryId(5);
    await seedMemoryRows(dbPath, [
      { id: memId, tier: 'recall', kind: 'fact', content: 'forget-test row' },
    ]);

    const forgetResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'forget', memId, '--json'],
      timeoutMs: 60_000,
    });
    expect(forgetResult.exitCode).toBe(0);
    const forgetPayload = findNotification<MemoryForgottenPayload>(
      forgetResult.stdoutLines,
      'memory.forgotten',
    );
    expect(forgetPayload).toBeDefined();
    expect(forgetPayload!.success).toBe(true);

    const listResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['memory', 'list', '--json'],
      timeoutMs: 60_000,
    });
    expect(listResult.exitCode).toBe(0);
    const listPayload = findNotification<MemoryListPayload>(
      listResult.stdoutLines,
      'memory.list',
    );
    expect(listPayload).toBeDefined();
    const ids = listPayload!.memories.map((m) => m.id);
    expect(ids).not.toContain(memId);
  });
});
