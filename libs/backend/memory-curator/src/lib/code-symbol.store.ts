import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  VecStatusService,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';
import {
  type ICodeSymbolReader,
  type CodeIndexFreshness,
  type CodeSymbolHit,
  type CodeSymbolHitPage,
} from '@ptah-extension/memory-contracts';
import { buildFtsQueryPlan, executeFtsQueryPlan } from './fts-query.util';

export interface CodeSymbolInsert {
  readonly workspaceRoot: string;
  readonly filePath: string;
  readonly kind: string;
  readonly symbolName: string;
  readonly subject: string;
  readonly text: string;
  readonly tokenCount: number;
}

export interface CodeSymbolSearchParams {
  readonly workspaceRoot?: string | null;
  readonly query?: string;
  readonly kinds?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface CodeSymbolListEntry {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly filePath: string;
  readonly kind: string;
  readonly symbolName: string;
  readonly subject: string;
  readonly tokenCount: number;
  readonly updatedAt: number;
}

export interface CodeSymbolSearchResult {
  readonly items: readonly CodeSymbolListEntry[];
  readonly total: number;
}

/**
 * Tri-state workspace predicate, matching `MemoryStore.stats`:
 *
 *   - `string`    → that workspace only (`workspace_root IS ?`)
 *   - `null`      → unscoped rows only (`workspace_root IS NULL`)
 *   - `undefined` → no predicate at all, i.e. EVERY workspace
 *
 * `null` used to be folded into `undefined` here (`!== undefined && !== null`),
 * which is exactly why a no-workspace `memory:stats` reported the code-symbol
 * count of every workspace in `~/.ptah/state/ptah-dev.sqlite`: the caller said
 * "global/unscoped" and the store heard "unfiltered". `code_symbols.workspace_root`
 * is never NULL (see `CodeSymbolInsert`), so `null` correctly matches nothing.
 *
 * A caller that genuinely means "every workspace" must now say `undefined`, and
 * no RPC path does — `MemoryRpcHandlers` resolves the tri-state at the boundary.
 */
function workspaceClause(workspaceRoot: string | null | undefined): {
  readonly sql: string;
  readonly values: readonly unknown[];
} {
  if (workspaceRoot === undefined) return { sql: '', values: [] };
  if (workspaceRoot === null)
    return { sql: 'workspace_root IS NULL', values: [] };
  return { sql: 'workspace_root IS ?', values: [workspaceRoot] };
}

interface CodeSymbolRow {
  id: string;
  workspace_root: string;
  file_path: string;
  kind: string;
  symbol_name: string;
  subject: string;
  token_count: number;
  updated_at: number;
}

/** Full row shape used by the hybrid semantic search path (carries `text`). */
interface CodeSymbolHitRow {
  rowid: number;
  id: string;
  workspace_root: string;
  file_path: string;
  kind: string;
  symbol_name: string;
  subject: string;
  text: string;
  token_count: number;
}

interface CodeVecRow {
  rowid: number;
  distance: number;
}

/** Default k for Reciprocal Rank Fusion — matches MemorySearchService. */
const CODE_RRF_K = 25;

/** Upper bound on `searchSymbols` topK, and so on the length of the exact-name list. */
const CODE_SEARCH_MAX_TOP_K = 50;

/**
 * RRF weight of the exact `symbol_name` candidate list. BM25 and vector weights
 * sum to 1, so a row absent from the exact list scores at most 1 / (k + 1).
 * An exact row at 0-based index i scores at least W / (k + i + 1), and i is at
 * most CODE_SEARCH_MAX_TOP_K - 1. W = 3 gives 3 / 75 = 0.04 > 1 / 26 ≈ 0.0385,
 * so every exact-name row outranks every non-exact row. Raising the topK cap
 * requires re-deriving this weight.
 */
const EXACT_NAME_RRF_WEIGHT = 3;

/** A query SQLite `NOCASE` can compare case-insensitively on its own. */
const ASCII_ONLY = /^\p{ASCII}*$/u;

/** Files deleted per transaction in {@link CodeSymbolStore.purgeMissing}. */
const PURGE_MISSING_BATCH = 200;

/**
 * Marker row in `indexing_state`, the database's existing per-key meta
 * table (migration 0012). Real workspace fingerprints are 16 hex characters
 * (`deriveWorkspaceFingerprint`); this key is not, and every reader of the
 * table looks up a fingerprint it already has, so the row is not a workspace.
 * Presence means a symbol replace, purge, delete, or insert committed while
 * sqlite-vec was unloaded. The next time vec is available, every
 * `code_symbols_vec` row is deleted and this row is removed. Embeddings are
 * absent until the next index run. Lexical search does not read them.
 */
const VEC_STALE_FINGERPRINT = 'code-symbols-vec-stale';

function normalizeStoredPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** Row columns selected by the exact-name lookups. */
const EXACT_NAME_COLUMNS = `cs.rowid AS rowid, cs.id AS id, cs.workspace_root AS workspace_root,
             cs.file_path AS file_path, cs.kind AS kind, cs.symbol_name AS symbol_name,
             cs.subject AS subject, cs.text AS text, cs.token_count AS token_count`;

@injectable()
export class CodeSymbolStore implements ICodeSymbolReader {
  private embedderWarnedOnce = false;
  /**
   * Set after orphan `code_symbols_vec` rows have been removed for the
   * current stretch of vec availability. Cleared when vec is unavailable
   * so the next time it loads, leftovers from that outage are removed.
   */
  private vecOrphansReconciled = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
  ) {}

  /**
   * `code_symbols.id` is `TEXT PRIMARY KEY` (migration 0013), not
   * `INTEGER PRIMARY KEY AUTOINCREMENT`. The implicit rowid can be reused
   * after a delete. sqlite-vec's `vec0` table cannot be written while the
   * extension is unloaded, so a delete or replace during an outage leaves
   * the old `code_symbols_vec` row in place. Once vec returns, that rowid
   * may already belong to a different symbol, so deleting only orphans
   * keeps the stale embedding.
   *
   * A committed symbol write during the outage inserts
   * {@link VEC_STALE_FINGERPRINT} in the same transaction. The first call
   * after vec is available again, including a search, deletes every vec
   * row and clears the marker. A missing vector is not a semantic
   * candidate. Lexical search still runs. While vec stayed available, only
   * true orphans are removed, and each vec insert still deletes that rowid
   * first (`vec0` is not written with `INSERT OR REPLACE`).
   *
   * The marker lives in SQLite, so an outage that lasts the whole process
   * is still repaired in the next process. Returns whether vec reads and
   * writes may run.
   */
  private reconcileOrphanVecRows(): boolean {
    if (!this.vecStatus.available) {
      this.vecOrphansReconciled = false;
      return false;
    }
    if (this.vecOrphansReconciled) return true;

    const db = this.connection.db;
    try {
      const stale = db
        .prepare(
          `SELECT 1 AS present FROM indexing_state WHERE workspace_fingerprint = ?`,
        )
        .get(VEC_STALE_FINGERPRINT) as { present: number } | undefined;
      if (stale) {
        this.dropAllVecRows(db);
      } else {
        this.dropOrphanVecRows(db);
      }
    } catch (err: unknown) {
      this.connection.handleFatalWriteError(err);
      throw err;
    }
    this.vecOrphansReconciled = true;
    return true;
  }

  /** Record that symbol rows changed while vec rows could not. */
  private markVecStale(): void {
    this.connection.db
      .prepare(
        `INSERT OR IGNORE INTO indexing_state (workspace_fingerprint) VALUES (?)`,
      )
      .run(VEC_STALE_FINGERPRINT);
  }

  /**
   * Delete every vec row, then the stale marker. The marker is cleared
   * only after the deletes, inside the same transaction: a failure leaves
   * the marker so the next call tries again. vec0 is deleted by rowid.
   */
  private dropAllVecRows(db: SqliteConnectionService['db']): void {
    const rowids = db
      .prepare(`SELECT rowid AS rowid FROM code_symbols_vec_rowids`)
      .all() as Array<{ rowid: number }>;
    const deleteVec = db.prepare(
      `DELETE FROM code_symbols_vec WHERE rowid = ?`,
    );
    const clearMarker = db.prepare(
      `DELETE FROM indexing_state WHERE workspace_fingerprint = ?`,
    );
    const txnFn = ((): void => {
      for (const row of rowids) deleteVec.run(row.rowid);
      clearMarker.run(VEC_STALE_FINGERPRINT);
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as () => void;
    txn();
    this.logger.debug?.(
      '[code-symbol-store] dropped code_symbols_vec after a vec outage',
      { removed: rowids.length },
    );
  }

  /**
   * vec0 accepts `DELETE … WHERE rowid = ?`. A `NOT IN` delete against the
   * virtual table is not that shape, so the predicate runs on the vec0
   * rowid shadow and each orphan is deleted by rowid.
   */
  private dropOrphanVecRows(db: SqliteConnectionService['db']): void {
    const orphans = db
      .prepare(
        `SELECT rowid AS rowid FROM code_symbols_vec_rowids
         WHERE rowid NOT IN (SELECT rowid FROM code_symbols)`,
      )
      .all() as Array<{ rowid: number }>;
    if (orphans.length === 0) return;
    const deleteVec = db.prepare(
      `DELETE FROM code_symbols_vec WHERE rowid = ?`,
    );
    const txnFn = ((rows: ReadonlyArray<{ rowid: number }>): void => {
      for (const row of rows) deleteVec.run(row.rowid);
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as (
      rows: ReadonlyArray<{ rowid: number }>,
    ) => void;
    txn(orphans);
    this.logger.debug?.(
      '[code-symbol-store] removed orphan code_symbols_vec rows',
      { removed: orphans.length },
    );
  }

  deleteByFile(workspaceRoot: string, filePath: string): number {
    return this.deleteFileRows(workspaceRoot, filePath);
  }

  /**
   * Delete every symbol row for `filePath` and insert `rows` in one
   * transaction. A failed insert leaves the previous rows (and their FTS
   * and vector rows) in place. FTS follows the `code_symbols` triggers;
   * vector rows are deleted by rowid before the symbol rows.
   */
  async replaceFileSymbols(
    workspaceRoot: string,
    filePath: string,
    rows: readonly CodeSymbolInsert[],
  ): Promise<void> {
    const now = Date.now();
    const vecAvailable = this.reconcileOrphanVecRows();
    const embeddings: Float32Array[] =
      vecAvailable && rows.length > 0
        ? await this.embedderEmbed(rows.map((entry) => entry.text))
        : [];

    const db = this.connection.db;
    const selectRowidsStmt = vecAvailable
      ? db.prepare(
          `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
        )
      : null;
    const deleteVecStmt = vecAvailable
      ? db.prepare(`DELETE FROM code_symbols_vec WHERE rowid = ?`)
      : null;
    const deleteSymbolsStmt = db.prepare(
      `DELETE FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
    );
    const upsertStmt = db.prepare(
      `INSERT INTO code_symbols (id, workspace_root, file_path, kind, symbol_name, subject, text, token_count, created_at, updated_at)
       VALUES (@id, @workspace_root, @file_path, @kind, @symbol_name, @subject, @text, @token_count, @created_at, @updated_at)
       ON CONFLICT(workspace_root, subject) DO UPDATE SET
         file_path = excluded.file_path,
         kind = excluded.kind,
         symbol_name = excluded.symbol_name,
         text = excluded.text,
         token_count = excluded.token_count,
         updated_at = excluded.updated_at`,
    );
    const fetchRowidStmt = db.prepare(
      `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ? AND subject = ?`,
    );
    const insertVecStmt = vecAvailable
      ? db.prepare(
          `INSERT INTO code_symbols_vec(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`,
        )
      : null;

    type Payload = { readonly entries: readonly CodeSymbolInsert[] };
    const txnFn = ((payload: Payload): void => {
      if (selectRowidsStmt && deleteVecStmt) {
        const oldRows = selectRowidsStmt.all(workspaceRoot, filePath) as Array<{
          rowid: number;
        }>;
        for (const old of oldRows) {
          deleteVecStmt.run(old.rowid);
        }
      }
      const removed = deleteSymbolsStmt.run(workspaceRoot, filePath);
      if (
        !vecAvailable &&
        (removed.changes > 0 || payload.entries.length > 0)
      ) {
        this.markVecStale();
      }
      for (let i = 0; i < payload.entries.length; i++) {
        const e = payload.entries[i];
        upsertStmt.run({
          id: ulid(),
          workspace_root: e.workspaceRoot,
          file_path: e.filePath,
          kind: e.kind,
          symbol_name: e.symbolName,
          subject: e.subject,
          text: e.text,
          token_count: e.tokenCount,
          created_at: now,
          updated_at: now,
        });
        if (insertVecStmt && deleteVecStmt) {
          const vec = embeddings[i];
          if (vec && vec.length === this.embedder.dim) {
            const row = fetchRowidStmt.get(e.workspaceRoot, e.subject) as
              { rowid: number } | undefined;
            if (row) {
              // Drop a stale embedding if this rowid was reused while vec
              // was down (implicit rowid, no AUTOINCREMENT).
              deleteVecStmt.run(row.rowid);
              insertVecStmt.run(
                row.rowid,
                Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
              );
            }
          }
        }
      }
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as (p: Payload) => void;
    try {
      txn({ entries: rows });
    } catch (err: unknown) {
      this.connection.handleFatalWriteError(err);
      throw err;
    }
  }

  /**
   * Delete symbol rows (and their FTS/vector rows) whose `file_path` is not
   * in `presentPaths`. Scoped to `workspaceRoot`; other roots are untouched.
   * Deletes run in batches of {@link PURGE_MISSING_BATCH} files. Each
   * batch is its own transaction: a failure rolls that batch back (no
   * file in it loses its symbol row while keeping a vec row) and leaves
   * earlier batches committed. Those paths are already absent, and the
   * next purge deletes whatever remains. One transaction for the whole
   * set would hold the write lock for every missing file.
   */
  purgeMissing(workspaceRoot: string, presentPaths: readonly string[]): number {
    const vecAvailable = this.reconcileOrphanVecRows();
    const present = new Set(
      presentPaths.map((filePath) => normalizeStoredPath(filePath)),
    );
    const db = this.connection.db;
    const listed = db
      .prepare(
        `SELECT DISTINCT file_path AS file_path FROM code_symbols WHERE workspace_root = ?`,
      )
      .all(workspaceRoot) as Array<{ file_path: string }>;
    const missing: string[] = [];
    for (const row of listed) {
      if (!present.has(normalizeStoredPath(row.file_path))) {
        missing.push(row.file_path);
      }
    }
    if (missing.length === 0) return 0;

    const selectRowidsStmt = vecAvailable
      ? db.prepare(
          `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
        )
      : null;
    const deleteVecStmt = vecAvailable
      ? db.prepare(`DELETE FROM code_symbols_vec WHERE rowid = ?`)
      : null;
    const deleteSymbolsStmt = db.prepare(
      `DELETE FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
    );

    type Payload = { readonly paths: readonly string[] };
    const txnFn = ((payload: Payload): number => {
      if (!vecAvailable && payload.paths.length > 0) this.markVecStale();
      let changes = 0;
      for (const filePath of payload.paths) {
        if (selectRowidsStmt && deleteVecStmt) {
          const ids = selectRowidsStmt.all(workspaceRoot, filePath) as Array<{
            rowid: number;
          }>;
          for (const id of ids) {
            deleteVecStmt.run(id.rowid);
          }
        }
        changes += deleteSymbolsStmt.run(workspaceRoot, filePath).changes;
      }
      return changes;
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as (p: Payload) => number;

    let totalDeleted = 0;
    try {
      for (let i = 0; i < missing.length; i += PURGE_MISSING_BATCH) {
        totalDeleted += txn({
          paths: missing.slice(i, i + PURGE_MISSING_BATCH),
        });
      }
    } catch (err: unknown) {
      this.connection.handleFatalWriteError(err);
      throw err;
    }
    return totalDeleted;
  }

  /** Delete one file's symbol rows and their vector rows, FTS via triggers. */
  private deleteFileRows(workspaceRoot: string, filePath: string): number {
    const db = this.connection.db;
    const vecAvailable = this.reconcileOrphanVecRows();
    const selectRowidsStmt = vecAvailable
      ? db.prepare(
          `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
        )
      : null;
    const deleteVecStmt = vecAvailable
      ? db.prepare(`DELETE FROM code_symbols_vec WHERE rowid = ?`)
      : null;
    const deleteSymbolsStmt = db.prepare(
      `DELETE FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
    );
    type Payload = {
      readonly workspaceRoot: string;
      readonly filePath: string;
    };
    const txnFn = ((payload: Payload): number => {
      if (selectRowidsStmt && deleteVecStmt) {
        const ids = selectRowidsStmt.all(
          payload.workspaceRoot,
          payload.filePath,
        ) as Array<{ rowid: number }>;
        for (const id of ids) {
          deleteVecStmt.run(id.rowid);
        }
      }
      const removed = deleteSymbolsStmt.run(
        payload.workspaceRoot,
        payload.filePath,
      );
      if (!vecAvailable && removed.changes > 0) this.markVecStale();
      return removed.changes;
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as (p: Payload) => number;
    try {
      return txn({ workspaceRoot, filePath });
    } catch (err: unknown) {
      this.connection.handleFatalWriteError(err);
      throw err;
    }
  }

  async insertBatch(entries: readonly CodeSymbolInsert[]): Promise<void> {
    if (entries.length === 0) return;
    const now = Date.now();
    const vecAvailable = this.reconcileOrphanVecRows();
    const embeddings: Float32Array[] = vecAvailable
      ? await this.embedderEmbed(entries.map((e) => e.text))
      : [];

    const db = this.connection.db;
    const upsertStmt = db.prepare(
      `INSERT INTO code_symbols (id, workspace_root, file_path, kind, symbol_name, subject, text, token_count, created_at, updated_at)
       VALUES (@id, @workspace_root, @file_path, @kind, @symbol_name, @subject, @text, @token_count, @created_at, @updated_at)
       ON CONFLICT(workspace_root, subject) DO UPDATE SET
         file_path = excluded.file_path,
         kind = excluded.kind,
         symbol_name = excluded.symbol_name,
         text = excluded.text,
         token_count = excluded.token_count,
         updated_at = excluded.updated_at`,
    );
    const fetchRowidStmt = db.prepare(
      `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ? AND subject = ?`,
    );
    const deleteVecStmt = vecAvailable
      ? db.prepare(`DELETE FROM code_symbols_vec WHERE rowid = ?`)
      : null;
    const insertVecStmt = vecAvailable
      ? db.prepare(
          `INSERT INTO code_symbols_vec(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`,
        )
      : null;

    type Payload = { readonly entries: readonly CodeSymbolInsert[] };
    const txnFn = ((payload: Payload): void => {
      if (!vecAvailable) this.markVecStale();
      for (let i = 0; i < payload.entries.length; i++) {
        const e = payload.entries[i];
        upsertStmt.run({
          id: ulid(),
          workspace_root: e.workspaceRoot,
          file_path: e.filePath,
          kind: e.kind,
          symbol_name: e.symbolName,
          subject: e.subject,
          text: e.text,
          token_count: e.tokenCount,
          created_at: now,
          updated_at: now,
        });
        if (insertVecStmt && deleteVecStmt) {
          const vec = embeddings[i];
          if (vec && vec.length === this.embedder.dim) {
            const row = fetchRowidStmt.get(e.workspaceRoot, e.subject) as
              { rowid: number } | undefined;
            if (row) {
              deleteVecStmt.run(row.rowid);
              insertVecStmt.run(
                row.rowid,
                Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
              );
            }
          }
        }
      }
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as (p: Payload) => void;
    try {
      txn({ entries });
    } catch (err: unknown) {
      this.connection.handleFatalWriteError(err);
      throw err;
    }
  }

  /** Count indexed symbols. See `workspaceClause` for the tri-state contract. */
  count(workspaceRoot?: string | null): number {
    const clause = workspaceClause(workspaceRoot);
    const whereSql = clause.sql ? `WHERE ${clause.sql}` : '';
    const row = this.connection.db
      .prepare(`SELECT COUNT(*) AS n FROM code_symbols ${whereSql}`)
      .get(...clause.values) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /**
   * Symbol count and newest `updated_at` for one workspace root, in a single
   * aggregate query. An empty index yields `{ symbolCount: 0, newestUpdatedAt: null }`.
   */
  async getIndexFreshness(workspaceRoot: string): Promise<CodeIndexFreshness> {
    const row = this.connection.db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(updated_at) AS newest FROM code_symbols WHERE workspace_root = ?`,
      )
      .get(workspaceRoot) as { n: number; newest: number | null } | undefined;
    const symbolCount = row?.n ?? 0;
    const newest = row?.newest;
    return {
      symbolCount,
      newestUpdatedAt:
        symbolCount > 0 && typeof newest === 'number' ? newest : null,
    };
  }

  /** Paginated search over code_symbols with optional workspace, name/path, and kind filters. */
  search(params: CodeSymbolSearchParams): CodeSymbolSearchResult {
    const clauses: string[] = [];
    const values: unknown[] = [];

    const wsClause = workspaceClause(params.workspaceRoot);
    if (wsClause.sql) {
      clauses.push(wsClause.sql);
      values.push(...wsClause.values);
    }

    const trimmedQuery =
      typeof params.query === 'string' ? params.query.trim() : '';
    if (trimmedQuery.length > 0) {
      const escaped = trimmedQuery
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const likePattern = `%${escaped}%`;
      clauses.push(
        `(symbol_name LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\')`,
      );
      values.push(likePattern, likePattern);
    }

    if (params.kinds && params.kinds.length > 0) {
      const placeholders = params.kinds.map(() => '?').join(',');
      clauses.push(`kind IN (${placeholders})`);
      for (const k of params.kinds) values.push(k);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const rawLimit =
      typeof params.limit === 'number' && Number.isFinite(params.limit)
        ? Math.trunc(params.limit)
        : 50;
    const limit = Math.min(200, Math.max(1, rawLimit));
    const rawOffset =
      typeof params.offset === 'number' && Number.isFinite(params.offset)
        ? Math.trunc(params.offset)
        : 0;
    const offset = Math.max(0, rawOffset);

    const db = this.connection.db;
    const countSql = `SELECT COUNT(*) AS n FROM code_symbols ${whereSql}`;
    const countRow = db.prepare(countSql).get(...values) as
      { n: number } | undefined;
    const total = countRow?.n ?? 0;

    const rowsSql = `SELECT id, workspace_root, file_path, kind, symbol_name, subject, token_count, updated_at
       FROM code_symbols
       ${whereSql}
       ORDER BY updated_at DESC, symbol_name ASC
       LIMIT ? OFFSET ?`;
    const rows = db
      .prepare(rowsSql)
      .all(...values, limit, offset) as CodeSymbolRow[];

    const items: CodeSymbolListEntry[] = rows.map((r) => ({
      id: r.id,
      workspaceRoot: r.workspace_root,
      filePath: r.file_path,
      kind: r.kind,
      symbolName: r.symbol_name,
      subject: r.subject,
      tokenCount: r.token_count,
      updatedAt: r.updated_at,
    }));

    return { items, total };
  }

  /**
   * Hybrid BM25 (code_symbols_fts) + vector (code_symbols_vec) search over the
   * indexed symbols, plus an exact `symbol_name` candidate list, fused with
   * Reciprocal Rank Fusion. An exact-name row always ranks above every other row
   * (see `EXACT_NAME_RRF_WEIGHT`); the porter tokenizer keeps a camelCase name as
   * one opaque token, so BM25 alone does not guarantee that. Falls back to
   * BM25-only when sqlite-vec is unavailable or the vector query fails. Returns
   * `''`-safe empty page on empty query.
   */
  async searchSymbols(
    query: string,
    topK = 10,
    workspaceRoot?: string,
  ): Promise<CodeSymbolHitPage> {
    const limit = Math.max(1, Math.min(CODE_SEARCH_MAX_TOP_K, topK));
    const trimmed = query.trim();
    if (!trimmed) return { hits: [], bm25Only: !this.vecStatus.available };

    const exactRows = this.exactNameSymbols(trimmed, limit, workspaceRoot);
    const bm25Rows = this.bm25SearchSymbols(trimmed, limit * 4, workspaceRoot);
    let vecRows: CodeSymbolHitRow[] = [];
    let bm25Only = !this.reconcileOrphanVecRows();
    if (!bm25Only) {
      try {
        vecRows = await this.vecSearchSymbols(
          trimmed,
          limit * 4,
          workspaceRoot,
        );
      } catch (err: unknown) {
        this.logger.warn(
          '[code-symbol-store] vec search failed; falling back to BM25',
          { error: err instanceof Error ? err.message : String(err) },
        );
        bm25Only = true;
      }
    }

    const tokenCount = trimmed.split(/\s+/).filter((t) => t.length > 0).length;
    const bm25Weight = tokenCount < 4 ? 0.6 : 0.3;
    const fused = this.rrfFuseSymbols(exactRows, bm25Rows, vecRows, limit, {
      exact: EXACT_NAME_RRF_WEIGHT,
      bm25: bm25Weight,
      vec: 1 - bm25Weight,
    });

    const hits: CodeSymbolHit[] = fused.map(({ row, score }) => ({
      id: row.id,
      workspaceRoot: row.workspace_root,
      filePath: row.file_path,
      kind: row.kind,
      symbolName: row.symbol_name,
      subject: row.subject,
      text: row.text,
      tokenCount: row.token_count,
      score,
    }));
    return { hits, bm25Only };
  }

  /**
   * Rows whose `symbol_name` equals the query. Case-sensitive matches win: when
   * any exists, only those are returned; otherwise the case-insensitive matches
   * are — through SQL `NOCASE` for an ASCII query (`nocaseNameSymbols`), or the
   * JS Unicode fallback for any other (`foldedNameSymbols`). Ties (the same
   * name in several files) order by file path. A query containing whitespace
   * cannot be a symbol name, so it skips the lookup and natural-language
   * searches fuse exactly as before. The query is bound as a parameter and `=`
   * has no wildcards, so `%`, `_` and quotes stay literal.
   */
  private exactNameSymbols(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): CodeSymbolHitRow[] {
    if (/\s/.test(query)) return [];
    const rows = this.nameEqualsSymbols('', query, limit, workspaceRoot);
    if (rows.length > 0) return rows;
    return ASCII_ONLY.test(query)
      ? this.nameEqualsSymbols('COLLATE NOCASE', query, limit, workspaceRoot)
      : this.foldedNameSymbols(query, limit, workspaceRoot);
  }

  /**
   * `symbol_name = ?` with the given collation, workspace-scoped, in file-path
   * order, capped at `limit`. With `COLLATE NOCASE` this is the ASCII
   * case-insensitive tier: for an ASCII query it matches exactly the rows the
   * JS fallback would, except that a stored name containing U+212A KELVIN SIGN
   * lowers to ASCII `k` under `toLowerCase()` but is not folded by `NOCASE`, so
   * `kelvin` does not find `Kelvin`. That gap is accepted to keep an ASCII
   * miss off the JS scan.
   */
  private nameEqualsSymbols(
    collation: '' | 'COLLATE NOCASE',
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): CodeSymbolHitRow[] {
    const wsFilter = workspaceRoot ? 'AND cs.workspace_root = ?' : '';
    const sql = `
      SELECT ${EXACT_NAME_COLUMNS}
      FROM code_symbols cs
      WHERE cs.symbol_name = ? ${collation}
      ${wsFilter}
      ORDER BY cs.file_path ASC, cs.rowid ASC
      LIMIT ?
    `;
    const params: unknown[] = [query];
    if (workspaceRoot) params.push(workspaceRoot);
    params.push(limit);
    return this.connection.db.prepare(sql).all(...params) as CodeSymbolHitRow[];
  }

  /**
   * Case-insensitive fallback for a query with non-ASCII characters. SQLite's
   * `NOCASE` folds only ASCII, so the comparison runs in JS with
   * `String.prototype.toLowerCase()`: the Unicode default lowercase mapping,
   * independent of the host locale. `Äpfel` matches `äpfel` and `ẞ` matches
   * `ß`, but there is no full case folding: `STRASSE` does not match `straße`,
   * `İ` lowers to `i` + U+0307 so `İndex` does not match `index`, and `I`
   * always lowers to `i`, never Turkish `ı`.
   *
   * SQL narrows the candidates by character length first. Lowercasing never
   * shortens a string and only U+0130 (`İ`) lengthens, by one, so a matching
   * name has between `L - d` and `L` characters, where `L` is the length of the
   * lowered query and `d` the number of `i` + U+0307 pairs in it. The scan
   * streams only rowid and name in file-path order and stops after `limit`
   * matches; full rows are fetched for the matched rowids alone. The scan is
   * still O(workspace) on a miss; an indexed lowercase-key column would make
   * it a lookup.
   */
  private foldedNameSymbols(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): CodeSymbolHitRow[] {
    const folded = query.toLowerCase();
    const foldedLength = [...folded].length;
    const dottedI = folded.split('i̇').length - 1;
    const wsFilter = workspaceRoot ? 'AND cs.workspace_root = ?' : '';
    const scanSql = `
      SELECT cs.rowid AS rowid, cs.symbol_name AS symbol_name
      FROM code_symbols cs
      WHERE length(cs.symbol_name) BETWEEN ? AND ?
      ${wsFilter}
      ORDER BY cs.file_path ASC, cs.rowid ASC
    `;
    const params: unknown[] = [foldedLength - dottedI, foldedLength];
    if (workspaceRoot) params.push(workspaceRoot);
    const matchedRowids: number[] = [];
    for (const row of this.connection.db.prepare(scanSql).iterate(...params)) {
      const candidate = row as { rowid: number; symbol_name: string };
      if (candidate.symbol_name.toLowerCase() !== folded) continue;
      matchedRowids.push(candidate.rowid);
      if (matchedRowids.length >= limit) break;
    }
    if (matchedRowids.length === 0) return [];
    const placeholders = matchedRowids.map(() => '?').join(',');
    return this.connection.db
      .prepare(
        `SELECT ${EXACT_NAME_COLUMNS}
         FROM code_symbols cs
         WHERE cs.rowid IN (${placeholders})
         ORDER BY cs.file_path ASC, cs.rowid ASC`,
      )
      .all(...matchedRowids) as CodeSymbolHitRow[];
  }

  private bm25SearchSymbols(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): CodeSymbolHitRow[] {
    const wsFilter = workspaceRoot ? 'AND cs.workspace_root = ?' : '';
    const sql = `
      SELECT cs.rowid AS rowid, cs.id AS id, cs.workspace_root AS workspace_root,
             cs.file_path AS file_path, cs.kind AS kind, cs.symbol_name AS symbol_name,
             cs.subject AS subject, cs.text AS text, cs.token_count AS token_count
      FROM code_symbols_fts fts
      JOIN code_symbols cs ON cs.rowid = fts.rowid
      WHERE code_symbols_fts MATCH ?
      ${wsFilter}
      ORDER BY bm25(code_symbols_fts) ASC
      LIMIT ?
    `;
    const plan = buildFtsQueryPlan(query);
    const run = (match: string): CodeSymbolHitRow[] => {
      const params: unknown[] = [match];
      if (workspaceRoot) params.push(workspaceRoot);
      params.push(limit);
      return this.connection.db
        .prepare(sql)
        .all(...params) as CodeSymbolHitRow[];
    };
    try {
      return executeFtsQueryPlan(plan, limit, run, (row) => row.rowid);
    } catch (err: unknown) {
      this.logger.warn('[code-symbol-store] BM25 search failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async vecSearchSymbols(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): Promise<CodeSymbolHitRow[]> {
    const [vec] = await this.embedder.embed([query]);
    if (!vec || vec.length !== this.embedder.dim) return [];
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const distRows = this.connection.db
      .prepare(
        `SELECT rowid AS rowid, distance AS distance FROM code_symbols_vec
         WHERE embedding MATCH ? ORDER BY distance ASC LIMIT ?`,
      )
      .all(buf, limit) as CodeVecRow[];
    if (distRows.length === 0) return [];
    const placeholders = distRows.map(() => '?').join(',');
    const wsFilter = workspaceRoot ? 'AND cs.workspace_root = ?' : '';
    const sql = `
      SELECT cs.rowid AS rowid, cs.id AS id, cs.workspace_root AS workspace_root,
             cs.file_path AS file_path, cs.kind AS kind, cs.symbol_name AS symbol_name,
             cs.subject AS subject, cs.text AS text, cs.token_count AS token_count
      FROM code_symbols cs
      WHERE cs.rowid IN (${placeholders})
      ${wsFilter}
    `;
    const params: unknown[] = distRows.map((r) => r.rowid);
    if (workspaceRoot) params.push(workspaceRoot);
    const rows = this.connection.db
      .prepare(sql)
      .all(...params) as CodeSymbolHitRow[];
    const byRowid = new Map(rows.map((r) => [r.rowid, r]));
    const out: CodeSymbolHitRow[] = [];
    for (const v of distRows) {
      const row = byRowid.get(v.rowid);
      if (row) out.push(row);
    }
    return out;
  }

  /** Reciprocal Rank Fusion over the exact-name, BM25 and vector result lists, keyed by rowid. */
  private rrfFuseSymbols(
    exact: readonly CodeSymbolHitRow[],
    bm25: readonly CodeSymbolHitRow[],
    vec: readonly CodeSymbolHitRow[],
    limit: number,
    weights: { exact: number; bm25: number; vec: number },
  ): Array<{ row: CodeSymbolHitRow; score: number }> {
    const k = CODE_RRF_K;
    const acc = new Map<number, { row: CodeSymbolHitRow; score: number }>();
    const add = (list: readonly CodeSymbolHitRow[], weight: number): void => {
      list.forEach((row, idx) => {
        const contribution = weight / (k + idx + 1);
        const existing = acc.get(row.rowid);
        if (existing) existing.score += contribution;
        else acc.set(row.rowid, { row, score: contribution });
      });
    };
    add(exact, weights.exact);
    add(bm25, weights.bm25);
    add(vec, weights.vec);
    return Array.from(acc.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  purgeJunk(workspaceRoot?: string | null): number {
    const junkSegments = [
      '/.angular/',
      '/.cache/',
      '/.next/',
      '/.nx/',
      '/.output/',
      '/.turbo/',
      '/.vite/',
      '/.vscode-test/',
      '/build/',
      '/coverage/',
      '/dist/',
      '/node_modules/',
      '/out/',
      '/target/',
      '/tmp/',
    ];
    const db = this.connection.db;
    const vecAvailable = this.reconcileOrphanVecRows();
    const clause = workspaceClause(workspaceRoot);
    const where = `file_path LIKE ? ESCAPE '\\'${
      clause.sql ? ` AND ${clause.sql}` : ''
    }`;
    const selectRowidsStmt = vecAvailable
      ? db.prepare(`SELECT rowid AS rowid FROM code_symbols WHERE ${where}`)
      : null;
    const deleteVecStmt = vecAvailable
      ? db.prepare(`DELETE FROM code_symbols_vec WHERE rowid = ?`)
      : null;
    const deleteSymbolsStmt = db.prepare(
      `DELETE FROM code_symbols WHERE ${where}`,
    );
    const patterns = junkSegments.map((segment) => {
      const escaped = segment
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      return `%${escaped}%`;
    });
    type Payload = { readonly patterns: readonly string[] };
    const txnFn = ((payload: Payload): number => {
      let totalDeleted = 0;
      for (const pattern of payload.patterns) {
        if (selectRowidsStmt && deleteVecStmt) {
          const ids = selectRowidsStmt.all(pattern, ...clause.values) as Array<{
            rowid: number;
          }>;
          for (const id of ids) {
            deleteVecStmt.run(id.rowid);
          }
        }
        const removed = deleteSymbolsStmt.run(pattern, ...clause.values);
        totalDeleted += removed.changes;
      }
      if (!vecAvailable && totalDeleted > 0) this.markVecStale();
      return totalDeleted;
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as (p: Payload) => number;
    try {
      return txn({ patterns });
    } catch (err: unknown) {
      this.connection.handleFatalWriteError(err);
      throw err;
    }
  }

  purgeWorkspace(workspaceRoot: string): number {
    const db = this.connection.db;
    const vecAvailable = this.reconcileOrphanVecRows();
    const selectRowidsStmt = vecAvailable
      ? db.prepare(
          `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ?`,
        )
      : null;
    const deleteVecStmt = vecAvailable
      ? db.prepare(`DELETE FROM code_symbols_vec WHERE rowid = ?`)
      : null;
    const deleteSymbolsStmt = db.prepare(
      `DELETE FROM code_symbols WHERE workspace_root = ?`,
    );
    type Payload = { readonly workspaceRoot: string };
    const txnFn = ((payload: Payload): number => {
      if (selectRowidsStmt && deleteVecStmt) {
        const ids = selectRowidsStmt.all(payload.workspaceRoot) as Array<{
          rowid: number;
        }>;
        for (const id of ids) {
          deleteVecStmt.run(id.rowid);
        }
      }
      const removed = deleteSymbolsStmt.run(payload.workspaceRoot);
      if (!vecAvailable && removed.changes > 0) this.markVecStale();
      return removed.changes;
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as (p: Payload) => number;
    try {
      return txn({ workspaceRoot });
    } catch (err: unknown) {
      this.connection.handleFatalWriteError(err);
      throw err;
    }
  }

  private async embedderEmbed(
    texts: readonly string[],
  ): Promise<Float32Array[]> {
    try {
      return await this.embedder.embed(texts);
    } catch (err) {
      if (!this.embedderWarnedOnce) {
        this.embedderWarnedOnce = true;
        this.logger.warn(
          '[code-symbol-store] embedder unavailable; symbols will be stored without vectors until restart',
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      return [];
    }
  }
}
