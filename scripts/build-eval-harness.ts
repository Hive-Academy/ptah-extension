/**
 * build-eval-harness.ts — Standalone memory-retrieval evaluation script.
 *
 * Runs outside the Electron/extension DI container using better-sqlite3
 * directly so no activation bootstrap is needed.
 *
 * Usage:
 *   npx ts-node --project scripts/tsconfig.json scripts/build-eval-harness.ts --build
 *   npx ts-node --project scripts/tsconfig.json scripts/build-eval-harness.ts --evaluate
 *
 * Schema note: the ptah.sqlite DB does not have an `agent_runs` table in the
 * current schema (migrations 0001–0009). The harness uses a self-consistency
 * fallback: each memory_chunk's text becomes a query; the expected positives
 * are the IDs of all other chunks in the same memory. This tests whether
 * re-querying a stored chunk retrieves its sibling chunks — a meaningful
 * proxy for retrieval quality.
 *
 * If an `agent_runs` table is added in a future migration, replace the
 * fallback with real agent-run queries in buildEvalSet().
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';

// ── Output paths ──────────────────────────────────────────────────────────────

const EVAL_DIR = path.join(process.cwd(), '.ptah', 'eval');
const EVAL_SET_PATH = path.join(EVAL_DIR, 'memory-recall-v1.jsonl');
const RESULTS_DIR = path.join(EVAL_DIR, 'results');

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvalLine {
  /** Text of the sampled chunk — used as the search query. */
  query: string;
  /** IDs of sibling chunks in the same memory (the expected recall set). */
  positives: string[];
  /** Workspace root at memory creation time. */
  workspace_root: string | null;
  /** Source memory_id for traceability. */
  run_id: string;
  /** Creation timestamp of the sampled chunk (epoch ms). */
  created_at: number;
}

interface EvalResults {
  timestamp: string;
  queryCount: number;
  recall10: number;
  mrr10: number;
  pipeline: string;
  evalSetPath: string;
  perQuery: Array<{
    query: string;
    hitRanks: number[];
    recall: number;
    mrr: number;
  }>;
}

// ── SQLite row shapes ─────────────────────────────────────────────────────────

interface MemoryChunkRow {
  id: string;
  memory_id: string;
  ord: number;
  text: string;
  token_count: number;
  created_at: number;
}

interface MemoryRow {
  id: string;
  workspace_root: string | null;
}

interface FtsResultRow {
  chunk_id: string;
}

// ── DB path resolution ────────────────────────────────────────────────────────

function resolveDbPath(): string {
  const explicit = process.env['PTAH_DB_PATH'];
  if (explicit) return explicit;
  return path.join(os.homedir(), '.ptah', 'state', 'ptah.sqlite');
}

// ── --build ───────────────────────────────────────────────────────────────────

function buildEvalSet(): void {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(
      `[eval] DB not found at ${dbPath}. Run Ptah at least once to create it.`,
    );
    process.exit(1);
  }

  console.log(`[eval] Opening DB at ${dbPath} (readonly)`);
  const db = new Database(dbPath, { readonly: true });

  let lines: EvalLine[] = [];

  // Check for agent_runs table (future schema extension).
  const hasAgentRuns = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_runs'`,
    )
    .get();

  if (hasAgentRuns) {
    // Future path: extract real agent-run queries.
    console.log('[eval] agent_runs table found — using real agent-run data');
    lines = buildFromAgentRuns(db);
  } else {
    // Fallback: self-consistency eval from memory_chunks.
    console.log(
      '[eval] agent_runs table not found — falling back to memory_chunks self-consistency eval',
    );
    lines = buildFromMemoryChunks(db);
  }

  db.close();

  if (lines.length === 0) {
    console.warn(
      '[eval] No eval lines produced. Is the DB populated with memories?',
    );
  }

  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const jsonl = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(EVAL_SET_PATH, jsonl, 'utf8');
  console.log(`[eval] Wrote ${lines.length} eval lines to ${EVAL_SET_PATH}`);
}

/**
 * Build eval set from real agent runs (future path when agent_runs exists).
 * Each run contributes one EvalLine: first user message as query, injected
 * memory_chunk IDs as positives.
 */
function buildFromAgentRuns(db: Database.Database): EvalLine[] {
  // Placeholder for future schema — return empty to fall through gracefully.
  console.warn(
    '[eval] buildFromAgentRuns: schema not yet defined, returning empty set',
  );
  void db;
  return [];
}

/**
 * Self-consistency eval: for each memory that has 2+ chunks, take one chunk as
 * the query and the remaining chunk IDs as positives. This tests that searching
 * for one part of a memory retrieves the other parts.
 *
 * Sampling strategy: pick the chunk with ord=0 (the "lead" chunk) as the query.
 * Positives = all chunk IDs in the same memory where ord > 0.
 * Memories with only 1 chunk are skipped (no positives to measure).
 */
function buildFromMemoryChunks(db: Database.Database): EvalLine[] {
  // Get all memories that have at least 2 chunks.
  const memories = db
    .prepare(
      `SELECT m.id, m.workspace_root
         FROM memories m
         WHERE (SELECT COUNT(*) FROM memory_chunks mc WHERE mc.memory_id = m.id) >= 2
         ORDER BY m.created_at DESC
         LIMIT 500`,
    )
    .all() as MemoryRow[];

  const lines: EvalLine[] = [];

  for (const memory of memories) {
    const chunks = db
      .prepare(
        `SELECT id, memory_id, ord, text, token_count, created_at
           FROM memory_chunks
           WHERE memory_id = ?
           ORDER BY ord ASC`,
      )
      .all(memory.id) as MemoryChunkRow[];

    if (chunks.length < 2) continue;

    const queryChunk = chunks[0];
    if (!queryChunk) continue;

    const positives = chunks.slice(1).map((c) => c.id);

    if (positives.length === 0) continue;

    lines.push({
      query: queryChunk.text,
      positives,
      workspace_root: memory.workspace_root,
      run_id: memory.id,
      created_at: queryChunk.created_at,
    });
  }

  return lines;
}

// ── --evaluate ────────────────────────────────────────────────────────────────

/**
 * Run BM25 search for each query in the JSONL file and compute Recall@10 /
 * MRR@10. Does not require the embedder worker — BM25-only evaluation is
 * sufficient as a retrieval quality baseline.
 *
 * For vec (semantic) evaluation, boot the full Electron stack and run the
 * live MemorySearchService.
 */
function evaluate(): void {
  if (!fs.existsSync(EVAL_SET_PATH)) {
    console.error(
      `[eval] Eval set not found at ${EVAL_SET_PATH}. Run --build first.`,
    );
    process.exit(1);
  }

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`[eval] DB not found at ${dbPath}.`);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(EVAL_SET_PATH, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvalLine);

  if (lines.length === 0) {
    console.error('[eval] Eval set is empty. Run --build first.');
    process.exit(1);
  }

  console.log(`[eval] Opening DB at ${dbPath} (readonly)`);
  const db = new Database(dbPath, { readonly: true });

  const perQuery: EvalResults['perQuery'] = [];
  let totalRecall = 0;
  let totalMrr = 0;

  for (const line of lines) {
    const escaped = escapeFtsQuery(line.query);
    let results: FtsResultRow[] = [];
    try {
      results = db
        .prepare(
          `SELECT mc.id AS chunk_id
             FROM memory_chunks_fts fts
             JOIN memory_chunks mc ON mc.rowid = fts.rowid
             WHERE memory_chunks_fts MATCH ?
             ORDER BY bm25(memory_chunks_fts) ASC
             LIMIT 10`,
        )
        .all(escaped) as FtsResultRow[];
    } catch {
      // FTS table may not be populated; treat as no results.
    }

    const returnedIds = results.map((r) => r.chunk_id);
    const positiveSet = new Set(line.positives);

    const hitRanks: number[] = [];
    for (let rank = 1; rank <= returnedIds.length; rank++) {
      const id = returnedIds[rank - 1];
      if (id && positiveSet.has(id)) {
        hitRanks.push(rank);
      }
    }

    const recall = hitRanks.length > 0 ? 1 : 0;
    const mrr = hitRanks.length > 0 ? 1 / (hitRanks[0] as number) : 0;

    totalRecall += recall;
    totalMrr += mrr;

    perQuery.push({
      query: line.query.slice(0, 120),
      hitRanks,
      recall,
      mrr,
    });
  }

  db.close();

  const queryCount = lines.length;
  const recall10 = queryCount > 0 ? totalRecall / queryCount : 0;
  const mrr10 = queryCount > 0 ? totalMrr / queryCount : 0;

  const results: EvalResults = {
    timestamp: new Date().toISOString(),
    queryCount,
    recall10: Math.round(recall10 * 10000) / 10000,
    mrr10: Math.round(mrr10 * 10000) / 10000,
    pipeline: 'bm25-only',
    evalSetPath: EVAL_SET_PATH,
    perQuery,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(RESULTS_DIR, `${iso}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');

  console.log(`[eval] Results written to ${outPath}`);
  console.log(`[eval] queryCount=${queryCount}`);
  console.log(`[eval] Recall@10=${results.recall10}`);
  console.log(`[eval] MRR@10=${results.mrr10}`);
}

// ── FTS escape (mirrors MemorySearchService.escapeFtsQuery) ───────────────────

function escapeFtsQuery(q: string): string {
  const stripped = q.replace(/["*()^+\-]/g, ' ');
  const tokens = stripped.split(/\s+/).filter((t) => t.length > 1);

  if (tokens.length === 0) return '""';

  const escaped = tokens.map((t, i) => {
    const clean = t.replace(/"/g, '');
    if (i === tokens.length - 1) {
      return `"${clean}"*`;
    }
    return `"${clean}"`;
  });

  return escaped.join(' OR ');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--build')) {
  buildEvalSet();
} else if (args.includes('--evaluate')) {
  evaluate();
} else {
  console.error(
    'Usage: ts-node scripts/build-eval-harness.ts [--build | --evaluate]',
  );
  process.exit(1);
}
