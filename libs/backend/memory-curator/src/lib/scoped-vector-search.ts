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
 *
 * vec0 KNN is a brute-force scan of the whole table whatever `k` is (`k` only
 * sizes the result heap), so this runs exactly ONE KNN pass at the cap and
 * post-filters it: widening `k` pass by pass would re-scan the table each time.
 *
 * Recall trade-off: the KNN never inspects more than
 * {@link MAX_SCOPED_VECTOR_CANDIDATES} global neighbours. A workspace holding a
 * tiny share of the vectors can therefore get fewer than `limit` scoped rows,
 * or none. That is deliberate (the alternative is the full-table scan that
 * blocked the Electron main thread for seconds); the rows found are returned,
 * the shortfall is logged once per table and scope at debug, and hybrid callers
 * still fuse their BM25 rows, which this cap does not touch. When the KNN
 * returns fewer than the cap the table is exhausted: every vector was
 * inspected, the answer is exact and nothing is logged.
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
  onCapped?: () => void,
): VectorCandidate[] {
  const target = Math.max(1, Math.min(limit, 100));
  // The outer LEFT JOIN always yields one row, so the inspected count is
  // known even when the predicate keeps nothing (that row has a null rowid).
  const statement = connection.db.prepare(`
    WITH candidates AS MATERIALIZED (
      SELECT rowid, distance FROM ${table}
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    ),
    scoped AS (
      SELECT candidates.rowid AS rowid, candidates.distance AS distance
      FROM candidates
      ${joins}
      WHERE ${predicate}
      ORDER BY candidates.distance ASC LIMIT ?
    )
    SELECT (SELECT COUNT(*) FROM candidates) AS inspected,
           scoped.rowid AS rowid, scoped.distance AS distance
    FROM (SELECT 1) AS anchor LEFT JOIN scoped ON 1 = 1
    ORDER BY scoped.distance ASC
  `);
  let inspected = 0;
  const rows: VectorCandidate[] = [];
  for (const raw of statement.all(embedding, MAX_SCOPED_VECTOR_CANDIDATES, ...params, target)) {
    const row = parseRow(raw);
    if (!row) continue;
    inspected = row.inspected;
    if (row.candidate) rows.push(row.candidate);
  }
  if (rows.length < target && inspected >= MAX_SCOPED_VECTOR_CANDIDATES) {
    reportCapReached(logger, table, params, rows.length, target);
    onCapped?.();
  }
  return rows;
}

interface ParsedRow {
  readonly inspected: number;
  readonly candidate: VectorCandidate | null;
}

function parseRow(raw: unknown): ParsedRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const inspected: unknown = Reflect.get(raw, 'inspected');
  const rowid: unknown = Reflect.get(raw, 'rowid');
  const distance: unknown = Reflect.get(raw, 'distance');
  if (typeof inspected !== 'number') return null;
  const id = typeof rowid === 'bigint' ? Number(rowid) : rowid;
  return {
    inspected,
    candidate:
      typeof id === 'number' && typeof distance === 'number' ? { rowid: id, distance } : null,
  };
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
