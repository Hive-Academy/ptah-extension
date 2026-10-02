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
 * walk an illegal edge (e.g. `rejected` → `promoted`). The one exception is
 * `promoteAtomically`'s compare-and-set `fromStatus: 'rejected'`.
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
  JUDGE_PANEL_ROLES,
  JUDGE_STATUSES,
  MERGED_INTO_PREFIX,
  RETIRED_UNUSED_REASON,
  type CandidateId,
  type JudgePanelRationale,
  type JudgeVerdict,
  type NewCandidateInput,
  type RegisterCandidateResult,
  type ReplayMeasurement,
  type TriggerEvalMeasurement,
  type SkillCandidateRow,
  type SkillCandidateStats,
  type SkillInvocationRow,
  type SkillResidency,
  type SkillStatus,
  type SubagentRunMetrics,
  type ScorecardAggregate,
  type GradedInvocationRow,
} from './types';
import { cosineSimilarity } from './cosine-similarity';
import {
  toCandidateRow,
  type RawCandidateRow,
} from './skill-candidate.row-mappers';

interface RawInvocationEventRow {
  id: string;
  session_id: string;
  succeeded: number;
  invoked_at: number;
  source: string;
  context_id: string | null;
}

/** `SUM(CASE …)` over an empty table is NULL, hence the `| null`. */
type RawLifecycleCountsRow = {
  [K in Exclude<keyof SkillCandidateStats, 'invocations'>]: number | null;
};

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

interface RawWinRateRow {
  skill_slug: string;
  invocations: number | null;
  wins: number | null;
  unknown: number | null;
}

/**
 * One slug's win rate over the invocation → session-outcome join (plan §2.5).
 *
 * `winRate` is `number | null` and the `null` is NOT an error state — it is
 * "no measured session for this skill yet". See `getWinRates`'s header for why
 * it must never be `0`. Every consumer branches on it; none coalesces it.
 */
export interface SkillWinRate {
  readonly slug: string;
  /** Every recorded invocation of the slug, whatever its session's verdict. */
  readonly invocations: number;
  /** Verdicts in `tests-green` / `user-accepted` / `explicit-confirmation`. */
  readonly wins: number;
  /** `unverified` verdicts PLUS sessions with no verdict row at all. */
  readonly unknown: number;
  /** `wins / (invocations - unknown)`; `null` when that denominator is 0. */
  readonly winRate: number | null;
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
  /** Nesting depth of {@link inImmediateTransaction}; 0 = no open transaction. */
  private transactionDepth = 0;

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
         promoted_at, rejected_at, rejected_reason, workspace_root
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 0, 0, ?, NULL, NULL, NULL, ?)`,
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
      // `?? null`, never `?? ''`. A caller that did not supply a root does not
      // know where the session ran; writing `''` would record the unrelated
      // claim "deliberately cross-project". See `NewCandidateInput`.
      input.workspaceRoot ?? null,
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

  /**
   * The newest still-`candidate` row drafted from a given session.
   *
   * `registerCandidate` dedupes on `trajectory_hash`, and that hash covers
   * EVERY turn of the session — so a session that grows produces a different
   * hash and a brand-new row for work that is the same work. That is how one
   * session ended up with five rows and five `-N` suffixed slug directories on
   * disk. This is the lookup that lets `analyzeSession` recognise "I have
   * already drafted a candidate for this session" and supersede it instead.
   *
   * `json_each` over `source_session_ids` rather than a `LIKE '%id%'` scan:
   * the column is a JSON array and a substring match would also hit a session
   * id that merely CONTAINS this one.
   *
   * Restricted to `status='candidate'` by default and never widened by
   * accident: a promoted row is a shipped skill and a rejected one is a
   * decision already taken, and neither may be rewritten under a session that
   * happens to have grown. `superseded` enforces the same rule from its side.
   */
  findLatestBySourceSession(
    sessionId: string,
    status: SkillStatus = 'candidate',
  ): SkillCandidateRow | null {
    if (!sessionId) return null;
    const stmt = this.db.prepare(
      `SELECT * FROM skill_candidates
        WHERE status = ?
          AND EXISTS (
            SELECT 1 FROM json_each(skill_candidates.source_session_ids)
            WHERE value = ?
          )
        ORDER BY created_at DESC
        LIMIT 1`,
    );
    const raw = stmt.get(status, sessionId) as RawCandidateRow | undefined;
    return raw ? this.toCandidateRow(raw) : null;
  }

  /**
   * Replace the CONTENT of an existing candidate with a newer draft of the
   * same work — the write half of the per-session supersession that stops a
   * growing session minting a new row per re-analysis.
   *
   * `name` is deliberately NOT touched. It is the SKILL.md folder name and it
   * carries a UNIQUE index; renaming it would leave the directory the row
   * points at behind and mint the next one with a `-N` suffix, which is the
   * defect this method exists to remove.
   *
   * The four columns are written as ONE fixed UPDATE, the same rule
   * `recordJudgeVerdict` documents: a partial write would leave the previous
   * draft's `trajectory_hash` beside this draft's body, and the hash is what
   * every other dedupe path reads.
   *
   * Throws for a row that is not `status='candidate'`. A promoted skill has
   * shipped and a rejected one has been decided; rewriting either under a
   * session that grew would silently change an artifact nobody re-reviewed.
   */
  superseded(
    id: CandidateId,
    input: {
      description: string;
      bodyPath: string;
      trajectoryHash: string;
      embedding: Float32Array | null;
    },
  ): SkillCandidateRow {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`[skill-synthesis] superseded: ${id} not found`);
    }
    if (current.status !== 'candidate') {
      throw new Error(
        `[skill-synthesis] superseded: ${id} is '${current.status}', not 'candidate' — a decided row is never rewritten`,
      );
    }

    let embeddingRowid = current.embeddingRowid;
    if (input.embedding && this.vecStatus.available) {
      embeddingRowid = this.insertEmbedding(input.embedding);
    }

    this.db
      .prepare(
        `UPDATE skill_candidates
            SET description     = ?,
                body_path       = ?,
                trajectory_hash = ?,
                embedding_rowid = ?
          WHERE id = ?`,
      )
      .run(
        input.description,
        input.bodyPath,
        input.trajectoryHash,
        embeddingRowid,
        id,
      );

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(
        `[skill-synthesis] superseded: row ${id} disappeared after update`,
      );
    }
    return updated;
  }

  findByName(name: string): SkillCandidateRow | null {
    const stmt = this.db.prepare(
      `SELECT * FROM skill_candidates WHERE name = ? ORDER BY created_at DESC LIMIT 1`,
    );
    const raw = stmt.get(name) as RawCandidateRow | undefined;
    return raw ? this.toCandidateRow(raw) : null;
  }

  /**
   * ## `workspaceRoot` IS OPTIONAL, AND OMITTING IT IS NOT A DEFAULT — IT IS A
   * ## SEPARATE, LOUDER READ.
   *
   * This mirrors `getWinRates` exactly; read its header for the full
   * reasoning, because the same two rules apply here.
   *
   * The unscoped form is what almost every caller wants, and that is not an
   * accident of history. Clustering, dedup, the residency budget, the
   * promotion sweep and the phase-3 gates all read the candidate set ACROSS
   * projects on purpose: a promoted skill is written to `~/.ptah/skills/` and
   * propagated into every workspace, so scoping any of those reads would
   * change what the subsystem does, not just what it shows.
   *
   * Exactly ONE caller passes a root — `SkillsSynthesisRpcHandlers`, backing
   * the Skills tab's list. A candidate is unreviewed work from one session in
   * one project, and the person who can judge it is the person working there.
   * Widening the scoped form into the default would silently re-scope the
   * other six.
   *
   * ## A `NULL` `workspace_root` IS INCLUDED IN A SCOPED READ
   *
   * `workspace_root` is three-valued — a real path is that workspace, `''` is
   * DELIBERATELY cross-project, and `NULL` is UNKNOWN. Every candidate
   * predating `0040` whose queue row the backfill could not resolve is `NULL`,
   * and dropping those would make them invisible in every workspace forever:
   * a display defect traded for silent data loss. `''` is NOT folded in — it
   * is a known value meaning "not this workspace".
   */
  listByStatus(
    status: SkillStatus,
    workspaceRoot?: string,
  ): SkillCandidateRow[] {
    const scoped = workspaceRoot !== undefined;
    const stmt = this.db.prepare(
      scoped
        ? `SELECT * FROM skill_candidates
            WHERE status = ?
              AND (workspace_root = ? OR workspace_root IS NULL)
            ORDER BY created_at DESC`
        : `SELECT * FROM skill_candidates
            WHERE status = ?
            ORDER BY created_at DESC`,
    );
    const rows = (
      scoped ? stmt.all(status, workspaceRoot) : stmt.all(status)
    ) as RawCandidateRow[];
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
   * Invocations are the tracker's `skill_invocation_events` for the row's
   * slug (`name`), so a `-2` suffixed skill counts only its own events.
   */
  listActiveOrderedByDecayScore(
    now: number,
    decayRate: number,
  ): SkillCandidateRow[] {
    const promoted = this.listByStatus('promoted').filter(
      (r) => !r.pinned && r.residency === 'resident',
    );
    if (promoted.length === 0) return [];
    const eventTimes = this.db.prepare(
      `SELECT invoked_at FROM skill_invocation_events
        WHERE skill_slug = ?
        ORDER BY invoked_at DESC
        LIMIT 1000`,
    );
    const scored: Array<{ row: SkillCandidateRow; score: number }> = [];
    for (const row of promoted) {
      const events = eventTimes.all(row.name) as Array<{ invoked_at: number }>;
      let score = 0;
      for (const event of events) {
        const ageDays = Math.max(0, (now - event.invoked_at) / 86400000);
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
   * Promote one candidate and optionally demote the weakest resident as one
   * durable state transition. The explicit transaction is shared by both
   * SQLite bindings; `node:sqlite` deliberately has no `db.transaction()`.
   *
   * `name`, when given, is the materialized directory slug (e.g. `foo-2`) and
   * is written with the promotion. A UNIQUE violation on `name` throws, and the
   * transaction rolls back the demotion with it.
   *
   * `fromStatus: 'rejected'` is the ONE way back from `rejected`, outside
   * `LEGAL_TRANSITIONS`: the startup reconcile re-promotes the rejected row
   * holding an accepted suggestion's slug (`name` is UNIQUE, so a second row
   * cannot be inserted). The write is a compare-and-set on that status; it
   * clears the rejection and makes the row resident. A row no longer
   * `rejected` throws, rolling back the caller's whole unit.
   */
  promoteAtomically(
    id: CandidateId,
    options: {
      promotedAt: number;
      bodyPath: string;
      demotedResidentId?: CandidateId;
      name?: string;
      fromStatus?: 'candidate' | 'rejected';
    },
  ): SkillCandidateRow {
    const fromStatus = options.fromStatus ?? 'candidate';
    const current = this.findById(id);
    if (!current) {
      throw new Error(`[skill-synthesis] promoteAtomically: ${id} not found`);
    }
    if (
      fromStatus === 'candidate' &&
      !LEGAL_TRANSITIONS[current.status].includes('promoted')
    ) {
      throw new Error(
        `[skill-synthesis] illegal status transition ${current.status} → promoted for ${id}`,
      );
    }
    if (options.demotedResidentId === id) {
      throw new Error(
        `[skill-synthesis] promoteAtomically: candidate ${id} cannot demote itself`,
      );
    }
    if (options.name !== undefined && options.name.trim() === '') {
      throw new Error(
        `[skill-synthesis] promoteAtomically: empty slug for candidate ${id}`,
      );
    }

    return this.inImmediateTransaction(() => {
      if (options.demotedResidentId) {
        const demotion = this.db
          .prepare(
            `UPDATE skill_candidates
             SET residency = @residency
             WHERE id = @demotedResidentId
               AND status = @promotedStatus
               AND residency = @residentResidency`,
          )
          .run({
            residency: 'dormant',
            demotedResidentId: options.demotedResidentId,
            promotedStatus: 'promoted',
            residentResidency: 'resident',
          });
        if (demotion.changes !== 1) {
          throw new Error(
            `[skill-synthesis] promoteAtomically: resident ${options.demotedResidentId} was not demotable`,
          );
        }
      }

      const promotion = this.db
        .prepare(
          `UPDATE skill_candidates
           SET status = @promotedStatus,
               promoted_at = @promotedAt,
               body_path = @bodyPath,
               name = COALESCE(@name, name),
               residency = 'resident', rejected_at = NULL, rejected_reason = NULL
           WHERE id = @candidateId AND status = @fromStatus`,
        )
        .run({
          promotedStatus: 'promoted',
          promotedAt: options.promotedAt,
          bodyPath: options.bodyPath,
          name: options.name ?? null,
          candidateId: id,
          fromStatus,
        });
      if (promotion.changes !== 1) {
        throw new Error(
          `[skill-synthesis] promoteAtomically: candidate ${id} was not promotable`,
        );
      }

      const promoted = this.findById(id);
      if (!promoted) {
        throw new Error(
          `[skill-synthesis] promoteAtomically: row ${id} disappeared after update`,
        );
      }
      return promoted;
    });
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
   * Overwrite a just re-promoted row's content with what a freshly registered
   * adopt row would carry (the `fromStatus: 'rejected'` path of
   * {@link promoteAtomically}): description, sources and embedding from the
   * adopt input; display name, workspace root and every judge, replay and
   * trigger measurement reset to NULL. `id`, `name`, `created_at`,
   * `trajectory_hash`, counters and `pinned` are kept.
   *
   * The embedding follows `registerCandidate`: a vec row only when one is
   * given and sqlite-vec is available, else `embedding_rowid` NULL.
   *
   * Plain statements only (it runs inside the adopt transaction, R-f); a row
   * that is not `promoted` throws so the caller's unit rolls back.
   */
  resetRevivedContent(
    id: CandidateId,
    input: {
      description: string;
      sourceSessionIds: string[];
      embedding: Float32Array | null;
    },
  ): SkillCandidateRow {
    const embeddingRowid =
      input.embedding && this.vecStatus.available
        ? this.insertEmbedding(input.embedding)
        : null;
    const result = this.db
      .prepare(
        `UPDATE skill_candidates
            SET description = ?, source_session_ids = ?, embedding_rowid = ?,
                display_name = NULL, workspace_root = NULL,
                judge_score = NULL, judge_status = NULL, judge_reason = NULL,
                judge_novelty = NULL, judge_actionability = NULL,
                judge_scope = NULL, judge_generalization = NULL,
                judge_trigger_clarity = NULL, judge_panel_rationales = NULL,
                judged_at = NULL,
                replay_confidence = NULL, replay_holdout_session_id = NULL,
                replay_at = NULL, trigger_score = NULL,
                trigger_precision = NULL, trigger_recall = NULL,
                trigger_eval_at = NULL
          WHERE id = ? AND status = 'promoted'`,
      )
      .run(
        input.description,
        JSON.stringify(input.sourceSessionIds),
        embeddingRowid,
        id,
      );
    const row = result.changes === 1 ? this.findById(id) : null;
    if (!row) {
      throw new Error(
        `[skill-synthesis] resetRevivedContent: ${id} is not a promoted row`,
      );
    }
    return row;
  }

  /**
   * Every promoted row with the time it was last used, oldest use first: the
   * later of the newest `skill_invocation_events` row for its slug and
   * `promoted_at`, else `created_at`. A row promoted (or re-promoted) within
   * the window is never idle, whatever events its slug had before. One
   * statement; the retirement sweep's input.
   */
  listPromotedLastUse(): Array<{ row: SkillCandidateRow; lastUsedAt: number }> {
    const rows = this.db
      .prepare(
        `SELECT c.*,
                MAX(
                  COALESCE(e.max_invoked_at, c.promoted_at, c.created_at),
                  COALESCE(c.promoted_at, c.created_at)
                ) AS last_used_at
           FROM skill_candidates c
           LEFT JOIN (
             SELECT skill_slug, MAX(invoked_at) AS max_invoked_at
               FROM skill_invocation_events
              GROUP BY skill_slug
           ) e ON e.skill_slug = c.name
          WHERE c.status = 'promoted'
          ORDER BY last_used_at ASC`,
      )
      .all() as Array<RawCandidateRow & { last_used_at: number }>;
    return rows.map((r) => ({
      row: this.toCandidateRow(r),
      lastUsedAt: r.last_used_at,
    }));
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
   * Reject `id` only if it is still `expected` — one compare-and-set UPDATE,
   * the same shape as `promoteAtomically`'s promotion write. Both edges are in
   * `LEGAL_TRANSITIONS`. `false` means another writer decided first; callers
   * log and skip it, never throw.
   */
  rejectIfStatus(
    id: CandidateId,
    expected: 'candidate' | 'promoted',
    reason: string,
    rejectedAt: number = Date.now(),
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE skill_candidates
            SET status = 'rejected', rejected_at = ?, rejected_reason = ?
          WHERE id = ? AND status = ?`,
      )
      .run(rejectedAt, reason, id, expected);
    return result.changes === 1;
  }

  /**
   * Run `fn` in one `BEGIN IMMEDIATE` transaction. Re-entrant: a nested call
   * runs `fn` inline and only the outermost call issues BEGIN/COMMIT/ROLLBACK,
   * so callers can compose store writes (and plain-statement writes of other
   * stores on the same connection) into one unit. Nesting is tracked here, not
   * via `db.inTransaction`, which the node:sqlite adapter does not keep for an
   * `exec('BEGIN')`. An inner throw must propagate so the outer call rolls
   * back; there is no savepoint. Never call a method that opens its own
   * transaction (e.g. `setPin`) from `fn` — SQLite rejects the nested BEGIN.
   */
  inImmediateTransaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth++;
      try {
        return fn();
      } finally {
        this.transactionDepth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth = 1;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
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
   * Persist the judge PANEL's rationales (`0033`'s `judge_panel_rationales`,
   * first written in phase 3).
   *
   * A SIBLING of {@link recordJudgeVerdict}, and deliberately not folded into
   * it. `recordJudgeVerdict` writes the nine columns of ONE verdict as a fixed
   * set; the panel writes the RECORD OF HOW that verdict was reached, and the
   * two are produced at different moments — the `judge` stage scores, the
   * `judge-panel` stage convenes. Folding the column into the verdict write
   * would mean every single-judge run had to blank a panel it never held.
   *
   * ## The column is the whole list, replaced, never appended to
   *
   * One panel run is one deliberation. Appending would let a re-run's panellist
   * A sit beside the previous run's escalation, which reads as a five-way panel
   * nobody convened — the same class of quietly-wrong record the fixed
   * nine-column verdict write exists to prevent.
   *
   * Each entry is validated against the SAME `status`/`score` contract
   * `recordJudgeVerdict` enforces. This is not a second layer above that method:
   * it is this column's own enforcing edge, and it exists because a panel entry
   * is a verdict too — `{status:'unscored', score:10}` would be exactly the
   * fabricated score phase 1 removed, stored one column to the left.
   */
  recordJudgePanel(
    id: CandidateId,
    rationales: readonly JudgePanelRationale[],
  ): SkillCandidateRow {
    if (rationales.length === 0) {
      throw new Error(
        `[skill-synthesis] recordJudgePanel: ${id} was given no rationales; a panel that produced nothing must write nothing`,
      );
    }
    for (const entry of rationales) {
      if (!(JUDGE_PANEL_ROLES as readonly string[]).includes(entry.role)) {
        throw new Error(
          `[skill-synthesis] recordJudgePanel: unknown panel role '${String(
            entry.role,
          )}' (expected ${JUDGE_PANEL_ROLES.join(' | ')})`,
        );
      }
      if (!(JUDGE_STATUSES as readonly string[]).includes(entry.status)) {
        throw new Error(
          `[skill-synthesis] recordJudgePanel: unknown judge status '${String(
            entry.status,
          )}' (expected ${JUDGE_STATUSES.join(' | ')})`,
        );
      }
      if (entry.status === 'scored') {
        if (entry.score === null || !Number.isFinite(entry.score)) {
          throw new Error(
            `[skill-synthesis] recordJudgePanel: a 'scored' ${entry.role} entry for ${id} needs a finite score`,
          );
        }
      } else if (entry.score !== null) {
        throw new Error(
          `[skill-synthesis] recordJudgePanel: a '${entry.status}' ${entry.role} entry for ${id} must carry score=null, got ${entry.score}`,
        );
      }
    }

    this.db
      .prepare(
        `UPDATE skill_candidates SET judge_panel_rationales = ? WHERE id = ?`,
      )
      .run(JSON.stringify(rationales), id);

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`[skill-synthesis] recordJudgePanel: ${id} not found`);
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
    const holdoutSessionId = measurement.holdoutSessionId?.trim() || null;
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
    /**
     * Workspace the invocation happened in (migration `0037`).
     *
     * OPTIONAL AT THE TYPE LEVEL, NEVER FABRICATED AT THE VALUE LEVEL. A
     * caller that does not know the workspace writes NULL, which means
     * "provenance unknown" and is a different fact from `''`, which `0034`
     * spends on `skill_session_verdicts.workspace_root` to mean "deliberately
     * cross-project". Do not coalesce one to the other.
     * `SkillInvocationRecorder` — the only production caller — requires the
     * value on its own input type, so the production path always supplies it.
     */
    workspaceRoot?: string | null;
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
          cost_usd, duration_ms, tool_count, task_id, workspace_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.workspaceRoot ?? null,
    );
  }

  /**
   * Per-slug win rate over the invocation → session-outcome join (plan §2.5,
   * migration `0037`).
   *
   * THE NULL IS THE FEATURE. `winRate = wins / (invocations - unknown)`, and
   * when that denominator is `0` the answer is `null` — NEVER `0`. A skill
   * nobody has measured has no win rate; a skill measured and beaten has a
   * low one. Collapsing the first into `0` ranks the unmeasured skill BELOW
   * the measured loser in every consumer that sorts on this number (dormancy
   * demotion, the auto-enhance gate, the weekly digest), which is exactly
   * backwards: the unmeasured skill is the one we know least about and the one
   * demotion must touch LAST. This is the same asymmetry `0033` established for
   * `judge_score` and `0036` for the empirical gates.
   *
   * The three buckets partition on `evidence_class`, and `no-correction` is
   * deliberately in NONE of them: it is weak evidence of success, so it is
   * neither a win (it does not enter the numerator) nor unknown (it does not
   * leave the denominator). A session whose verdict row is absent entirely
   * counts as unknown, which is what makes a host that never ran the
   * archaeologist report `null` instead of a fabricated `0`.
   *
   * Aggregated in SQL, divided in TypeScript: SQLite's integer division would
   * turn every rate below 1 into `0`, and a `CAST(... AS REAL)` would still
   * have to answer for the zero denominator somewhere. One place to get the
   * rule wrong is better than two.
   *
   * ## `workspaceRoot` IS OPTIONAL, AND OMITTING IT IS NOT A DEFAULT — IT IS A
   * ## DIFFERENT QUESTION
   *
   * Four callers ask a CROSS-PROJECT question and pass nothing: the enhancer's
   * eligibility gate, the promotion service's dormancy ranking and the
   * scorecard's RPC read all ask "what is this skill's track record", and a
   * skill's track record does not stop at a repo boundary. The weekly gap
   * digest asks the other question — "how is this skill doing HERE" — because
   * its other three sweeps are workspace-scoped through
   * `SessionVerdictStore.listByWorkspace` and a per-workspace digest carrying
   * one cross-project row is something a user notices. Widening the scoped form
   * into the default would silently re-scope the other three.
   *
   * ## A `NULL` `workspace_root` IS INCLUDED IN A SCOPED READ
   *
   * `0037` added the column as nullable and spelled out what the three values
   * mean: a real path is that workspace, `''` is DELIBERATELY cross-project,
   * and `NULL` is "recorded before phase 4 threaded the value through,
   * provenance unknown". Only the third is in question here, and the predicate
   * keeps it, because excluding it is the worse error in a way that is easy to
   * miss. Every event on every install that has history predates `0037`, so a
   * `NULL`-excluding predicate empties the denominator on exactly those
   * installs — and an empty denominator is `winRate: null`, which the digest
   * renders as "no measured outcome yet". That would retitle a skill's real,
   * measured track record as an ABSENT measurement, the same `null`-is-never-a
   * measurement inversion this method's header forbids, arriving from the other
   * direction. Keeping the row instead can only over-attribute work whose
   * provenance nobody recorded, and it is still strictly NARROWER than the
   * cross-project answer the digest read before, so the change cannot regress
   * anything. The `NULL` pool is also fixed in size and stops growing the
   * moment `0037` lands, so the scoping sharpens by itself as events accrue.
   *
   * `''` is NOT folded in — it is a known value meaning "not this workspace",
   * and `0037` is explicit that no consumer may coalesce `NULL` to `''`. The
   * caller that genuinely wants the cross-project feed passes `''` and gets
   * `''`-plus-unknown rows, exactly as `listByWorkspace('')` behaves.
   *
   * Two whole static statements rather than one built by concatenation: this
   * directory's SQL must stay free of `${...}` interpolation, and a predicate
   * spliced in at runtime is precisely the shape that rule exists to keep out.
   */
  getWinRates(workspaceRoot?: string): SkillWinRate[] {
    const scoped = workspaceRoot !== undefined;
    const statement = this.db.prepare(
      scoped
        ? `SELECT e.skill_slug,
                  COUNT(*) AS invocations,
                  SUM(CASE WHEN v.evidence_class IN
                        ('tests-green','user-accepted','explicit-confirmation')
                      THEN 1 ELSE 0 END) AS wins,
                  SUM(CASE WHEN v.session_id IS NULL OR v.evidence_class = 'unverified'
                      THEN 1 ELSE 0 END) AS unknown
           FROM skill_invocation_events e
           LEFT JOIN skill_session_verdicts v ON v.session_id = e.session_id
           WHERE e.workspace_root = ? OR e.workspace_root IS NULL
           GROUP BY e.skill_slug`
        : `SELECT e.skill_slug,
                  COUNT(*) AS invocations,
                  SUM(CASE WHEN v.evidence_class IN
                        ('tests-green','user-accepted','explicit-confirmation')
                      THEN 1 ELSE 0 END) AS wins,
                  SUM(CASE WHEN v.session_id IS NULL OR v.evidence_class = 'unverified'
                      THEN 1 ELSE 0 END) AS unknown
           FROM skill_invocation_events e
           LEFT JOIN skill_session_verdicts v ON v.session_id = e.session_id
           GROUP BY e.skill_slug`,
    );
    const rows = (
      scoped ? statement.all(workspaceRoot) : statement.all()
    ) as RawWinRateRow[];

    return rows.map((r) => {
      const invocations = r.invocations ?? 0;
      const wins = r.wins ?? 0;
      const unknown = r.unknown ?? 0;
      const measured = invocations - unknown;
      return {
        slug: r.skill_slug,
        invocations,
        wins,
        unknown,
        winRate: measured > 0 ? wins / measured : null,
      };
    });
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
      { id: string } | undefined;
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

  /**
   * Newest-first tracker events for a candidate, read by its slug (`name`) from
   * `skill_invocation_events` and mapped onto the `SkillInvocationRow` wire
   * shape (`skillId` = the candidate id, `notes` = the event `source`).
   * Unknown id or non-positive limit → `[]`.
   */
  listInvocationEvents(
    candidateId: CandidateId,
    limit: number,
  ): SkillInvocationRow[] {
    if (limit <= 0) return [];
    const row = this.findById(candidateId);
    if (!row) return [];
    const rows = this.db
      .prepare(
        `SELECT id, session_id, succeeded, invoked_at, source, context_id
           FROM skill_invocation_events
          WHERE skill_slug = ?
          ORDER BY invoked_at DESC
          LIMIT ?`,
      )
      .all(row.name, limit) as RawInvocationEventRow[];
    return rows.map((r) => ({
      id: r.id,
      skillId: candidateId,
      sessionId: r.session_id,
      succeeded: r.succeeded === 1,
      invokedAt: r.invoked_at,
      notes: r.source,
      contextId: r.context_id ?? null,
    }));
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

  getStats(): SkillCandidateStats {
    const c = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END) AS candidates,
           SUM(CASE WHEN status = 'promoted' THEN 1 ELSE 0 END) AS promoted,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN status = 'promoted' AND residency = 'resident'
                    THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'promoted' AND residency = 'dormant'
                    THEN 1 ELSE 0 END) AS dormant,
           SUM(CASE WHEN status = 'rejected' AND rejected_reason LIKE ?
                    THEN 1 ELSE 0 END) AS merged,
           SUM(CASE WHEN status = 'rejected' AND rejected_reason = ?
                    THEN 1 ELSE 0 END) AS retired
         FROM skill_candidates`,
      )
      .get(`${MERGED_INTO_PREFIX}%`, RETIRED_UNUSED_REASON) as
      RawLifecycleCountsRow | undefined;
    const invocations = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM skill_invocation_events
          WHERE skill_slug IN
            (SELECT name FROM skill_candidates WHERE status = 'promoted')`,
      )
      .get() as { n: number } | undefined;
    return {
      candidates: c?.candidates ?? 0,
      promoted: c?.promoted ?? 0,
      rejected: c?.rejected ?? 0,
      active: c?.active ?? 0,
      dormant: c?.dormant ?? 0,
      merged: c?.merged ?? 0,
      retired: c?.retired ?? 0,
      invocations: invocations?.n ?? 0,
    };
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
      // degradation-audit: optional-capability - Vector embeddings are
      // cache-like enrichment; null means this candidate has no readable
      // vector.
      this.logger.warn('[skill-synthesis] failed to read embedding', {
        rowid,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private toCandidateRow(raw: RawCandidateRow): SkillCandidateRow {
    return toCandidateRow(raw, this.logger);
  }

  private generateCandidateId(): string {
    return ulid();
  }

  private generateInvocationId(): string {
    return ulid();
  }
}
