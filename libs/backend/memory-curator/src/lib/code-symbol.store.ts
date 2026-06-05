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
  type CodeSymbolHit,
  type CodeSymbolHitPage,
} from '@ptah-extension/memory-contracts';
import { escapeFtsQuery } from './fts-query.util';

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

@injectable()
export class CodeSymbolStore implements ICodeSymbolReader {
  private embedderWarnedOnce = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
  ) {}

  deleteByFile(workspaceRoot: string, filePath: string): number {
    const result = this.connection.db
      .prepare(
        `DELETE FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
      )
      .run(workspaceRoot, filePath);
    return result.changes;
  }

  async insertBatch(entries: readonly CodeSymbolInsert[]): Promise<void> {
    if (entries.length === 0) return;
    const now = Date.now();
    const vecAvailable = this.vecStatus.available;
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
              | { rowid: number }
              | undefined;
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

  count(workspaceRoot?: string | null): number {
    const sql =
      workspaceRoot !== undefined && workspaceRoot !== null
        ? `SELECT COUNT(*) AS n FROM code_symbols WHERE workspace_root IS ?`
        : `SELECT COUNT(*) AS n FROM code_symbols`;
    const row =
      workspaceRoot !== undefined && workspaceRoot !== null
        ? (this.connection.db.prepare(sql).get(workspaceRoot) as
            | { n: number }
            | undefined)
        : (this.connection.db.prepare(sql).get() as { n: number } | undefined);
    return row?.n ?? 0;
  }

  /** Paginated search over code_symbols with optional workspace, name/path, and kind filters. */
  search(params: CodeSymbolSearchParams): CodeSymbolSearchResult {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (params.workspaceRoot !== undefined && params.workspaceRoot !== null) {
      clauses.push('workspace_root = ?');
      values.push(params.workspaceRoot);
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
      | { n: number }
      | undefined;
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
   * indexed symbols, fused with Reciprocal Rank Fusion. Falls back to BM25-only
   * when sqlite-vec is unavailable or the vector query fails. Returns `''`-safe
   * empty page on empty query.
   */
  async searchSymbols(
    query: string,
    topK = 10,
    workspaceRoot?: string,
  ): Promise<CodeSymbolHitPage> {
    const limit = Math.max(1, Math.min(50, topK));
    const trimmed = query.trim();
    if (!trimmed) return { hits: [], bm25Only: !this.vecStatus.available };

    const bm25Rows = this.bm25SearchSymbols(trimmed, limit * 4, workspaceRoot);
    let vecRows: CodeSymbolHitRow[] = [];
    let bm25Only = !this.vecStatus.available;
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
    const fused = this.rrfFuseSymbols(bm25Rows, vecRows, limit, {
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
    const params: unknown[] = [escapeFtsQuery(query)];
    if (workspaceRoot) params.push(workspaceRoot);
    params.push(limit);
    try {
      return this.connection.db
        .prepare(sql)
        .all(...params) as CodeSymbolHitRow[];
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

  /** Reciprocal Rank Fusion over BM25 and vector result lists, keyed by rowid. */
  private rrfFuseSymbols(
    bm25: readonly CodeSymbolHitRow[],
    vec: readonly CodeSymbolHitRow[],
    limit: number,
    weights: { bm25: number; vec: number },
  ): Array<{ row: CodeSymbolHitRow; score: number }> {
    const k = CODE_RRF_K;
    const acc = new Map<number, { row: CodeSymbolHitRow; score: number }>();
    bm25.forEach((row, idx) => {
      acc.set(row.rowid, {
        row,
        score: weights.bm25 / (k + idx + 1),
      });
    });
    vec.forEach((row, idx) => {
      const existing = acc.get(row.rowid);
      if (existing) existing.score += weights.vec / (k + idx + 1);
      else acc.set(row.rowid, { row, score: weights.vec / (k + idx + 1) });
    });
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
    let totalDeleted = 0;
    const sql =
      workspaceRoot !== undefined && workspaceRoot !== null
        ? `DELETE FROM code_symbols WHERE file_path LIKE ? ESCAPE '\\' AND workspace_root IS ?`
        : `DELETE FROM code_symbols WHERE file_path LIKE ? ESCAPE '\\'`;
    const stmt = this.connection.db.prepare(sql);
    for (const segment of junkSegments) {
      const escaped = segment
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const result =
        workspaceRoot !== undefined && workspaceRoot !== null
          ? stmt.run(`%${escaped}%`, workspaceRoot)
          : stmt.run(`%${escaped}%`);
      totalDeleted += result.changes;
    }
    return totalDeleted;
  }

  purgeWorkspace(workspaceRoot: string): number {
    const result = this.connection.db
      .prepare(`DELETE FROM code_symbols WHERE workspace_root = ?`)
      .run(workspaceRoot);
    return result.changes;
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
