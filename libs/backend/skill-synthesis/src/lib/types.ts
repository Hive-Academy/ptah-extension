/**
 * skill-synthesis — internal types.
 *
 * Branded IDs are kept inside this library because they are not consumed
 * across library boundaries. Cross-library code only sees the higher-level
 * `SkillCandidateRow` / `SkillInvocationRow` row shapes.
 */

export const JUDGE_DEFAULT_MODEL_ID = 'claude-haiku-4-5-20251001';

/** Opaque identifier for a row in `skill_candidates` (status='promoted'). */
export type SkillId = string & { readonly __brand: 'SkillId' };
/** Opaque identifier for any `skill_candidates` row regardless of status. */
export type CandidateId = string & { readonly __brand: 'CandidateId' };

/** Status values mirror the SQL CHECK constraint exactly. */
export type SkillStatus = 'candidate' | 'promoted' | 'rejected';

/**
 * Residency values mirror the SQL CHECK constraint exactly. `resident` skills
 * are fed to the junction layer; `dormant` skills are skipped there (kept in
 * the DB + on disk for future re-promotion) so they no longer consume the
 * prompt budget.
 */
export type SkillResidency = 'resident' | 'dormant';

/** Row shape for `skill_candidates`. */
export interface SkillCandidateRow {
  id: CandidateId;
  name: string;
  description: string;
  bodyPath: string;
  sourceSessionIds: string[];
  trajectoryHash: string;
  embeddingRowid: number | null;
  status: SkillStatus;
  successCount: number;
  failureCount: number;
  createdAt: number;
  promotedAt: number | null;
  rejectedAt: number | null;
  rejectedReason: string | null;
  pinned: boolean;
  residency: SkillResidency;
}

/** Row shape for `skill_invocations`. */
export interface SkillInvocationRow {
  id: string;
  skillId: CandidateId;
  sessionId: string;
  succeeded: boolean;
  invokedAt: number;
  notes: string | null;
  contextId: string | null;
}

/**
 * Per-invocation runtime metrics for a subagent run, extracted from the
 * subagent transcript at SubagentStop (token classes, cost, duration, tool
 * count). Every field is nullable: providers that report no usage
 * (Copilot/Codex/ollama) yield all-null metrics, which SQL AVG()/SUM()
 * exclude rather than count as zero.
 */
export interface SubagentRunMetrics {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly costUsd: number | null;
  readonly durationMs: number | null;
  readonly toolCount: number | null;
}

/** Settings projection used by the synthesis service. */
export interface SkillSynthesisSettings {
  enabled: boolean;
  successesToPromote: number;
  dedupCosineThreshold: number;
  maxActiveSkills: number;
  /** Absolute path to candidates dir; empty string ⇒ derive from homedir. */
  candidatesDir: string;
  /** Minimum number of turns in a session for trajectory extraction eligibility. */
  eligibilityMinTurns: number;
  /** Exponential decay rate (0-1) applied to invocation recency scoring. */
  evictionDecayRate: number;
  /** Minimum distinct context count for accelerated promotion threshold. */
  generalizationContextThreshold: number;
  /** Cosine distance threshold for cluster-centroid deduplication (0-1). */
  dedupClusterThreshold: number;
  /** Minimum edit count for the prefilter edit-only acceptance path. */
  prefilterMinEdits: number;
  /** Minimum canonical-text length for the prefilter tool-heavy acceptance path. */
  prefilterMinChars: number;
  /** Minimum tool_use count for the prefilter tool-heavy acceptance path. */
  prefilterMinToolUses: number;
  /** Whether the LLM-as-judge gate is active during promotion. */
  judgeEnabled: boolean;
  /** Minimum composite judge score (0-10) required for promotion. */
  minJudgeScore: number;
  /** Model identifier for the LLM judge; 'inherit' resolves to workspace default. */
  judgeModel: string;
  /** Maximum number of manually pinned skills allowed simultaneously. */
  maxPinnedSkills: number;
  /** Whether the Curator service runs on a background interval. */
  curatorEnabled: boolean;
  /** Interval in hours between automatic Curator passes. */
  curatorIntervalHours: number;
  /** Minimum cluster size that triggers a cluster-based skill suggestion. */
  suggestionMinClusterSize: number;
  /** Maximum number of most-recent candidates fed into the clustering pass. */
  suggestionMaxCandidates: number;
}

/** Options for storing a new candidate (pre-insert shape). */
export interface NewCandidateInput {
  name: string;
  description: string;
  bodyPath: string;
  sourceSessionIds: string[];
  trajectoryHash: string;
  embedding: Float32Array | null;
  createdAt: number;
}

/** Result returned to callers when a new candidate is registered. */
export interface RegisterCandidateResult {
  candidate: SkillCandidateRow;
  /** True if this trajectory already existed and the row was reused. */
  reused: boolean;
}

/** Lifecycle states of a cluster-level skill suggestion. */
export type SkillSuggestionStatus = 'pending' | 'accepted' | 'dismissed';

/** Row shape for `skill_suggestions`. */
export interface SkillSuggestionRow {
  id: string;
  name: string;
  description: string;
  body: string;
  memberSessionIds: string[];
  memberCandidateIds: string[];
  clusterSize: number;
  technologyFingerprint: string;
  judgeScore: number;
  status: SkillSuggestionStatus;
  createdAt: number;
  decidedAt: number | null;
}

/** Pre-insert shape for a new pending suggestion. */
export interface NewSuggestionInput {
  name: string;
  description: string;
  body: string;
  memberSessionIds: string[];
  memberCandidateIds: string[];
  clusterSize: number;
  technologyFingerprint: string;
  judgeScore: number;
}
