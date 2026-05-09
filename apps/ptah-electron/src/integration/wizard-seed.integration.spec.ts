/**
 * Wizard memory seed — Electron integration tests (TASK_2026_THOTH_WIZARD_SEED Batch 5 T5.1)
 *
 * Four scenarios that exercise the real SQLite store + real MemoryWriterAdapter
 * under a minimal tsyringe DI container, matching the registration that
 * phase-2-libraries.ts produces in production.
 *
 * Strategy
 * --------
 * - `SqliteConnectionService` is opened against a real in-memory `better-sqlite3`
 *   database via its `configure({ factory })` test seam. The vec0 extension is
 *   skipped (`vecPathResolver: null`) but the migration SQL includes a
 *   `CREATE VIRTUAL TABLE ... USING vec0` that would fail if run as-is. The
 *   workaround is to pre-create only the tables required by `MemoryStore` and
 *   to skip the full migration runner by providing a custom factory that returns
 *   a database with the schema already in place.
 *
 *   Concretely: `SqliteConnectionService.configure()` is used to inject a factory
 *   that creates the DB AND pre-creates the `memories`, `memory_chunks`, and
 *   `memory_chunks_fts` tables (no `memory_chunks_vec`). After `openAndMigrate()`
 *   applies migrations, those CREATE TABLE statements are idempotent ("IF NOT
 *   EXISTS"), so this is safe.
 *
 *   The simpler path is to call `db.exec(SCHEMA_SQL)` BEFORE `openAndMigrate()`
 *   can't be used here because `configure()` accepts a factory, not a pre-built
 *   instance. Instead we inject a factory that returns a pre-seeded database and
 *   also sets vecExtensionLoaded=false by design (vecPathResolver=null).
 *
 *   Actual approach: bypass the migration runner's vec0 problem by providing a
 *   Database factory that (a) opens ':memory:', (b) runs the schema CREATE
 *   statements inline (without the vec0 virtual table), and (c) inserts the
 *   migration-row bookkeeping so the runner sees all versions as already applied.
 *
 * - A no-op `IEmbedder` stub is registered so `insertMemoryWithChunks` skips
 *   vec0 inserts but still persists memory rows.
 *
 * - The writer (`MemoryWriterAdapter`) and store (`MemoryStore`) are resolved
 *   from a real tsyringe child container, proving the DI graph is sound.
 *
 * Run: `nx test ptah-electron --testPathPattern=wizard-seed.integration`
 * Or:  `nx test ptah-electron -t wizard-seed`
 */

import 'reflect-metadata';

import { container as globalContainer } from 'tsyringe';

import {
  SqliteConnectionService,
  registerPersistenceSqliteServices,
  PERSISTENCE_TOKENS,
  MIGRATIONS,
} from '@ptah-extension/persistence-sqlite';
import type {
  IEmbedder,
  SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';

import {
  registerMemoryCuratorServices,
  MEMORY_TOKENS,
} from '@ptah-extension/memory-curator';
import type {
  MemoryStore,
  MemoryStatsResponse,
} from '@ptah-extension/memory-curator';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IMemoryWriter,
  MemoryWriteRequest,
} from '@ptah-extension/platform-core';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';

// ---------------------------------------------------------------------------
// Schema SQL — mirrors 0002_memory.ts but WITHOUT the vec0 virtual table.
// The migration bookkeeping rows keep the migration runner from re-running.
// ---------------------------------------------------------------------------

/**
 * Minimal schema required by MemoryStore without sqlite-vec extension.
 * Must be created before openAndMigrate() records migration versions so
 * the runner skips them as already-applied.
 */
const SCHEMA_NO_VEC = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id              TEXT PRIMARY KEY,
  session_id      TEXT,
  workspace_root  TEXT,
  tier            TEXT NOT NULL CHECK (tier IN ('core','recall','archival')),
  kind            TEXT NOT NULL,
  subject         TEXT,
  content         TEXT NOT NULL,
  source_message_ids TEXT,
  salience        REAL NOT NULL DEFAULT 0,
  decay_rate      REAL NOT NULL DEFAULT 0.01,
  hits            INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  expires_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memories_session   ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_workspace ON memories(workspace_root);
CREATE INDEX IF NOT EXISTS idx_memories_tier      ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_subject   ON memories(subject);
CREATE INDEX IF NOT EXISTS idx_memories_salience  ON memories(salience DESC);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_memory ON memory_chunks(memory_id);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
  text,
  content='memory_chunks', content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_chunks_au AFTER UPDATE ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memory_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`;

/**
 * All known migration versions that should appear as "already applied" so the
 * SqliteMigrationRunner does not attempt to re-run any of them. We need to
 * insert all versions that the MIGRATIONS array includes so the runner skips them.
 * The runner only checks `schema_migrations` before applying — it does not
 * re-verify table existence.
 */
function seedMigrationBookkeeping(db: SqliteDatabase): void {
  const now = Date.now();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const m of MIGRATIONS) {
    stmt.run(m.version, m.name, now);
  }
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

/** Stub embedder — no worker thread, no vectors. */
const stubEmbedder: IEmbedder = {
  dim: 384,
  modelId: 'stub',
  embed: async () => [],
  dispose: async () => undefined,
};

/** Minimal logger stub. */
function makeLogger(): Logger {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * Build a fresh child container with:
 *  - real in-memory better-sqlite3 (no vec0 virtual tables)
 *  - real MemoryStore (SELECT/INSERT/DELETE operations work)
 *  - real MemoryWriterAdapter (upsert with hash-skip logic)
 */
async function buildContainer(): Promise<{
  writer: IMemoryWriter;
  store: MemoryStore;
  connection: SqliteConnectionService;
  teardown: () => void;
}> {
  const child = globalContainer.createChildContainer();
  const logger = makeLogger();

  child.register(TOKENS.LOGGER, { useValue: logger });
  child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, { useValue: ':memory:' });

  registerPersistenceSqliteServices(child, logger);

  // Stub embedder — registered before memory-curator so memory-curator's
  // EmbedderWorkerClient registration overrides it. We re-register after.
  child.register(PERSISTENCE_TOKENS.EMBEDDER, { useValue: stubEmbedder });

  // memory-curator registers EmbedderWorkerClient under EMBEDDER → re-register stub
  registerMemoryCuratorServices(child, logger);
  child.register(PERSISTENCE_TOKENS.EMBEDDER, { useValue: stubEmbedder });

  // Resolve the connection service and configure it with an in-memory DB factory.
  // The factory: (1) opens a real better-sqlite3 ':memory:', (2) creates the
  // schema tables WITHOUT the vec0 virtual table, (3) seeds migration bookkeeping
  // so the runner skips all migrations. `vecPathResolver: null` suppresses the
  // loadExtension call entirely so vecExtensionLoaded stays false.
  const BetterSqlite3 = require('better-sqlite3') as (
    path: string,
    opts?: object,
  ) => SqliteDatabase;

  const connection = child.resolve<SqliteConnectionService>(
    PERSISTENCE_TOKENS.SQLITE_CONNECTION,
  );
  connection.configure({
    factory: (_path: string): SqliteDatabase => {
      const db = BetterSqlite3(':memory:');
      // Apply pragmas manually (openAndMigrate will re-apply but that's fine)
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      // Create schema without vec0
      db.exec(SCHEMA_NO_VEC);
      // Mark all migrations as already applied so the runner skips them
      seedMigrationBookkeeping(db);
      return db;
    },
    vecPathResolver: null,
  });

  await connection.openAndMigrate();

  const store = child.resolve<MemoryStore>(MEMORY_TOKENS.MEMORY_STORE);
  const writer = child.resolve<IMemoryWriter>(PLATFORM_TOKENS.MEMORY_WRITER);

  return {
    writer,
    store,
    connection,
    teardown: () => {
      try {
        connection.close();
      } catch {
        /* ignore */
      }
      child.clearInstances();
    },
  };
}

/** Canonical seed request factory. */
function makeReq(
  overrides: Partial<MemoryWriteRequest> = {},
): MemoryWriteRequest {
  return {
    workspaceFingerprint: 'abcdef1234567890',
    workspaceRoot: '/workspace/my-project',
    subject: 'project-profile',
    content: '## Project Profile\nType: Test Project\n',
    tier: 'core',
    kind: 'preference',
    pinned: true,
    salience: 1.0,
    decayRate: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wizard-seed', () => {
  // -------------------------------------------------------------------------
  // T5.1 test 21: electron-end-to-end
  // -------------------------------------------------------------------------
  it('[electron-end-to-end] real SQLite: 2 core + 1 recall entries with expected kind/pinned', async () => {
    const { writer, store, teardown } = await buildContainer();
    try {
      const r1 = await writer.upsert(
        makeReq({
          subject: 'project-profile',
          content: '## Project Profile\nType: Test Project\n',
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      const r2 = await writer.upsert(
        makeReq({
          subject: 'code-conventions',
          content: '## Code Conventions\n- Use TypeScript\n',
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      const r3 = await writer.upsert(
        makeReq({
          subject: 'key-files',
          content: '## Key File Locations\nEntry points: src/main.ts\n',
          tier: 'recall',
          kind: 'entity',
          pinned: false,
          salience: 0.6,
          decayRate: 0.01,
        }),
      );

      expect(r1.status).toBe('inserted');
      expect(r2.status).toBe('inserted');
      expect(r3.status).toBe('inserted');

      // Verify via store.list — 2 core entries
      const coreEntries = store.list({ tier: 'core' }).memories;
      expect(coreEntries).toHaveLength(2);
      expect(
        coreEntries.every((m) => m.kind === 'preference' && m.pinned === true),
      ).toBe(true);
      const coreSubjects = coreEntries.map((m) => m.subject).sort();
      expect(coreSubjects).toEqual(['code-conventions', 'project-profile']);

      // 1 recall entry
      const recallEntries = store.list({ tier: 'recall' }).memories;
      expect(recallEntries).toHaveLength(1);
      expect(recallEntries[0].subject).toBe('key-files');
      expect(recallEntries[0].kind).toBe('entity');
      expect(recallEntries[0].pinned).toBe(false);

      // Stats
      const stats: MemoryStatsResponse = store.stats();
      expect(stats.core).toBe(2);
      expect(stats.recall).toBe(1);
    } finally {
      teardown();
    }
  });

  // -------------------------------------------------------------------------
  // T5.1 test 22: electron-rerun-no-duplicates
  // -------------------------------------------------------------------------
  it('[electron-rerun-no-duplicates] second run with changed content replaces entries (no duplicate rows)', async () => {
    const { writer, store, teardown } = await buildContainer();
    try {
      // First run
      await writer.upsert(
        makeReq({
          subject: 'project-profile',
          content: '## Project Profile\nType: v1\n',
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      await writer.upsert(
        makeReq({
          subject: 'code-conventions',
          content: '## Code Conventions\n- Rule A\n',
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      await writer.upsert(
        makeReq({
          subject: 'key-files',
          content: '## Key File Locations\nEntry points: src/main.ts\n',
          tier: 'recall',
          kind: 'entity',
          pinned: false,
          salience: 0.6,
          decayRate: 0.01,
        }),
      );

      // Second run — updated content
      const r1 = await writer.upsert(
        makeReq({
          subject: 'project-profile',
          content: '## Project Profile\nType: v2\n',
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      const r2 = await writer.upsert(
        makeReq({
          subject: 'code-conventions',
          content: '## Code Conventions\n- Rule A\n- Rule B\n',
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      const r3 = await writer.upsert(
        makeReq({
          subject: 'key-files',
          content:
            '## Key File Locations\nEntry points: src/main.ts, apps/api/src/main.ts\n',
          tier: 'recall',
          kind: 'entity',
          pinned: false,
          salience: 0.6,
          decayRate: 0.01,
        }),
      );

      expect(r1.status).toBe('replaced');
      expect(r2.status).toBe('replaced');
      expect(r3.status).toBe('replaced');

      // memory:stats must still report 2 core + 1 recall (not 4 + 2)
      const stats: MemoryStatsResponse = store.stats();
      expect(stats.core).toBe(2);
      expect(stats.recall).toBe(1);
    } finally {
      teardown();
    }
  });

  // -------------------------------------------------------------------------
  // T5.1 test 23: electron-rerun-hash-skip
  // -------------------------------------------------------------------------
  it('[electron-rerun-hash-skip] second run with identical content makes zero insertMemoryWithChunks calls', async () => {
    const { writer, store, teardown } = await buildContainer();
    try {
      const profileReq = makeReq({
        subject: 'project-profile',
        content: '## Project Profile\nType: Stable\n',
        tier: 'core',
        kind: 'preference',
        pinned: true,
      });
      const conventionsReq = makeReq({
        subject: 'code-conventions',
        content: '## Code Conventions\n- Use strict mode\n',
        tier: 'core',
        kind: 'preference',
        pinned: true,
      });
      const keyFilesReq = makeReq({
        subject: 'key-files',
        content: '## Key File Locations\nEntry points: src/main.ts\n',
        tier: 'recall',
        kind: 'entity',
        pinned: false,
        salience: 0.6,
        decayRate: 0.01,
      });

      // First run — inserts
      await writer.upsert(profileReq);
      await writer.upsert(conventionsReq);
      await writer.upsert(keyFilesReq);

      // Spy on insertMemoryWithChunks BEFORE second run
      const insertSpy = jest.spyOn(store, 'insertMemoryWithChunks');

      // Second run — identical content → 'unchanged' for all 3
      const r1 = await writer.upsert(profileReq);
      const r2 = await writer.upsert(conventionsReq);
      const r3 = await writer.upsert(keyFilesReq);

      expect(r1.status).toBe('unchanged');
      expect(r2.status).toBe('unchanged');
      expect(r3.status).toBe('unchanged');

      // Zero insertMemoryWithChunks calls — the hash-skip path was taken
      expect(insertSpy).not.toHaveBeenCalled();

      // Row count unchanged: still 2 core + 1 recall
      const stats: MemoryStatsResponse = store.stats();
      expect(stats.core).toBe(2);
      expect(stats.recall).toBe(1);
    } finally {
      teardown();
    }
  });

  // -------------------------------------------------------------------------
  // T5.1 test 24: electron-workspace-rename
  // -------------------------------------------------------------------------
  it('[electron-workspace-rename] fingerprint-based identity survives workspaceRoot rename', async () => {
    const { writer, store, teardown } = await buildContainer();
    try {
      const originalRoot = '/workspace/my-project';
      const renamedRoot = '/workspace/my-project-v2';
      const fp = 'abcdef1234567890';

      const profileContent = '## Project Profile\nType: Rename Test\n';
      const conventionsContent = '## Code Conventions\n- Immutability\n';
      const keyFilesContent =
        '## Key File Locations\nEntry points: src/main.ts\n';

      // First run with original root
      await writer.upsert(
        makeReq({
          workspaceRoot: originalRoot,
          workspaceFingerprint: fp,
          subject: 'project-profile',
          content: profileContent,
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      await writer.upsert(
        makeReq({
          workspaceRoot: originalRoot,
          workspaceFingerprint: fp,
          subject: 'code-conventions',
          content: conventionsContent,
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      await writer.upsert(
        makeReq({
          workspaceRoot: originalRoot,
          workspaceFingerprint: fp,
          subject: 'key-files',
          content: keyFilesContent,
          tier: 'recall',
          kind: 'entity',
          pinned: false,
          salience: 0.6,
          decayRate: 0.01,
        }),
      );

      // Second run with renamed root — same fingerprint, same content → hash-skip
      const r1 = await writer.upsert(
        makeReq({
          workspaceRoot: renamedRoot,
          workspaceFingerprint: fp,
          subject: 'project-profile',
          content: profileContent,
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      const r2 = await writer.upsert(
        makeReq({
          workspaceRoot: renamedRoot,
          workspaceFingerprint: fp,
          subject: 'code-conventions',
          content: conventionsContent,
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      const r3 = await writer.upsert(
        makeReq({
          workspaceRoot: renamedRoot,
          workspaceFingerprint: fp,
          subject: 'key-files',
          content: keyFilesContent,
          tier: 'recall',
          kind: 'entity',
          pinned: false,
          salience: 0.6,
          decayRate: 0.01,
        }),
      );

      // Content is identical → hash-skip
      expect(r1.status).toBe('unchanged');
      expect(r2.status).toBe('unchanged');
      expect(r3.status).toBe('unchanged');

      // Stats still 2 core + 1 recall
      const statsAfterRename: MemoryStatsResponse = store.stats();
      expect(statsAfterRename.core).toBe(2);
      expect(statsAfterRename.recall).toBe(1);

      // Rename + content change → replaced, new workspaceRoot persisted
      const updatedProfile = profileContent + '\nTech stack: TypeScript\n';
      const r4 = await writer.upsert(
        makeReq({
          workspaceRoot: renamedRoot,
          workspaceFingerprint: fp,
          subject: 'project-profile',
          content: updatedProfile,
          tier: 'core',
          kind: 'preference',
          pinned: true,
        }),
      );
      expect(r4.status).toBe('replaced');

      // Replaced entry carries the new workspaceRoot
      const coreEntries = store.list({ tier: 'core' }).memories;
      const profileEntry = coreEntries.find(
        (m) => m.subject === 'project-profile',
      );
      expect(profileEntry).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(profileEntry!.workspaceRoot).toBe(renamedRoot);

      // Row count: still 2 core + 1 recall
      const statsFinal: MemoryStatsResponse = store.stats();
      expect(statsFinal.core).toBe(2);
      expect(statsFinal.recall).toBe(1);
    } finally {
      teardown();
    }
  });
});
