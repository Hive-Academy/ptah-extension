import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { VecStatusService } from '@ptah-extension/persistence-sqlite';
import { RetentionStepError } from './observation-retention.store';
import {
  MEMORY_LIFECYCLE_SQL,
  MemoryLifecycleStore,
} from './memory-lifecycle.store';
import {
  openRetentionTestDb,
  removeRetentionTempDirs,
  seedMemory,
  type RetentionTestDb,
} from './retention-sqlite.test-support';

function logger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('MemoryLifecycleStore', () => {
  let t: RetentionTestDb;
  let available: boolean;
  let store: MemoryLifecycleStore;

  beforeEach(() => {
    t = openRetentionTestDb({ memorySchema: true, vec: true });
    available = true;
    const vecStatus = {
      get available() {
        return available;
      },
    } as VecStatusService;
    store = new MemoryLifecycleStore(logger(), t.connection, vecStatus);
  });
  afterEach(() => t.close());
  afterAll(() => removeRetentionTempDirs());

  it('loads sqlite-vec and creates the lifecycle schema without skips', () => {
    expect(
      t.raw.prepare('SELECT vec_version() AS version').get(),
    ).toBeDefined();
    expect(
      t.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'idx_memories_tier_archived'",
        )
        .get(),
    ).toBeDefined();
  });

  it('pins every lifecycle SELECT to its intended indexes without sqlite_stat1', () => {
    expect(
      t.raw
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'")
        .get(),
    ).toBeUndefined();
    const plans: Array<{ sql: string; params: Record<string, unknown> }> = [
      {
        sql: MEMORY_LIFECYCLE_SQL.DELETE_ARCHIVED_SELECT_SQL,
        params: { cutoff: 10, limit: 5 },
      },
      {
        sql: MEMORY_LIFECYCLE_SQL.ARCHIVE_SELECT_SQL,
        params: { cutoff: 10, limit: 5 },
      },
      {
        sql: MEMORY_LIFECYCLE_SQL.EVICT_ARCHIVAL_SELECT_SQL,
        params: { ws: '/a', graceCutoff: 10, limit: 5 },
      },
      {
        sql: MEMORY_LIFECYCLE_SQL.EVICT_RECALL_SELECT_SQL,
        params: { ws: '/a', limit: 5 },
      },
      { sql: MEMORY_LIFECYCLE_SQL.ARCHIVE_COUNT_SQL, params: { cutoff: 10 } },
      { sql: MEMORY_LIFECYCLE_SQL.DELETE_COUNT_SQL, params: { cutoff: 10 } },
    ];
    for (const plan of plans) {
      const details = t.raw
        .prepare(`EXPLAIN QUERY PLAN ${plan.sql}`)
        .all(plan.params)
        .map((row) => String((row as { detail: unknown }).detail));
      expect(
        details.some((detail) =>
          /USING INDEX idx_memories_tier_(last_used|archived)/.test(detail),
        ),
      ).toBe(true);
      expect(
        details.some((detail) => detail.includes('idx_corpus_mem_memory')),
      ).toBe(true);
    }
  });

  it('honours cutoff, pinned and corpus predicates while archiving without updated_at changes', () => {
    seedMemory(t.raw, { id: 'old', workspaceRoot: '/a', lastUsedAt: 9 });
    seedMemory(t.raw, { id: 'edge', workspaceRoot: '/a', lastUsedAt: 10 });
    seedMemory(t.raw, {
      id: 'pinned',
      workspaceRoot: '/a',
      lastUsedAt: 1,
      pinned: true,
    });
    seedMemory(t.raw, { id: 'corpus', workspaceRoot: '/a', lastUsedAt: 1 });
    t.raw
      .prepare(
        'INSERT INTO corpora (id, workspace_root, name, query_json, built_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('c', '/a', 'c', '{}', 1);
    t.raw
      .prepare(
        'INSERT INTO corpus_memories (corpus_id, memory_id, ord) VALUES (?, ?, ?)',
      )
      .run('c', 'corpus', 0);
    const before = t.raw
      .prepare('SELECT updated_at FROM memories WHERE id = ?')
      .get('old');
    expect(store.archiveBatch(10, 100, 20)).toEqual({
      archived: 1,
      workspaceRoots: ['/a'],
    });
    expect(
      t.raw
        .prepare(
          'SELECT tier, archived_at, updated_at FROM memories WHERE id = ?',
        )
        .get('old'),
    ).toEqual({ tier: 'archival', archived_at: 100, ...(before as object) });
    expect(store.archiveBatch(10, 100, 20).archived).toBe(0);
  });

  it('deletes chunks, FTS, vec and concepts together without touching protected rows', () => {
    seedMemory(t.raw, {
      id: 'delete',
      tier: 'archival',
      archivedAt: 9,
      concepts: ['alpha'],
      chunks: 2,
    });
    seedMemory(t.raw, {
      id: 'edge',
      tier: 'archival',
      archivedAt: 10,
      concepts: ['beta'],
    });
    seedMemory(t.raw, { id: 'core', tier: 'core', archivedAt: 1 });
    const chunkRowids = t.raw
      .prepare('SELECT rowid FROM memory_chunks WHERE memory_id = ?')
      .all('delete') as Array<{ rowid: number }>;
    expect(store.deleteArchivedBatch(10, 20).deleted).toBe(1);
    expect(
      t.raw
        .prepare('SELECT COUNT(*) AS n FROM memories WHERE id = ?')
        .get('delete'),
    ).toEqual({ n: 0 });
    expect(
      t.raw
        .prepare('SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id = ?')
        .get('delete'),
    ).toEqual({ n: 0 });
    for (const { rowid } of chunkRowids) {
      expect(
        t.raw
          .prepare(
            'SELECT COUNT(*) AS n FROM memory_chunks_fts_docsize WHERE id = ?',
          )
          .get(rowid),
      ).toEqual({ n: 0 });
      expect(
        t.raw
          .prepare(
            'SELECT COUNT(*) AS n FROM memory_chunks_vec_rowids WHERE rowid = ?',
          )
          .get(rowid),
      ).toEqual({ n: 0 });
    }
    expect(
      t.raw
        .prepare(
          'SELECT COUNT(*) AS n FROM memory_concepts_fts WHERE memory_id = ?',
        )
        .get('delete'),
    ).toEqual({ n: 0 });
    expect(
      t.raw
        .prepare('SELECT COUNT(*) AS n FROM memories WHERE id IN (?, ?)')
        .get('edge', 'core'),
    ).toEqual({ n: 2 });
  });

  it('uses IS for null and non-null workspace cap eviction and applies archival grace', () => {
    seedMemory(t.raw, {
      id: 'null-old',
      tier: 'archival',
      workspaceRoot: null,
      archivedAt: 1,
      lastUsedAt: 1,
    });
    seedMemory(t.raw, {
      id: 'null-new',
      tier: 'archival',
      workspaceRoot: null,
      archivedAt: 10,
      lastUsedAt: 2,
    });
    seedMemory(t.raw, {
      id: 'empty',
      tier: 'archival',
      workspaceRoot: '',
      archivedAt: 1,
      lastUsedAt: 1,
    });
    expect(store.evictBatch(null, 'archival', 10, 10).evicted).toBe(1);
    expect(t.raw.prepare('SELECT id FROM memories ORDER BY id').all()).toEqual([
      { id: 'empty' },
      { id: 'null-new' },
    ]);
  });

  it('blocks deletes without vec only while the vec cleanup trigger exists', () => {
    t.reopenWithoutVec();
    available = false;
    expect(store.canDelete()).toEqual({
      allowed: false,
      reason: 'vec-unavailable',
    });
    t.raw.exec('DROP TRIGGER memory_chunks_vec_ad');
    expect(store.canDelete()).toEqual({ allowed: true });
  });

  it('returns one local over-cap read error and clears it after repair', () => {
    t.raw.exec('ALTER TABLE corpus_memories RENAME TO corpus_memories_broken');
    const failed = store.overCapWorkspaces(1_000);
    expect(failed.workspaces).toEqual([]);
    expect(failed.readErrors).toHaveLength(1);
    expect(failed.readErrors[0]).toMatch(/^overCapWorkspaces: /);

    t.raw.exec('ALTER TABLE corpus_memories_broken RENAME TO corpus_memories');
    expect(store.overCapWorkspaces(1_000)).toEqual({
      workspaces: [],
      readErrors: [],
    });
  });

  it('returns null for each failed preview read without carrying errors forward', () => {
    t.raw.exec('DROP INDEX idx_memories_tier_last_used');
    expect(store.readPreview(10, 20, 1_000)).toEqual({
      archiveEligible: null,
      deleteEligible: 0,
      overCap: 0,
      readErrors: [expect.stringMatching(/^archiveEligible: /)],
    });
    t.raw.exec(
      'CREATE INDEX idx_memories_tier_last_used ON memories(tier, last_used_at)',
    );

    t.raw.exec('DROP INDEX idx_memories_tier_archived');
    expect(store.readPreview(10, 20, 1_000)).toEqual({
      archiveEligible: 0,
      deleteEligible: null,
      overCap: 0,
      readErrors: [expect.stringMatching(/^deleteEligible: /)],
    });
    t.raw.exec(
      'CREATE INDEX idx_memories_tier_archived ON memories(tier, archived_at)',
    );

    t.raw.exec('ALTER TABLE corpus_memories RENAME TO corpus_memories_broken');
    const failed = store.readPreview(10, 20, 1_000);
    expect(failed).toMatchObject({
      archiveEligible: null,
      deleteEligible: null,
      overCap: null,
    });
    expect(failed.readErrors).toHaveLength(3);
    expect(failed.readErrors).toEqual([
      expect.stringMatching(/^archiveEligible: /),
      expect.stringMatching(/^deleteEligible: /),
      expect.stringMatching(/^overCapWorkspaces: /),
    ]);

    t.raw.exec('ALTER TABLE corpus_memories_broken RENAME TO corpus_memories');
    expect(store.readPreview(10, 20, 1_000)).toEqual({
      archiveEligible: 0,
      deleteEligible: 0,
      overCap: 0,
      readErrors: [],
    });
  });

  it('rolls back the chunk delete when the memory delete fails', () => {
    seedMemory(t.raw, { id: 'rollback', tier: 'archival', archivedAt: 1 });
    t.raw.exec(
      "CREATE TRIGGER fail_memory_delete BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'forced'); END",
    );
    expect(() => store.deleteArchivedBatch(10, 10)).toThrow(RetentionStepError);
    expect(
      t.raw
        .prepare('SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id = ?')
        .get('rollback'),
    ).toEqual({ n: 1 });
    expect(
      t.raw
        .prepare('SELECT COUNT(*) AS n FROM memories WHERE id = ?')
        .get('rollback'),
    ).toEqual({ n: 1 });
  });

  it('maps BEGIN IMMEDIATE contention to database-busy', () => {
    const second = t.openSecondHandle();
    second.exec('BEGIN IMMEDIATE');
    try {
      expect(() => store.archiveBatch(10, 10, 1)).toThrow(
        expect.objectContaining({ reason: 'database-busy' }),
      );
    } finally {
      second.exec('ROLLBACK');
      second.close();
    }
  });

  it('contains no salience update in lifecycle SQL', () => {
    expect(Object.values(MEMORY_LIFECYCLE_SQL).join('\n')).not.toMatch(
      /SET\s+salience/i,
    );
  });
});
