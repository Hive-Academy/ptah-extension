import type { CuratorLogger, SqliteDbProvider } from './sqlite-reader-deps.types';

export interface VectorCandidate {
  readonly rowid: number;
  readonly distance: number;
}

/** Maximum KNN candidates inspected for a workspace search, regardless of DB size. */
export const MAX_SCOPED_VECTOR_CANDIDATES = 2048;

/** Bound on remembered scopes for the once-per-scope recall log. */
const MAX_REPORTED_SCOPES = 256;
const reportedCappedScopes = new Set<string>();

/**
 * Search the vec0 index first, then apply the relational workspace predicate.
 * Doubling k gives small workspaces a chance without a whole-table distance join.
 *
 * Recall trade-off: the KNN never inspects more than
 * {@link MAX_SCOPED_VECTOR_CANDIDATES} global neighbours. A workspace holding a
 * tiny share of the vectors can therefore get fewer than `limit` scoped rows,
 * or none. That is deliberate (the alternative is the full-table scan that
 * blocked the Electron main thread for seconds); the rows found are returned,
 * the shortfall is logged once per table and scope at debug, and hybrid callers
 * still fuse their BM25 rows, which this cap does not touch.
 */
export function scopedVectorCandidates(
  connection: Pick<SqliteDbProvider, 'db'>,
  table: 'memory_chunks_vec' | 'code_symbols_vec',
  embedding: Buffer,
  limit: number,
  joins: string,
  predicate: string,
  params: readonly unknown[],
  logger: Pick<CuratorLogger, 'debug'>,
): VectorCandidate[] {
  const target = Math.max(1, Math.min(limit, 100));
  const statement = connection.db.prepare(`
    WITH candidates AS MATERIALIZED (
      SELECT rowid, distance FROM ${table}
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    )
    SELECT candidates.rowid AS rowid, candidates.distance AS distance
    FROM candidates
    ${joins}
    WHERE ${predicate}
    ORDER BY candidates.distance ASC LIMIT ?
  `);
  let k = Math.min(MAX_SCOPED_VECTOR_CANDIDATES, Math.max(64, target * 4));
  for (;;) {
    const rows = statement.all(embedding, k, ...params, target) as VectorCandidate[];
    if (rows.length >= target) return rows;
    if (k === MAX_SCOPED_VECTOR_CANDIDATES) {
      reportCapReached(logger, table, params, rows.length, target);
      return rows;
    }
    k = Math.min(MAX_SCOPED_VECTOR_CANDIDATES, k * 2);
  }
}

function reportCapReached(
  logger: Pick<CuratorLogger, 'debug'>,
  table: string,
  params: readonly unknown[],
  found: number,
  requested: number,
): void {
  const scopeKey = JSON.stringify([table, ...params]);
  if (reportedCappedScopes.has(scopeKey)) return;
  if (reportedCappedScopes.size >= MAX_REPORTED_SCOPES) reportedCappedScopes.clear();
  reportedCappedScopes.add(scopeKey);
  logger.debug(
    '[memory-curator] scoped vector search reached its candidate cap; returning partial vector hits (lexical results are unaffected)',
    {
      table,
      scopedHits: found,
      requested,
      candidatesInspected: MAX_SCOPED_VECTOR_CANDIDATES,
    },
  );
}
