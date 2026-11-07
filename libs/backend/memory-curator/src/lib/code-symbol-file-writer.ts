import { ulid } from 'ulid';
import type {
  SqliteDatabase,
  SqliteStatement,
} from '@ptah-extension/persistence-sqlite';
import type { CodeSymbolInsert } from './code-symbol.store';

/**
 * Symbol rows written per transaction by `CodeSymbolStore.replaceFileSymbols`.
 *
 * better-sqlite3 runs on the host's main loop, and one row costs an insert,
 * its FTS trigger, and (with sqlite-vec) a rowid lookup plus a vec0 insert.
 * A 1 MB generated file can yield thousands of symbols, which in ONE
 * transaction is a main-loop block of hundreds of milliseconds. 200 rows keep
 * one transaction to a few milliseconds; nearly every source file fits in one.
 */
export const MAX_SYMBOL_ROWS_PER_TRANSACTION = 200;

/** Half-open `[start, end)` row ranges; always at least one (possibly empty). */
export function symbolWriteChunks(
  total: number,
  size: number = MAX_SYMBOL_ROWS_PER_TRANSACTION,
): Array<{ readonly start: number; readonly end: number }> {
  if (total <= 0) return [{ start: 0, end: 0 }];
  const chunks: Array<{ readonly start: number; readonly end: number }> = [];
  for (let start = 0; start < total; start += size) {
    chunks.push({ start, end: Math.min(start + size, total) });
  }
  return chunks;
}

export interface FileSymbolWriteTarget {
  readonly workspaceRoot: string;
  readonly filePath: string;
  /** `created_at` / `updated_at` of every row of this replace. */
  readonly now: number;
  readonly vecAvailable: boolean;
  /** Same order as the rows; empty when vec or the embedder is unavailable. */
  readonly embeddings: readonly Float32Array[];
  readonly embedderDim: number;
  /** Records a symbol change vec rows could not follow. */
  readonly markVecStale: () => void;
}

/**
 * The statements of one `replaceFileSymbols` call, prepared once and applied
 * per transaction. Callers own the transaction boundaries; each method here is
 * synchronous SQL meant to run inside one.
 */
export class FileSymbolWriter {
  private readonly selectRowids: SqliteStatement | null;
  private readonly deleteVec: SqliteStatement | null;
  private readonly insertVec: SqliteStatement | null;
  private readonly deleteSymbols: SqliteStatement;
  private readonly upsert: SqliteStatement;
  private readonly fetchRowid: SqliteStatement;

  constructor(
    db: SqliteDatabase,
    private readonly target: FileSymbolWriteTarget,
  ) {
    const vec = target.vecAvailable;
    this.selectRowids = vec
      ? db.prepare(
          `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
        )
      : null;
    this.deleteVec = vec
      ? db.prepare(`DELETE FROM code_symbols_vec WHERE rowid = ?`)
      : null;
    this.insertVec = vec
      ? db.prepare(
          `INSERT INTO code_symbols_vec(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)`,
        )
      : null;
    this.deleteSymbols = db.prepare(
      `DELETE FROM code_symbols WHERE workspace_root = ? AND file_path = ?`,
    );
    this.upsert = db.prepare(
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
    this.fetchRowid = db.prepare(
      `SELECT rowid AS rowid FROM code_symbols WHERE workspace_root = ? AND subject = ?`,
    );
  }

  /**
   * Delete every row of the file: vector rows by rowid first, then the symbol
   * rows (FTS follows the `code_symbols` triggers). Returns rows removed.
   */
  clearFile(): number {
    const { workspaceRoot, filePath } = this.target;
    if (this.selectRowids && this.deleteVec) {
      const oldRows = this.selectRowids.all(workspaceRoot, filePath) as Array<{
        rowid: number;
      }>;
      for (const old of oldRows) this.deleteVec.run(old.rowid);
    }
    return this.deleteSymbols.run(workspaceRoot, filePath).changes;
  }

  /** Upsert `rows[start, end)` with their embeddings. */
  insertRange(
    rows: readonly CodeSymbolInsert[],
    start: number,
    end: number,
  ): void {
    const { now, embeddings, embedderDim } = this.target;
    for (let i = start; i < end; i++) {
      const e = rows[i];
      this.upsert.run({
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
      const vec = embeddings[i];
      if (
        this.insertVec &&
        this.deleteVec &&
        vec &&
        vec.length === embedderDim
      ) {
        const row = this.fetchRowid.get(e.workspaceRoot, e.subject) as
          { rowid: number } | undefined;
        if (row) {
          // Drop a stale embedding if this rowid was reused while vec was
          // down (implicit rowid, no AUTOINCREMENT).
          this.deleteVec.run(row.rowid);
          this.insertVec.run(
            row.rowid,
            Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
          );
        }
      }
    }
  }

  /**
   * One transaction's worth: on the first chunk clear the file, then insert
   * `rows[start, end)`. Marks vec stale exactly when the single-transaction
   * replace did: vec down and some row removed or written.
   */
  writeChunk(
    rows: readonly CodeSymbolInsert[],
    start: number,
    end: number,
    clearFirst: boolean,
  ): void {
    const removed = clearFirst ? this.clearFile() : 0;
    if (!this.target.vecAvailable && (removed > 0 || end > start)) {
      this.target.markVecStale();
    }
    this.insertRange(rows, start, end);
  }
}
