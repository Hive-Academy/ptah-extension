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
  type MemoryType,
} from './memory.types';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';
import { ObservationQueueStore } from './observation-queue.store';

export interface MemSearchIndexFilter {
  readonly query?: string;
  readonly topK?: number;
  readonly workspaceRoot?: string;
  readonly type?: readonly MemoryType[];
  readonly concepts?: readonly string[];
  readonly files?: readonly string[];
  readonly dateRange?: { readonly fromMs?: number; readonly toMs?: number };
}

export interface MemoryIndexRowOut {
  readonly id: string;
  readonly subject: string | null;
  readonly type: MemoryType;
  readonly concepts: readonly string[];
  readonly files: readonly string[];
  readonly capturedAt: number;
  readonly score: number;
  readonly workspaceRoot: string | null;
}

export interface MemSearchIndexResponse {
  readonly rows: readonly MemoryIndexRowOut[];
  readonly bm25Only: boolean;
}

export interface MemTimelineRequest {
  readonly anchorId: string;
  readonly before?: number;
  readonly after?: number;
  readonly workspaceRoot?: string;
}

export interface MemTimelineResponse {
  readonly rows: readonly MemoryIndexRowOut[];
  readonly anchorIndex: number;
}

export interface MemGetObservationsRequest {
  readonly ids: readonly string[];
  readonly includeQueueRows?: boolean;
}

export interface MemMemoryFullOut {
  readonly id: string;
  readonly subject: string | null;
  readonly content: string;
  readonly type: MemoryType;
  readonly request: string | null;
  readonly investigated: string | null;
  readonly learned: string | null;
  readonly completed: string | null;
  readonly nextSteps: string | null;
  readonly concepts: readonly string[];
  readonly files: readonly string[];
  readonly sessionId: string | null;
  readonly workspaceRoot: string | null;
  readonly capturedAt: number;
}

export interface MemObservationRowOut {
  readonly id: number;
  readonly kind: string;
  readonly toolName: string | null;
  readonly filePath: string | null;
  readonly capturedAt: number;
}

export interface MemGetObservationsResponse {
  readonly memories: readonly MemMemoryFullOut[];
  readonly observationsBySession: Readonly<
    Record<string, readonly MemObservationRowOut[]>
  >;
}

interface MemoryRowFull {
  id: string;
  session_id: string | null;
  workspace_root: string | null;
  subject: string | null;
  content: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  type: MemoryType | null;
  concepts_json: string | null;
  files_json: string | null;
  created_at: number;
}

interface MemoryRowCompact {
  id: string;
  workspace_root: string | null;
  subject: string | null;
  type: MemoryType | null;
  concepts_json: string | null;
  files_json: string | null;
  created_at: number;
}

const MEMORY_TYPES: readonly MemoryType[] = [
  'bugfix',
  'feature',
  'decision',
  'discovery',
  'refactor',
  'change',
];

function parseStringArrayJson(raw: string | null): readonly string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
  return [];
}

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

  /** LRU result cache for `searchIndex` — keyed by query + filter blob + ws + writeCounter. */
  private readonly indexCache = new LRUCache<string, MemSearchIndexResponse>({
    max: 100,
    ttl: 60_000,
  });

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
    @inject(MEMORY_TOKENS.OBSERVATION_QUEUE_STORE)
    private readonly observationQueue: ObservationQueueStore,
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

  /**
   * Build the LRU cache key for `searchIndex`. The filter blob is a stable
   * JSON projection so two semantically-equal filter objects collide.
   */
  private makeIndexCacheKey(filter: MemSearchIndexFilter): string {
    const ws = filter.workspaceRoot ?? '';
    const counter = this.store.getWriteCounter(ws);
    const filterBlob = JSON.stringify({
      q: (filter.query ?? '').trim().toLowerCase(),
      k: filter.topK ?? 0,
      t: filter.type ? [...filter.type].sort() : [],
      c: filter.concepts ? [...filter.concepts].sort() : [],
      f: filter.files ? [...filter.files].sort() : [],
      d: {
        f: filter.dateRange?.fromMs ?? null,
        t: filter.dateRange?.toMs ?? null,
      },
    });
    return `${ws}|${counter}|${filterBlob}`;
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
    const tokenCount = trimmed.split(/\s+/).filter((t) => t.length > 0).length;
    const bm25Weight = tokenCount < 4 ? 0.6 : 0.3;
    const weights = { bm25: bm25Weight, vec: 1 - bm25Weight };
    let fused = this.rrfFuse(bm25Rows, vecRows, limit * 4, { k: 25, weights });
    if (fused.length >= 5) {
      const workerClient = this.workerClient;
      if (workerClient !== null) {
        try {
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

      this.store.recordHit(memory.id);
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
    const workspaceFilter = workspaceRoot ? 'AND mc.workspace_root IS ?' : '';
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
    const workspaceFilter = workspaceRoot ? 'AND mc.workspace_root IS ?' : '';
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
      .replace(/["*()^:+\-~]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .filter((t) => !FTS5_KEYWORDS.has(t));

    if (tokens.length === 0) return '""';

    return tokens
      .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
      .join(' OR ');
  }

  /**
   * Progressive disclosure search: returns compact rows (NO `content`) so
   * caller can stage a follow-up `mem:getObservations` for the ids it wants
   * to materialize. When `filter.query` is empty, BM25/vec are skipped and
   * the result is a pure-filter listing ordered by salience.
   */
  async searchIndex(
    filter: MemSearchIndexFilter,
  ): Promise<MemSearchIndexResponse> {
    const trimmedQuery = (filter.query ?? '').trim();
    const cacheKey = this.makeIndexCacheKey(filter);
    const cached = this.indexCache.get(cacheKey);
    if (cached) return cached;

    const limit = Math.max(1, Math.min(100, filter.topK ?? 20));
    const workspaceRoot = filter.workspaceRoot;
    const vecLoaded = this.connection.vecExtensionLoaded;

    let response: MemSearchIndexResponse;

    if (trimmedQuery.length === 0) {
      const rows = this.listIndexRowsByFilter(filter, limit);
      response = { rows, bm25Only: true };
    } else {
      const bm25Rows = this.bm25SearchByMemory(
        trimmedQuery,
        limit * 4,
        workspaceRoot,
      );
      let vecRows: Array<{
        rowid: number;
        memory_id: string;
        distance: number;
      }> = [];
      let bm25Only = !vecLoaded;
      if (!bm25Only) {
        try {
          vecRows = await this.vecSearchByMemory(
            trimmedQuery,
            limit * 4,
            workspaceRoot,
          );
        } catch (err) {
          this.logger.warn(
            '[memory-curator] mem:searchIndex vec search failed; bm25-only',
            { error: err instanceof Error ? err.message : String(err) },
          );
          bm25Only = true;
        }
      }
      const fused = this.rrfFuseByMemory(bm25Rows, vecRows, limit * 4);
      const ids = fused.map((e) => e.memoryId);
      const memoryRows = this.fetchCompactRowsByIds(ids, filter);
      const byId = new Map(memoryRows.map((r) => [r.id, r]));
      const ranked: MemoryIndexRowOut[] = [];
      for (const entry of fused) {
        const row = byId.get(entry.memoryId);
        if (!row) continue;
        ranked.push({
          id: row.id,
          subject: row.subject,
          type: row.type ?? 'discovery',
          concepts: parseStringArrayJson(row.concepts_json),
          files: parseStringArrayJson(row.files_json),
          capturedAt: row.created_at,
          score: entry.score,
          workspaceRoot: row.workspace_root,
        });
        if (ranked.length >= limit) break;
      }
      response = { rows: ranked, bm25Only };
    }

    this.indexCache.set(cacheKey, response);
    return response;
  }

  /**
   * Timeline: `[...before.reverse(), anchor, ...after]` with
   * `anchorIndex = before.length`. Workspace-top → empty before;
   * workspace-bottom → empty after; anchor missing → empty rows.
   */
  timeline(req: MemTimelineRequest): MemTimelineResponse {
    const beforeLimit = Math.max(0, Math.min(50, req.before ?? 5));
    const afterLimit = Math.max(0, Math.min(50, req.after ?? 5));
    const db = this.connection.db;

    const anchorRow = db
      .prepare(
        `SELECT id, workspace_root, subject, type, concepts_json, files_json, created_at
         FROM memories WHERE id = ?`,
      )
      .get(req.anchorId) as MemoryRowCompact | undefined;
    if (!anchorRow) return { rows: [], anchorIndex: 0 };

    const workspaceRoot = req.workspaceRoot ?? anchorRow.workspace_root;
    const wsFilter = 'workspace_root IS ?';

    const beforeRows = db
      .prepare(
        `SELECT id, workspace_root, subject, type, concepts_json, files_json, created_at
         FROM memories WHERE ${wsFilter} AND created_at < ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(
        workspaceRoot,
        anchorRow.created_at,
        beforeLimit,
      ) as MemoryRowCompact[];

    const afterRows = db
      .prepare(
        `SELECT id, workspace_root, subject, type, concepts_json, files_json, created_at
         FROM memories WHERE ${wsFilter} AND created_at > ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(
        workspaceRoot,
        anchorRow.created_at,
        afterLimit,
      ) as MemoryRowCompact[];

    const rows: MemoryIndexRowOut[] = [];
    for (const r of beforeRows.slice().reverse()) {
      rows.push(this.compactRowToOut(r, 0));
    }
    rows.push(this.compactRowToOut(anchorRow, 1));
    for (const r of afterRows) rows.push(this.compactRowToOut(r, 0));
    return { rows, anchorIndex: beforeRows.length };
  }

  /**
   * Fetch full 5-field summaries for the requested ids plus the read-only
   * observation queue rows grouped by session. Does NOT mark observation
   * rows processed.
   */
  getObservations(req: MemGetObservationsRequest): MemGetObservationsResponse {
    const ids = req.ids.slice(0, 200);
    if (ids.length === 0) return { memories: [], observationsBySession: {} };

    const placeholders = ids.map(() => '?').join(',');
    const db = this.connection.db;
    const rows = db
      .prepare(
        `SELECT id, session_id, workspace_root, subject, content, type,
                request, investigated, learned, completed, next_steps,
                concepts_json, files_json, created_at
         FROM memories WHERE id IN (${placeholders})`,
      )
      .all(...ids) as MemoryRowFull[];

    const memories: MemMemoryFullOut[] = rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      content: r.content,
      type: r.type ?? 'discovery',
      request: r.request,
      investigated: r.investigated,
      learned: r.learned,
      completed: r.completed,
      nextSteps: r.next_steps,
      concepts: parseStringArrayJson(r.concepts_json),
      files: parseStringArrayJson(r.files_json),
      sessionId: r.session_id,
      workspaceRoot: r.workspace_root,
      capturedAt: r.created_at,
    }));

    const observationsBySession: Record<
      string,
      readonly MemObservationRowOut[]
    > = {};
    if (req.includeQueueRows !== false) {
      const seenSessions = new Set<string>();
      for (const r of rows) {
        if (!r.session_id || seenSessions.has(r.session_id)) continue;
        seenSessions.add(r.session_id);
        const queueRows = this.observationQueue.peekForSession(
          r.session_id,
          50,
        );
        observationsBySession[r.session_id] = queueRows.map((q) => ({
          id: q.id,
          kind: q.kind,
          toolName: q.toolName ?? null,
          filePath: q.filePath ?? null,
          capturedAt: q.capturedAt,
        }));
      }
    }

    return { memories, observationsBySession };
  }

  private compactRowToOut(
    row: MemoryRowCompact,
    score: number,
  ): MemoryIndexRowOut {
    return {
      id: row.id,
      subject: row.subject,
      type: row.type ?? 'discovery',
      concepts: parseStringArrayJson(row.concepts_json),
      files: parseStringArrayJson(row.files_json),
      capturedAt: row.created_at,
      score,
      workspaceRoot: row.workspace_root,
    };
  }

  private buildFilterClause(filter: MemSearchIndexFilter): {
    clause: string;
    params: unknown[];
  } {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.workspaceRoot !== undefined) {
      where.push('m.workspace_root IS ?');
      params.push(filter.workspaceRoot);
    }

    if (filter.type && filter.type.length > 0) {
      const validTypes = filter.type.filter((t) => MEMORY_TYPES.includes(t));
      if (validTypes.length > 0) {
        const ph = validTypes.map(() => '?').join(',');
        where.push(`m.type IN (${ph})`);
        params.push(...validTypes);
      }
    }

    if (filter.concepts && filter.concepts.length > 0) {
      for (const concept of filter.concepts) {
        if (typeof concept !== 'string' || concept.length === 0) continue;
        where.push(
          `EXISTS (SELECT 1 FROM json_each(m.concepts_json) WHERE json_each.value = ?)`,
        );
        params.push(concept);
      }
    }

    if (filter.files && filter.files.length > 0) {
      for (const file of filter.files) {
        if (typeof file !== 'string' || file.length === 0) continue;
        where.push(
          `EXISTS (SELECT 1 FROM json_each(m.files_json) WHERE json_each.value = ?)`,
        );
        params.push(file);
      }
    }

    if (filter.dateRange?.fromMs !== undefined) {
      where.push('m.created_at >= ?');
      params.push(filter.dateRange.fromMs);
    }
    if (filter.dateRange?.toMs !== undefined) {
      where.push('m.created_at <= ?');
      params.push(filter.dateRange.toMs);
    }

    return {
      clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      params,
    };
  }

  private listIndexRowsByFilter(
    filter: MemSearchIndexFilter,
    limit: number,
  ): readonly MemoryIndexRowOut[] {
    const { clause, params } = this.buildFilterClause(filter);
    const sql = `SELECT m.id, m.workspace_root, m.subject, m.type,
                        m.concepts_json, m.files_json, m.created_at
                 FROM memories m
                 ${clause}
                 ORDER BY m.salience DESC, m.last_used_at DESC
                 LIMIT ?`;
    try {
      const rows = this.connection.db
        .prepare(sql)
        .all(...params, limit) as MemoryRowCompact[];
      return rows.map((r) => this.compactRowToOut(r, 0));
    } catch (err) {
      this.logger.warn('[memory-curator] mem:searchIndex pure-filter failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private fetchCompactRowsByIds(
    ids: readonly string[],
    filter: MemSearchIndexFilter,
  ): readonly MemoryRowCompact[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const { clause, params } = this.buildFilterClause(filter);
    const idClause = clause === '' ? 'WHERE m.id IN' : 'AND m.id IN';
    const sql = `SELECT m.id, m.workspace_root, m.subject, m.type,
                        m.concepts_json, m.files_json, m.created_at
                 FROM memories m
                 ${clause}
                 ${idClause} (${placeholders})`;
    try {
      return this.connection.db
        .prepare(sql)
        .all(...params, ...ids) as MemoryRowCompact[];
    } catch (err) {
      this.logger.warn('[memory-curator] mem:searchIndex fetch failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private bm25SearchByMemory(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): Array<{ memory_id: string; rank: number }> {
    const wsJoin = workspaceRoot
      ? 'JOIN memories m ON m.id = mc.memory_id'
      : '';
    const wsFilter = workspaceRoot ? 'AND m.workspace_root IS ?' : '';
    const sql = `
      SELECT mc.memory_id AS memory_id, MIN(bm25(memory_chunks_fts)) AS rank
      FROM memory_chunks_fts fts
      JOIN memory_chunks mc ON mc.rowid = fts.rowid
      ${wsJoin}
      WHERE memory_chunks_fts MATCH ?
      ${wsFilter}
      GROUP BY mc.memory_id
      ORDER BY rank ASC
      LIMIT ?
    `;
    const params: unknown[] = [this.escapeFtsQuery(query)];
    if (workspaceRoot) params.push(workspaceRoot);
    params.push(limit);
    try {
      return this.connection.db.prepare(sql).all(...params) as Array<{
        memory_id: string;
        rank: number;
      }>;
    } catch (err) {
      this.logger.warn('[memory-curator] mem:searchIndex bm25 failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async vecSearchByMemory(
    query: string,
    limit: number,
    workspaceRoot?: string,
  ): Promise<Array<{ rowid: number; memory_id: string; distance: number }>> {
    const [vec] = await this.embedder.embed([query]);
    if (!vec || vec.length !== this.embedder.dim) return [];
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const distRows = this.connection.db
      .prepare(
        `SELECT rowid AS rowid, distance AS distance FROM memory_chunks_vec
         WHERE embedding MATCH ? ORDER BY distance ASC LIMIT ?`,
      )
      .all(buf, limit) as Array<{ rowid: number; distance: number }>;
    if (distRows.length === 0) return [];
    const placeholders = distRows.map(() => '?').join(',');
    const wsJoin = workspaceRoot
      ? 'JOIN memories m ON m.id = mc.memory_id'
      : '';
    const wsFilter = workspaceRoot ? 'AND m.workspace_root IS ?' : '';
    const sql = `
      SELECT mc.rowid AS rowid, mc.memory_id AS memory_id
      FROM memory_chunks mc
      ${wsJoin}
      WHERE mc.rowid IN (${placeholders})
      ${wsFilter}
    `;
    const params: unknown[] = distRows.map((r) => r.rowid);
    if (workspaceRoot) params.push(workspaceRoot);
    const chunkRows = this.connection.db.prepare(sql).all(...params) as Array<{
      rowid: number;
      memory_id: string;
    }>;
    const byRowid = new Map(chunkRows.map((r) => [r.rowid, r.memory_id]));
    const seen = new Set<string>();
    const out: Array<{ rowid: number; memory_id: string; distance: number }> =
      [];
    for (const v of distRows) {
      const mid = byRowid.get(v.rowid);
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      out.push({ rowid: v.rowid, memory_id: mid, distance: v.distance });
    }
    return out;
  }

  private rrfFuseByMemory(
    bm25: ReadonlyArray<{ memory_id: string; rank: number }>,
    vec: ReadonlyArray<{ memory_id: string; distance: number }>,
    limit: number,
  ): Array<{ memoryId: string; score: number }> {
    const k = 25;
    const acc = new Map<string, number>();
    bm25.forEach((row, idx) => {
      const rank = idx + 1;
      acc.set(row.memory_id, (acc.get(row.memory_id) ?? 0) + 0.5 / (k + rank));
    });
    vec.forEach((row, idx) => {
      const rank = idx + 1;
      acc.set(row.memory_id, (acc.get(row.memory_id) ?? 0) + 0.5 / (k + rank));
    });
    return Array.from(acc.entries())
      .map(([memoryId, score]) => ({ memoryId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
