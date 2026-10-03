/**
 * Row mappers of {@link SkillCandidateStore}: the raw `skill_candidates`
 * shape a `SELECT *` returns, and its translation into
 * {@link SkillCandidateRow}. Kept beside the store so the store holds only
 * statements (TASK_2026_578, R-h line budget).
 */
import type { Logger } from '@ptah-extension/vscode-core';
import {
  JUDGE_STATUSES,
  type CandidateId,
  type JudgeStatus,
  type SkillCandidateRow,
  type SkillStatus,
} from './types';

export interface RawCandidateRow {
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
  // ── 0040 ──────────────────────────────────────────────────────────────────
  // Same `SELECT *` trap as the two blocks below. `NULL` here means UNKNOWN
  // origin and is INCLUDED by a workspace-scoped read; a column missing from
  // this interface reads back `undefined`, becomes `null`, and every candidate
  // silently reverts to appearing in every workspace — the defect `0040`
  // exists to fix, looking exactly like the fix working.
  workspace_root: string | null;
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

/**
 * Read edge of the `judge_status` union. `null` and `''` mean "never judged".
 * Anything else that is not a union member is downgraded to `'unscored'` —
 * the value that means "no trustworthy verdict" — and logged. There is no DB
 * `CHECK` to have caught it, and the alternative (passing the raw string
 * through a field typed as the union) would lie to every consumer.
 */
function toJudgeStatus(raw: string | null, logger: Logger): JudgeStatus | null {
  if (raw === null || raw === '') return null;
  if ((JUDGE_STATUSES as readonly string[]).includes(raw)) {
    return raw as JudgeStatus;
  }
  logger.warn(
    '[skill-synthesis] unknown judge_status read from skill_candidates; treating as unscored',
    { judgeStatus: raw },
  );
  return 'unscored';
}

export function toCandidateRow(
  raw: RawCandidateRow,
  logger: Logger,
): SkillCandidateRow {
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
    // `?? null` normalizes a driver's `undefined` for an absent column. It
    // does NOT coalesce to `''` — `null` is "origin unknown" and `''` is
    // "deliberately cross-project", and only the second is a claim.
    workspaceRoot: raw.workspace_root ?? null,
    judgeStatus: toJudgeStatus(raw.judge_status, logger),
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
