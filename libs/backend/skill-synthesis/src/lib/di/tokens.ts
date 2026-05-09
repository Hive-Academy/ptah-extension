/**
 * DI Token Registry — Skill Synthesis Tokens (Track 2).
 *
 * Convention mirrors `libs/backend/agent-sdk/src/lib/di/tokens.ts`:
 *  - Always `Symbol.for('Name')` (globally interned).
 *  - Each description globally unique across all token files.
 *  - Frozen `as const` so consumers narrow on the symbol values.
 */
export const SKILL_SYNTHESIS_TOKENS = {
  /** SkillSynthesisService — top-level orchestrator (analyzes sessions). */
  SKILL_SYNTHESIS_SERVICE: Symbol.for('PtahSkillSynthesisService'),
  /** SkillPromotionService — applies the 3-success threshold + dedup + cap. */
  SKILL_PROMOTION_SERVICE: Symbol.for('PtahSkillPromotionService'),
  /** SkillInvocationTracker — records per-session invocations (success/fail). */
  SKILL_INVOCATION_TRACKER: Symbol.for('PtahSkillInvocationTracker'),
  /** SkillCandidateStore — SQLite persistence layer for candidates + vec rows. */
  SKILL_CANDIDATE_STORE: Symbol.for('PtahSkillCandidateStore'),
  /** SkillClusterDedupService — cluster-centroid dedup for promoted skills. */
  SKILL_CLUSTER_DEDUP_SERVICE: Symbol.for('PtahSkillClusterDedupService'),
  /** SkillJudgeService — LLM-as-judge gate during promotion. */
  SKILL_JUDGE_SERVICE: Symbol.for('PtahSkillJudgeService'),
  /** SkillCuratorService — Hermes-style periodic skill curation daemon. */
  SKILL_CURATOR_SERVICE: Symbol.for('PtahSkillCuratorService'),
} as const;

export type SkillSynthesisDIToken = keyof typeof SKILL_SYNTHESIS_TOKENS;
