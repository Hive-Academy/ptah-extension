/**
 * The wire shape of `skill_synthesis_queue` (migration `0032`).
 *
 * The two member lists below are the TypeScript half of a schema contract whose
 * other half is a SQLite `CHECK` constraint that cannot be widened by
 * `ALTER TABLE`. They must stay member-for-member identical to `0032`; the
 * co-located store specs pin them against the shipped migration SQL so a drift
 * fails in CI rather than as a constraint violation on a user's database.
 *
 * Phase 0 only ever writes four stages and four statuses. The other members are
 * declared up front on purpose — see the header of
 * `0032_skill_synthesis_queue.ts`.
 */
import type { AnalyzeSource } from '../skill-synthesis.service';

/** Every `stage` member `0032` accepts, in DDL order. */
export const SKILL_QUEUE_STAGES = [
  'prefilter',
  'archaeology',
  'synthesis',
  'embedding',
  'clustering',
  'cluster-synthesis',
  'judge',
  'judge-panel',
  'replay',
  'trigger-eval',
  'digest',
] as const;

export type SkillQueueStage = (typeof SKILL_QUEUE_STAGES)[number];

/** Every `status` member `0032` accepts, in DDL order. */
export const SKILL_QUEUE_STATUSES = [
  'queued',
  'claimed',
  'running',
  'done',
  'failed',
  'unscored',
  'skipped',
] as const;

export type SkillQueueStatus = (typeof SKILL_QUEUE_STATUSES)[number];

/**
 * Why the row was enqueued. Identical to the trigger taxonomy the inline
 * pipeline already uses, so an enqueued row carries the same provenance the
 * old `analyzeSession(source)` call did.
 */
export type SkillQueueSource = AnalyzeSource;

/** One row of `skill_synthesis_queue`, camel-cased. */
export interface SkillQueueRow {
  id: string;
  sessionId: string;
  /** Round-robin fairness key. `''` for cross-project stages (clustering). */
  workspaceRoot: string;
  transcriptPath: string | null;
  source: SkillQueueSource;
  stage: SkillQueueStage;
  /** Self-reference into the stage DAG; the ancestor must be `done`. */
  dependsOn: string | null;
  status: SkillQueueStatus;
  /**
   * Trajectory turn count at enqueue time. This is the durable replacement for
   * `SkillSynthesisService.analyzedSessions` — a `Map<sessionId, highest turn
   * count>`, NOT a seen-set. A finished row re-opens only when the session has
   * grown past this number, which is what makes "re-analyze once it grew"
   * survive a window restart.
   */
  turnCount: number;
  attemptCount: number;
  enqueuedAt: number;
  /** Epoch ms before which the row is not eligible. `0` = eligible now. */
  notBefore: number;
  claimedBy: string | null;
  /** Heartbeated by `touchClaim`; drives stale-claim reaping. */
  claimedAt: number | null;
  finishedAt: number | null;
  lane: string | null;
  /** SHORT and user-facing — rendered in Activity. */
  reason: string | null;
  /** Diagnostic only; never rendered. */
  lastError: string | null;
  candidateId: string | null;
  payload: Record<string, unknown>;
}

/** Everything `enqueue` needs. Only `sessionId`, `stage` and `source` are required. */
export interface EnqueueInput {
  sessionId: string;
  stage: SkillQueueStage;
  source: SkillQueueSource;
  workspaceRoot?: string;
  transcriptPath?: string | null;
  /** Highest analyzed turn count; gates the guarded re-open. Defaults to 0. */
  turnCount?: number;
  dependsOn?: string | null;
  lane?: string | null;
  notBefore?: number;
  payload?: Record<string, unknown>;
  /** Test seam for a deterministic clock. */
  enqueuedAt?: number;
}

/**
 * What `enqueue` did.
 *
 * - `created`   — no row existed for `(session_id, stage)`.
 * - `reopened`  — a finished row existed and the session had grown, so it was
 *                 reset to `queued`.
 * - `unchanged` — a row existed that is either still in flight or has not
 *                 grown past its recorded `turnCount`. Not an error.
 */
export type EnqueueOutcome = 'created' | 'reopened' | 'unchanged';

export interface EnqueueResult {
  outcome: EnqueueOutcome;
  row: SkillQueueRow | null;
}

/** A single row's terminal-state annotation. */
export interface MarkOptions {
  /** SHORT, user-facing. Rendered in Activity. */
  reason?: string;
  /** Test seam for a deterministic clock. */
  finishedAt?: number;
}

/**
 * `unscored` is the only terminal-looking status that stays re-eligible, so it
 * is the only one that carries a backoff.
 */
export interface MarkUnscoredOptions extends MarkOptions {
  /** Epoch ms before which the row must not be re-claimed. Defaults to 0. */
  notBefore?: number;
}
