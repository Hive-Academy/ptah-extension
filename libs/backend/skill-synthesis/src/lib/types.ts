/**
 * skill-synthesis — internal types.
 *
 * Branded IDs are kept inside this library because they are not consumed
 * across library boundaries. Cross-library code only sees the higher-level
 * `SkillCandidateRow` / `SkillInvocationRow` row shapes.
 */

/** Opaque identifier for a row in `skill_candidates` (status='promoted'). */
export type SkillId = string & { readonly __brand: 'SkillId' };
/** Opaque identifier for any `skill_candidates` row regardless of status. */
export type CandidateId = string & { readonly __brand: 'CandidateId' };

/** Status values mirror the SQL CHECK constraint exactly. */
export type SkillStatus = 'candidate' | 'promoted' | 'rejected';

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
  /** Minimum ratio of trajectory turns to total session turns (0-1). */
  minTrajectoryFidelityRatio: number;
  /** Cosine distance threshold for cluster-centroid deduplication (0-1). */
  dedupClusterThreshold: number;
  /** Minimum normalized Levenshtein edit distance to accept a candidate (0-1). */
  minAbstractionEditDistance: number;
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
