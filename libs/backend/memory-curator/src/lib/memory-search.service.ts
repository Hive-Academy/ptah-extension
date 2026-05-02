/**
 * MemorySearchService — hybrid BM25 (FTS5) + vector (sqlite-vec) search
 * with Reciprocal Rank Fusion (RRF, k=60). Falls back to BM25-only when
 * sqlite-vec is unavailable.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
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

const RRF_K = 60;

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
export class MemorySearchService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
  ) {}

  async search(query: string, topK = 10): Promise<MemorySearchResponse> {
    const limit = Math.max(1, Math.min(50, topK));
    const trimmed = query.trim();
    if (!trimmed)
      return { hits: [], bm25Only: !this.connection.vecExtensionLoaded };

    const bm25Rows = this.bm25Search(trimmed, limit * 4);
    let vecRows: Array<FtsRow & { distance: number }> = [];
    let bm25Only = !this.connection.vecExtensionLoaded;
    if (!bm25Only) {
      try {
        vecRows = await this.vecSearch(trimmed, limit * 4);
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

    const fused = this.rrfFuse(bm25Rows, vecRows, limit);
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
      // Update hit counter as a side effect — improves future salience.
      try {
        this.store.recordHit(memory.id);
      } catch {
        /* ignore — store may be a stub in tests */
      }
    }
    return { hits, bm25Only };
  }

  private bm25Search(query: string, limit: number): FtsRow[] {
    const sql = `
      SELECT mc.rowid AS rowid, mc.id AS chunk_id, mc.memory_id AS memory_id,
             mc.ord AS ord, mc.text AS text, mc.token_count AS token_count,
             mc.created_at AS created_at
      FROM memory_chunks_fts fts
      JOIN memory_chunks mc ON mc.rowid = fts.rowid
      WHERE memory_chunks_fts MATCH ?
      ORDER BY bm25(memory_chunks_fts) ASC
      LIMIT ?
    `;
    try {
      return this.connection.db
        .prepare(sql)
        .all(this.escapeFtsQuery(query), limit) as FtsRow[];
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
    const sql = `
      SELECT mc.rowid AS rowid, mc.id AS chunk_id, mc.memory_id AS memory_id,
             mc.ord AS ord, mc.text AS text, mc.token_count AS token_count,
             mc.created_at AS created_at
      FROM memory_chunks mc
      WHERE mc.rowid IN (${placeholders})
    `;
    const rowids = distRows.map((r) => r.rowid);
    const chunkRows = this.connection.db
      .prepare(sql)
      .all(...rowids) as FtsRow[];
    const byRowid = new Map(chunkRows.map((r) => [r.rowid, r]));
    const out: Array<FtsRow & { distance: number }> = [];
    for (const v of distRows) {
      const row = byRowid.get(v.rowid);
      if (row) out.push({ ...row, distance: v.distance });
    }
    return out;
  }

  private rrfFuse(
    bm25: readonly FtsRow[],
    vec: readonly (FtsRow & { distance: number })[],
    limit: number,
  ): Array<{
    row: FtsRow;
    score: number;
    bm25Rank: number | null;
    vecRank: number | null;
  }> {
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
        score: 1 / (RRF_K + rank),
        bm25Rank: rank,
        vecRank: null,
      });
    });
    vec.forEach((row, idx) => {
      const rank = idx + 1;
      const existing = acc.get(row.rowid);
      if (existing) {
        existing.score += 1 / (RRF_K + rank);
        existing.vecRank = rank;
      } else {
        acc.set(row.rowid, {
          row,
          score: 1 / (RRF_K + rank),
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

  private escapeFtsQuery(q: string): string {
    // Strip FTS5 special characters; wrap multi-token query in OR.
    const tokens = q
      .replace(/["'()]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t.replace(/"/g, '')}"`);
    if (tokens.length === 0)
      return `"${q.replace(/["'()]/g, ' ').trim() || 'memory'}"`;
    return tokens.join(' OR ');
  }
}
