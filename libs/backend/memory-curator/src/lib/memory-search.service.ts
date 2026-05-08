/**
 * MemorySearchService — hybrid BM25 (FTS5) + vector (sqlite-vec) search
 * with Reciprocal Rank Fusion (RRF). Falls back to BM25-only when
 * sqlite-vec is unavailable. Results are cached in an LRU cache keyed by
 * query + workspaceRoot + write-counter so stale entries are auto-evicted
 * on any write to the memory store.
 */
import { LRUCache } from 'lru-cache';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  type IMemoryReader,
  type MemoryHitPage,
} from '@ptah-extension/memory-contracts';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from './di/tokens';
import type { MemoryStore } from './memory.store';
import {
  chunkId,
  memoryId,
  type MemorySearchHit,
  type MemorySearchResponse,
} from './memory.types';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';

/** Default k for RRF — lowered from 60 to 25 for tighter ranking at memory scales of 100-5000 chunks. */
const RRF_K_DEFAULT = 25;

interface FtsRow {
  rowid: number;
  chunk_id: string;
  memory_id: string;
  ord: number;
  text: string;
  token_count: number;
  created_at: number;
}

interface VecRow {
  rowid: number;
  distance: number;
}

@injectable()
export class MemorySearchService implements IMemoryReader {
  /** LRU result cache — keyed by `${query}|${workspaceRoot}|${writeCounter}`. */
  private readonly cache = new LRUCache<string, MemorySearchResponse>({
    max: 100,
    ttl: 60_000,
  });

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
  ) {}

  /**
   * Build the LRU cache key. Embeds the write-counter so cached entries
   * from before a store write are never returned after it.
   */
  private makeCacheKey(
    normalizedQuery: string,
    workspaceRoot: string | undefined,
  ): string {
    const ws = workspaceRoot ?? '';
    const counter = this.store.getWriteCounter(ws);
    return `${normalizedQuery}|${ws}|${counter}`;
  }

  async search(
    query: string,
    topK = 10,
    workspaceRoot?: string,
  ): Promise<MemoryHitPage> {
    const rich = await this.searchRich(query, topK, workspaceRoot);
    return {
      hits: rich.hits.map((h) => ({
        memoryId: h.memory.id as string,
        subject: h.memory.subject,
        content: h.memory.content,
        chunkText: h.chunk.text,
        score: h.score,
        tier: h.memory.tier,
      })),
      bm25Only: rich.bm25Only,
    };
  }

  async searchRich(
    query: string,
    topK = 10,
    workspaceRoot?: string,
  ): Promise<MemorySearchResponse> {
    const limit = Math.max(1, Math.min(50, topK));
    const trimmed = query.trim();
    if (!trimmed)
      return { hits: [], bm25Only: !this.connection.vecExtensionLoaded };

    // R3: LRU cache — short-circuit the full pipeline on repeated identical queries.
    const cacheKey = this.makeCacheKey(trimmed, workspaceRoot);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug('[memory-curator] cache hit', { query: trimmed });
      return cached;
    }

    const bm25Rows = this.bm25Search(trimmed, limit * 4, workspaceRoot);
    let vecRows: Array<FtsRow & { distance: number }> = [];
    let bm25Only = !this.connection.vecExtensionLoaded;
    if (!bm25Only) {
      try {
        vecRows = await this.vecSearch(trimmed, limit * 4, workspaceRoot);
      } catch (err) {
        this.logger.warn(
          '[memory-curator] vec search failed; falling back to BM25',
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
        bm25Only = true;
      }
    }

    // R5: Token-count-based weight heuristic.
    // Short queries (< 4 tokens) favour exact BM25 term matching;
    // longer queries with context favour semantic vector similarity.
    const tokenCount = trimmed.split(/\s+/).filter((t) => t.length > 0).length;
    const bm25Weight = tokenCount < 4 ? 0.6 : 0.3;
    const weights = { bm25: bm25Weight, vec: 1 - bm25Weight };

    // R1: Reranker — skip if too few candidates, fall back to RRF order on error.
    // EmbedderWorkerClient is registered as the concrete impl under EMBEDDER;
    // cast once here instead of widening IEmbedder (VS Code + CLI environments
    // may use a non-worker embedder that has no rerank capability).
    //
    // Pass limit * 4 to rrfFuse so the reranker receives 4× the final topK as
    // candidates, then slice back to limit after reranking. Previously rrfFuse
    // was called with `limit`, which sliced the fused list to topK immediately
    // and made the subsequent .slice(0, limit * 4) a no-op (Critical R1 fix).
    let fused = this.rrfFuse(bm25Rows, vecRows, limit * 4, { k: 25, weights });
    if (fused.length >= 5) {
      const workerClient = this.workerClient;
      if (workerClient !== null) {
        try {
          // Cap candidate text at 512 chars before sending to the worker to
          // guard against OOM on unexpectedly large chunks (F-L3 defense-in-depth).
          const MAX_CANDIDATE_CHARS = 512;
          const rerankInput = fused.slice(0, limit * 4).map((e) => ({
            id: String(e.row.rowid),
            text:
              e.row.text.length > MAX_CANDIDATE_CHARS
                ? e.row.text.slice(0, MAX_CANDIDATE_CHARS)
                : e.row.text,
          }));
          const ranked = await workerClient.rerank(trimmed, rerankInput, limit);
          const byId = new Map(fused.map((e) => [String(e.row.rowid), e]));
          const reranked = ranked
            .map((r) => byId.get(r.id))
            .filter((e): e is NonNullable<typeof e> => e !== undefined);
          if (reranked.length > 0) {
            fused = reranked;
          }
        } catch (err: unknown) {
          this.logger.warn(
            '[memory-curator] reranker failed; using RRF order',
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
          // fused unchanged — fall through with RRF order
        }
      }
    }

    const hits: MemorySearchHit[] = [];
    for (const entry of fused) {
      const memory = this.lookupMemory(entry.row.memory_id);
      if (!memory) continue;
      hits.push({
        memory,
        chunk: {
          id: chunkId(entry.row.chunk_id),
          memoryId: memoryId(entry.row.memory_id),
          ord: entry.row.ord,
          text: entry.row.text,
          tokenCount: entry.row.token_count,
          createdAt: entry.row.created_at,
        },
        score: entry.score,
        bm25Rank: entry.bm25Rank,
        vecRank: entry.vecRank,
      });
      try {
        this.store.recordHit(memory.id);
      } catch {
        /* ignore — store may be a stub in tests */
      }
    }

    const response: MemorySearchResponse = { hits, bm25Only };
    this.cache.set(cacheKey, response);
    return response;
  }

  /**
   * Returns the concrete EmbedderWorkerClient when the injected embedder is
   * one, or null in environments (VS Code extension, unit tests) where a
   * non-worker embedder is used. Keeps IEmbedder narrow — rerank/warmup are
   * EmbedderWorkerClient-specific capabilities.
   */
  private get workerClient(): EmbedderWorkerClient | null {
    return this.embedder instanceof EmbedderWorkerClient ? this.embedder : null;
  }

  private bm25Search(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): FtsRow[] {
    const workspaceFilter = workspaceRoot
      ? 'AND (mc.workspace_root IS NULL OR mc.workspace_root = ?)'
      : '';
    const sql = `
      SELECT mc.rowid AS rowid, mc.id AS chunk_id, mc.memory_id AS memory_id,
             mc.ord AS ord, mc.text AS text, mc.token_count AS token_count,
             mc.created_at AS created_at
      FROM memory_chunks_fts fts
      JOIN memory_chunks mc ON mc.rowid = fts.rowid
      WHERE memory_chunks_fts MATCH ?
      ${workspaceFilter}
      ORDER BY bm25(memory_chunks_fts) ASC
      LIMIT ?
    `;
    const params: unknown[] = [this.escapeFtsQuery(query)];
    if (workspaceRoot) params.push(workspaceRoot);
    params.push(limit);
    try {
      return this.connection.db.prepare(sql).all(...params) as FtsRow[];
    } catch (err) {
      this.logger.warn('[memory-curator] BM25 search failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async vecSearch(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): Promise<Array<FtsRow & { distance: number }>> {
    const [vec] = await this.embedder.embed([query]);
    if (!vec || vec.length !== this.embedder.dim) return [];
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const distRows = this.connection.db
      .prepare(
        `SELECT rowid AS rowid, distance AS distance FROM memory_chunks_vec
         WHERE embedding MATCH ? ORDER BY distance ASC LIMIT ?`,
      )
      .all(buf, limit) as VecRow[];
    if (distRows.length === 0) return [];
    const placeholders = distRows.map(() => '?').join(',');
    const workspaceFilter = workspaceRoot
      ? 'AND (mc.workspace_root IS NULL OR mc.workspace_root = ?)'
      : '';
    const sql = `
      SELECT mc.rowid AS rowid, mc.id AS chunk_id, mc.memory_id AS memory_id,
             mc.ord AS ord, mc.text AS text, mc.token_count AS token_count,
             mc.created_at AS created_at
      FROM memory_chunks mc
      JOIN memories m ON m.id = mc.memory_id
      WHERE mc.rowid IN (${placeholders})
      ${workspaceFilter}
    `;
    const rowids = distRows.map((r) => r.rowid);
    const params: unknown[] = [...rowids];
    if (workspaceRoot) params.push(workspaceRoot);
    const chunkRows = this.connection.db
      .prepare(sql)
      .all(...params) as FtsRow[];
    const byRowid = new Map(chunkRows.map((r) => [r.rowid, r]));
    const out: Array<FtsRow & { distance: number }> = [];
    for (const v of distRows) {
      const row = byRowid.get(v.rowid);
      if (row) out.push({ ...row, distance: v.distance });
    }
    return out;
  }

  /**
   * Reciprocal Rank Fusion over BM25 and vector result lists.
   * Pure function: no side-effects, no logger calls.
   *
   * @param opts.k - Ranking smoothing constant (default 25). Lower values
   *   preserve more differentiation between top and bottom ranks.
   * @param opts.weights - Per-source weights summing to 1.0 (default 0.5/0.5).
   *   `searchRich` computes these from query token count before calling.
   */
  private rrfFuse(
    bm25: readonly FtsRow[],
    vec: readonly (FtsRow & { distance: number })[],
    limit: number,
    opts: { k?: number; weights?: { bm25: number; vec: number } } = {},
  ): Array<{
    row: FtsRow;
    score: number;
    bm25Rank: number | null;
    vecRank: number | null;
  }> {
    const k = opts.k ?? RRF_K_DEFAULT;
    const w = opts.weights ?? { bm25: 0.5, vec: 0.5 };

    const acc = new Map<
      number,
      {
        row: FtsRow;
        score: number;
        bm25Rank: number | null;
        vecRank: number | null;
      }
    >();
    bm25.forEach((row, idx) => {
      const rank = idx + 1;
      acc.set(row.rowid, {
        row,
        score: w.bm25 / (k + rank),
        bm25Rank: rank,
        vecRank: null,
      });
    });
    vec.forEach((row, idx) => {
      const rank = idx + 1;
      const existing = acc.get(row.rowid);
      if (existing) {
        existing.score += w.vec / (k + rank);
        existing.vecRank = rank;
      } else {
        acc.set(row.rowid, {
          row,
          score: w.vec / (k + rank),
          bm25Rank: null,
          vecRank: rank,
        });
      }
    });
    return Array.from(acc.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private lookupMemory(id: string) {
    return this.store.getById(memoryId(id));
  }

  /**
   * Build an FTS5 MATCH expression from raw user query text.
   *
   * - Strips ALL FTS5 metacharacters so user input cannot break out of the
   *   query expression or trigger column-qualifier injection:
   *     " * ( ) ^ : + - ~
   * - FTS5 boolean keywords (NEAR AND OR NOT) are neutralised by wrapping
   *   each surviving token in double-quotes; the quoting turns them into
   *   literal phrase tokens. An explicit keyword-drop filter is added as
   *   defence-in-depth for any version where quoting behaviour might differ.
   * - Drops single-character tokens (low signal, high noise).
   * - Prefix-matches the LAST token: "<token>"* — accommodates partial words
   *   the user is mid-typing.
   * - Joins all tokens with OR for recall (RAG context injection prefers
   *   recall over precision; reranker handles precision in a later step).
   * - Empty-after-stripping -> returns '""' which won't match anything.
   *
   * Security: this is NOT classical SQL injection — the query is fed to
   * prepare().all() as a bound parameter. This strips FTS5-grammar-level
   * operators only (F-H1 from security review).
   */
  private escapeFtsQuery(rawQuery: string): string {
    /** FTS5 boolean keywords that must not survive into the final expression. */
    const FTS5_KEYWORDS = new Set(['near', 'and', 'or', 'not']);

    const tokens = rawQuery
      .toLowerCase()
      // Strip all FTS5 metacharacters: quotes, glob, parens, column-qualifier,
      // prefix-require/exclude, initial-token, proximity, tilde.
      .replace(/["*()^:+\-~]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      // Drop FTS5 boolean keywords (defence-in-depth — quoting already handles
      // them, but a future grammar change could re-expose them).
      .filter((t) => !FTS5_KEYWORDS.has(t));

    if (tokens.length === 0) return '""';

    return tokens
      .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
      .join(' OR ');
  }
}
