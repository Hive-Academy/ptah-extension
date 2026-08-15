/**
 * RPC contracts for the skill clone/enhance/reconcile surface
 * (`skillSynthesis:` namespace, P3-3).
 *
 * Shared MUST NOT import backend libs, so the registry kind / clone-status
 * literals are mirrored here rather than imported from skill-synthesis.
 */

export type SkillCloneKind = 'skill' | 'agent' | 'command';
export type SkillCloneStatus = 'clone' | 'authored' | 'synth' | 'diverged';

export interface CloneSummary {
  slug: string;
  kind: SkillCloneKind;
  cloneStatus: SkillCloneStatus;
  diverged: boolean;
  invocationCount: number;
  successRate: number;
  lastEnhancedAt: number | null;
  historyCount: number;
  pendingSourceHash: string | null;
  /** Recorded invocations required before auto-enhancement becomes eligible. */
  enhanceMinInvocations: number;
  /**
   * Epoch ms until which auto-enhancement is on cooldown after the last
   * enhancement, or `null` when never enhanced (no cooldown active).
   */
  enhanceCooldownUntil: number | null;
}

export interface SkillCloneHistoryEntry {
  ts: string;
  hasBody: boolean;
}

export interface SkillCloneInvocationStats {
  total: number;
  succeeded: number;
  failed: number;
  distinctContexts: number;
}

export type SkillSynthesisListClonesParams = Record<string, never>;
export interface SkillSynthesisListClonesResult {
  clones: CloneSummary[];
}

export interface SkillSynthesisGetCloneParams {
  slug: string;
  kind: SkillCloneKind;
}
export interface SkillSynthesisGetCloneResult {
  clone: CloneSummary | null;
  body: string | null;
  history: SkillCloneHistoryEntry[];
}

export interface SkillSynthesisEnhanceNowParams {
  kind: SkillCloneKind;
  slug: string;
}
export interface SkillSynthesisEnhanceNowResult {
  changed: boolean;
  slug: string;
  kind: SkillCloneKind;
  judgeScore: number | null;
  judgeReason: string | null;
  historyTs: string | null;
  skipReason: string | null;
}

/**
 * Preview-before-apply (enhancement proposal) surface.
 *
 * `previewEnhancement` runs generation + judging WITHOUT touching disk and
 * parks the proposed body in a short-lived server-side cache keyed by an
 * opaque `proposalId`. `applyProposal` then commits that exact body, so Apply
 * never re-runs the LLM and never applies a body the user did not see.
 *
 * When `proposed` is `false`, `proposalId` is `null` and `skipReason` explains
 * why. `currentBody` / `proposedBody` / `judgeScore` / `judgeReason` are still
 * populated whenever they are known (e.g. a judge-rejected candidate), so the
 * UI can render the rejected diff alongside the reason.
 */
export interface SkillSynthesisPreviewEnhancementParams {
  kind: SkillCloneKind;
  slug: string;
}
export interface SkillSynthesisPreviewEnhancementResult {
  proposed: boolean;
  skipReason: string | null;
  currentBody: string | null;
  proposedBody: string | null;
  judgeScore: number | null;
  judgeReason: string | null;
  proposalId: string | null;
}

export interface SkillSynthesisApplyProposalParams {
  kind: SkillCloneKind;
  slug: string;
  proposalId: string;
}
export interface SkillSynthesisApplyProposalResult {
  applied: boolean;
  historyTs: string | null;
}

/**
 * Body of one `.history/<ts>/` snapshot, so a past enhancement can be diffed
 * before reverting. `body` is `null` when the snapshot exists but carries no
 * artifact file (or the timestamp is unknown).
 */
export interface SkillSynthesisGetHistoryBodyParams {
  kind: SkillCloneKind;
  slug: string;
  ts: string;
}
export interface SkillSynthesisGetHistoryBodyResult {
  body: string | null;
  ts: string;
}

export interface SkillSynthesisRevertEnhancementParams {
  kind: SkillCloneKind;
  slug: string;
  historyTs: string;
}
export interface SkillSynthesisRevertEnhancementResult {
  reverted: boolean;
  slug: string;
  revertedFrom: string;
  newHistoryTs: string | null;
}

export interface SkillSynthesisRebaseCloneParams {
  kind: SkillCloneKind;
  slug: string;
}
export interface SkillSynthesisRebaseCloneResult {
  kind: SkillCloneKind;
  slug: string;
  sourceHash: string;
  snapshotPath: string | null;
  failed: boolean;
  reason: string | null;
}

export interface SkillSynthesisKeepCloneParams {
  kind: SkillCloneKind;
  slug: string;
}
export interface SkillSynthesisKeepCloneResult {
  kind: SkillCloneKind;
  slug: string;
  sourceHash: string;
}

export interface SkillSynthesisInvocationStatsParams {
  slug: string;
}
export interface SkillSynthesisInvocationStatsResult {
  slug: string;
  stats: SkillCloneInvocationStats;
}

/**
 * Batched per-subagent scorecard surfaced on agent clone cards in the Library
 * tab. Composed from graded orchestration runs (reconciled spec verdicts) plus
 * NULL-excluding metric aggregates. `gradedSuccessRate` is `null` (never a fake
 * 0%) when nothing has been graded; token and cost fields are independently
 * nullable so a usage-bearing-but-price-less provider still shows tokens.
 */
export interface AgentScorecard {
  slug: string;
  totalInvocations: number;
  gradedCount: number;
  gradedSuccessRate: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  avgCacheReadTokens: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  avgToolCount: number | null;
  /**
   * `wins / measured` over the invocation → session-outcome join
   * (TASK_2026_180 task B4.4.3), or `null` when nothing has been measured.
   *
   * `null` IS NEVER `0`. `0` means every measured session lost; `null` means
   * no session settled either way. Because `0` is falsy, a `||` anywhere on
   * this path — the handler, the RPC client, the template — silently retitles a
   * measured failure as an absent measurement. Use `??` or `=== null`.
   *
   * OPTIONAL rather than required, and the reason is structural: the aggregate
   * comes from `SkillScorecardService.getScorecards`, while the win rate is a
   * separate pass over a different join (`getWinRates`) that the RPC handler
   * runs and merges in. A required field here would force every producer of an
   * `AgentScorecard` to answer a question it did not ask, so `undefined` means
   * "this host did not compute it" and stays distinct from both `null` and `0`.
   */
  winRate?: number | null;
  recentVerdicts: Array<{
    taskId: string;
    succeeded: boolean;
    reconciledAt: number;
  }>;
}

/**
 * One graded invocation row in the lazily-loaded scorecard detail view.
 * `exactAttribution` is `true` for `spec:` provenance (exact task_id match) and
 * `false` for `spec-window:` (heuristic time-window fallback) so the UI can
 * mark heuristically-attributed rows distinctly.
 */
export interface ScorecardInvocationRow {
  taskId: string | null;
  succeeded: boolean;
  exactAttribution: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
  invokedAt: number;
  reconciledAt: number;
}

export interface SkillSynthesisGetScorecardsParams {
  slugs: string[];
}
export interface SkillSynthesisGetScorecardsResult {
  scorecards: Record<string, AgentScorecard>;
}

export interface SkillSynthesisGetScorecardDetailParams {
  slug: string;
  limit?: number;
}
export interface SkillSynthesisGetScorecardDetailResult {
  slug: string;
  rows: ScorecardInvocationRow[];
  /** MAX_FINDINGS_CHARS-bounded review excerpt, detail-only; null when absent. */
  findingsExcerpt: string | null;
}
