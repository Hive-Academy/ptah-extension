import { randomUUID } from 'node:crypto';
import {
  LANE_DEFAULT_MODEL,
  SUBAGENT_FAMILY,
  SUBAGENT_LANE_ID,
  type LaneFailureClassifier,
  type LaneFailureClassificationInput,
  type LaneOutcomeRecord,
  type LaneTaskKindClassificationInput,
  type LaneTaskKindClassifier,
  type OutcomeExecutorKind,
  type OutcomeTaskKind,
  type OutcomeTaskKindSource,
} from '@ptah-extension/shared';
import type {
  SdkAdapterSubagentEndedEvent,
  SubagentStopPayload,
} from '@ptah-extension/agent-sdk';
import { LaneOutcomeRowSchema } from './lane-outcome.schema';
import type { LaneOutcomeLogger } from './lane-outcome-logger';
import { parseReviewDeliverable } from './review-verdict.parser';
import type { LaneOutcomeStore } from './store/lane-outcome.store';
import { subagentRunId } from './subagent-join';
import { taskKindForRole } from './task-kind-mapping';
import {
  DeliverablesPayloadSchema,
  ReviewPayloadSchema,
  deterministicReviewReportId,
} from './write/report-effect';
import type {
  OutcomeWritePipeline,
  OutcomeWriteResult,
} from './write/outcome-write-pipeline';

export type LaneCompletionOutcomeInput = Omit<
  LaneOutcomeRecord,
  | 'executorKind'
  | 'taskKindSource'
  | 'telemetryJoin'
  | 'skillsLoaded'
  | 'sessionEvidenceClass'
> & {
  executorKind: Exclude<LaneOutcomeRecord['executorKind'], 'subagent'>;
} & Pick<LaneFailureClassificationInput, 'status' | 'failureKind' | 'exitCode'>;

/**
 * Transient lane-completion input that never reaches a row, the journal or a
 * log line. `brief` feeds the task-kind classifier only and is dropped once
 * classification settles or its entry is evicted.
 */
export interface LaneCompletionTransient {
  readonly brief?: string;
}

/** Most pending classification briefs and remembered subagent runs. */
const RECORDER_MEMORY_LIMIT = 200;
/** Longest brief handed to the task-kind classifier. */
const BRIEF_MAX_CHARS = 4000;
const REPORT_HOLD_MS = 24 * 60 * 60 * 1000;

interface ResolvedTaskKind {
  readonly taskKind: OutcomeTaskKind | null;
  readonly taskKindSource: OutcomeTaskKindSource;
}

/** Explicit → mapped → unclassified; classification happens after insert. */
function resolveTaskKind(
  explicit: OutcomeTaskKind | null,
  role: string | null,
): ResolvedTaskKind {
  if (explicit) return { taskKind: explicit, taskKindSource: 'explicit' };
  const mapped = taskKindForRole(role);
  if (mapped) return { taskKind: mapped, taskKindSource: 'mapped' };
  return { taskKind: null, taskKindSource: 'unclassified' };
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : 'UNKNOWN';
}

/** Adds a key, dropping the oldest entries past the recorder memory limit. */
function rememberBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > RECORDER_MEMORY_LIMIT) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/**
 * An unclassified, unverified subagent row for a run the host never saw stop
 * (external MCP callers). Also the base every subagent producer row builds on.
 */
export function reportedSubagentStopRow(
  agentId: string,
  nowMs: number,
): LaneOutcomeRecord {
  return {
    runId: subagentRunId(agentId),
    executorKind: 'subagent',
    laneId: SUBAGENT_LANE_ID,
    agentId,
    subagentSessionId: null,
    parentSessionId: null,
    workspaceRoot: null,
    family: SUBAGENT_FAMILY,
    provider: null,
    model: LANE_DEFAULT_MODEL,
    role: null,
    taskKind: null,
    taskKindSource: 'unclassified',
    taskId: null,
    verdict: 'unverified',
    failureClass: null,
    startedAt: null,
    endedAt: nowMs,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    routingSource: 'not-routed',
    reviseRounds: 0,
    finalReview: null,
    deliverablesDeclaredAt: null,
    telemetryJoin: 'unavailable',
    skillsLoaded: null,
    sessionEvidenceClass: null,
  };
}

interface SubagentStopFacts {
  readonly agentId: string;
  readonly agentType: string | null;
  readonly subagentSessionId: string | null;
  readonly parentSessionId: string | null;
  readonly workspaceRoot: string | null;
  readonly timestamp: number;
}

export class LaneOutcomeRecorder {
  private readonly classificationInputs = new Map<
    string,
    LaneFailureClassificationInput
  >();
  /** Transient briefs awaiting post-insert task-kind classification. */
  private readonly briefs = new Map<string, LaneTaskKindClassificationInput>();
  /** Subagent runs a stop producer already enqueued (first writer wins). */
  private readonly subagentRuns = new Map<string, true>();

  constructor(
    private readonly pipeline: OutcomeWritePipeline,
    private readonly store: LaneOutcomeStore,
    private readonly logger: LaneOutcomeLogger,
    private readonly classifier?: LaneFailureClassifier,
    private readonly taskKindClassifier?: LaneTaskKindClassifier,
  ) {}

  recordLaneCompletion(
    input: LaneCompletionOutcomeInput,
    transient: LaneCompletionTransient = {},
  ): void {
    const { status, failureKind, exitCode, ...facts } = input;
    const row: LaneOutcomeRecord = {
      ...facts,
      ...resolveTaskKind(input.taskKind, input.role),
      subagentSessionId: null,
      parentSessionId: null,
      workspaceRoot: null,
      telemetryJoin: 'not-applicable',
      skillsLoaded: null,
      sessionEvidenceClass: null,
    };
    const checked = LaneOutcomeRowSchema.safeParse(row);
    if (!checked.success) {
      this.logger.warn('Invalid lane outcome', { runId: input.runId });
      return;
    }
    if (
      this.classifier &&
      row.failureClass === null &&
      (row.verdict === 'failed' || row.verdict === 'no-deliverable') &&
      status !== 'stopped'
    ) {
      const classification: LaneFailureClassificationInput = {
        runId: row.runId,
        executorKind: input.executorKind,
        family: row.family,
        status,
        verdict: row.verdict,
        failureKind,
        exitCode,
        durationMs: row.durationMs,
      };
      if (!this.classificationInputs.has(row.runId))
        this.classificationInputs.set(row.runId, classification);
    }
    if (row.taskKindSource === 'unclassified')
      this.stashBrief(row.runId, input.executorKind, row.role, transient.brief);
    this.pipeline.enqueue({ kind: 'lane-completion', row });
  }

  /**
   * Runs after a row is inserted for the first time: the lane failure
   * classification and, for an unclassified row with a stashed brief, one
   * task-kind classification. Nothing here blocks the insert.
   */
  onLaneRecordInserted(row: LaneOutcomeRecord): void {
    this.classifyFailure(row);
    if (row.taskKindSource === 'unclassified') this.classifyTaskKind(row.runId);
    else this.briefs.delete(row.runId);
  }

  recordSubagentStop(payload: SubagentStopPayload): void {
    this.recordSubagentRow(
      {
        agentId: payload.agentId,
        agentType: payload.agentType,
        subagentSessionId: payload.subagentSessionId,
        parentSessionId: payload.parentSessionId,
        workspaceRoot: payload.workspaceRoot,
        timestamp: payload.timestamp,
      },
      undefined,
    );
  }

  /**
   * Second subagent stop producer (`SdkAdapterEvents.subagentEnded`). Builds
   * the same row as {@link recordSubagentStop}; whichever arrives first
   * writes it and the other only fills missing join fields. A mapped review
   * run's last message is offered to review capture.
   */
  recordSubagentEnded(event: SdkAdapterSubagentEndedEvent): void {
    const message = event.lastAssistantMessage;
    const row = this.recordSubagentRow(
      {
        agentId: event.agentId,
        agentType: event.agentType,
        subagentSessionId: null,
        parentSessionId: event.sessionId || null,
        workspaceRoot: event.cwd || null,
        timestamp: event.timestamp,
      },
      message ?? undefined,
    );
    if (!row || row.taskKind !== 'review' || !message?.trim()) return;
    void this.captureReview({ reviewerRunId: row.runId, text: message }).catch(
      (error: unknown) =>
        this.logger.warn('Review capture failed', {
          reviewerRunId: row.runId,
          code: errorCode(error),
        }),
    );
  }

  markSubagentBudgetStop(agentId: string): void {
    this.pipeline.enqueue({
      kind: 'budget-stop',
      runId: subagentRunId(agentId),
    });
  }

  async declareSubagentDeliverables(
    target: { runId: string },
    checks: readonly {
      exists: boolean;
      bytes: number;
      mtimeMs: number | null;
    }[],
    meta: {
      taskKind?: LaneOutcomeRecord['taskKind'];
      taskId?: string;
      routingSource?: LaneOutcomeRecord['routingSource'];
    } = {},
  ): Promise<OutcomeWriteResult> {
    const payload = DeliverablesPayloadSchema.safeParse({
      checks,
      ...(meta.taskKind ? { taskKind: meta.taskKind } : {}),
      ...(meta.taskId ? { taskId: meta.taskId } : {}),
      ...(meta.routingSource ? { routingSource: meta.routingSource } : {}),
    });
    if (!payload.success) return { ok: false, error: 'invalid deliverables' };
    const now = Date.now();
    return this.pipeline.submit({
      kind: 'deliverables',
      report: {
        kind: 'deliverables',
        reportId: randomUUID(),
        runId: target.runId,
        payload: JSON.stringify(payload.data),
        heldAt: now,
        expiresAt: now + REPORT_HOLD_MS,
      },
    });
  }

  async attachReview(
    target: { runId: string },
    verdict: 'approved' | 'rejected' | 'revise',
    options: { readonly reportId?: string } = {},
  ): Promise<OutcomeWriteResult> {
    const payload = ReviewPayloadSchema.safeParse({ verdict });
    if (!payload.success) return { ok: false, error: 'invalid review' };
    const now = Date.now();
    return this.pipeline.submit({
      kind: 'review',
      report: {
        kind: 'review',
        reportId: options.reportId ?? randomUUID(),
        runId: target.runId,
        payload: JSON.stringify(payload.data),
        heldAt: now,
        expiresAt: now + REPORT_HOLD_MS,
      },
    });
  }

  /**
   * Host-observed review capture (Req 7): parses a review run's deliverable
   * with the strict verdict-line grammar and attaches the verdict to the
   * reviewed run once per (reviewed, reviewer) pair. A refusal changes no
   * row and logs identifiers only; the text is never logged or stored.
   */
  async captureReview(input: {
    readonly reviewerRunId: string;
    readonly text: string;
  }): Promise<OutcomeWriteResult> {
    const parsed = parseReviewDeliverable(input.text, input.reviewerRunId);
    if ('refusal' in parsed) {
      this.logger.warn('Review capture refused', {
        reviewerRunId: input.reviewerRunId,
        refusal: parsed.refusal,
      });
      return { ok: false, error: `review capture refused: ${parsed.refusal}` };
    }
    const result = await this.attachReview(
      { runId: parsed.reviewedRunId },
      parsed.verdict,
      {
        reportId: deterministicReviewReportId(
          parsed.reviewedRunId,
          input.reviewerRunId,
        ),
      },
    );
    if (!result.ok)
      this.logger.warn('Review capture not applied', {
        reviewerRunId: input.reviewerRunId,
        reviewedRunId: parsed.reviewedRunId,
        error: result.error,
      });
    return result;
  }

  /**
   * Builds and enqueues one subagent row per `subagent:<agentId>`. Returns
   * the row (also for a later producer, which enriches instead of writing),
   * or null when the facts fail validation.
   */
  private recordSubagentRow(
    facts: SubagentStopFacts,
    brief: string | undefined,
  ): LaneOutcomeRecord | null {
    const role = facts.agentType || null;
    const row: LaneOutcomeRecord = {
      ...reportedSubagentStopRow(facts.agentId, facts.timestamp),
      subagentSessionId: facts.subagentSessionId,
      parentSessionId: facts.parentSessionId,
      workspaceRoot: facts.workspaceRoot,
      role,
      ...resolveTaskKind(null, role),
    };
    if (!LaneOutcomeRowSchema.safeParse(row).success) {
      this.logger.warn('Invalid subagent outcome', { agentId: facts.agentId });
      return null;
    }
    if (row.taskKindSource === 'unclassified')
      this.stashBrief(row.runId, 'subagent', role, brief);
    if (this.subagentRuns.has(row.runId)) {
      this.enrichSubagentRun(row);
      return row;
    }
    rememberBounded(this.subagentRuns, row.runId, true);
    this.pipeline.enqueue({ kind: 'subagent-stop', row });
    return row;
  }

  /**
   * A later producer for a run already enqueued: once the pipeline has
   * drained, fill only missing join fields and classify with a brief this
   * producer supplied. A run the store cannot read yet keeps its brief for
   * the insert callback. A run evicted from {@link subagentRuns} is enqueued
   * again instead, and the store's insert-if-absent ignores the duplicate.
   */
  private enrichSubagentRun(row: LaneOutcomeRecord): void {
    const runId = row.runId;
    void this.pipeline
      .flush()
      .then(async () => {
        await this.store.fillMissingSubagentJoin(runId, {
          subagentSessionId: row.subagentSessionId ?? null,
          parentSessionId: row.parentSessionId ?? null,
          workspaceRoot: row.workspaceRoot ?? null,
        });
        const stored = await this.store.get(runId);
        if (!stored) return;
        if (stored.taskKindSource === 'unclassified')
          this.classifyTaskKind(runId);
        else this.briefs.delete(runId);
      })
      .catch((error: unknown) =>
        this.logger.warn('Subagent outcome enrichment failed', {
          runId,
          code: errorCode(error),
        }),
      );
  }

  /** Keeps a bounded, non-blank brief only when a classifier can use it. */
  private stashBrief(
    runId: string,
    executorKind: OutcomeExecutorKind,
    role: string | null,
    brief: string | undefined,
  ): void {
    if (!this.taskKindClassifier || !brief?.trim() || this.briefs.has(runId))
      return;
    rememberBounded(this.briefs, runId, {
      runId,
      executorKind,
      role,
      brief: brief.slice(0, BRIEF_MAX_CHARS),
    });
  }

  private classifyFailure(row: LaneOutcomeRecord): void {
    const classification = this.classificationInputs.get(row.runId);
    this.classificationInputs.delete(row.runId);
    if (!classification || !this.classifier) return;
    void this.classifier
      .classify(classification)
      .then(async (failureClass) => {
        if (failureClass === null) return;
        await this.store.update(row.runId, { failureClass });
      })
      .catch((error: unknown) =>
        this.logger.warn('Outcome classification failed', {
          runId: row.runId,
          code: errorCode(error),
        }),
      );
  }

  /** At most one request per run: the brief is taken before the call. */
  private classifyTaskKind(runId: string): void {
    const input = this.briefs.get(runId);
    if (!input || !this.taskKindClassifier) return;
    this.briefs.delete(runId);
    // degradation-audit: reported - classification is optional evidence; the row stays unclassified
    void this.taskKindClassifier
      .classify(input)
      .then(async (taskKind) => {
        if (taskKind === null) return;
        await this.store.setClassifiedTaskKind(runId, taskKind);
      })
      .catch((error: unknown) =>
        this.logger.warn('Task kind classification failed', {
          runId,
          code: errorCode(error),
        }),
      );
  }
}
