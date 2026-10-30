/**
 * Lane outcome contracts (TASK_2026_646): the record the outcome pipeline
 * writes, the summary the router reads, the per-slug signals the Agents tab
 * shows, and the two ports between the libraries (SC-1, SC-2, SC-4).
 *
 * Privacy rule (Req 5.8): only the classifier input's transient `brief` may
 * carry text. Never persist or log it. Outcome records hold ids, enums and
 * numbers only, apart from existing join metadata.
 *
 * This file is the one definition backend and webview share. The SQLite row
 * (migration 0054) keeps `family TEXT` nullable, but the write-edge schema in
 * lane-outcomes requires a non-empty `family` (decision I2), so the record
 * type declares it non-null.
 */

import type { AgentStatus, LaneCompletionVerdict } from './agent-process.types';

export const OUTCOME_TASK_KINDS = [
  'plan',
  'implement',
  'review',
  'research',
  'tests',
  'docs',
] as const;
export type OutcomeTaskKind = (typeof OUTCOME_TASK_KINDS)[number];
export const OUTCOME_TASK_KIND_SOURCES = [
  'explicit',
  'mapped',
  'classified',
  'unclassified',
] as const;
export type OutcomeTaskKindSource = (typeof OUTCOME_TASK_KIND_SOURCES)[number];
export const LANE_FAILURE_CLASSES = [
  'usage-limit',
  'auth',
  'crash',
  'timeout',
  'bad-output',
] as const;
export type LaneFailureClass = (typeof LANE_FAILURE_CLASSES)[number];
export const OUTCOME_ROUTING_SOURCES = [
  'model',
  'ranking',
  'pin',
  'not-routed',
] as const;
export type OutcomeRoutingSource = (typeof OUTCOME_ROUTING_SOURCES)[number];
export type OutcomeExecutorKind = 'cli' | 'ptah-cli' | 'subagent';
export type OutcomeFinalReview = 'approved' | 'rejected';
/**
 * How a subagent record's tokens/cost/duration were obtained (Req 5.4).
 * Lanes: 'not-applicable'.
 */
export type OutcomeTelemetryJoin =
  'matched' | 'unmatched' | 'ambiguous' | 'unavailable' | 'not-applicable';

/**
 * Executor id of every subagent record (Req 5.2 "or `subagent`"); the slug is
 * in `role`.
 */
export const SUBAGENT_LANE_ID = 'subagent';
/**
 * Model value of a run spawned without a model (Req 5.2); routing treats it
 * as its own model key.
 */
export const LANE_DEFAULT_MODEL = 'lane-default';

/** One completed lane run, as the outcome pipeline persists it. */
export interface LaneOutcomeRecord {
  /** Lane: `${agentId}:${completedAt}` (the notifier dedup key); subagent: `subagent:${agentId}`. */
  readonly runId: string;
  readonly executorKind: OutcomeExecutorKind;
  /** cli id, ptahCliId, or {@link SUBAGENT_LANE_ID}. */
  readonly laneId: string;
  readonly agentId: string;
  /** Session and workspace identifiers for subagent telemetry joins; null for lanes. */
  readonly subagentSessionId?: string | null;
  readonly parentSessionId?: string | null;
  readonly workspaceRoot?: string | null;
  /** `laneFamilyOf(...)` at write time (SC-5); `SUBAGENT_FAMILY` for subagents. */
  readonly family: string;
  readonly provider: string | null;
  /** As spawned; {@link LANE_DEFAULT_MODEL} when spawned without one. */
  readonly model: string;
  /** Lane role; subagent slug. */
  readonly role: string | null;
  /** null = not routed with one. */
  readonly taskKind: OutcomeTaskKind | null;
  /** Null for older rows whose provenance is unknown. */
  readonly taskKindSource: OutcomeTaskKindSource | null;
  readonly taskId: string | null;
  readonly verdict: LaneCompletionVerdict;
  readonly failureClass: LaneFailureClass | null;
  readonly startedAt: number | null;
  /** Epoch ms. */
  readonly endedAt: number;
  readonly durationMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly routingSource: OutcomeRoutingSource;
  /** Count of `revise` verdicts; 0 is a real count, not "unknown". */
  readonly reviseRounds: number;
  /** null = "not reviewed". */
  readonly finalReview: OutcomeFinalReview | null;
  /** Set by the first `deliverables` report (finding 4). */
  readonly deliverablesDeclaredAt: number | null;
  readonly telemetryJoin: OutcomeTelemetryJoin;
  /** null = unknown, never [] for unknown. */
  readonly skillsLoaded: readonly string[] | null;
  /** `skill_session_verdicts.evidence_class` for the run's session, if a row exists. */
  readonly sessionEvidenceClass: string | null;
}

/** What routing reads. Holds no text. */
export type LaneOutcomeSummary = Pick<
  LaneOutcomeRecord,
  | 'runId'
  | 'laneId'
  | 'family'
  | 'model'
  | 'taskKind'
  | 'verdict'
  | 'failureClass'
  | 'finalReview'
  | 'reviseRounds'
  | 'durationMs'
  | 'endedAt'
  | 'routingSource'
  | 'inputTokens'
  | 'outputTokens'
  | 'costUsd'
>;

export interface OutcomeRatio {
  readonly numerator: number;
  readonly denominator: number;
}

export interface AgentOutcomeSignals {
  readonly slug: string;
  readonly windowDays: number;
  /** Records in window; 0 → UI "no data yet". */
  readonly runCount: number;
  /** Req 9.1 definition; denominator 0 → "no verified runs". */
  readonly delivered: OutcomeRatio;
  /** Denominator 0 → "not reviewed yet". */
  readonly reviewPass: OutcomeRatio;
  /** One decimal; null when reviewPass.denominator === 0. */
  readonly avgReviseRounds: number | null;
  /** Tie → the newest occurrence wins; null → "no failures recorded". */
  readonly topFailureClass: LaneFailureClass | null;
}

/**
 * The only outcome interface lane-routing sees (SC-2). lane-outcomes extends
 * it with its own queries and registers one service under it.
 */
export interface LaneOutcomeReader {
  /**
   * Records of one lane with `endedAt >= window.sinceMs`, newest first.
   * Never rejects: store failure → [] + log. Unknown laneId → [].
   * Target latency 200 ms; routing races it inside its 2000 ms gather
   * deadline.
   */
  recentOutcomes(
    laneId: string,
    window: { readonly sinceMs: number },
  ): Promise<readonly LaneOutcomeSummary[]>;
  /**
   * True when the active durable store is readable (SQLite open in
   * desktop/CLI, the IStateStorage-backed store in VS Code; SC-10). False
   * only while the desktop/CLI DB is not yet open or no store is registered
   * → routing adds the Req 4.5 "no outcome history" reason and uses
   * seed/neutral scores.
   */
  isPersistent(): boolean;
}

/**
 * What lane-outcomes hands the failure classifier: ids, enums and numbers
 * only, no text (NFR Security).
 */
export interface LaneFailureClassificationInput {
  readonly runId: string;
  readonly executorKind: Exclude<OutcomeExecutorKind, 'subagent'>;
  readonly family: string;
  readonly status: AgentStatus;
  readonly verdict: Extract<LaneCompletionVerdict, 'no-deliverable' | 'failed'>;
  /** APM's limit classifier output, e.g. 'quota'. */
  readonly failureKind: string | null;
  readonly exitCode: number | null;
  readonly durationMs: number | null;
}

/**
 * Port lane-outcomes calls to ask lane-routing to classify a failure
 * (SC-4, Req 10.3 / 12.5).
 */
export interface LaneFailureClassifier {
  /**
   * Never rejects. Unset decision model → null with zero requests. At most
   * one request per call.
   */
  classify(
    input: LaneFailureClassificationInput,
  ): Promise<LaneFailureClass | null>;
}

/** Transient classifier input; `brief` must never be persisted or logged. */
export interface LaneTaskKindClassificationInput {
  readonly runId: string;
  readonly executorKind: OutcomeExecutorKind;
  readonly role: string | null;
  readonly brief: string;
}

/** Port lane-outcomes calls to classify a task kind after insertion. */
export interface LaneTaskKindClassifier {
  /** Never rejects; an unset model returns null after zero requests. */
  classify(input: LaneTaskKindClassificationInput): Promise<OutcomeTaskKind | null>;
}
