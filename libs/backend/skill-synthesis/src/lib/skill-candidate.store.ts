/**
 * SkillCandidateStore — SQLite persistence layer for skill_candidates +
 * skill_candidates_vec + skill_invocations.
 *
 * Operates against the shared `~/.ptah/ptah.db` connection owned by
 * persistence-sqlite. The store is intentionally dumb: it does NOT enforce
 * promotion thresholds, dedup, or cap — those are SkillPromotionService's
 * job. Here we only handle CRUD + vec0 writes.
 *
 * Status transitions are validated to fail loudly if the caller tries to
 * walk an illegal edge (e.g. `rejected` → `promoted`).
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
  type SqliteStatement,
} from '@ptah-extension/persistence-sqlite';
import {
  type CandidateId,
  type NewCandidateInput,
  type RegisterCandidateResult,
  type SkillCandidateRow,
  type SkillInvocationRow,
  type SkillStatus,
} from './types';

interface RawCandidateRow {
  id: string;
  name: string;
  description: string;
  body_path: string;
  source_session_ids: string;
  trajectory_hash: string;
  embedding_rowid: number | null;
  status: SkillStatus;
  success_count: number;
  failure_count: number;
  created_at: number;
  promoted_at: number | null;
  rejected_at: number | null;
  rejected_reason: string | null;
}

interface RawInvocationRow {
  id: string;
  skill_id: string;
  session_id: string;
  succeeded: number;
  invoked_at: number;
  notes: string | null;
}

const LEGAL_TRANSITIONS: Record<SkillStatus, readonly SkillStatus[]> = {
  candidate: ['promoted', 'rejected'],
  promoted: ['rejected'],
  rejected: [],
};

@injectable()
export class SkillCandidateStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  // ────────────────────────────────────────────────────────────────────
  // Candidate CRUD
  // ────────────────────────────────────────────────────────────────────

  /**
   * Insert a new candidate (status='candidate'). If a row with the same
   * `trajectory_hash` already exists, returns the existing row with
   * `reused=true` — callers MUST treat this as idempotent.
   */
  registerCandidate(input: NewCandidateInput): RegisterCandidateResult {
    const existing = this.findByTrajectoryHash(input.trajectoryHash);
    if (existing) {
      return { candidate: existing, reused: true };
    }

    const id = this.generateCandidateId();
    let embeddingRowid: number | null = null;
    if (input.embedding && this.connection.vecExtensionLoaded) {
      embeddingRowid = this.insertEmbedding(input.embedding);
    }

    const stmt = this.db.prepare(
      `INSERT INTO skill_candidates (
         id, name, description, body_path, source_session_ids,
         trajectory_hash, embedding_rowid, status,
         success_count, failure_count, created_at,
         promoted_at, rejected_at, rejected_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 0, 0, ?, NULL, NULL, NULL)`,
    );
    stmt.run(
      id,
      input.name,
      input.description,
      input.bodyPath,
      JSON.stringify(input.sourceSessionIds),
      input.trajectoryHash,
      embeddingRowid,
      input.createdAt,
    );

    const row = this.findById(id as CandidateId);
    if (!row) {
      throw new Error(
        `[skill-synthesis] registerCandidate: insert succeeded but row ${id} could not be re-read`,
      );
    }
    return { candidate: row, reused: false };
  }

  findById(id: CandidateId): SkillCandidateRow | null {
    const stmt = this.db.prepare(`SELECT * FROM skill_candidates WHERE id = ?`);
    const raw = stmt.get(id) as RawCandidateRow | undefined;
    return raw ? this.toCandidateRow(raw) : null;
  }

  findByTrajectoryHash(hash: string): SkillCandidateRow | null {
    const stmt = this.db.prepare(
      `SELECT * FROM skill_candidates WHERE trajectory_hash = ?`,
    );
    const raw = stmt.get(hash) as RawCandidateRow | undefined;
    return raw ? this.toCandidateRow(raw) : null;
  }

  listByStatus(status: SkillStatus): SkillCandidateRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM skill_candidates
       WHERE status = ?
       ORDER BY created_at DESC`,
    );
    const rows = stmt.all(status) as RawCandidateRow[];
    return rows.map((r) => this.toCandidateRow(r));
  }

  /**
   * Active = status='promoted'. Ordered by recency-weighted invocation
   * activity for LRU eviction (most-active first → eviction takes the tail).
   */
  listActiveOrderedByActivity(now: number): SkillCandidateRow[] {
    // recency_factor = 1 / (1 + days_since_last_invocation)
    // score = success_count * recency_factor
    // Skills never invoked use created_at as a fallback timestamp.
    const stmt = this.db.prepare(
      `SELECT c.*,
              (
                CAST(c.success_count AS REAL) /
                (1.0 +
                  ((? - COALESCE(
                    (SELECT MAX(invoked_at) FROM skill_invocations
                     WHERE skill_id = c.id),
                    c.created_at
                  )) / 86400000.0)
                )
              ) AS activity_score
       FROM skill_candidates c
       WHERE c.status = 'promoted'
       ORDER BY activity_score DESC, c.promoted_at DESC`,
    );
    const rows = stmt.all(now) as RawCandidateRow[];
    return rows.map((r) => this.toCandidateRow(r));
  }

  /** Update status with a legal-transition check. Throws on illegal moves. */
  updateStatus(
    id: CandidateId,
    next: SkillStatus,
    options: {
      reason?: string;
      promotedAt?: number;
      rejectedAt?: number;
      bodyPath?: string;
    } = {},
  ): SkillCandidateRow {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`[skill-synthesis] updateStatus: ${id} not found`);
    }
    if (current.status === next) return current;
    const allowed = LEGAL_TRANSITIONS[current.status];
    if (!allowed.includes(next)) {
      throw new Error(
        `[skill-synthesis] illegal status transition ${current.status} → ${next} for ${id}`,
      );
    }

    const fragments: string[] = ['status = ?'];
    const values: unknown[] = [next];
    if (next === 'promoted') {
      fragments.push('promoted_at = ?');
      values.push(options.promotedAt ?? Date.now());
    }
    if (next === 'rejected') {
      fragments.push('rejected_at = ?', 'rejected_reason = ?');
      values.push(options.rejectedAt ?? Date.now(), options.reason ?? null);
    }
    if (options.bodyPath) {
      fragments.push('body_path = ?');
      values.push(options.bodyPath);
    }
    values.push(id);

    const stmt = this.db.prepare(
      `UPDATE skill_candidates SET ${fragments.join(', ')} WHERE id = ?`,
    );
    stmt.run(...values);

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(
        `[skill-synthesis] updateStatus: row ${id} disappeared after update`,
      );
    }
    return updated;
  }

  /** Increment success_count atomically. Returns the post-increment value. */
  incrementSuccess(id: CandidateId): number {
    const stmt = this.db.prepare(
      `UPDATE skill_candidates
       SET success_count = success_count + 1
       WHERE id = ?`,
    );
    stmt.run(id);
    const row = this.findById(id);
    return row?.successCount ?? 0;
  }

  /** Increment failure_count atomically. Returns the post-increment value. */
  incrementFailure(id: CandidateId): number {
    const stmt = this.db.prepare(
      `UPDATE skill_candidates
       SET failure_count = failure_count + 1
       WHERE id = ?`,
    );
    stmt.run(id);
    const row = this.findById(id);
    return row?.failureCount ?? 0;
  }

  // ────────────────────────────────────────────────────────────────────
  // Invocation CRUD
  // ────────────────────────────────────────────────────────────────────

  recordInvocation(input: {
    skillId: CandidateId;
    sessionId: string;
    succeeded: boolean;
    invokedAt: number;
    notes?: string;
  }): SkillInvocationRow {
    const id = this.generateInvocationId();
    const stmt = this.db.prepare(
      `INSERT INTO skill_invocations
         (id, skill_id, session_id, succeeded, invoked_at, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      id,
      input.skillId,
      input.sessionId,
      input.succeeded ? 1 : 0,
      input.invokedAt,
      input.notes ?? null,
    );
    return {
      id,
      skillId: input.skillId,
      sessionId: input.sessionId,
      succeeded: input.succeeded,
      invokedAt: input.invokedAt,
      notes: input.notes ?? null,
    };
  }

  listInvocations(skillId: CandidateId, limit = 100): SkillInvocationRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM skill_invocations
       WHERE skill_id = ?
       ORDER BY invoked_at DESC
       LIMIT ?`,
    );
    const rows = stmt.all(skillId, limit) as RawInvocationRow[];
    return rows.map((r) => this.toInvocationRow(r));
  }

  // ────────────────────────────────────────────────────────────────────
  // Vector search
  // ────────────────────────────────────────────────────────────────────

  /**
   * Read a stored embedding by rowid. Returns null if sqlite-vec is not
   * loaded or the rowid does not exist.
   */
  getEmbedding(rowid: number): Float32Array | null {
    if (!this.connection.vecExtensionLoaded) return null;
    return this.readEmbedding(rowid);
  }

  /**
   * Search active (promoted) candidates by cosine similarity. Returns rows
   * paired with their similarity score (1 = identical). Returns an empty
   * array when sqlite-vec is not loaded — callers must handle this.
   */
  searchActiveByEmbedding(
    embedding: Float32Array,
    limit = 5,
  ): Array<{ row: SkillCandidateRow; similarity: number }> {
    if (!this.connection.vecExtensionLoaded) return [];
    // vec0 distance is L2; we convert to cosine via normalized vectors stored
    // by `insertEmbedding`. Simpler approach: ask vec for distance, then
    // re-rank manually using cosine on the in-memory vector. Pragmatic
    // implementation: do an in-memory scan of all promoted candidates.
    const promoted = this.listByStatus('promoted');
    if (promoted.length === 0) return [];
    const scored: Array<{ row: SkillCandidateRow; similarity: number }> = [];
    for (const row of promoted) {
      if (row.embeddingRowid === null) continue;
      const stored = this.readEmbedding(row.embeddingRowid);
      if (!stored) continue;
      scored.push({ row, similarity: cosineSimilarity(embedding, stored) });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  // ────────────────────────────────────────────────────────────────────
  // Stats
  // ────────────────────────────────────────────────────────────────────

  getStats(): {
    candidates: number;
    promoted: number;
    rejected: number;
    invocations: number;
  } {
    const counts = this.db
      .prepare(
        `SELECT status, COUNT(*) as n FROM skill_candidates GROUP BY status`,
      )
      .all() as Array<{ status: SkillStatus; n: number }>;
    const invocations =
      (
        this.db.prepare(`SELECT COUNT(*) as n FROM skill_invocations`).get() as
          | { n: number }
          | undefined
      )?.n ?? 0;
    let candidates = 0;
    let promoted = 0;
    let rejected = 0;
    for (const c of counts) {
      if (c.status === 'candidate') candidates = c.n;
      else if (c.status === 'promoted') promoted = c.n;
      else if (c.status === 'rejected') rejected = c.n;
    }
    return { candidates, promoted, rejected, invocations };
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private insertEmbedding(vec: Float32Array): number {
    const stmt = this.db.prepare(
      `INSERT INTO skill_candidates_vec (embedding) VALUES (?)`,
    );
    const result = stmt.run(Buffer.from(vec.buffer));
    const rowid = result.lastInsertRowid;
    return typeof rowid === 'bigint' ? Number(rowid) : rowid;
  }

  private readEmbedding(rowid: number): Float32Array | null {
    try {
      const stmt: SqliteStatement = this.db.prepare(
        `SELECT embedding FROM skill_candidates_vec WHERE rowid = ?`,
      );
      const raw = stmt.get(rowid) as { embedding: Buffer } | undefined;
      if (!raw) return null;
      const buf = raw.embedding;
      return new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );
    } catch (err) {
      this.logger.warn('[skill-synthesis] failed to read embedding', {
        rowid,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private toCandidateRow(raw: RawCandidateRow): SkillCandidateRow {
    let sources: string[] = [];
    try {
      const parsed = JSON.parse(raw.source_session_ids) as unknown;
      if (Array.isArray(parsed)) {
        sources = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      sources = [];
    }
    return {
      id: raw.id as CandidateId,
      name: raw.name,
      description: raw.description,
      bodyPath: raw.body_path,
      sourceSessionIds: sources,
      trajectoryHash: raw.trajectory_hash,
      embeddingRowid: raw.embedding_rowid,
      status: raw.status,
      successCount: raw.success_count,
      failureCount: raw.failure_count,
      createdAt: raw.created_at,
      promotedAt: raw.promoted_at,
      rejectedAt: raw.rejected_at,
      rejectedReason: raw.rejected_reason,
    };
  }

  private toInvocationRow(raw: RawInvocationRow): SkillInvocationRow {
    return {
      id: raw.id,
      skillId: raw.skill_id as CandidateId,
      sessionId: raw.session_id,
      succeeded: raw.succeeded === 1,
      invokedAt: raw.invoked_at,
      notes: raw.notes,
    };
  }

  private generateCandidateId(): string {
    return ulid();
  }

  private generateInvocationId(): string {
    return ulid();
  }
}

/** Cosine similarity for two equal-length vectors. Returns 0 on degenerate input. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
