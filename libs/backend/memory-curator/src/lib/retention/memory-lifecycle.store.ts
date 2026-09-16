import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  VecStatusService,
  type SqliteDatabase,
  type SqliteStatement,
} from '@ptah-extension/persistence-sqlite';
import { RetentionStepError } from './observation-retention.store';

const DELETE_ARCHIVED_SELECT_SQL = `SELECT m.id, m.workspace_root FROM memories m INDEXED BY idx_memories_tier_archived
 WHERE m.tier = 'archival' AND m.archived_at < @cutoff AND m.pinned = 0
   AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
 ORDER BY m.archived_at LIMIT @limit`;

const ARCHIVE_SELECT_SQL = `SELECT m.id, m.workspace_root FROM memories m INDEXED BY idx_memories_tier_last_used
 WHERE m.tier = 'recall' AND m.last_used_at < @cutoff AND m.pinned = 0
   AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
 ORDER BY m.last_used_at LIMIT @limit`;

const ARCHIVE_UPDATE_SQL = `UPDATE memories SET tier = 'archival', archived_at = @now
 WHERE id IN (SELECT value FROM json_each(@ids)) AND tier = 'recall' AND pinned = 0`;

const OVER_CAP_SQL = `SELECT m.workspace_root AS workspace_root, COUNT(*) AS evictable,
       SUM(m.tier = 'recall') AS recall_evictable
  FROM memories m
 WHERE m.tier <> 'core' AND m.pinned = 0
   AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
 GROUP BY m.workspace_root
HAVING COUNT(*) > @cap`;

const EVICT_ARCHIVAL_SELECT_SQL = `SELECT m.id FROM memories m INDEXED BY idx_memories_tier_last_used
 WHERE m.tier = 'archival' AND m.workspace_root IS @ws AND m.pinned = 0
   AND m.archived_at < @graceCutoff
   AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
 ORDER BY m.last_used_at LIMIT @limit`;

const EVICT_RECALL_SELECT_SQL = `SELECT m.id FROM memories m INDEXED BY idx_memories_tier_last_used
 WHERE m.tier = 'recall' AND m.workspace_root IS @ws AND m.pinned = 0
   AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)
 ORDER BY m.last_used_at LIMIT @limit`;

const DELETE_CHUNKS_SQL = `DELETE FROM memory_chunks
 WHERE memory_id IN (SELECT id FROM memories
                      WHERE id IN (SELECT value FROM json_each(@ids))
                        AND tier <> 'core' AND pinned = 0)`;

const DELETE_MEMORIES_SQL = `DELETE FROM memories
 WHERE id IN (SELECT value FROM json_each(@ids)) AND tier <> 'core' AND pinned = 0`;

const TRIGGER_EXISTS_SQL = `SELECT 1 FROM sqlite_master
 WHERE type = 'trigger' AND name = 'memory_chunks_vec_ad'`;

const ARCHIVE_COUNT_SQL = `SELECT COUNT(*) AS n FROM memories m INDEXED BY idx_memories_tier_last_used
 WHERE m.tier = 'recall' AND m.last_used_at < @cutoff AND m.pinned = 0
   AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)`;

const DELETE_COUNT_SQL = `SELECT COUNT(*) AS n FROM memories m INDEXED BY idx_memories_tier_archived
 WHERE m.tier = 'archival' AND m.archived_at < @cutoff AND m.pinned = 0
   AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)`;

export const MEMORY_LIFECYCLE_SQL = {
  DELETE_ARCHIVED_SELECT_SQL,
  ARCHIVE_SELECT_SQL,
  ARCHIVE_UPDATE_SQL,
  OVER_CAP_SQL,
  EVICT_ARCHIVAL_SELECT_SQL,
  EVICT_RECALL_SELECT_SQL,
  DELETE_CHUNKS_SQL,
  DELETE_MEMORIES_SQL,
  TRIGGER_EXISTS_SQL,
  ARCHIVE_COUNT_SQL,
  DELETE_COUNT_SQL,
} as const;

export interface MemoryLifecycleBatchResult {
  readonly deleted: number;
  readonly workspaceRoots: readonly (string | null)[];
}

export interface MemoryArchiveBatchResult {
  readonly archived: number;
  readonly workspaceRoots: readonly (string | null)[];
}

export interface OverCapWorkspace {
  readonly workspaceRoot: string | null;
  readonly evictable: number;
  readonly recallEvictable: number;
}

export interface OverCapWorkspacesReading {
  readonly workspaces: readonly OverCapWorkspace[];
  readonly readErrors: readonly string[];
}

export interface MemoryEvictBatchResult {
  readonly evicted: number;
}

export interface MemoryLifecyclePreviewReading {
  readonly archiveEligible: number | null;
  readonly deleteEligible: number | null;
  readonly overCap: number | null;
  readonly readErrors: readonly string[];
}

interface IdRootRow {
  id: string;
  workspace_root: string | null;
}

function isBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; errcode?: unknown };
  return (
    (typeof candidate.code === 'string' &&
      candidate.code.startsWith('SQLITE_BUSY')) ||
    (typeof candidate.errcode === 'number' && (candidate.errcode & 0xff) === 5)
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class MemoryLifecycleStore {
  private readonly statements = new Map<string, SqliteStatement>();
  private cachedDb: SqliteDatabase | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
  ) {}

  canDelete():
    | { readonly allowed: true }
    | { readonly allowed: false; readonly reason: 'vec-unavailable' } {
    if (this.vecStatus.available) return { allowed: true };
    const trigger = this.statement(
      this.connection.db,
      TRIGGER_EXISTS_SQL,
    ).get();
    return trigger === undefined
      ? { allowed: true }
      : { allowed: false, reason: 'vec-unavailable' };
  }

  deleteArchivedBatch(
    cutoffMs: number,
    limit: number,
  ): MemoryLifecycleBatchResult {
    return this.inTransaction('delete-archived', (db) => {
      const rows = this.statement(db, DELETE_ARCHIVED_SELECT_SQL).all({
        cutoff: cutoffMs,
        limit,
      }) as IdRootRow[];
      const deleted = this.deletePair(
        db,
        rows.map((row) => row.id),
      );
      return { deleted, workspaceRoots: rows.map((row) => row.workspace_root) };
    });
  }

  archiveBatch(
    cutoffMs: number,
    nowMs: number,
    limit: number,
  ): MemoryArchiveBatchResult {
    return this.inTransaction('archive', (db) => {
      const rows = this.statement(db, ARCHIVE_SELECT_SQL).all({
        cutoff: cutoffMs,
        limit,
      }) as IdRootRow[];
      if (rows.length === 0) return { archived: 0, workspaceRoots: [] };
      const result = this.statement(db, ARCHIVE_UPDATE_SQL).run({
        now: nowMs,
        ids: JSON.stringify(rows.map((row) => row.id)),
      });
      return {
        archived: Number(result.changes),
        workspaceRoots: rows.map((row) => row.workspace_root),
      };
    });
  }

  overCapWorkspaces(cap: number): OverCapWorkspacesReading {
    const readErrors: string[] = [];
    try {
      const workspaces = (
        this.statement(this.connection.db, OVER_CAP_SQL).all({ cap }) as Array<{
          workspace_root: string | null;
          evictable: number | bigint;
          recall_evictable: number | bigint | null;
        }>
      ).map((row) => ({
        workspaceRoot: row.workspace_root,
        evictable: Number(row.evictable),
        recallEvictable: Number(row.recall_evictable ?? 0),
      }));
      return { workspaces, readErrors };
    } catch (error: unknown) {
      // degradation-audit: optional-capability - preview/cap reads are advisory;
      // the owning retention run reports the diagnostic and continues safely.
      readErrors.push(`overCapWorkspaces: ${errorText(error)}`);
      return { workspaces: [], readErrors };
    }
  }

  evictBatch(
    workspaceRoot: string | null,
    tier: 'archival' | 'recall',
    graceCutoffMs: number,
    limit: number,
  ): MemoryEvictBatchResult {
    return this.inTransaction(`evict-${tier}`, (db) => {
      const sql =
        tier === 'archival'
          ? EVICT_ARCHIVAL_SELECT_SQL
          : EVICT_RECALL_SELECT_SQL;
      const params =
        tier === 'archival'
          ? { ws: workspaceRoot, graceCutoff: graceCutoffMs, limit }
          : { ws: workspaceRoot, limit };
      const rows = this.statement(db, sql).all(params) as Array<{ id: string }>;
      return {
        evicted: this.deletePair(
          db,
          rows.map((row) => row.id),
        ),
      };
    });
  }

  readPreview(
    archiveCutoffMs: number,
    deleteCutoffMs: number,
    cap: number,
  ): MemoryLifecyclePreviewReading {
    const readErrors: string[] = [];
    let archiveEligible: number | null = null;
    let deleteEligible: number | null = null;
    let overCap: number | null = null;
    try {
      const row = this.statement(this.connection.db, ARCHIVE_COUNT_SQL).get({
        cutoff: archiveCutoffMs,
      }) as { n: number | bigint };
      archiveEligible = Number(row.n);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - lifecycle preview reads never
      // fail the destructive run; the error is exposed through readErrors.
      readErrors.push(`archiveEligible: ${errorText(error)}`);
    }
    try {
      const row = this.statement(this.connection.db, DELETE_COUNT_SQL).get({
        cutoff: deleteCutoffMs,
      }) as { n: number | bigint };
      deleteEligible = Number(row.n);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - lifecycle preview reads never
      // fail the destructive run; the error is exposed through readErrors.
      readErrors.push(`deleteEligible: ${errorText(error)}`);
    }
    const overCapReading = this.overCapWorkspaces(cap);
    readErrors.push(...overCapReading.readErrors);
    if (overCapReading.readErrors.length === 0) {
      overCap = overCapReading.workspaces.reduce(
        (total, row) => total + Math.max(0, row.evictable - cap),
        0,
      );
    }
    return { archiveEligible, deleteEligible, overCap, readErrors };
  }

  private deletePair(db: SqliteDatabase, ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    const bound = { ids: JSON.stringify(ids) };
    this.statement(db, DELETE_CHUNKS_SQL).run(bound);
    return Number(this.statement(db, DELETE_MEMORIES_SQL).run(bound).changes);
  }

  private inTransaction<T>(step: string, work: (db: SqliteDatabase) => T): T {
    let db: SqliteDatabase;
    try {
      db = this.connection.db;
      db.exec('BEGIN IMMEDIATE');
    } catch (error: unknown) {
      throw new RetentionStepError(
        isBusyError(error) ? 'database-busy' : 'sql-error',
        step,
        error,
      );
    }
    try {
      const result = work(db);
      db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError: unknown) {
        // degradation-audit: reported - the original transaction failure is
        // authoritative; a failed rollback is logged without replacing it.
        this.logger.debug('[memory-curator] lifecycle rollback failed', {
          step,
          error: errorText(rollbackError),
        });
      }
      throw new RetentionStepError(
        isBusyError(error) ? 'database-busy' : 'sql-error',
        step,
        error,
      );
    }
  }

  private statement(db: SqliteDatabase, sql: string): SqliteStatement {
    if (db !== this.cachedDb) {
      this.statements.clear();
      this.cachedDb = db;
    }
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
}
