/**
 * Memory retention — integration proof on real SQLite with a fake clock
 * (TASK_2026_440, reachability item 4): rows actually leave the table.
 *
 * Real `ObservationRetentionStore`, real `SqlitePageReclaimer`, real
 * `MemoryRetentionService`, on a temp-file database created with
 * `auto_vacuum = INCREMENTAL` before its schema and migrations 0016 + 0043
 * applied. Runs on better-sqlite3 when it loads, `node:sqlite` otherwise, and
 * FAILS — never skips — when neither loads.
 *
 * The clock is a fixed `NOW` far in the future of the real clock, so the
 * service's construction time is always more than 10 minutes before `NOW` and
 * the boot-deferral gate is open. Battery and foreground gates are open too.
 */
import 'reflect-metadata';
import type {
  BackgroundWorkAdmission,
  Logger,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SqlitePageReclaimer,
  type IEmbedder,
  type VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { MemoryStore } from '../memory.store';
import {
  MEMORY_LIFECYCLE_SQL,
  MemoryLifecycleStore,
} from './memory-lifecycle.store';
import { MemoryLifecycleService } from './memory-lifecycle.service';
import { MemoryRetentionService } from './memory-retention.service';
import {
  MEMORY_RETENTION_LIMITS,
  type MemoryRetentionLimits,
} from './memory-retention-config';
import type {
  MemoryRetentionReport,
  MemoryRetentionRunReport,
} from './memory-retention.types';
import {
  ObservationRetentionStore,
  RetentionStepError,
} from './observation-retention.store';
import {
  openRetentionTestDb,
  pragmaNumber,
  removeRetentionTempDirs,
  requireSqliteOpener,
  seedObservations,
  seedMemories,
  seedMemory,
  type RetentionTestDb,
  type SeedRow,
} from './retention-sqlite.test-support';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2030-03-17 — deliberately far after the real clock. */
const NOW = 1_900_000_000_000;
const PAYLOAD_8KB = 'r'.repeat(8 * 1024);

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(settings: Record<string, unknown>): IWorkspaceProvider {
  return {
    getConfiguration: (_section: string, key: string, def?: unknown) =>
      key in settings ? settings[key] : def,
  } as unknown as IWorkspaceProvider;
}

interface Harness {
  readonly t: RetentionTestDb;
  readonly store: ObservationRetentionStore;
  readonly service: MemoryRetentionService;
  readonly settings: Record<string, unknown>;
  readonly logger: Logger;
  run(at: number): Promise<MemoryRetentionReport>;
}

const openDbs: RetentionTestDb[] = [];

function makeHarness(
  limits: Partial<MemoryRetentionLimits> = {},
  wrapStore?: (store: ObservationRetentionStore) => void,
  governor?: BackgroundWorkAdmission,
): Harness {
  const t = openRetentionTestDb();
  openDbs.push(t);
  const logger = makeLogger();
  const store = new ObservationRetentionStore(logger, t.connection);
  wrapStore?.(store);
  const settings: Record<string, unknown> = {
    'memory.retention.batchSize': 100,
  };
  const service = new MemoryRetentionService(
    logger,
    makeWorkspace(settings),
    t.connection,
    new SqlitePageReclaimer(logger, t.connection),
    store,
    { ...MEMORY_RETENTION_LIMITS, ...limits },
    {
      runStep: jest.fn(async () => ({
        archived: 0,
        deleted: 0,
        evicted: 0,
        exhausted: true,
        stop: null,
        note: null,
        preview: null,
        readErrors: [],
      })),
    } as unknown as MemoryLifecycleService,
    governor ?? null,
  );
  return {
    t,
    store,
    service,
    settings,
    logger,
    run: (at: number) =>
      service.run({
        signal: new AbortController().signal,
        isOnBattery: () => false,
        msSinceForegroundActivity: () => Number.POSITIVE_INFINITY,
        now: () => at,
      }),
  };
}

function seedGroup(count: number, make: (i: number) => SeedRow): SeedRow[] {
  return Array.from({ length: count }, (_, i) => make(i));
}

type RowSnapshot = Map<
  number,
  {
    session_id: string;
    kind: string;
    captured_at: number;
    processed_at: number | null;
  }
>;

function snapshot(t: RetentionTestDb): RowSnapshot {
  const rows = t.raw
    .prepare(
      'SELECT id, session_id, kind, captured_at, processed_at FROM observation_queue ORDER BY id',
    )
    .all() as Array<{
    id: number;
    session_id: string;
    kind: string;
    captured_at: number;
    processed_at: number | null;
  }>;
  return new Map(
    rows.map((r) => [
      Number(r.id),
      {
        session_id: r.session_id,
        kind: r.kind,
        captured_at: Number(r.captured_at),
        processed_at: r.processed_at === null ? null : Number(r.processed_at),
      },
    ]),
  );
}

/**
 * Pointer-map pages in `(low, high]`. With auto-vacuum on, SQLite keeps one
 * pointer-map page every `usable/5 + 1` pages starting at page 2
 * (`ptrmapPageno` in btree.c; no reserved bytes here, so usable = page size).
 */
function ptrmapPagesBetween(
  low: number,
  high: number,
  pageSize: number,
): number {
  const interval = Math.floor(pageSize / 5) + 1;
  let n = 0;
  for (let page = 2; page <= high; page += interval) {
    if (page > low) n++;
  }
  return n;
}

function ledger(t: RetentionTestDb): Array<Record<string, unknown>> {
  return t.raw
    .prepare('SELECT * FROM observation_quarantine ORDER BY session_id, kind')
    .all() as Array<Record<string, unknown>>;
}

afterEach(() => {
  for (const t of openDbs.splice(0)) t.close();
});

describe('memory lifecycle — integration (real SQLite + sqlite-vec, fake clock)', () => {
  it('loads sqlite-vec without skipping', () => {
    const h = makeLifecycleHarness();
    expect(h.t.raw.prepare('SELECT vec_version() AS version').get()).toEqual({
      version: expect.any(String),
    });
  });

  it('archives at T0, restores use, waits through +30 d, then deletes all dependants at +61 d', async () => {
    const h = makeLifecycleHarness();
    const old = Array.from({ length: 40 }, (_, i) => `r-old-${i}`);
    const workspaceB = Array.from({ length: 5 }, (_, i) => `w-b-${i}`);
    const fresh = Array.from({ length: 10 }, (_, i) => `r-fresh-${i}`);
    for (let i = 0; i < old.length; i++) {
      seedMemory(h.t.raw, {
        id: old[i],
        workspaceRoot: '/a',
        lastUsedAt: NOW - 31 * DAY,
        chunks: 2,
        concepts: [`concept-${i}`],
        token: `alphaold${i}`,
      });
    }
    for (const id of workspaceB) {
      seedMemory(h.t.raw, {
        id,
        workspaceRoot: '/b',
        lastUsedAt: NOW - 31 * DAY,
        chunks: 2,
      });
    }
    for (const id of fresh)
      seedMemory(h.t.raw, {
        id,
        workspaceRoot: '/a',
        lastUsedAt: NOW - 29 * DAY,
      });
    for (const id of ['p-0', 'p-1'])
      seedMemory(h.t.raw, {
        id,
        workspaceRoot: '/a',
        pinned: true,
        lastUsedAt: NOW - 200 * DAY,
      });
    for (const id of ['c-0', 'c-1'])
      seedMemory(h.t.raw, {
        id,
        workspaceRoot: '/a',
        tier: 'core',
        pinned: true,
        lastUsedAt: NOW - 200 * DAY,
      });
    h.t.raw
      .prepare(
        'INSERT INTO corpora (id, workspace_root, name, query_json, built_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('corpus-1', '/a', 'protected', '{}', NOW);
    for (const [ord, id] of ['k-0', 'k-1'].entries()) {
      seedMemory(h.t.raw, {
        id,
        workspaceRoot: '/a',
        lastUsedAt: NOW - 200 * DAY,
      });
      h.t.raw
        .prepare(
          'INSERT INTO corpus_memories (corpus_id, memory_id, ord) VALUES (?, ?, ?)',
        )
        .run('corpus-1', id, ord);
    }
    const deleted = [...old.slice(1), ...workspaceB];
    const rowids = new Map<string, number[]>();
    for (const id of deleted) {
      rowids.set(
        id,
        (
          h.t.raw
            .prepare('SELECT rowid FROM memory_chunks WHERE memory_id = ?')
            .all(id) as Array<{ rowid: number }>
        ).map((row) => Number(row.rowid)),
      );
    }
    const before = [
      scalar(h.t, 'SELECT COUNT(*) AS n FROM memory_chunks'),
      scalar(h.t, 'SELECT COUNT(*) AS n FROM memory_chunks_fts_docsize'),
      scalar(h.t, 'SELECT COUNT(*) AS n FROM memory_chunks_vec_rowids'),
    ];
    await expect(h.run(NOW)).resolves.toMatchObject({
      status: 'completed',
      memoriesArchived: 45,
      memoriesDeleted: 0,
    });
    expect(
      scalar(
        h.t,
        'SELECT COUNT(*) AS n FROM memories WHERE tier = ? AND archived_at = ?',
        'archival',
        NOW,
      ),
    ).toBe(45);
    expect([
      scalar(h.t, 'SELECT COUNT(*) AS n FROM memory_chunks'),
      scalar(h.t, 'SELECT COUNT(*) AS n FROM memory_chunks_fts_docsize'),
      scalar(h.t, 'SELECT COUNT(*) AS n FROM memory_chunks_vec_rowids'),
    ]).toEqual(before);

    h.memoryStore.recordUse([old[0] as never]);
    expect(
      h.t.raw
        .prepare('SELECT tier, archived_at, hits FROM memories WHERE id = ?')
        .get(old[0]),
    ).toEqual({ tier: 'recall', archived_at: null, hits: 1 });
    await expect(h.run(NOW + 30 * DAY)).resolves.toMatchObject({
      memoriesDeleted: 0,
    });
    const at61 = (await h.run(NOW + 61 * DAY)) as MemoryRetentionRunReport;
    expect(at61).toMatchObject({ status: 'completed', memoriesDeleted: 44 });
    // Keep the explicit chunk half of the atomic delete pair pinned even
    // though this test database also has FK cascades: production files can
    // have foreign-key enforcement disabled on independently opened handles.
    expect(h.t.issued).toContain(MEMORY_LIFECYCLE_SQL.DELETE_CHUNKS_SQL);
    for (const id of deleted) {
      expect(
        scalar(h.t, 'SELECT COUNT(*) AS n FROM memories WHERE id = ?', id),
      ).toBe(0);
      expect(
        scalar(
          h.t,
          'SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id = ?',
          id,
        ),
      ).toBe(0);
      expect(
        scalar(
          h.t,
          'SELECT COUNT(*) AS n FROM memory_concepts_fts WHERE memory_id = ?',
          id,
        ),
      ).toBe(0);
      for (const rowid of rowids.get(id) ?? []) {
        expect(
          scalar(
            h.t,
            'SELECT COUNT(*) AS n FROM memory_chunks_fts_docsize WHERE id = ?',
            rowid,
          ),
        ).toBe(0);
        expect(
          scalar(
            h.t,
            'SELECT COUNT(*) AS n FROM memory_chunks_vec_rowids WHERE rowid = ?',
            rowid,
          ),
        ).toBe(0);
      }
    }
    expect(
      scalar(
        h.t,
        'SELECT COUNT(*) AS n FROM memory_chunks_fts WHERE memory_chunks_fts MATCH ?',
        'alphaold1',
      ),
    ).toBe(0);
    const nearest = h.t.raw
      .prepare(
        'SELECT rowid FROM memory_chunks_vec WHERE embedding MATCH ? ORDER BY distance ASC LIMIT ?',
      )
      .all(Buffer.from(new Float32Array(384).buffer), 20) as Array<{
      rowid: number;
    }>;
    expect(nearest.map((row) => Number(row.rowid))).not.toContain(
      rowids.get(old[1])?.[0],
    );
    expect(
      scalar(
        h.t,
        'SELECT COUNT(*) AS n FROM memories WHERE id IN (?, ?, ?, ?, ?, ?, ?)',
        old[0],
        'p-0',
        'p-1',
        'c-0',
        'c-1',
        'k-0',
        'k-1',
      ),
    ).toBe(7);
    expect(
      fresh.every(
        (id) =>
          scalar(h.t, 'SELECT COUNT(*) AS n FROM memories WHERE id = ?', id) ===
          1,
      ),
    ).toBe(true);
    expect(typeof at61.pagesReclaimed).toBe('number');
    expect(h.service.storageHealth().memoryLifecycle.preview).not.toBeNull();
  });

  it('deletes every dependent row at T0 + 61 d when foreign keys are off', async () => {
    const h = makeLifecycleHarness();
    const deleted = ['fk-off-old-0', 'fk-off-old-1'];
    for (const [index, id] of deleted.entries()) {
      seedMemory(h.t.raw, {
        id,
        workspaceRoot: '/fk-off',
        lastUsedAt: NOW - 31 * DAY,
        chunks: 2,
        concepts: [`fk-off-concept-${index}`],
      });
    }
    seedMemory(h.t.raw, {
      id: 'fk-off-fresh',
      workspaceRoot: '/fk-off',
      lastUsedAt: NOW - 29 * DAY,
    });
    seedMemory(h.t.raw, {
      id: 'fk-off-pinned',
      workspaceRoot: '/fk-off',
      pinned: true,
      lastUsedAt: NOW - 200 * DAY,
    });
    seedMemory(h.t.raw, {
      id: 'fk-off-core',
      workspaceRoot: '/fk-off',
      tier: 'core',
      pinned: true,
      lastUsedAt: NOW - 200 * DAY,
    });
    const rowids = new Map<string, number[]>();
    for (const id of deleted) {
      rowids.set(
        id,
        (
          h.t.raw
            .prepare('SELECT rowid FROM memory_chunks WHERE memory_id = ?')
            .all(id) as Array<{ rowid: number }>
        ).map((row) => Number(row.rowid)),
      );
    }

    await expect(h.run(NOW)).resolves.toMatchObject({
      status: 'completed',
      memoriesArchived: 2,
      memoriesDeleted: 0,
    });
    h.t.reopenWithoutForeignKeys();
    expect(pragmaNumber(h.t.raw, 'foreign_keys')).toBe(0);
    await expect(h.run(NOW + 61 * DAY)).resolves.toMatchObject({
      status: 'completed',
      memoriesDeleted: 2,
    });

    for (const id of deleted) {
      expect(
        scalar(h.t, 'SELECT COUNT(*) AS n FROM memories WHERE id = ?', id),
      ).toBe(0);
      expect(
        scalar(
          h.t,
          'SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id = ?',
          id,
        ),
      ).toBe(0);
      expect(
        scalar(
          h.t,
          'SELECT COUNT(*) AS n FROM memory_concepts_fts WHERE memory_id = ?',
          id,
        ),
      ).toBe(0);
      for (const rowid of rowids.get(id) ?? []) {
        expect(
          scalar(
            h.t,
            'SELECT COUNT(*) AS n FROM memory_chunks_fts_docsize WHERE id = ?',
            rowid,
          ),
        ).toBe(0);
        expect(
          scalar(
            h.t,
            'SELECT COUNT(*) AS n FROM memory_chunks_vec_rowids WHERE rowid = ?',
            rowid,
          ),
        ).toBe(0);
      }
    }
    expect(
      scalar(
        h.t,
        'SELECT COUNT(*) AS n FROM memories WHERE id IN (?, ?, ?)',
        'fk-off-fresh',
        'fk-off-pinned',
        'fk-off-core',
      ),
    ).toBe(3);
  });

  it('evicts only six oldest grace-eligible archival rows in A, leaving B and protected rows', async () => {
    const h = makeLifecycleHarness({
      'memory.lifecycle.maxPerWorkspace': 1000,
    });
    seedMemories(h.t.raw, [
      ...Array.from({ length: 1003 }, (_, i) => ({
        id: `cap-old-${i}`,
        workspaceRoot: '/a',
        tier: 'archival' as const,
        archivedAt: NOW - 8 * DAY,
        lastUsedAt: i + 1,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `cap-grace-${i}`,
        workspaceRoot: '/a',
        tier: 'archival' as const,
        archivedAt: NOW - 2 * DAY,
        lastUsedAt: 10_000 + i,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `cap-b-${i}`,
        workspaceRoot: '/b',
        tier: 'archival' as const,
        archivedAt: NOW - 8 * DAY,
      })),
      {
        id: 'cap-pinned',
        workspaceRoot: '/a',
        pinned: true,
        lastUsedAt: 0,
      },
      {
        id: 'cap-core',
        workspaceRoot: '/a',
        tier: 'core',
        pinned: true,
        lastUsedAt: 0,
      },
    ]);
    await expect(h.run(NOW)).resolves.toMatchObject({ memoriesEvicted: 6 });
    expect(
      h.t.raw
        .prepare(
          "SELECT id FROM memories WHERE id LIKE 'cap-old-%' ORDER BY last_used_at LIMIT 1",
        )
        .get(),
    ).toEqual({ id: 'cap-old-6' });
    expect(
      scalar(
        h.t,
        "SELECT COUNT(*) AS n FROM memories WHERE id LIKE 'cap-grace-%'",
      ),
    ).toBe(3);
    expect(
      scalar(h.t, "SELECT COUNT(*) AS n FROM memories WHERE id LIKE 'cap-b-%'"),
    ).toBe(20);
    expect(
      scalar(
        h.t,
        'SELECT COUNT(*) AS n FROM memories WHERE id IN (?, ?)',
        'cap-pinned',
        'cap-core',
      ),
    ).toBe(2);
  }, 120_000);

  it('evicts the ten oldest recall rows over cap', async () => {
    const h = makeLifecycleHarness({
      'memory.lifecycle.maxPerWorkspace': 1000,
    });
    seedMemories(
      h.t.raw,
      Array.from({ length: 1010 }, (_, i) => ({
        id: `recall-cap-${i}`,
        workspaceRoot: '/a',
        lastUsedAt: NOW - DAY + i,
      })),
    );
    await expect(h.run(NOW)).resolves.toMatchObject({ memoriesEvicted: 10 });
    expect(
      h.t.raw
        .prepare(
          "SELECT id FROM memories WHERE id LIKE 'recall-cap-%' ORDER BY last_used_at LIMIT 1",
        )
        .get(),
    ).toEqual({ id: 'recall-cap-10' });
  }, 120_000);

  it('does not delete rows archived by a back-to-back first run', async () => {
    const h = makeLifecycleHarness();
    for (let i = 0; i < 30; i++)
      seedMemory(h.t.raw, { id: `guard-${i}`, lastUsedAt: NOW - 400 * DAY });
    await expect(h.run(NOW)).resolves.toMatchObject({
      memoriesArchived: 30,
      memoriesDeleted: 0,
    });
    h.t.raw.exec(
      'UPDATE memory_retention_state SET backlog_remaining = 1 WHERE id = 1',
    );
    await expect(h.run(NOW + HOUR)).resolves.toMatchObject({
      memoriesArchived: 0,
      memoriesDeleted: 0,
    });
    expect(
      scalar(h.t, "SELECT COUNT(*) AS n FROM memories WHERE id LIKE 'guard-%'"),
    ).toBe(30);
  });

  it('archives without deleting when vec is unavailable, then is not due', async () => {
    const h = makeLifecycleHarness();
    seedMemory(h.t.raw, { id: 'vec-old', lastUsedAt: NOW - 100 * DAY });
    h.t.reopenWithoutVec();
    h.vecStatus.available = false;
    await expect(h.run(NOW)).resolves.toMatchObject({
      status: 'completed',
      lifecycleNote: 'vec-unavailable',
      memoriesArchived: 1,
      memoriesDeleted: 0,
    });
    await expect(h.run(NOW + HOUR)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-due',
    });
  });

  it('shares the memory budget and finishes the committed archive backlog next hour', async () => {
    const h = makeLifecycleHarness({}, { maxMemoryRowsPerRun: 25 });
    for (let i = 0; i < 30; i++)
      seedMemory(h.t.raw, { id: `budget-${i}`, lastUsedAt: NOW - 31 * DAY });
    await expect(h.run(NOW)).resolves.toMatchObject({
      status: 'partial',
      reason: 'memory-row-budget',
      memoriesArchived: 25,
    });
    await expect(h.run(NOW + HOUR)).resolves.toMatchObject({
      status: 'completed',
      memoriesArchived: 5,
    });
  });

  it('advances the unscoped search generation after a lifecycle delete in a workspace', async () => {
    const h = makeLifecycleHarness();
    seedMemory(h.t.raw, {
      id: 'unscoped-generation-delete',
      workspaceRoot: '/workspace-a',
      tier: 'archival',
      archivedAt: NOW - 61 * DAY,
      lastUsedAt: NOW - 100 * DAY,
    });
    const before = h.memoryStore.getWriteCounter('');

    await expect(h.run(NOW)).resolves.toMatchObject({
      status: 'completed',
      memoriesDeleted: 1,
    });
    expect(h.memoryStore.getWriteCounter('')).toBe(before + 1);
  });

  it('rolls back the second delete pair after a mid-delete failure and releases single-flight', async () => {
    let fail = true;
    let memoryDeleteCalls = 0;
    const h = makeLifecycleHarness({}, {}, (t) => {
      const db = t.db as unknown as {
        prepare(sql: string): {
          run(...params: unknown[]): unknown;
          get(...params: unknown[]): unknown;
          all(...params: unknown[]): unknown[];
        };
      };
      const originalPrepare = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        const statement = originalPrepare(sql);
        if (!/^DELETE FROM memories\b/.test(sql)) return statement;
        return {
          ...statement,
          run: (...params: unknown[]) => {
            memoryDeleteCalls++;
            if (fail && memoryDeleteCalls === 2)
              throw new Error('injected memory delete failure');
            return statement.run(...params);
          },
        };
      };
    });
    for (let i = 0; i < 250; i++)
      seedMemory(h.t.raw, {
        id: `fail-delete-${i}`,
        tier: 'archival',
        archivedAt: NOW - 61 * DAY,
        lastUsedAt: NOW - 100 * DAY,
      });
    const failedRun = await h.run(NOW);
    expect(failedRun).toMatchObject({
      status: 'failed',
      memoriesDeleted: 100,
    });
    expect(
      scalar(
        h.t,
        "SELECT COUNT(*) AS n FROM memories WHERE id LIKE 'fail-delete-%'",
      ),
    ).toBe(150);
    expect(h.store.readState()).toMatchObject({
      memoriesDeleted: 100,
      lastOutcome: 'failed',
    });
    expect(
      scalar(
        h.t,
        "SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id LIKE 'fail-delete-%'",
      ),
    ).toBe(150);
    fail = false;
    await expect(h.run(NOW + HOUR)).resolves.toMatchObject({
      status: 'completed',
      memoriesDeleted: 150,
    });
  });

  it('disabled lifecycle performs no writes but records the enabled-run preview', async () => {
    const h = makeLifecycleHarness({ 'memory.lifecycle.enabled': false });
    seedMemory(h.t.raw, { id: 'disabled-old', lastUsedAt: NOW - 100 * DAY });
    await expect(h.run(NOW)).resolves.toMatchObject({
      status: 'completed',
      lifecycleNote: 'disabled',
      memoriesArchived: 0,
      memoriesDeleted: 0,
      memoriesEvicted: 0,
    });
    expect(
      h.t.raw
        .prepare('SELECT tier FROM memories WHERE id = ?')
        .get('disabled-old'),
    ).toEqual({ tier: 'recall' });
    expect(h.service.storageHealth().memoryLifecycle.preview).toMatchObject({
      archiveEligible: 1,
    });
  });
});
afterAll(() => removeRetentionTempDirs());

interface LifecycleHarness extends Harness {
  readonly memoryStore: MemoryStore;
  readonly lifecycleStore: MemoryLifecycleStore;
  readonly vecStatus: { available: boolean };
}

function makeLifecycleHarness(
  settings: Record<string, unknown> = {},
  limits: Partial<MemoryRetentionLimits> = {},
  beforeStores?: (t: RetentionTestDb) => void,
): LifecycleHarness {
  const t = openRetentionTestDb({ memorySchema: true, vec: true });
  openDbs.push(t);
  beforeStores?.(t);
  const logger = makeLogger();
  const workspaceSettings: Record<string, unknown> = {
    'memory.retention.batchSize': 100,
    ...settings,
  };
  const workspace = makeWorkspace(workspaceSettings);
  const vecStatus = { available: true };
  const memoryStore = new MemoryStore(
    logger,
    t.connection,
    { embed: jest.fn() } as unknown as IEmbedder,
    vecStatus as unknown as VecStatusService,
  );
  const lifecycleStore = new MemoryLifecycleStore(
    logger,
    t.connection,
    vecStatus as unknown as VecStatusService,
  );
  const runLimits = { ...MEMORY_RETENTION_LIMITS, ...limits };
  const lifecycle = new MemoryLifecycleService(
    logger,
    workspace,
    lifecycleStore,
    memoryStore,
    runLimits,
  );
  const store = new ObservationRetentionStore(logger, t.connection);
  const service = new MemoryRetentionService(
    logger,
    workspace,
    t.connection,
    new SqlitePageReclaimer(logger, t.connection),
    store,
    runLimits,
    lifecycle,
    null,
  );
  return {
    t,
    store,
    service,
    settings: workspaceSettings,
    logger,
    memoryStore,
    lifecycleStore,
    vecStatus,
    run: (at: number) =>
      service.run({
        signal: new AbortController().signal,
        isOnBattery: () => false,
        msSinceForegroundActivity: () => Number.POSITIVE_INFINITY,
        now: () => at,
      }),
  };
}

function scalar(t: RetentionTestDb, sql: string, ...params: unknown[]): number {
  const row = t.raw.prepare(sql).get(...params) as { n: number | bigint };
  return Number(row.n);
}

describe('memory retention — integration (real SQLite, fake clock)', () => {
  it('has a real SQLite binding (fails, never skips, without one)', () => {
    expect(() => requireSqliteOpener()).not.toThrow();
  });

  it('purges processed rows, keeps every unprocessed row, reclaims and records; run 2 is not due; run 3 slides the default windows; run 4 is idempotent', async () => {
    const h = makeHarness();
    const { t } = h;

    const pOld = seedObservations(
      t.raw,
      seedGroup(1200, (i) => ({
        sessionId: `p-${i % 3}`,
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
        toolResponseText: PAYLOAD_8KB,
      })),
    );
    const pNew = seedObservations(
      t.raw,
      seedGroup(50, (i) => ({
        sessionId: `p-${i % 3}`,
        kind: 'tool-use',
        capturedAt: NOW - 7 * DAY,
        processedAt: NOW - 6 * DAY,
      })),
    );
    // R7: keyed on processed_at, not captured_at.
    const pOldCapturedNewProcessed = seedObservations(
      t.raw,
      seedGroup(10, () => ({
        sessionId: 'p-0',
        kind: 'assistant-turn',
        capturedAt: NOW - 30 * DAY,
        processedAt: NOW - DAY,
      })),
    );
    const uGrace = seedObservations(
      t.raw,
      seedGroup(40, (i) => ({
        sessionId: `u-${i % 2}`,
        kind: 'tool-use',
        capturedAt: NOW - 13 * DAY,
        processedAt: null,
      })),
    );
    // TASK_2026_621: unprocessed rows far older than stuckDays (14) must survive.
    const uStuck = seedObservations(
      t.raw,
      seedGroup(300, (i) => ({
        sessionId: `u-${i % 2}`,
        kind: i % 4 < 2 ? 'tool-use' : 'user-prompt',
        capturedAt: NOW - 15 * DAY - i * 1000,
        processedAt: null,
        toolResponseText: 'stuck',
      })),
    );

    const before = snapshot(t);
    const pageCountBefore = pragmaNumber(t.raw, 'page_count');
    const freelistBefore = pragmaNumber(t.raw, 'freelist_count');

    // ---- Run 1 ----
    const run1 = (await h.run(NOW)) as MemoryRetentionRunReport;
    expect(run1.status).toBe('completed');
    expect(run1.reason).toBeNull();
    expect(run1.processedPurged).toBe(1200);
    expect(run1.stuckKept).toBe(300);
    expect(run1.backlogRemaining).toBe(false);
    expect(run1.error).toBeNull();
    expect(run1.freedBytes).toBeGreaterThan(1200 * 4096);
    expect(run1.pagesReclaimed).toBeGreaterThan(0);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[memory-curator] retention kept unprocessed observations older than stuckDays',
      { stuckKept: 300, stuckDays: 14 },
    );

    const after = snapshot(t);
    for (const id of pOld) expect(after.has(id)).toBe(false);
    // Every other row — including every stuck unprocessed one — is unchanged,
    // and no row had processed_at written.
    const survivors = [
      ...pNew,
      ...pOldCapturedNewProcessed,
      ...uGrace,
      ...uStuck,
    ];
    expect(after.size).toBe(survivors.length);
    for (const id of survivors) expect(after.get(id)).toEqual(before.get(id));
    expect(ledger(t)).toEqual([]);

    const freelistAfter = pragmaNumber(t.raw, 'freelist_count');
    expect(freelistAfter === 0 || freelistAfter < freelistBefore).toBe(true);
    // `page_count` drops by exactly the freelist pages handed back, plus any
    // pointer-map pages (auto-vacuum bookkeeping, never on the freelist) that
    // fell off the truncated tail of the file.
    const pageCountAfter = pragmaNumber(t.raw, 'page_count');
    expect(pageCountBefore - pageCountAfter).toBe(
      run1.pagesReclaimed +
        ptrmapPagesBetween(
          pageCountAfter,
          pageCountBefore,
          pragmaNumber(t.raw, 'page_size'),
        ),
    );

    const state1 = h.store.readState();
    expect(state1?.lastCompletedAt).toBe(NOW);
    expect(state1?.lastOutcome).toBe('completed');
    expect(state1?.backlogRemaining).toBe(false);
    expect(state1?.processedPurged).toBe(1200);
    expect(state1?.stuckQuarantined).toBe(0);
    expect(state1?.processedRowsAfter).toBe(
      pNew.length + pOldCapturedNewProcessed.length,
    );

    // Liveness: the backlog and its age are visible in diagnostics.
    const health = h.service.storageHealth();
    expect(health.observations.pendingRows).toBe(340);
    expect(health.observations.oldestPendingAt).toBe(
      NOW - 15 * DAY - 299 * 1000,
    );
    expect(health.observations.quarantineLedgerRows).toBe(0);
    expect(health.retention.lastRun?.outcome).toBe('completed');
    expect(health.retention.nextDueAt).toBe(NOW + DAY);

    // ---- Run 2: one hour later, nothing is due and nothing is written ----
    const stateBeforeRun2 = h.store.readState();
    await expect(h.run(NOW + HOUR)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-due',
    });
    expect(h.store.readState()).toEqual(stateBeforeRun2);

    // ---- Run 3: 25 h later, DEFAULT 7/14-day windows. The cutoffs slide with
    // the run clock: P-new (processed NOW-6d) is now older than 7 days and is
    // purged; U-grace (captured NOW-13d) is now older than 14 days and is
    // counted as stuck, but kept.
    const run3 = (await h.run(NOW + 25 * HOUR)) as MemoryRetentionRunReport;
    expect(run3).toMatchObject({
      status: 'completed',
      reason: null,
      processedPurged: 50,
      stuckKept: 340,
      ledgerPruned: 0,
      backlogRemaining: false,
      error: null,
    });

    const afterRun3 = snapshot(t);
    for (const id of pNew) expect(afterRun3.has(id)).toBe(false);
    const run3Survivors = [...pOldCapturedNewProcessed, ...uGrace, ...uStuck];
    expect(afterRun3.size).toBe(run3Survivors.length);
    for (const id of run3Survivors) {
      expect(afterRun3.get(id)).toEqual(before.get(id));
    }
    expect(ledger(t)).toEqual([]);

    const state3 = h.store.readState();
    expect(state3?.lastCompletedAt).toBe(NOW + 25 * HOUR);
    expect(state3?.processedPurged).toBe(50);
    expect(state3?.stuckQuarantined).toBe(0);
    expect(state3?.processedRowsAfter).toBe(pOldCapturedNewProcessed.length);

    // ---- Run 4: due again 25 h after run 3, nothing is eligible to delete.
    const run4 = (await h.run(NOW + 50 * HOUR)) as MemoryRetentionRunReport;
    expect(run4).toEqual({
      status: 'completed',
      reason: null,
      processedPurged: 0,
      stuckKept: 340,
      ledgerPruned: 0,
      freedBytes: 0,
      pagesReclaimed: 0,
      memoriesArchived: 0,
      memoriesDeleted: 0,
      memoriesEvicted: 0,
      lifecycleNote: null,
      backlogRemaining: false,
      durationMs: 0,
      error: null,
    });
    expect(snapshot(t)).toEqual(afterRun3);
    expect(h.store.readState()?.lastCompletedAt).toBe(NOW + 50 * HOUR);
  });

  it('a row-budget stop still prunes the ledger and reclaims, and never touches unprocessed rows', async () => {
    const h = makeHarness({ maxRowsPerRun: 250 });
    const { t } = h;
    h.settings['memory.retention.batchSize'] = 500;

    // 300 eligible processed rows: more than the 250 cap.
    seedObservations(
      t.raw,
      seedGroup(300, (i) => ({
        sessionId: `p-${i % 2}`,
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
        toolResponseText: PAYLOAD_8KB,
      })),
    );
    const stuck = seedObservations(
      t.raw,
      seedGroup(200, (i) => ({
        sessionId: 'u-0',
        kind: 'tool-use',
        capturedAt: NOW - 20 * DAY + i * 1000,
        processedAt: null,
        toolResponseText: PAYLOAD_8KB,
      })),
    );

    // Ledger rows written before TASK_2026_621 are still bounded.
    const insertLedger = t.raw.prepare(
      `INSERT INTO observation_quarantine
         (session_id, kind, reason, row_count, payload_bytes, oldest_captured_at,
          newest_captured_at, first_quarantined_at, last_quarantined_at)
       VALUES (?, 'user-prompt', 'stuck-unprocessed', 3, 30, ?, ?, ?, ?)`,
    );
    // Older than the 90-day bound → pruned.
    insertLedger.run(
      'old-s',
      NOW - 200 * DAY,
      NOW - 190 * DAY,
      NOW - 100 * DAY,
      NOW - 91 * DAY,
    );
    // Inside the bound → kept.
    insertLedger.run(
      'recent-s',
      NOW - 120 * DAY,
      NOW - 110 * DAY,
      NOW - 89 * DAY,
      NOW - 89 * DAY,
    );

    const run1 = (await h.run(NOW)) as MemoryRetentionRunReport;
    expect(run1).toMatchObject({
      status: 'partial',
      reason: 'row-budget',
      processedPurged: 250,
      stuckKept: 200,
      ledgerPruned: 1,
      backlogRemaining: true,
      error: null,
    });

    const left = snapshot(t);
    for (const id of stuck) expect(left.get(id)?.processed_at).toBeNull();
    expect(left.size).toBe(50 + stuck.length);
    expect(ledger(t).map((row) => row['session_id'])).toEqual(['recent-s']);

    // Reclaim ran after the row-budget stop and emptied the freelist.
    expect(run1.pagesReclaimed).toBeGreaterThan(0);
    expect(pragmaNumber(t.raw, 'freelist_count')).toBe(0);

    const stateRow = t.raw
      .prepare(
        'SELECT last_outcome, last_reason, backlog_remaining, ledger_pruned, last_completed_at FROM memory_retention_state WHERE id = 1',
      )
      .get() as Record<string, unknown>;
    expect(stateRow['last_outcome']).toBe('partial');
    expect(stateRow['last_reason']).toBe('row-budget');
    expect(Number(stateRow['backlog_remaining'])).toBe(1);
    expect(Number(stateRow['ledger_pruned'])).toBe(1);
    expect(stateRow['last_completed_at']).toBeNull();

    // The next hour finishes the processed backlog; the stuck rows stay.
    const run2 = (await h.run(NOW + HOUR)) as MemoryRetentionRunReport;
    expect(run2).toMatchObject({
      status: 'completed',
      processedPurged: 50,
      stuckKept: 200,
      backlogRemaining: false,
    });
    const after2 = snapshot(t);
    expect(after2.size).toBe(stuck.length);
    for (const id of stuck) expect(after2.get(id)?.processed_at).toBeNull();
    expect(h.store.readState()?.lastCompletedAt).toBe(NOW + HOUR);
  });

  it('a failure in the third purge batch fails the run, keeps batches 1-2, records the error and releases the flag', async () => {
    let failThirdBatch = true;
    const h = makeHarness({}, (store) => {
      const real = store.purgeProcessedBatch.bind(store);
      let calls = 0;
      store.purgeProcessedBatch = (cutoff, limit, cursor) => {
        calls++;
        if (failThirdBatch && calls === 3) {
          throw new RetentionStepError(
            'sql-error',
            'purge-processed',
            new Error(
              'disk I/O error writing /home/someone/.ptah/state/ptah.sqlite',
            ),
          );
        }
        return real(cutoff, limit, cursor);
      };
    });
    const { t } = h;
    const ids = seedObservations(
      t.raw,
      seedGroup(350, () => ({
        sessionId: 'p-0',
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
      })),
    );

    const run1 = (await h.run(NOW)) as MemoryRetentionRunReport;
    expect(run1).toMatchObject({
      status: 'failed',
      reason: 'sql-error',
      processedPurged: 200,
      backlogRemaining: true,
    });
    expect(run1.error).toContain('[path redacted]');
    expect(run1.error).not.toContain('someone');

    const survivors = snapshot(t);
    expect(survivors.size).toBe(150);
    // The purge drains a session in id order through the index; batches 1-2
    // took the first 200 ids and batch 3's rows are all still present.
    for (const id of ids.slice(0, 200)) expect(survivors.has(id)).toBe(false);
    for (const id of ids.slice(200)) expect(survivors.has(id)).toBe(true);

    const state1 = h.store.readState();
    expect(state1?.lastOutcome).toBe('failed');
    expect(state1?.lastReason).toBe('sql-error');
    expect(state1?.lastError).toContain('disk I/O error');
    expect(state1?.lastError).not.toContain('someone');
    expect(state1?.backlogRemaining).toBe(true);
    expect(state1?.lastCompletedAt).toBeNull();

    failThirdBatch = false;
    const run2 = (await h.run(NOW + HOUR)) as MemoryRetentionRunReport;
    expect(run2.status).toBe('completed');
    expect(run2.processedPurged).toBe(150);
    expect(snapshot(t).size).toBe(0);
  });

  it('waits on governor before purging rows from real SQLite', async () => {
    let clear = false;
    let waiter: (() => void) | null = null;
    const governor: BackgroundWorkAdmission = {
      isClear: () => clear,
      whenClear: () => {
        if (clear) return Promise.resolve('clear');
        return new Promise((resolve) => {
          waiter = () => resolve('clear');
        });
      },
    };

    const h = makeHarness({}, undefined, governor);
    const { t } = h;
    seedObservations(
      t.raw,
      seedGroup(100, () => ({
        sessionId: 'gov-0',
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
      })),
    );

    let finished = false;
    const runPromise = h.run(NOW).then((res) => {
      finished = true;
      return res;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(finished).toBe(false);
    expect(snapshot(t).size).toBe(100);
    expect(waiter).not.toBeNull();

    clear = true;
    if (waiter) {
      (waiter as () => void)();
    }

    const result = (await runPromise) as MemoryRetentionRunReport;
    expect(result.status).toBe('completed');
    expect(result.processedPurged).toBe(100);
    expect(snapshot(t).size).toBe(0);
  });
});
