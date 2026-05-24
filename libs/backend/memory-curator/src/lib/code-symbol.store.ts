import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';

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

@injectable()
export class CodeSymbolStore {
  private embedderWarnedOnce = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
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
    const vecAvailable = this.connection.vecExtensionLoaded;
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
