/**
 * SkillQueueStore — CRUD over `skill_synthesis_queue` (migration `0032`).
 *
 * Two primitives live here and they are deliberately NOT the same one:
 *
 * 1. **Enqueue is idempotent, not at-most-once.** It is a plain `INSERT` whose
 *    `UNIQUE(session_id, stage)` violation is caught and turned into a *guarded
 *    re-open* `UPDATE` gated on `turn_count`. No `INSERT OR IGNORE`, no UPSERT
 *    (the rule stated at `run.store.ts:6-9`): both would swallow the collision
 *    and hand back a row the caller has no right to act on. The guard is what
 *    preserves today's "re-analyze a session only once it has grown" semantics
 *    — `SkillSynthesisService.analyzedSessions` is a `Map<sessionId, highest
 *    analyzed turn count>`, not a seen-set — and it preserves them *durably and
 *    across windows*, which the in-memory Map never did.
 *
 * 2. **Claiming IS the at-most-once primitive**, expressed as a compare-and-swap
 *    because the row pre-exists (unlike `job_runs`, where the INSERT is the
 *    claim). `tryClaim` returning `null` means another worker won the race —
 *    success-by-another-worker, exactly as `JobRunner` treats
 *    `SlotAlreadyClaimedError` (`job-runner.ts:119-125`). It NEVER throws for
 *    that case.
 *
 * Both run inside an explicit `BEGIN IMMEDIATE` … `COMMIT`, the same idiom the
 * migration runner uses (`migration-runner.ts:221`), so the CAS is atomic
 * across processes sharing `~/.ptah/state/ptah.sqlite` — a VS Code window and
 * the Electron app draining at the same instant is the case this exists for.
 *
 * `touchClaim` is the other half of the claim contract: a stage that legitimately
 * runs for minutes (the archaeologist makes several LLM round trips) heartbeats
 * its claim so `reapStale` cannot reclaim it mid-flight. A worker whose
 * `touchClaim` returns `false` has already lost the row and must stop writing to
 * it.
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  isUniqueConstraintError,
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type {
  EnqueueInput,
  EnqueueResult,
  MarkOptions,
  MarkUnscoredOptions,
  SkillQueueRow,
  SkillQueueSource,
  SkillQueueStage,
  SkillQueueStatus,
} from './skill-queue.types';

interface RawQueueRow {
  id: string;
  session_id: string;
  workspace_root: string;
  transcript_path: string | null;
  source: string;
  stage: string;
  depends_on: string | null;
  status: string;
  turn_count: number;
  attempt_count: number;
  enqueued_at: number;
  not_before: number;
  claimed_by: string | null;
  claimed_at: number | null;
  finished_at: number | null;
  lane: string | null;
  reason: string | null;
  last_error: string | null;
  candidate_id: string | null;
  payload: string;
}

/** Set by `reapStale` so the Activity surface can explain the reset. */
export const STALE_CLAIM_REASON = 'reclaimed after stale claim TTL';

const INSERT_SQL = `INSERT INTO skill_synthesis_queue
     (id, session_id, workspace_root, transcript_path, source, stage,
      depends_on, status, turn_count, attempt_count, enqueued_at, not_before,
      lane, payload)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?)`;

/**
 * The guarded re-open. Three guards, all load-bearing:
 *  - `status IN (...)` — an in-flight row (`queued`/`claimed`/`running`) is
 *    never disturbed, so a concurrent claim cannot be stolen from under a worker.
 *  - `turn_count < ?` — the session must have GROWN. This is the durable
 *    successor to the `analyzedSessions` Map comparison.
 *  - `attempt_count = 0` — a re-opened row gets a fresh retry budget.
 *
 * ## `payload` is deliberately NOT cleared here — and MERGING IS NOT CLEARING
 *
 * Clearing looks right: a re-opened row re-runs its stage from scratch, so the
 * previous pass's `verdictFallback` is a stale record. It is nonetheless the
 * wrong fix. `payload` also carries the PRODUCER'S INPUTS (which candidate a
 * `judge-panel` or `trigger-eval` row is grading), so a row wiped to `{}` would
 * be dispatched to a handler with nothing to work on — a stale field traded for
 * a dead row. Selectively dropping one key in SQL
 * (`json_remove(payload, '$.verdictFallback')`) was considered and rejected
 * too: it hard-codes one gate's output key into the store, which would then
 * need editing every time a stage learned a new one.
 *
 * `enqueue` DOES merge the caller's payload onto the row it re-opens, and that
 * is a different operation in both directions. Clearing destroys keys nobody
 * named; the merge writes only the keys the producer named THIS pass and leaves
 * every other key — including a stage output the store knows nothing about —
 * exactly where it was. **Do not "simplify" the merge back into a clear, and do
 * not read the merge as licence to clear.** Both mistakes are the same mistake:
 * the store deciding the fate of a key it does not own.
 *
 * So the rule is OWNERSHIP, enforced by {@link SkillQueueStore.mergePayload}
 * and by `enqueue`'s re-open branch rather than by this statement. Each writer
 * refreshes its own keys: the replay handler writes `verdictFallback` on EVERY
 * path it can return through, so a finished row never shows a previous pass's
 * flag, and a producer re-points a re-opened row at the candidate the current
 * pass produced. `candidate_id` is preserved here for the same reason and has
 * been since day one.
 *
 * ## Why the re-point rides `enqueue`'s transaction and not a second call
 *
 * It used to be a second call: the producer ran `enqueue`, saw `reopened`, then
 * ran `mergePayload`. Two `BEGIN IMMEDIATE` blocks, and between the two commits
 * the row sat `queued` carrying the PREVIOUS pass's `candidateId`. `CLAIM_SQL`
 * gates on `status` alone, so a second host draining the shared
 * `~/.ptah/state/ptah.sqlite` could claim it in that window, read the stale id
 * and grade a SUPERSEDED candidate — then `markDone` the row, so the candidate
 * that should have been measured never would be. Silent: no error, no reason
 * token, a plausible verdict on the wrong row. Re-opening and re-pointing in
 * ONE transaction closes the window; it is the same read-modify-write argument
 * `mergePayload` already makes for itself.
 */
const REOPEN_SQL = `UPDATE skill_synthesis_queue
      SET status = 'queued', turn_count = ?, attempt_count = 0,
          claimed_by = NULL, claimed_at = NULL, finished_at = NULL,
          not_before = 0, reason = NULL, last_error = NULL
    WHERE session_id = ? AND stage = ?
      AND status IN ('done', 'failed', 'unscored', 'skipped')
      AND turn_count < ?`;

const CLAIM_SQL = `UPDATE skill_synthesis_queue
      SET status = 'claimed', claimed_by = ?, claimed_at = ?,
          attempt_count = attempt_count + 1
    WHERE id = ? AND status IN ('queued', 'unscored')`;

/**
 * The eligibility scan, per workspace. Joins `depends_on` so a stage never runs
 * ahead of its ancestor, and orders by `enqueued_at` only WITHIN one workspace —
 * global `enqueued_at` ordering is what would let one busy project starve the
 * others (R4).
 */
const ELIGIBLE_SQL = `SELECT q.* FROM skill_synthesis_queue q
     LEFT JOIN skill_synthesis_queue d ON d.id = q.depends_on
    WHERE q.status IN ('queued', 'unscored')
      AND q.not_before <= ?
      AND (q.depends_on IS NULL OR d.status = 'done')
      AND q.workspace_root = ?
    ORDER BY q.enqueued_at ASC
    LIMIT ?`;

/**
 * Distinct eligible workspaces, least-recently-drained first. A workspace with
 * no cursor row sorts first (`COALESCE(..., 0)`), so a brand-new project is
 * served before one that was drained a second ago.
 *
 * `GROUP BY` rather than `SELECT DISTINCT` — SQLite rejects an `ORDER BY` term
 * that is not in a `DISTINCT` result set.
 */
const ELIGIBLE_WORKSPACES_SQL = `SELECT q.workspace_root AS workspace_root,
          COALESCE(MIN(c.last_drained_at), 0) AS last_drained_at
     FROM skill_synthesis_queue q
     LEFT JOIN skill_synthesis_queue d ON d.id = q.depends_on
     LEFT JOIN skill_synthesis_workspace_cursor c
            ON c.workspace_root = q.workspace_root
    WHERE q.status IN ('queued', 'unscored')
      AND q.not_before <= ?
      AND (q.depends_on IS NULL OR d.status = 'done')
    GROUP BY q.workspace_root
    ORDER BY last_drained_at ASC, q.workspace_root ASC`;

@injectable()
export class SkillQueueStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  /**
   * Insert the row, or re-open a finished one whose session has grown.
   * Never inserts a duplicate: `UNIQUE(session_id, stage)` is the gate.
   */
  enqueue(input: EnqueueInput): EnqueueResult {
    const turnCount = input.turnCount ?? 0;
    return this.inImmediateTransaction<EnqueueResult>(() => {
      const id = ulid();
      try {
        this.db
          .prepare(INSERT_SQL)
          .run(
            id,
            input.sessionId,
            input.workspaceRoot ?? '',
            input.transcriptPath ?? null,
            input.source,
            input.stage,
            input.dependsOn ?? null,
            turnCount,
            input.enqueuedAt ?? Date.now(),
            input.notBefore ?? 0,
            input.lane ?? null,
            JSON.stringify(input.payload ?? {}),
          );
        return { outcome: 'created', row: this.findById(id) };
      } catch (error: unknown) {
        if (!isUniqueConstraintError(error)) throw error;
      }

      const changes = Number(
        this.db
          .prepare(REOPEN_SQL)
          .run(turnCount, input.sessionId, input.stage, turnCount).changes,
      );
      const outcome = changes > 0 ? 'reopened' : 'unchanged';
      const row = this.findBySessionStage(input.sessionId, input.stage);
      if (outcome !== 'reopened' || !row) return { outcome, row };

      // The caller's payload is MERGED onto the re-opened row, inside the same
      // transaction as the re-open. See the header note above `REOPEN_SQL`:
      // merging is not clearing, and the two must not be confused.
      const merged = this.mergePayloadWithin(row.id, input.payload ?? {});
      return { outcome, row: merged ? { ...row, payload: merged } : row };
    });
  }

  /**
   * Compare-and-swap the row into `claimed`. Returns the claimed row, or `null`
   * when another worker won — which is a normal outcome, not an error.
   */
  tryClaim(
    id: string,
    claimedBy: string,
    now: number = Date.now(),
  ): SkillQueueRow | null {
    return this.inImmediateTransaction<SkillQueueRow | null>(() => {
      const changes = Number(
        this.db.prepare(CLAIM_SQL).run(claimedBy, now, id).changes,
      );
      if (changes === 0) return null;
      return this.findById(id);
    });
  }

  /**
   * Heartbeat a live claim so a long-but-legitimate run is not reaped.
   *
   * Returns `false` when the row is no longer claimed — it was already reaped,
   * or finished. The caller has lost the row and must stop working on it; that
   * is the whole point of returning a boolean rather than `void`.
   */
  touchClaim(id: string, now: number = Date.now()): boolean {
    const changes = Number(
      this.db
        .prepare(
          `UPDATE skill_synthesis_queue SET claimed_at = ?
            WHERE id = ? AND status IN ('claimed', 'running')`,
        )
        .run(now, id).changes,
    );
    return changes > 0;
  }

  markDone(
    id: string,
    opts: MarkOptions & { candidateId?: string } = {},
  ): void {
    this.db
      .prepare(
        `UPDATE skill_synthesis_queue
            SET status = 'done', finished_at = ?, last_error = NULL,
                reason = ?, candidate_id = COALESCE(?, candidate_id)
          WHERE id = ?`,
      )
      .run(
        opts.finishedAt ?? Date.now(),
        opts.reason ?? null,
        opts.candidateId ?? null,
        id,
      );
  }

  /**
   * Terminal failure. There is no backoff parameter on purpose: a `failed` row
   * is not re-eligible — it re-opens only through `enqueue`, once the session
   * grows past its `turn_count`.
   */
  markFailed(id: string, lastError: string, opts: MarkOptions = {}): void {
    this.db
      .prepare(
        `UPDATE skill_synthesis_queue
            SET status = 'failed', finished_at = ?, last_error = ?, reason = ?
          WHERE id = ?`,
      )
      .run(opts.finishedAt ?? Date.now(), lastError, opts.reason ?? null, id);
  }

  /**
   * The stage ran and produced nothing usable. The row stays re-eligible under
   * `not_before` — that is Phase 0's rate-limit backoff, with no new machinery.
   *
   * NOTE: `skill_synthesis_queue.status = 'unscored'` is NOT
   * `skill_candidates.judge_status = 'unscored'`. The two must not be conflated.
   */
  markUnscored(id: string, opts: MarkUnscoredOptions = {}): void {
    this.db
      .prepare(
        `UPDATE skill_synthesis_queue
            SET status = 'unscored', finished_at = ?, reason = ?, not_before = ?
          WHERE id = ?`,
      )
      .run(
        opts.finishedAt ?? Date.now(),
        opts.reason ?? null,
        opts.notBefore ?? 0,
        id,
      );
  }

  /**
   * Put a CLAIMED row back on the queue behind a backoff. This is the transport
   * half of the failure taxonomy: a lane that timed out, or whose configured
   * provider is present but unusable (Q2), has produced no verdict at all and
   * must simply be tried again later.
   *
   * ## Why this is not `markUnscored`, and not `markFailed`
   *
   * `unscored` is a JUDGE outcome — "we ran, and we do not know". Reusing it for
   * a transport failure would make `skill_synthesis_queue.status = 'unscored'`
   * mean two unrelated things, and the Activity surface could no longer tell a
   * model that declined to score from an endpoint that never answered.
   * `markFailed` is terminal with no backoff: a `failed` row re-opens only
   * through `enqueue` once the session grows, which is exactly wrong for an
   * endpoint that will probably work in half an hour.
   *
   * ## The status guard
   *
   * `status IN ('claimed', 'running')` for the same reason `touchClaim` has it:
   * only an in-flight row may be requeued. A worker whose claim `reapStale`
   * already returned to `queued` gets `false` and must stop writing — otherwise
   * it would overwrite the reap reason and push `not_before` out on a row it no
   * longer owns. Like `touchClaim`, the guard is on STATUS, not on `claimed_by`;
   * B0.3 set that bar and widening it here alone would be a second contract.
   *
   * `last_error` is deliberately left as it was — it is diagnostic-only, never
   * rendered, and clearing it on every retry would erase the trail of what the
   * previous attempts hit. `reason` IS user-facing and is overwritten.
   */
  requeue(id: string, notBefore: number, reason: string): boolean {
    return this.inImmediateTransaction<boolean>(() => {
      const changes = Number(
        this.db
          .prepare(
            `UPDATE skill_synthesis_queue
                SET status = 'queued', not_before = ?, reason = ?,
                    claimed_by = NULL, claimed_at = NULL, finished_at = NULL
              WHERE id = ? AND status IN ('claimed', 'running')`,
          )
          .run(notBefore, reason, id).changes,
      );
      return changes > 0;
    });
  }

  /**
   * Shallow-merge `patch` over the row's stored `payload`. The patch wins per
   * key; every key it does not name survives.
   *
   * ## Why this exists at all
   *
   * `INSERT_SQL` was the ONLY writer of this column, and `REOPEN_SQL` still
   * does not touch it. So a stage that learns something WHILE it runs — the
   * replay gate measuring on fallback evidence — had nowhere to put it. This is
   * that writer, and it is the MID-RUN one: the other half of the payload's
   * ownership, a producer re-pointing a re-opened row at the candidate this
   * pass produced, now rides `enqueue`'s own transaction rather than calling
   * back in here, because a re-open followed by a separate merge leaves a
   * window in which another host can claim the row and grade the stale
   * candidate.
   *
   * ## Merge, never overwrite, never append
   *
   * `payload` carries a producer's INPUTS (which candidate to grade) beside a
   * stage's OUTPUTS (`verdictFallback`). Blind-overwriting the column from a
   * handler would delete the inputs the handler was dispatched with; appending
   * would grow the column without bound on a row that re-opens every time its
   * session grows. A shallow merge is the only shape where both owners can
   * write their own keys and neither can destroy the other's.
   *
   * ## It runs inside `inImmediateTransaction`, and that is not decoration
   *
   * This is a read-modify-write, which is exactly the case that helper exists
   * for — the same reason `enqueue` and `tryClaim` take it. Two hosts draining
   * the shared `~/.ptah/state/ptah.sqlite` at the same instant is a real
   * configuration (a VS Code window and the Electron app), and a DEFERRED read
   * followed by a late write would let the second host's UPDATE land on a
   * payload it never read — silently dropping the first host's key rather than
   * merging it. Taking the write lock up front makes the read and the write one
   * atomic step.
   *
   * An unparseable stored payload degrades through `parsePayload`, which
   * already warns and yields `{}`. Re-parsing here with its own `try` would be
   * a second definition of "what a bad payload means", and the two would drift
   * the first time either changed.
   *
   * A row that does not exist is a silent no-op, matching every other guarded
   * UPDATE in this store: the caller has lost the row, and inventing one would
   * be worse than writing nothing.
   */
  mergePayload(id: string, patch: Record<string, unknown>): void {
    this.inImmediateTransaction<void>(() => {
      this.mergePayloadWithin(id, patch);
    });
  }

  /**
   * The merge itself, for a caller that ALREADY HOLDS the write transaction.
   * Returns the merged payload, or `null` when there was nothing to do — the
   * row is gone, or the patch names no keys.
   *
   * It exists because `enqueue`'s re-open branch has to merge inside its own
   * `BEGIN IMMEDIATE`, and calling {@link mergePayload} from there would nest a
   * second one. Extracting the body is the only shape where both callers run
   * the SAME merge: a second copy of these four lines would be a second
   * definition of what "shallow merge, patch wins per key" means, and the two
   * would drift the first time either changed.
   *
   * An empty patch writes nothing rather than re-writing the column with its
   * own contents. Three of the four production `enqueue` callers pass no
   * payload at all, and a re-open should not touch a column no producer named.
   */
  private mergePayloadWithin(
    id: string,
    patch: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (Object.keys(patch).length === 0) return null;
    const raw = this.db
      .prepare(`SELECT payload FROM skill_synthesis_queue WHERE id = ?`)
      .get(id) as { payload: string } | undefined;
    if (!raw) return null;
    const merged = { ...this.parsePayload(raw.payload), ...patch };
    this.db
      .prepare(`UPDATE skill_synthesis_queue SET payload = ? WHERE id = ?`)
      .run(JSON.stringify(merged), id);
    return merged;
  }

  /** The stage was not worth running (prefilter rejection, disabled feature). */
  markSkipped(id: string, opts: MarkOptions = {}): void {
    this.db
      .prepare(
        `UPDATE skill_synthesis_queue
            SET status = 'skipped', finished_at = ?, reason = ?
          WHERE id = ?`,
      )
      .run(opts.finishedAt ?? Date.now(), opts.reason ?? null, id);
  }

  /**
   * Return claims older than `ttlMs` to `queued`. Runs at the head of every
   * drain and at `SkillSynthesisService.start()`, so a row claimed by a process
   * that was killed mid-stage is not stranded forever.
   *
   * Returns the number of rows reclaimed.
   */
  reapStale(ttlMs: number, now: number = Date.now()): number {
    const cutoff = now - ttlMs;
    const changes = Number(
      this.db
        .prepare(
          `UPDATE skill_synthesis_queue
              SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
                  reason = ?
            WHERE status IN ('claimed', 'running') AND claimed_at < ?`,
        )
        .run(STALE_CLAIM_REASON, cutoff).changes,
    );
    if (changes > 0) {
      this.logger.warn('[skill-synthesis] reclaimed stale queue claims', {
        count: changes,
        ttlMs,
      });
    }
    return changes;
  }

  /** Eligible workspaces, least-recently-drained first (round-robin order). */
  listEligibleWorkspaces(now: number = Date.now()): string[] {
    const rows = this.db.prepare(ELIGIBLE_WORKSPACES_SQL).all(now) as Array<{
      workspace_root: string;
    }>;
    return rows.map((r) => r.workspace_root);
  }

  /** Eligible rows for one workspace, oldest first. */
  listEligible(
    workspaceRoot: string,
    limit: number,
    now: number = Date.now(),
  ): SkillQueueRow[] {
    const rows = this.db
      .prepare(ELIGIBLE_SQL)
      .all(now, workspaceRoot, limit) as RawQueueRow[];
    return rows.map((r) => this.toRow(r));
  }

  /** Most recently enqueued rows, any status — the Activity surface's feed. */
  listRecent(limit: number): SkillQueueRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM skill_synthesis_queue
          ORDER BY enqueued_at DESC LIMIT ?`,
      )
      .all(limit) as RawQueueRow[];
    return rows.map((r) => this.toRow(r));
  }

  /**
   * Record that `workspaceRoot` was visited by a drain tick. Without this the
   * round-robin cursor never advances and `listEligibleWorkspaces` returns the
   * same head forever.
   */
  markWorkspaceDrained(workspaceRoot: string, at: number = Date.now()): void {
    const changes = Number(
      this.db
        .prepare(
          `UPDATE skill_synthesis_workspace_cursor
              SET last_drained_at = ? WHERE workspace_root = ?`,
        )
        .run(at, workspaceRoot).changes,
    );
    if (changes === 0) {
      this.db
        .prepare(
          `INSERT INTO skill_synthesis_workspace_cursor
             (workspace_root, last_drained_at) VALUES (?, ?)`,
        )
        .run(workspaceRoot, at);
    }
  }

  findById(id: string): SkillQueueRow | null {
    const raw = this.db
      .prepare(`SELECT * FROM skill_synthesis_queue WHERE id = ?`)
      .get(id) as RawQueueRow | undefined;
    return raw ? this.toRow(raw) : null;
  }

  findBySessionStage(
    sessionId: string,
    stage: SkillQueueStage,
  ): SkillQueueRow | null {
    const raw = this.db
      .prepare(
        `SELECT * FROM skill_synthesis_queue
          WHERE session_id = ? AND stage = ?`,
      )
      .get(sessionId, stage) as RawQueueRow | undefined;
    return raw ? this.toRow(raw) : null;
  }

  /**
   * `BEGIN IMMEDIATE` … `COMMIT` around `fn`, rolling back if it throws.
   *
   * IMMEDIATE (not DEFERRED) because `enqueue` and `tryClaim` read-then-write: a
   * deferred transaction takes its write lock late and can lose the row it just
   * read. `requeue` uses it too — a single guarded UPDATE does not strictly need
   * it, but taking the write lock up front is what keeps two hosts draining the
   * same `~/.ptah/state/ptah.sqlite` off each other's `SQLITE_BUSY` path.
   *
   * `db.exec('BEGIN IMMEDIATE')` rather than better-sqlite3's `db.transaction()`:
   * the latter does not exist on the built-in `node:sqlite` binding the specs
   * fall back to, so using it would make these transitions unassertable on any
   * machine where the Electron-ABI `better-sqlite3` cannot load.
   */
  private inImmediateTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private toRow(raw: RawQueueRow): SkillQueueRow {
    return {
      id: raw.id,
      sessionId: raw.session_id,
      workspaceRoot: raw.workspace_root,
      transcriptPath: raw.transcript_path,
      source: raw.source as SkillQueueSource,
      stage: raw.stage as SkillQueueStage,
      dependsOn: raw.depends_on,
      status: raw.status as SkillQueueStatus,
      turnCount: raw.turn_count,
      attemptCount: raw.attempt_count,
      enqueuedAt: raw.enqueued_at,
      notBefore: raw.not_before,
      claimedBy: raw.claimed_by,
      claimedAt: raw.claimed_at,
      finishedAt: raw.finished_at,
      lane: raw.lane,
      reason: raw.reason,
      lastError: raw.last_error,
      candidateId: raw.candidate_id,
      payload: this.parsePayload(raw.payload),
    };
  }

  private parsePayload(json: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      this.logger.warn('[skill-synthesis] unparseable queue payload', { json });
    }
    return {};
  }
}
