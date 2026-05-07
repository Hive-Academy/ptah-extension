/**
 * MemoryStore — typed CRUD over the `memories` and `memory_chunks` tables
 * (plus the `memory_chunks_fts` and `memory_chunks_vec` virtual tables).
 *
 * Uses better-sqlite3's synchronous API exposed by SqliteConnectionService.
 * When `vecExtensionLoaded` is false, vec0 inserts are skipped and search
 * gracefully degrades to BM25-only.
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  type IMemoryLister,
  type MemoryListPage,
} from '@ptah-extension/memory-contracts';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';
import {
  chunkId,
  memoryId,
  type ChunkInsert,
  type Memory,
  type MemoryChunk,
  type MemoryId,
  type MemoryInsert,
  type MemoryListResponse,
  type MemoryStatsResponse,
  type MemoryTier,
} from './memory.types';

interface MemoryRow {
  id: string;
  session_id: string | null;
  workspace_root: string | null;
  tier: MemoryTier;
  kind: Memory['kind'];
  subject: string | null;
  content: string;
  source_message_ids: string | null;
  salience: number;
  decay_rate: number;
  hits: number;
  pinned: number;
  created_at: number;
  updated_at: number;
  last_used_at: number;
  expires_at: number | null;
}

interface ChunkRow {
  id: string;
  memory_id: string;
  ord: number;
  text: string;
  token_count: number;
  created_at: number;
}

function rowToMemory(row: MemoryRow): Memory {
  let sourceMessageIds: readonly string[] = [];
  if (row.source_message_ids) {
    try {
      const parsed = JSON.parse(row.source_message_ids);
      if (Array.isArray(parsed))
        sourceMessageIds = parsed.filter((x) => typeof x === 'string');
    } catch {
      // ignore malformed JSON; treat as empty
    }
  }
  return {
    id: memoryId(row.id),
    sessionId: row.session_id,
    workspaceRoot: row.workspace_root,
    tier: row.tier,
    kind: row.kind,
    subject: row.subject,
    content: row.content,
    sourceMessageIds,
    salience: row.salience,
    decayRate: row.decay_rate,
    hits: row.hits,
    pinned: row.pinned !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

function rowToChunk(row: ChunkRow): MemoryChunk {
  return {
    id: chunkId(row.id),
    memoryId: memoryId(row.memory_id),
    ord: row.ord,
    text: row.text,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  };
}

@injectable()
export class MemoryStore implements IMemoryLister {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.EMBEDDER) private readonly embedder: IEmbedder,
  ) {}

  /** Insert a Memory + its chunks atomically. Embeddings are computed if vec is available. */
  async insertMemoryWithChunks(
    insert: MemoryInsert,
    chunks: readonly Omit<ChunkInsert, 'memoryId'>[],
  ): Promise<MemoryId> {
    const now = Date.now();
    const id = memoryId(ulid());
    const sourceJson = JSON.stringify(insert.sourceMessageIds ?? []);
    const memoryParams = {
      id,
      session_id: insert.sessionId ?? null,
      workspace_root: insert.workspaceRoot ?? null,
      tier: insert.tier,
      kind: insert.kind,
      subject: insert.subject ?? null,
      content: insert.content,
      source_message_ids: sourceJson,
      salience: insert.salience ?? 0,
      decay_rate: insert.decayRate ?? 0.01,
      hits: 0,
      pinned: insert.pinned ? 1 : 0,
      created_at: now,
      updated_at: now,
      last_used_at: now,
      expires_at: insert.expiresAt ?? null,
    };

    // Compute embeddings before opening tx (better-sqlite3 transactions are
    // synchronous and we cannot await inside).
    const vecAvailable = this.connection.vecExtensionLoaded;
    const embeddings: Float32Array[] =
      vecAvailable && chunks.length > 0
        ? await this.embedderEmbed(chunks.map((c) => c.text))
        : [];

    const db = this.connection.db;
    const insertMemoryStmt = db.prepare(
      `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
         source_message_ids, salience, decay_rate, hits, pinned,
         created_at, updated_at, last_used_at, expires_at)
       VALUES (@id, @session_id, @workspace_root, @tier, @kind, @subject, @content,
         @source_message_ids, @salience, @decay_rate, @hits, @pinned,
         @created_at, @updated_at, @last_used_at, @expires_at)`,
    );
    const insertChunkStmt = db.prepare(
      `INSERT INTO memory_chunks (id, memory_id, ord, text, token_count, created_at)
       VALUES (@id, @memory_id, @ord, @text, @token_count, @created_at)`,
    );
    const insertVecStmt = vecAvailable
      ? db.prepare(
          `INSERT INTO memory_chunks_vec(rowid, embedding) VALUES (?, ?)`,
        )
      : null;
    const fetchRowidStmt = db.prepare(
      `SELECT rowid AS rowid FROM memory_chunks WHERE id = ?`,
    );

    // better-sqlite3's `db.transaction()` is typed against a generic varargs
    // callback. Cast the typed inner function exactly once to a callable
    // matching that signature, then back to our typed wrapper — one cast in,
    // one cast out, instead of three chained `as unknown as`.
    type TxnFn = (m: typeof memoryParams) => MemoryId;
    const txnFn = ((m: typeof memoryParams): MemoryId => {
      insertMemoryStmt.run(m);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const cid = chunkId(ulid());
        insertChunkStmt.run({
          id: cid,
          memory_id: id,
          ord: c.ord,
          text: c.text,
          token_count: c.tokenCount,
          created_at: now,
        });
        if (insertVecStmt) {
          const vec = embeddings[i];
          if (vec && vec.length === this.embedder.dim) {
            const row = fetchRowidStmt.get(cid) as
              | { rowid: number }
              | undefined;
            if (row) {
              insertVecStmt.run(
                row.rowid,
                Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
              );
            }
          }
        }
      }
      return id;
    }) as unknown as (...args: unknown[]) => unknown;
    const txn = db.transaction(txnFn) as unknown as TxnFn;
    return txn(memoryParams);
  }

  private async embedderEmbed(
    texts: readonly string[],
  ): Promise<Float32Array[]> {
    try {
      return await this.embedder.embed(texts);
    } catch (err) {
      this.logger.warn(
        '[memory-curator] embedder.embed failed; chunks stored without vectors',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return [];
    }
  }

  getById(id: MemoryId): Memory | null {
    const stmt = this.connection.db.prepare(
      `SELECT * FROM memories WHERE id = ?`,
    );
    const row = stmt.get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  list(
    filter: {
      workspaceRoot?: string | null;
      tier?: MemoryTier;
      limit?: number;
      offset?: number;
    } = {},
  ): MemoryListResponse {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.workspaceRoot !== undefined) {
      where.push('workspace_root IS @workspace_root');
      params['workspace_root'] = filter.workspaceRoot;
    }
    if (filter.tier) {
      where.push('tier = @tier');
      params['tier'] = filter.tier;
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
    const offset = Math.max(0, filter.offset ?? 0);
    const totalRow = this.connection.db
      .prepare(`SELECT COUNT(*) AS n FROM memories ${whereSql}`)
      .get(params) as { n: number } | undefined;
    // Parameterize LIMIT/OFFSET — even though `limit` and `offset` are clamped
    // to safe integers above, parameterizing prevents any future caller from
    // accidentally re-introducing string interpolation as a refactor pattern.
    const rows = this.connection.db
      .prepare(
        `SELECT * FROM memories ${whereSql} ORDER BY salience DESC, last_used_at DESC LIMIT @__limit OFFSET @__offset`,
      )
      .all({ ...params, __limit: limit, __offset: offset }) as MemoryRow[];
    return {
      memories: rows.map(rowToMemory),
      total: totalRow?.n ?? rows.length,
    };
  }

  /**
   * IMemoryLister implementation — read-only list for cross-layer consumers.
   * Returns a page of memories with a total count for pagination, sorted by salience.
   */
  listAll(
    workspaceRoot?: string,
    tier?: string,
    limit = 50,
    offset = 0,
  ): MemoryListPage {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (workspaceRoot) {
      conditions.push('(workspace_root IS NULL OR workspace_root = ?)');
      params.push(workspaceRoot);
    }
    if (tier) {
      conditions.push('tier = ?');
      params.push(tier);
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const clampedLimit = Math.max(1, Math.min(500, limit));
    const clampedOffset = Math.max(0, offset);
    const rows = this.connection.db
      .prepare(
        `SELECT id, subject, content, tier, kind, salience, created_at FROM memories ${where} ORDER BY salience DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, clampedLimit, clampedOffset) as Array<{
      id: string;
      subject: string | null;
      content: string;
      tier: string;
      kind: string;
      salience: number;
      created_at: number;
    }>;
    const countRow = this.connection.db
      .prepare(`SELECT COUNT(*) as n FROM memories ${where}`)
      .get(...params) as { n: number } | undefined;
    return {
      memories: rows.map((r) => ({
        id: r.id,
        subject: r.subject,
        content: r.content,
        tier: r.tier,
        kind: r.kind,
        salience: r.salience,
        createdAt: r.created_at,
      })),
      total: countRow?.n ?? rows.length,
    };
  }

  getChunks(id: MemoryId): readonly MemoryChunk[] {
    const rows = this.connection.db
      .prepare(
        `SELECT * FROM memory_chunks WHERE memory_id = ? ORDER BY ord ASC`,
      )
      .all(id) as ChunkRow[];
    return rows.map(rowToChunk);
  }

  setPinned(id: MemoryId, pinned: boolean): void {
    this.connection.db
      .prepare(`UPDATE memories SET pinned = ?, updated_at = ? WHERE id = ?`)
      .run(pinned ? 1 : 0, Date.now(), id);
  }

  forget(id: MemoryId): void {
    this.connection.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  }

  recordHit(id: MemoryId): void {
    this.connection.db
      .prepare(
        `UPDATE memories SET hits = hits + 1, last_used_at = ? WHERE id = ?`,
      )
      .run(Date.now(), id);
  }

  updateSalience(id: MemoryId, salience: number, tier?: MemoryTier): void {
    if (tier) {
      this.connection.db
        .prepare(
          `UPDATE memories SET salience = ?, tier = ?, updated_at = ? WHERE id = ?`,
        )
        .run(salience, tier, Date.now(), id);
    } else {
      this.connection.db
        .prepare(
          `UPDATE memories SET salience = ?, updated_at = ? WHERE id = ?`,
        )
        .run(salience, Date.now(), id);
    }
  }

  /** Append source content to an existing memory's chunk list (used on merge). */
  async appendChunks(
    id: MemoryId,
    additional: readonly Omit<ChunkInsert, 'memoryId'>[],
  ): Promise<void> {
    if (additional.length === 0) return;
    const now = Date.now();
    const vecAvailable = this.connection.vecExtensionLoaded;
    const embeddings: Float32Array[] = vecAvailable
      ? await this.embedderEmbed(additional.map((c) => c.text))
      : [];
    const db = this.connection.db;
    const baseOrdRow = db
      .prepare(
        `SELECT COALESCE(MAX(ord), -1) AS m FROM memory_chunks WHERE memory_id = ?`,
      )
      .get(id) as { m: number } | undefined;
    const baseOrd = (baseOrdRow?.m ?? -1) + 1;
    const insertChunkStmt = db.prepare(
      `INSERT INTO memory_chunks (id, memory_id, ord, text, token_count, created_at)
       VALUES (@id, @memory_id, @ord, @text, @token_count, @created_at)`,
    );
    const insertVecStmt = vecAvailable
      ? db.prepare(
          `INSERT INTO memory_chunks_vec(rowid, embedding) VALUES (?, ?)`,
        )
      : null;
    const fetchRowidStmt = db.prepare(
      `SELECT rowid AS rowid FROM memory_chunks WHERE id = ?`,
    );
    const updateMemoryStmt = db.prepare(
      `UPDATE memories SET updated_at = ?, last_used_at = ? WHERE id = ?`,
    );
    const txn = db.transaction(((..._args: unknown[]) => {
      for (let i = 0; i < additional.length; i++) {
        const c = additional[i];
        const cid = chunkId(ulid());
        insertChunkStmt.run({
          id: cid,
          memory_id: id,
          ord: baseOrd + i,
          text: c.text,
          token_count: c.tokenCount,
          created_at: now,
        });
        if (insertVecStmt) {
          const vec = embeddings[i];
          if (vec && vec.length === this.embedder.dim) {
            const row = fetchRowidStmt.get(cid) as
              | { rowid: number }
              | undefined;
            if (row) {
              insertVecStmt.run(
                row.rowid,
                Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
              );
            }
          }
        }
      }
      updateMemoryStmt.run(now, now, id);
    }) as (...args: unknown[]) => unknown);
    txn();
  }

  stats(workspaceRoot?: string | null): MemoryStatsResponse {
    const db = this.connection.db;
    const where =
      workspaceRoot !== undefined ? 'WHERE workspace_root IS ?' : '';
    const args = workspaceRoot !== undefined ? [workspaceRoot] : [];
    const tiers = db
      .prepare(
        `SELECT tier, COUNT(*) AS n FROM memories ${where} GROUP BY tier`,
      )
      .all(...args) as Array<{ tier: MemoryTier; n: number }>;
    const counts: Record<MemoryTier, number> = {
      core: 0,
      recall: 0,
      archival: 0,
    };
    for (const t of tiers) counts[t.tier] = t.n;
    const last = db
      .prepare(`SELECT MAX(updated_at) AS m FROM memories ${where}`)
      .get(...args) as { m: number | null } | undefined;
    return {
      core: counts.core,
      recall: counts.recall,
      archival: counts.archival,
      lastCuratedAt: last?.m ?? null,
    };
  }

  /** Iterate all memory rows (for the decay job sweep). */
  all(): readonly Memory[] {
    const rows = this.connection.db
      .prepare(`SELECT * FROM memories`)
      .all() as MemoryRow[];
    return rows.map(rowToMemory);
  }

  /** Drop and rebuild FTS + vec indexes from the canonical chunk table. */
  async rebuildIndex(): Promise<{ rebuiltFts: boolean; rebuiltVec: boolean }> {
    const db = this.connection.db;
    db.exec(
      `INSERT INTO memory_chunks_fts(memory_chunks_fts) VALUES('rebuild')`,
    );
    let rebuiltVec = false;
    if (this.connection.vecExtensionLoaded) {
      db.exec(`DELETE FROM memory_chunks_vec`);
      const chunkRows = db
        .prepare(
          `SELECT rowid AS rowid, text FROM memory_chunks ORDER BY rowid ASC`,
        )
        .all() as Array<{ rowid: number; text: string }>;
      // Embed in batches of 32 to avoid worker stalls.
      const batch = 32;
      const insertVecStmt = db.prepare(
        `INSERT INTO memory_chunks_vec(rowid, embedding) VALUES (?, ?)`,
      );
      for (let i = 0; i < chunkRows.length; i += batch) {
        const slice = chunkRows.slice(i, i + batch);
        const vectors = await this.embedderEmbed(slice.map((r) => r.text));
        for (let j = 0; j < slice.length; j++) {
          const v = vectors[j];
          if (!v || v.length !== this.embedder.dim) continue;
          insertVecStmt.run(
            slice[j].rowid,
            Buffer.from(v.buffer, v.byteOffset, v.byteLength),
          );
        }
      }
      rebuiltVec = true;
    }
    return { rebuiltFts: true, rebuiltVec };
  }
}
