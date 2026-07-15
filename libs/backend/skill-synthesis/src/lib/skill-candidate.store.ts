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
  VecStatusService,
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
  type SkillResidency,
  type SkillStatus,
  type SubagentRunMetrics,
} from './types';
import { cosineSimilarity } from './cosine-similarity';

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
  pinned: number;
  residency: string;
}

interface RawInvocationRow {
  id: string;
  skill_id: string;
  session_id: string;
  succeeded: number;
  invoked_at: number;
  notes: string | null;
  context_id: string | null;
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
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

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
    if (input.embedding && this.vecStatus.available) {
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

  findByName(name: string): SkillCandidateRow | null {
    const stmt = this.db.prepare(
      `SELECT * FROM skill_candidates WHERE name = ? ORDER BY created_at DESC LIMIT 1`,
    );
    const raw = stmt.get(name) as RawCandidateRow | undefined;
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
   * Active promoted skills ordered by decay-weighted score (ascending).
   * Lowest score = least valuable = demote first.
   * Only includes unpinned, resident candidates — pinned skills are exempt and
   * already-dormant skills are excluded (they no longer count against the
   * residency budget and must not be re-demoted).
   *
   * Decay score per skill = sum of decayRate^(ageDays) for each invocation.
   * Skills with no invocations get score 0 (oldest for demotion).
   */
  listActiveOrderedByDecayScore(
    now: number,
    decayRate: number,
  ): SkillCandidateRow[] {
    const promoted = this.listByStatus('promoted').filter(
      (r) => !r.pinned && r.residency === 'resident',
    );
    if (promoted.length === 0) return [];
    const scored: Array<{ row: SkillCandidateRow; score: number }> = [];
    for (const row of promoted) {
      const invocations = this.listInvocations(row.id, 1000);
      let score = 0;
      for (const inv of invocations) {
        const ageDays = Math.max(0, (now - inv.invokedAt) / 86400000);
        score += Math.pow(decayRate, ageDays);
      }
      scored.push({ row, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.row);
  }

  /**
   * Set the residency of a candidate. `dormant` skills are skipped at the
   * junction layer (description+body no longer fed to the model) but keep their
   * row and SKILL.md for future re-promotion; `resident` is the default.
   */
  setResidency(id: CandidateId, residency: SkillResidency): SkillCandidateRow {
    const stmt = this.db.prepare(
      `UPDATE skill_candidates SET residency = ? WHERE id = ?`,
    );
    stmt.run(residency, id);
    const row = this.findById(id);
    if (!row) {
      throw new Error(
        `[skill-synthesis] setResidency: row ${id} disappeared after update`,
      );
    }
    return row;
  }

  /**
   * Slugs (candidate.name) of promoted skills currently marked dormant. Used by
   * the junction integration seam to skip dormant skills so they no longer
   * occupy the prompt budget.
   */
  listDormantPromotedSlugs(): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM skill_candidates
         WHERE status = 'promoted' AND residency = 'dormant'`,
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name).filter((name) => name.length > 0);
  }

  /**
   * Active = status='promoted'. Ordered by recency-weighted invocation
   * activity for LRU eviction (most-active first → eviction takes the tail).
   */
  listActiveOrderedByActivity(now: number): SkillCandidateRow[] {
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

  /**
   * Set or clear the pinned flag on a candidate.
   * When setting pinned=true, enforces the maxPinnedCap limit.
   * Throws if cap would be exceeded.
   *
   * The COUNT check and UPDATE are executed inside a single synchronous
   * transaction to eliminate the TOCTOU race that could allow exceeding the cap
   * under concurrent (but still synchronous) callers.
   */
  setPin(id: CandidateId, pinned: boolean, maxPinnedCap: number): void {
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM skill_candidates WHERE pinned = 1`,
    );
    const updateStmt = this.db.prepare(
      `UPDATE skill_candidates SET pinned = ? WHERE id = ?`,
    );

    const txn = this.db.transaction(() => {
      if (pinned) {
        const row = countStmt.get() as { cnt: number };
        if (row.cnt >= maxPinnedCap) {
          throw new Error('maxPinnedSkills cap reached');
        }
      }
      updateStmt.run(pinned ? 1 : 0, id);
    });

    txn();
  }

  /**
   * Count distinct context IDs recorded for a candidate's invocations.
   * Returns 0 for legacy rows where context_id is NULL.
   */
  countDistinctContexts(candidateId: CandidateId): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT context_id) as cnt
         FROM skill_invocations
         WHERE skill_id = ? AND context_id IS NOT NULL`,
      )
      .get(candidateId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  recordInvocation(input: {
    skillId: CandidateId;
    sessionId: string;
    succeeded: boolean;
    invokedAt: number;
    notes?: string;
    contextId?: string;
  }): SkillInvocationRow {
    const id = this.generateInvocationId();
    const stmt = this.db.prepare(
      `INSERT INTO skill_invocations
         (id, skill_id, session_id, succeeded, invoked_at, notes, context_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      id,
      input.skillId,
      input.sessionId,
      input.succeeded ? 1 : 0,
      input.invokedAt,
      input.notes ?? null,
      input.contextId ?? null,
    );
    return {
      id,
      skillId: input.skillId,
      sessionId: input.sessionId,
      succeeded: input.succeeded,
      invokedAt: input.invokedAt,
      notes: input.notes ?? null,
      contextId: input.contextId ?? null,
    };
  }

  recordSkillEvent(input: {
    skillSlug: string;
    sessionId: string;
    contextId: string | null;
    source: string;
    succeeded: boolean;
    isError: boolean;
    invokedAt: number;
    /** Subagent-source only; NULL for tool-use / prompt-expansion events. */
    metrics?: SubagentRunMetrics | null;
    /** Exact task attribution (TASK_YYYY_NNN) when derivable, else NULL. */
    taskId?: string | null;
  }): void {
    const m = input.metrics ?? null;
    const stmt = this.db.prepare(
      `INSERT INTO skill_invocation_events
         (id, skill_slug, session_id, context_id, source, succeeded, is_error, invoked_at,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cost_usd, duration_ms, tool_count, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      ulid(),
      input.skillSlug,
      input.sessionId,
      input.contextId,
      input.source,
      input.succeeded ? 1 : 0,
      input.isError ? 1 : 0,
      input.invokedAt,
      m?.inputTokens ?? null,
      m?.outputTokens ?? null,
      m?.cacheReadTokens ?? null,
      m?.cacheCreationTokens ?? null,
      m?.costUsd ?? null,
      m?.durationMs ?? null,
      m?.toolCount ?? null,
      input.taskId ?? null,
    );
  }

  /**
   * Reconcile a single un-reconciled subagent invocation event for a slug
   * against a graded verdict harvested from `.ptah/specs`. One batch verdict
   * flips at most one row (cardinality parity), using two ordered passes:
   *
   *  1. **Exact pass** — the newest un-reconciled `source='subagent'` row whose
   *     `task_id` equals the spec's task id, IGNORING the time window. Uses
   *     `idx_skill_inv_events_task` (no full-table scan). Provenance is the
   *     caller-supplied `verdictSource` (base `spec:TASK_X`). This is the
   *     precise attribution that survives concurrent same-slug runs.
   *  2. **Window fallback** — only when the exact pass matched nothing: the
   *     newest un-reconciled row inside [windowStart, windowEnd] that has NO
   *     `task_id` (`task_id IS NULL`), so a stamped concurrent event is never
   *     stolen by another task's window. Provenance is rewritten to
   *     `spec-window:TASK_X` so the heuristic attribution is auditable.
   *
   * Idempotent: the `reconciled_at IS NULL` guard means re-running a harvest
   * never double-flips a row. Returns true when a row was updated, false when
   * no eligible event existed (e.g. telemetry never recorded the run).
   */
  reconcileSubagentEvent(input: {
    slug: string;
    taskId: string;
    succeeded: boolean;
    isError: boolean;
    windowStart: number;
    windowEnd: number;
    verdictSource: string;
    reconciledAt: number;
  }): boolean {
    const exact = this.db
      .prepare(
        `SELECT id FROM skill_invocation_events
         WHERE skill_slug = ?
           AND source = 'subagent'
           AND task_id = ?
           AND reconciled_at IS NULL
         ORDER BY invoked_at DESC
         LIMIT 1`,
      )
      .get(input.slug, input.taskId) as { id: string } | undefined;
    if (exact) {
      this.applyReconciliation(exact.id, input, input.verdictSource);
      return true;
    }

    const fallback = this.db
      .prepare(
        `SELECT id FROM skill_invocation_events
         WHERE skill_slug = ?
           AND source = 'subagent'
           AND task_id IS NULL
           AND reconciled_at IS NULL
           AND invoked_at BETWEEN ? AND ?
         ORDER BY invoked_at DESC
         LIMIT 1`,
      )
      .get(input.slug, input.windowStart, input.windowEnd) as
      | { id: string }
      | undefined;
    if (!fallback) return false;

    this.applyReconciliation(
      fallback.id,
      input,
      this.toWindowVerdictSource(input.verdictSource),
    );
    return true;
  }

  private applyReconciliation(
    eventId: string,
    input: { succeeded: boolean; isError: boolean; reconciledAt: number },
    verdictSource: string,
  ): void {
    this.db
      .prepare(
        `UPDATE skill_invocation_events
         SET succeeded = ?, is_error = ?, reconciled_at = ?, verdict_source = ?
         WHERE id = ?`,
      )
      .run(
        input.succeeded ? 1 : 0,
        input.isError ? 1 : 0,
        input.reconciledAt,
        verdictSource,
        eventId,
      );
  }

  /** Rewrite a base `spec:TASK_X` provenance to the heuristic `spec-window:` form. */
  private toWindowVerdictSource(verdictSource: string): string {
    return verdictSource.startsWith('spec:')
      ? `spec-window:${verdictSource.slice('spec:'.length)}`
      : verdictSource;
  }

  getInvocationStats(slug: string): {
    total: number;
    succeeded: number;
    failed: number;
    distinctContexts: number;
  } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(succeeded), 0) AS succeeded,
           COALESCE(SUM(CASE WHEN succeeded = 0 THEN 1 ELSE 0 END), 0) AS failed,
           COUNT(DISTINCT context_id) AS distinctContexts
         FROM skill_invocation_events
         WHERE skill_slug = ?`,
      )
      .get(slug) as
      | {
          total: number;
          succeeded: number;
          failed: number;
          distinctContexts: number;
        }
      | undefined;
    return {
      total: row?.total ?? 0,
      succeeded: row?.succeeded ?? 0,
      failed: row?.failed ?? 0,
      distinctContexts: row?.distinctContexts ?? 0,
    };
  }

  /**
   * Reverse lookup: given a set of session ids, return the single skill slug
   * invoked most often across them (the "dominant" skill of those sessions), or
   * null when none of the sessions recorded any skill invocation. Used by the
   * never-re-synthesize guard to detect when a trajectory is dominated by an
   * authored skill.
   */
  getDominantSkillSlugForSessions(
    sessionIds: readonly string[],
  ): string | null {
    if (sessionIds.length === 0) return null;
    const placeholders = sessionIds.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT skill_slug, COUNT(*) AS c
         FROM skill_invocation_events
         WHERE session_id IN (${placeholders})
         GROUP BY skill_slug
         ORDER BY c DESC
         LIMIT 1`,
      )
      .get(...sessionIds) as { skill_slug: string; c: number } | undefined;
    if (!row || !row.skill_slug) return null;
    return row.skill_slug;
  }

  getRecentSessionsForSlug(slug: string, limit = 5): string[] {
    const rows = this.db
      .prepare(
        `SELECT session_id, MAX(invoked_at) AS last_at
         FROM skill_invocation_events
         WHERE skill_slug = ?
         GROUP BY session_id
         ORDER BY last_at DESC
         LIMIT ?`,
      )
      .all(slug, limit) as Array<{ session_id: string }>;
    return rows.map((r) => r.session_id).filter((id) => id.length > 0);
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

  /**
   * Read a stored embedding by rowid. Returns null if sqlite-vec is not
   * loaded or the rowid does not exist.
   */
  getEmbedding(rowid: number): Float32Array | null {
    if (!this.vecStatus.available) return null;
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
    if (!this.vecStatus.available) return [];
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

  /**
   * Attach an embedding to an existing candidate row (backfill path). No-ops
   * when sqlite-vec is unavailable. Inserts the vector into the vec0 table and
   * links its rowid onto the candidate.
   */
  setEmbedding(id: CandidateId, vec: Float32Array): void {
    if (!this.vecStatus.available) return;
    const rowid = this.insertEmbedding(vec);
    const stmt = this.db.prepare(
      `UPDATE skill_candidates SET embedding_rowid = ? WHERE id = ?`,
    );
    stmt.run(rowid, id);
  }

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
      pinned: raw.pinned === 1,
      residency: raw.residency === 'dormant' ? 'dormant' : 'resident',
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
      contextId: raw.context_id ?? null,
    };
  }

  private generateCandidateId(): string {
    return ulid();
  }

  private generateInvocationId(): string {
    return ulid();
  }
}
