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
 * The judge verdict vocabulary (migration `0033`).
 *
 * THIS UNION IS THE ONLY ENFORCEMENT THERE IS. `0033` deliberately ships
 * `judge_status` with NO `CHECK` constraint: SQLite cannot widen a CHECK with
 * `ALTER TABLE`, and phases 3/4 add scoring paths, so the vocabulary is not
 * knowable up front. The price of that choice is that `SkillCandidateStore` —
 * the single gate every read and write passes through — has to do the
 * enforcing, on BOTH edges: `recordJudgeVerdict` rejects a non-member, and
 * `toCandidateRow` refuses to hand an unrecognized string to a consumer that
 * has been told the type is this union.
 */
export const JUDGE_STATUSES = ['scored', 'unscored', 'disabled'] as const;

export type JudgeStatus = (typeof JUDGE_STATUSES)[number];

/**
 * The five criteria `SkillJudgeService` scores. Persisted individually rather
 * than only as an average so the UI can render a scorecard, and so a verdict
 * that is strong on novelty but weak on scope is legible instead of collapsed
 * into one number. `null` per criterion means "this criterion was not scored".
 */
export interface JudgeCriterionScores {
  novelty: number | null;
  actionability: number | null;
  scope: number | null;
  generalization: number | null;
  triggerClarity: number | null;
}

/**
 * A judge outcome as written by the promotion gate.
 *
 * `score: null` IS THE `unscored` VERDICT — it is not a low score and it is not
 * zero. It is the representation that phase 1 exists to introduce: before it,
 * an LLM error, a rate limit, or an unparseable reply made the judge fail OPEN
 * and fabricate `{ passed: true, score: 10 }`, which the UI then rendered as a
 * genuine perfect verdict. A candidate whose judge call failed must read back
 * as "we do not know", carry the reason, and stay eligible for a retry.
 */
export interface JudgeVerdict {
  status: JudgeStatus;
  /** `null` for every non-`scored` status. Never coalesce this to 0. */
  score: number | null;
  /** Why. For `unscored` this is the failure ("rate limited"), not a critique. */
  reason: string | null;
  /** Omit entirely when the judge produced no per-criterion breakdown. */
  criteria?: JudgeCriterionScores;
  /** Defaults to `Date.now()`. */
  judgedAt?: number;
}

/**
 * Residency values mirror the SQL CHECK constraint exactly. `resident` skills
 * are fed to the junction layer; `dormant` skills are skipped there (kept in
 * the DB + on disk for future re-promotion) so they no longer consume the
 * prompt budget.
 */
export type SkillResidency = 'resident' | 'dormant';

/**
 * Row shape for `skill_candidates`.
 *
 * The `judge*` / `displayName` block below is the `0033` column set. It lives
 * ON this type rather than beside it: every row the store can hand back has
 * been through `toCandidateRow`, which always populates them, so a separate
 * "judged" row type would have described a shape that never exists at runtime.
 * A row that predates `0033` reads back with `judgeStatus: null` — "never
 * judged" — which is a value, not an absence.
 */
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
  // ── 0033 judge verdict ────────────────────────────────────────────────────
  /** `null` = never judged (every row predating `0033`). */
  judgeStatus: JudgeStatus | null;
  /** `null` = unscored. Distinct from a genuine `0`. */
  judgeScore: number | null;
  judgeReason: string | null;
  judgeCriteria: JudgeCriterionScores;
  /** Raw JSON text; phase 3 owns the shape and the parse. Read-only here. */
  judgePanelRationales: string | null;
  judgedAt: number | null;
  /**
   * Human-readable title. `name` is a slug derived from the first 140
   * characters of the first user message — it is an internal id and the
   * SKILL.md folder name, and must never be rendered as a title.
   */
  displayName: string | null;
}

/**
 * The `0033` columns as a standalone block, projected off the row so the two
 * can never drift. Consumers that hand a verdict around without the rest of
 * the candidate (the promotion gate, the RPC summary mapper) take this.
 */
export type JudgeVerdictFields = Pick<
  SkillCandidateRow,
  | 'judgeStatus'
  | 'judgeScore'
  | 'judgeReason'
  | 'judgeCriteria'
  | 'judgePanelRationales'
  | 'judgedAt'
  | 'displayName'
>;

/**
 * @deprecated Use {@link SkillCandidateRow} — the judge fields are on it now.
 * Kept as an alias only so the phase-1 batches that were written against the
 * intersection keep compiling; delete once they have all landed.
 */
export type JudgedCandidateRow = SkillCandidateRow;

/**
 * The verdict block of a candidate that has never been judged.
 *
 * A fresh factory call rather than a shared frozen constant because the row
 * fields are mutable and callers spread this into a row they then own; handing
 * out one shared `judgeCriteria` object would alias five nullable numbers
 * across every unjudged row in the process.
 */
export function unjudgedVerdictFields(): JudgeVerdictFields {
  return {
    judgeStatus: null,
    judgeScore: null,
    judgeReason: null,
    judgeCriteria: {
      novelty: null,
      actionability: null,
      scope: null,
      generalization: null,
      triggerClarity: null,
    },
    judgePanelRationales: null,
    judgedAt: null,
    displayName: null,
  };
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

/**
 * Aggregated scorecard metrics for a single subagent slug, produced by ONE
 * `GROUP BY skill_slug` pass over its `source='subagent'` invocation events.
 * `total`/`graded`/`gradedSucceeded` are always concrete counts; every
 * token/cost/duration/tool average or sum is nullable because SQL AVG()/SUM()
 * return NULL when no row carries that metric (providers without usage). A slug
 * with no rows yields a fully zeroed/nulled aggregate — never an error.
 */
export interface ScorecardAggregate {
  slug: string;
  total: number;
  graded: number;
  gradedSucceeded: number;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  avgCacheReadTokens: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  avgToolCount: number | null;
}

/**
 * A single graded (reconciled) subagent invocation row for the detail view.
 * `verdictSource` distinguishes exact (`spec:TASK_X`) from heuristic
 * (`spec-window:TASK_X`) attribution; callers map it to an `exactAttribution`
 * flag. All metric fields are nullable (usage-less providers).
 */
export interface GradedInvocationRow {
  taskId: string | null;
  succeeded: boolean;
  verdictSource: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
  invokedAt: number;
  reconciledAt: number;
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
