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
  JUDGE_STATUSES,
  type CandidateId,
  type JudgeStatus,
  type JudgeVerdict,
  type NewCandidateInput,
  type RegisterCandidateResult,
  type ReplayMeasurement,
  type TriggerEvalMeasurement,
  type SkillCandidateRow,
  type SkillInvocationRow,
  type SkillResidency,
  type SkillStatus,
  type SubagentRunMetrics,
  type ScorecardAggregate,
  type GradedInvocationRow,
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
  // ── 0033 ──────────────────────────────────────────────────────────────────
  // Reads are `SELECT *`, so a column that is missing from this interface is
  // silently invisible to the store no matter what the DDL says. Adding a
  // column to `0033` without adding it here is a silent-data-loss bug, not a
  // compile error.
  judge_score: number | null;
  judge_status: string | null;
  judge_reason: string | null;
  judge_novelty: number | null;
  judge_actionability: number | null;
  judge_scope: number | null;
  judge_generalization: number | null;
  judge_trigger_clarity: number | null;
  judge_panel_rationales: string | null;
  judged_at: number | null;
  display_name: string | null;
  // ── 0036 ──────────────────────────────────────────────────────────────────
  // Same `SELECT *` trap as the 0033 block above, and it bites harder here: a
  // column missing from this interface reads back `undefined`, which
  // `toCandidateRow`'s `?? null` then turns into `null` — indistinguishable
  // from a gate that genuinely has not run. The failure looks exactly like the
  // feature working. Adding a column to `0036` without adding it here is a
  // silent-data-loss bug, not a compile error.
  replay_confidence: number | null;
  replay_holdout_session_id: string | null;
  replay_at: number | null;
  trigger_score: number | null;
  trigger_precision: number | null;
  trigger_recall: number | null;
  trigger_eval_at: number | null;
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

interface RawScorecardAggregateRow {
  slug: string;
  total: number | null;
  graded: number | null;
  graded_succeeded: number | null;
  avg_input: number | null;
  sum_input: number | null;
  avg_output: number | null;
  sum_output: number | null;
  avg_cache_read: number | null;
  avg_cost: number | null;
  avg_duration: number | null;
  avg_tools: number | null;
}

interface RawGradedInvocationRow {
  task_id: string | null;
  succeeded: number;
  verdict_source: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  invoked_at: number;
  reconciled_at: number | null;
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

  /**
   * Persist a judge verdict. A SIBLING of `updateStatus`, deliberately not an
   * option on it: the lifecycle status (`candidate`/`promoted`/`rejected`) and
   * the judge verdict are independent axes, and an `unscored` verdict is
   * precisely the case where the lifecycle status must NOT move.
   *
   * The nine judge columns are written as one fixed set rather than as the
   * dynamic fragments `updateStatus` builds, because a verdict is a whole
   * object: a partial update would leave last pass's per-criterion scores
   * sitting beside this pass's headline score, which is the same class of
   * quietly-wrong verdict this phase exists to remove. Absent criteria are
   * written NULL. `judge_panel_rationales` is untouched — phase 3 owns it.
   *
   * Throws on a status outside the union (there is no DB `CHECK` behind it) and
   * on the two contradictions that would reintroduce a fabricated score: a
   * `scored` verdict with no number, and a non-`scored` verdict carrying one.
   */
  recordJudgeVerdict(
    id: CandidateId,
    verdict: JudgeVerdict,
  ): SkillCandidateRow {
    if (!(JUDGE_STATUSES as readonly string[]).includes(verdict.status)) {
      throw new Error(
        `[skill-synthesis] recordJudgeVerdict: unknown judge status '${String(
          verdict.status,
        )}' (expected ${JUDGE_STATUSES.join(' | ')})`,
      );
    }
    if (verdict.status === 'scored') {
      if (verdict.score === null || !Number.isFinite(verdict.score)) {
        throw new Error(
          `[skill-synthesis] recordJudgeVerdict: a 'scored' verdict for ${id} needs a finite score`,
        );
      }
    } else if (verdict.score !== null) {
      throw new Error(
        `[skill-synthesis] recordJudgeVerdict: a '${verdict.status}' verdict for ${id} must carry score=null, got ${verdict.score}`,
      );
    }

    const criteria = verdict.criteria;
    const stmt = this.db.prepare(
      `UPDATE skill_candidates
       SET judge_score           = ?,
           judge_status          = ?,
           judge_reason          = ?,
           judge_novelty         = ?,
           judge_actionability   = ?,
           judge_scope           = ?,
           judge_generalization  = ?,
           judge_trigger_clarity = ?,
           judged_at             = ?
       WHERE id = ?`,
    );
    stmt.run(
      verdict.score,
      verdict.status,
      verdict.reason,
      criteria?.novelty ?? null,
      criteria?.actionability ?? null,
      criteria?.scope ?? null,
      criteria?.generalization ?? null,
      criteria?.triggerClarity ?? null,
      verdict.judgedAt ?? Date.now(),
      id,
    );

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`[skill-synthesis] recordJudgeVerdict: ${id} not found`);
    }
    return updated;
  }

  /**
   * Set the human-readable title a naming pass produced. `name` stays the slug
   * — it is the SKILL.md folder name and carries a UNIQUE index, so it is an
   * internal id and is never what a human should read. An empty or
   * whitespace-only name clears the column so the UI falls back rather than
   * rendering a blank title.
   */
  setDisplayName(id: CandidateId, displayName: string): SkillCandidateRow {
    const trimmed = displayName.trim();
    const stmt = this.db.prepare(
      `UPDATE skill_candidates SET display_name = ? WHERE id = ?`,
    );
    stmt.run(trimmed.length > 0 ? trimmed : null, id);

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`[skill-synthesis] setDisplayName: ${id} not found`);
    }
    return updated;
  }

  /**
   * Persist a replay-validation measurement (`0036`).
   *
   * A SIBLING of `updateStatus` and `recordJudgeVerdict`, and deliberately not
   * an option on either: the lifecycle status, the judge verdict and the two
   * empirical gates are four independent axes written by different stages at
   * different times. A replay result must be recordable without moving the
   * candidate's status and without touching a judge column.
   *
   * It is built with `updateStatus`'s fragment mechanics, but every fragment in
   * ITS OWN group is unconditional — the three replay columns always move
   * together. That is the same reasoning `recordJudgeVerdict` documents from
   * the other direction: a partial write would leave the PREVIOUS replay's
   * hold-out session sitting beside THIS replay's confidence, which reads as a
   * measurement nobody took. The group is the unit; the fragment list is how
   * two groups stay out of each other's UPDATE.
   *
   * `confidence: null` is a first-class value, not an omission — it is what a
   * replay whose lane failed, or a cluster with no member to hold out, records.
   * It must never be written as `0`, which means "replayed, aligned with
   * nothing".
   *
   * Throws on the two shapes that would fabricate a measurement: a confidence
   * outside 0–1 or non-finite, and a confidence with no hold-out session behind
   * it (there is nothing it could have been measured against).
   */
  recordReplay(
    id: CandidateId,
    measurement: ReplayMeasurement,
  ): SkillCandidateRow {
    const { confidence } = measurement;
    if (confidence !== null) {
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error(
          `[skill-synthesis] recordReplay: confidence for ${id} must be null or a finite number in [0, 1], got ${confidence}`,
        );
      }
    }
    const holdout = measurement.holdoutSessionId?.trim() ?? '';
    const holdoutSessionId = holdout.length > 0 ? holdout : null;
    if (confidence !== null && holdoutSessionId === null) {
      throw new Error(
        `[skill-synthesis] recordReplay: a confidence for ${id} needs the hold-out session it was measured against`,
      );
    }

    const fragments: string[] = [
      'replay_confidence = ?',
      'replay_holdout_session_id = ?',
      'replay_at = ?',
    ];
    const values: unknown[] = [
      confidence,
      holdoutSessionId,
      measurement.replayAt ?? Date.now(),
      id,
    ];

    this.db
      .prepare(
        `UPDATE skill_candidates SET ${fragments.join(', ')} WHERE id = ?`,
      )
      .run(...values);

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`[skill-synthesis] recordReplay: ${id} not found`);
    }
    return updated;
  }

  /**
   * Persist a trigger-retrieval measurement (`0036`). The sibling of
   * {@link recordReplay}, same group-is-the-unit rule: precision, recall, the
   * derived score and the timestamp move together, because a precision left
   * beside the previous run's recall is not a measurement of anything.
   *
   * `precision` and `recall` are definitionally 0–1 and are range-checked here
   * — the schema deliberately carries no `CHECK`, because SQLite cannot widen
   * or drop one, so this is the enforcing edge. `score` is checked for
   * finiteness only: it replaces the judge's 0–10 `triggerClarity` in ranking
   * and the scale it is expressed on is B3.3's to decide, so pinning a range
   * here would pre-empt that decision from the wrong file.
   *
   * All three may be `null` together — an eval that produced nothing
   * trustworthy. `null` is not `0`; a 0 means the description retrieved nothing
   * and IS a result.
   */
  recordTriggerEval(
    id: CandidateId,
    measurement: TriggerEvalMeasurement,
  ): SkillCandidateRow {
    const bounded: ReadonlyArray<readonly [string, number | null]> = [
      ['precision', measurement.precision],
      ['recall', measurement.recall],
    ];
    for (const [label, value] of bounded) {
      if (value === null) continue;
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(
          `[skill-synthesis] recordTriggerEval: ${label} for ${id} must be null or a finite number in [0, 1], got ${value}`,
        );
      }
    }
    if (measurement.score !== null && !Number.isFinite(measurement.score)) {
      throw new Error(
        `[skill-synthesis] recordTriggerEval: score for ${id} must be null or finite, got ${measurement.score}`,
      );
    }

    const fragments: string[] = [
      'trigger_score = ?',
      'trigger_precision = ?',
      'trigger_recall = ?',
      'trigger_eval_at = ?',
    ];
    const values: unknown[] = [
      measurement.score,
      measurement.precision,
      measurement.recall,
      measurement.evaluatedAt ?? Date.now(),
      id,
    ];

    this.db
      .prepare(
        `UPDATE skill_candidates SET ${fragments.join(', ')} WHERE id = ?`,
      )
      .run(...values);

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`[skill-synthesis] recordTriggerEval: ${id} not found`);
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
   * Batched scorecard aggregation for the Library view. ONE `GROUP BY
   * skill_slug` pass over `source='subagent'` rows for the requested slugs.
   * Returns a Map keyed by EVERY requested slug: slugs with no rows get a
   * typed zero/null aggregate (never omitted, never an error). Token/cost/
   * duration/tool averages and sums are NULL-excluding by SQL semantics — a
   * usage-less provider's all-null row is ignored, not counted as zero (R1.2).
   * Empty slug list → empty Map.
   */
  getScorecardAggregates(
    slugs: readonly string[],
  ): Map<string, ScorecardAggregate> {
    const result = new Map<string, ScorecardAggregate>();
    if (slugs.length === 0) return result;
    // Seed every requested slug with a zero aggregate so no-data slugs are
    // always present and well-typed.
    for (const slug of slugs) {
      result.set(slug, this.emptyScorecardAggregate(slug));
    }
    const placeholders = slugs.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT skill_slug AS slug,
                COUNT(*)                                                   AS total,
                SUM(CASE WHEN reconciled_at IS NOT NULL THEN 1 ELSE 0 END) AS graded,
                SUM(CASE WHEN reconciled_at IS NOT NULL AND succeeded = 1
                         THEN 1 ELSE 0 END)                               AS graded_succeeded,
                AVG(input_tokens)       AS avg_input,
                SUM(input_tokens)       AS sum_input,
                AVG(output_tokens)      AS avg_output,
                SUM(output_tokens)      AS sum_output,
                AVG(cache_read_tokens)  AS avg_cache_read,
                AVG(cost_usd)           AS avg_cost,
                AVG(duration_ms)        AS avg_duration,
                AVG(tool_count)         AS avg_tools
         FROM skill_invocation_events
         WHERE source = 'subagent' AND skill_slug IN (${placeholders})
         GROUP BY skill_slug`,
      )
      .all(...slugs) as RawScorecardAggregateRow[];
    for (const r of rows) {
      result.set(r.slug, {
        slug: r.slug,
        total: r.total ?? 0,
        graded: r.graded ?? 0,
        gradedSucceeded: r.graded_succeeded ?? 0,
        avgInputTokens: r.avg_input,
        avgOutputTokens: r.avg_output,
        avgCacheReadTokens: r.avg_cache_read,
        totalInputTokens: r.sum_input,
        totalOutputTokens: r.sum_output,
        avgCostUsd: r.avg_cost,
        avgDurationMs: r.avg_duration,
        avgToolCount: r.avg_tools,
      });
    }
    return result;
  }

  /**
   * Recent graded (reconciled) subagent invocations for a slug, newest verdict
   * first. Used by the lazy detail view. Only `reconciled_at IS NOT NULL` rows
   * are returned so ungraded optimistic events never surface as verdicts.
   */
  listGradedInvocations(slug: string, limit: number): GradedInvocationRow[] {
    if (!slug || limit <= 0) return [];
    const rows = this.db
      .prepare(
        `SELECT task_id, succeeded, verdict_source, input_tokens, output_tokens,
                cost_usd, duration_ms, invoked_at, reconciled_at
         FROM skill_invocation_events
         WHERE skill_slug = ?
           AND source = 'subagent'
           AND reconciled_at IS NOT NULL
         ORDER BY reconciled_at DESC
         LIMIT ?`,
      )
      .all(slug, limit) as RawGradedInvocationRow[];
    return rows.map((r) => ({
      taskId: r.task_id ?? null,
      succeeded: r.succeeded === 1,
      verdictSource: r.verdict_source ?? null,
      inputTokens: r.input_tokens ?? null,
      outputTokens: r.output_tokens ?? null,
      costUsd: r.cost_usd ?? null,
      durationMs: r.duration_ms ?? null,
      invokedAt: r.invoked_at,
      reconciledAt: r.reconciled_at ?? 0,
    }));
  }

  private emptyScorecardAggregate(slug: string): ScorecardAggregate {
    return {
      slug,
      total: 0,
      graded: 0,
      gradedSucceeded: 0,
      avgInputTokens: null,
      avgOutputTokens: null,
      avgCacheReadTokens: null,
      totalInputTokens: null,
      totalOutputTokens: null,
      avgCostUsd: null,
      avgDurationMs: null,
      avgToolCount: null,
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

  /**
   * Read edge of the `judge_status` union. `null` and `''` mean "never judged".
   * Anything else that is not a union member is downgraded to `'unscored'` —
   * the value that means "no trustworthy verdict" — and logged. There is no DB
   * `CHECK` to have caught it, and the alternative (passing the raw string
   * through a field typed as the union) would lie to every consumer.
   */
  private toJudgeStatus(raw: string | null): JudgeStatus | null {
    if (raw === null || raw === '') return null;
    if ((JUDGE_STATUSES as readonly string[]).includes(raw)) {
      return raw as JudgeStatus;
    }
    this.logger.warn(
      '[skill-synthesis] unknown judge_status read from skill_candidates; treating as unscored',
      { judgeStatus: raw },
    );
    return 'unscored';
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
      judgeStatus: this.toJudgeStatus(raw.judge_status),
      // `?? null` normalizes a driver's `undefined` for an absent column. It
      // does NOT coalesce a stored NULL to 0 — that would resurrect the exact
      // fabricated-score defect this column exists to kill.
      judgeScore: raw.judge_score ?? null,
      judgeReason: raw.judge_reason ?? null,
      judgeCriteria: {
        novelty: raw.judge_novelty ?? null,
        actionability: raw.judge_actionability ?? null,
        scope: raw.judge_scope ?? null,
        generalization: raw.judge_generalization ?? null,
        triggerClarity: raw.judge_trigger_clarity ?? null,
      },
      judgePanelRationales: raw.judge_panel_rationales ?? null,
      judgedAt: raw.judged_at ?? null,
      displayName: raw.display_name ?? null,
      // `?? null` normalizes a driver's `undefined` for an absent column, and
      // NOTHING here may coalesce to 0. A measured `0` — a replay that aligned
      // with nothing, a description that retrieved nothing — is evidence
      // against promotion; `null` is "this gate has not spoken" and leaves the
      // candidate retry-eligible. Collapsing the two would silently reject
      // every candidate the weekly drain has not reached yet.
      replayConfidence: raw.replay_confidence ?? null,
      replayHoldoutSessionId: raw.replay_holdout_session_id ?? null,
      replayAt: raw.replay_at ?? null,
      triggerScore: raw.trigger_score ?? null,
      triggerPrecision: raw.trigger_precision ?? null,
      triggerRecall: raw.trigger_recall ?? null,
      triggerEvalAt: raw.trigger_eval_at ?? null,
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
