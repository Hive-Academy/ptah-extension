/**
 * TASK_2026_563 M5 criteria 9-10: the 443 lifecycle never archives, deletes or
 * evicts a quarantined memory and never counts one toward the per-workspace
 * cap. Real stores on real SQLite (production migrations up to 0048), one
 * `MemoryLifecycleService.runStep` pass per phase, then a restore and a second
 * pass to prove the restored rows become eligible again.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  IEmbedder,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { MemoryStore } from '../memory.store';
import { MEMORY_LIFECYCLE_KEYS } from './memory-lifecycle-config';
import { MemoryLifecycleService } from './memory-lifecycle.service';
import {
  MEMORY_LIFECYCLE_SQL,
  MemoryLifecycleStore,
} from './memory-lifecycle.store';
import { DAY_MS, MEMORY_RETENTION_LIMITS } from './memory-retention-config';
import { RetentionRunBudget } from './retention-run-budget';
import {
  openRetentionTestDb,
  removeRetentionTempDirs,
  seedMemories,
  type RetentionTestDb,
  type SeedMemoryOptions,
} from './retention-sqlite.test-support';

const NOW = 1_800_000_000_000;
const QUARANTINED_AT = NOW - 5 * DAY_MS;

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

interface Harness {
  readonly t: RetentionTestDb;
  readonly memoryStore: MemoryStore;
  readonly lifecycleStore: MemoryLifecycleStore;
  runPass(): ReturnType<MemoryLifecycleService['runStep']>;
}

const openDbs: RetentionTestDb[] = [];

function makeHarness(settings: Record<string, unknown> = {}): Harness {
  const t = openRetentionTestDb({ memorySchema: true, vec: true });
  openDbs.push(t);
  const logger = makeLogger();
  const vecStatus = { available: true } as unknown as VecStatusService;
  const workspace = {
    getConfiguration: (_section: string, key: string, fallback?: unknown) =>
      key in settings ? settings[key] : fallback,
  } as unknown as IWorkspaceProvider;
  const memoryStore = new MemoryStore(
    logger,
    t.connection,
    { embed: jest.fn(), dim: 384 } as unknown as IEmbedder,
    vecStatus,
  );
  const lifecycleStore = new MemoryLifecycleStore(
    logger,
    t.connection,
    vecStatus,
  );
  const service = new MemoryLifecycleService(
    logger,
    workspace,
    lifecycleStore,
    memoryStore,
    MEMORY_RETENTION_LIMITS,
  );
  return {
    t,
    memoryStore,
    lifecycleStore,
    runPass: () =>
      service.runStep(
        new RetentionRunBudget({
          options: {
            signal: new AbortController().signal,
            isOnBattery: () => false,
            msSinceForegroundActivity: () => Number.POSITIVE_INFINITY,
          },
          limits: MEMORY_RETENTION_LIMITS,
          now: () => 0,
          startedAt: 0,
          logger,
          governor: null,
          queueBatchSize: 500,
          archiveBatchSize: 500,
          deleteBatchSize: 200,
        }),
        NOW,
      ),
  };
}

function quarantine(t: RetentionTestDb, ids: readonly string[]): void {
  const statement = t.raw.prepare(
    `UPDATE memories SET quarantined_at = ?, quarantine_reason = 'rule:test' WHERE id = ?`,
  );
  for (const id of ids) statement.run(QUARANTINED_AT, id);
}

interface LifecycleRow {
  readonly tier: string;
  readonly archived_at: number | null;
  readonly quarantined_at: number | null;
}

function rowOf(t: RetentionTestDb, id: string): LifecycleRow | undefined {
  return t.raw
    .prepare(
      'SELECT tier, archived_at, quarantined_at FROM memories WHERE id = ?',
    )
    .get(id) as LifecycleRow | undefined;
}

function chunkCount(t: RetentionTestDb, id: string): number {
  const row = t.raw
    .prepare('SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id = ?')
    .get(id) as { n: number | bigint };
  return Number(row.n);
}

afterEach(() => {
  for (const t of openDbs.splice(0)) t.close();
});
afterAll(() => removeRetentionTempDirs());

describe('memory lifecycle — quarantined rows are exempt (TASK_2026_563)', () => {
  it('neither deletes an archival row past grace nor archives a recall row past the cutoff, until restored', async () => {
    const h = makeHarness();
    const pastDelete: Omit<SeedMemoryOptions, 'id'> = {
      workspaceRoot: '/age',
      tier: 'archival',
      archivedAt: NOW - 61 * DAY_MS,
      lastUsedAt: NOW - 90 * DAY_MS,
      chunks: 2,
    };
    const pastArchive: Omit<SeedMemoryOptions, 'id'> = {
      workspaceRoot: '/age',
      tier: 'recall',
      lastUsedAt: NOW - 31 * DAY_MS,
      chunks: 2,
    };
    seedMemories(h.t.raw, [
      { id: 'q-archival', ...pastDelete },
      { id: 'c-archival', ...pastDelete },
      { id: 'q-recall', ...pastArchive },
      { id: 'c-recall', ...pastArchive },
    ]);
    quarantine(h.t, ['q-archival', 'q-recall']);

    // The preview counts only the controls.
    expect(
      h.lifecycleStore.readPreview(
        NOW - 30 * DAY_MS,
        NOW - 60 * DAY_MS,
        25_000,
      ),
    ).toEqual({
      archiveEligible: 1,
      deleteEligible: 1,
      overCap: 0,
      readErrors: [],
    });

    const first = await h.runPass();
    expect(first).toMatchObject({ deleted: 1, archived: 1, evicted: 0 });

    // Controls follow the 443 lifecycle.
    expect(rowOf(h.t, 'c-archival')).toBeUndefined();
    expect(chunkCount(h.t, 'c-archival')).toBe(0);
    expect(rowOf(h.t, 'c-recall')).toEqual({
      tier: 'archival',
      archived_at: NOW,
      quarantined_at: null,
    });

    // Quarantined rows keep their chunks, tier and archived_at.
    expect(rowOf(h.t, 'q-archival')).toEqual({
      tier: 'archival',
      archived_at: NOW - 61 * DAY_MS,
      quarantined_at: QUARANTINED_AT,
    });
    expect(rowOf(h.t, 'q-recall')).toEqual({
      tier: 'recall',
      archived_at: null,
      quarantined_at: QUARANTINED_AT,
    });
    expect(chunkCount(h.t, 'q-archival')).toBe(2);
    expect(chunkCount(h.t, 'q-recall')).toBe(2);

    expect(h.memoryStore.restoreQuarantined({ all: true }, '/age')).toEqual({
      restored: 2,
    });
    expect(rowOf(h.t, 'q-archival')).toEqual({
      tier: 'archival',
      archived_at: NOW - 61 * DAY_MS,
      quarantined_at: null,
    });
    expect(rowOf(h.t, 'q-recall')).toEqual({
      tier: 'recall',
      archived_at: null,
      quarantined_at: null,
    });

    const second = await h.runPass();
    expect(second).toMatchObject({ deleted: 1, archived: 1 });
    expect(rowOf(h.t, 'q-archival')).toBeUndefined();
    expect(chunkCount(h.t, 'q-archival')).toBe(0);
    expect(rowOf(h.t, 'q-recall')).toEqual({
      tier: 'archival',
      archived_at: NOW,
      quarantined_at: null,
    });
  });

  it('never counts or evicts quarantined rows in an over-cap workspace, until restored', async () => {
    const h = makeHarness({ [MEMORY_LIFECYCLE_KEYS.maxPerWorkspace]: 1000 });
    // 1000 active rows sit exactly at the cap; 3 older active controls push it
    // over by 3. The 5 quarantined rows are the OLDEST, so without the
    // predicate they would both inflate the count and be evicted first.
    const quarantinedIds = Array.from({ length: 5 }, (_, i) => `q-cap-${i}`);
    seedMemories(h.t.raw, [
      ...Array.from({ length: 1000 }, (_, i) => ({
        id: `keep-${i}`,
        workspaceRoot: '/cap',
        lastUsedAt: NOW - DAY_MS + i,
        chunks: 0,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `c-cap-${i}`,
        workspaceRoot: '/cap',
        lastUsedAt: NOW - 2 * DAY_MS + i,
      })),
      ...quarantinedIds.map((id, i) => ({
        id,
        workspaceRoot: '/cap',
        lastUsedAt: NOW - 3 * DAY_MS + i,
        chunks: 2,
      })),
    ]);
    quarantine(h.t, quarantinedIds);

    expect(h.lifecycleStore.overCapWorkspaces(1000).workspaces).toEqual([
      { workspaceRoot: '/cap', evictable: 1003, recallEvictable: 1003 },
    ]);
    expect(
      h.lifecycleStore.readPreview(NOW - 30 * DAY_MS, NOW - 60 * DAY_MS, 1000)
        .overCap,
    ).toBe(3);

    const first = await h.runPass();
    expect(first).toMatchObject({ evicted: 3, deleted: 0, archived: 0 });
    expect(first.preview?.overCap).toBe(0);
    for (let i = 0; i < 3; i++) {
      expect(rowOf(h.t, `c-cap-${i}`)).toBeUndefined();
    }
    for (const id of quarantinedIds) {
      expect(rowOf(h.t, id)).toEqual({
        tier: 'recall',
        archived_at: null,
        quarantined_at: QUARANTINED_AT,
      });
      expect(chunkCount(h.t, id)).toBe(2);
    }

    expect(
      h.memoryStore.restoreQuarantined({ ids: quarantinedIds }, '/cap'),
    ).toEqual({ restored: 5 });
    expect(
      h.lifecycleStore.readPreview(NOW - 30 * DAY_MS, NOW - 60 * DAY_MS, 1000)
        .overCap,
    ).toBe(5);

    const second = await h.runPass();
    expect(second).toMatchObject({ evicted: 5 });
    for (const id of quarantinedIds) {
      expect(rowOf(h.t, id)).toBeUndefined();
      expect(chunkCount(h.t, id)).toBe(0);
    }
    const remaining = h.t.raw
      .prepare(
        "SELECT COUNT(*) AS n FROM memories WHERE workspace_root = '/cap'",
      )
      .get() as { n: number | bigint };
    expect(Number(remaining.n)).toBe(1000);
  }, 120_000);

  it('refuses to delete or archive a quarantined row even when its id reaches the write statements', () => {
    const h = makeHarness();
    seedMemories(h.t.raw, [
      {
        id: 'q-direct',
        workspaceRoot: '/direct',
        tier: 'recall',
        lastUsedAt: NOW - 90 * DAY_MS,
        chunks: 2,
      },
    ]);
    quarantine(h.t, ['q-direct']);
    const ids = JSON.stringify(['q-direct']);

    // Defence in depth: the id-list statements carry the predicate too.
    expect(
      Number(
        h.t.db.prepare(MEMORY_LIFECYCLE_SQL.ARCHIVE_UPDATE_SQL).run({
          now: NOW,
          ids,
        }).changes,
      ),
    ).toBe(0);
    h.t.db.prepare(MEMORY_LIFECYCLE_SQL.DELETE_CHUNKS_SQL).run({ ids });
    expect(
      Number(
        h.t.db.prepare(MEMORY_LIFECYCLE_SQL.DELETE_MEMORIES_SQL).run({ ids })
          .changes,
      ),
    ).toBe(0);
    expect(rowOf(h.t, 'q-direct')).toEqual({
      tier: 'recall',
      archived_at: null,
      quarantined_at: QUARANTINED_AT,
    });
    expect(chunkCount(h.t, 'q-direct')).toBe(2);
  });
});
