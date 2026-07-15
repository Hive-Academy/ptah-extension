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
