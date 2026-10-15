import { randomUUID } from 'node:crypto';
import {
  LANE_DEFAULT_MODEL,
  SUBAGENT_FAMILY,
  SUBAGENT_LANE_ID,
  type LaneFailureClassifier,
  type LaneFailureClassificationInput,
  type LaneOutcomeRecord,
} from '@ptah-extension/shared';
import type { SubagentStopPayload } from '@ptah-extension/agent-sdk';
import { LaneOutcomeRowSchema } from './lane-outcome.schema';
import type { LaneOutcomeLogger } from './lane-outcome-logger';
import type { LaneOutcomeStore } from './store/lane-outcome.store';
import { subagentRunId } from './subagent-join';
import {
  DeliverablesPayloadSchema,
  ReviewPayloadSchema,
} from './write/report-effect';
import type {
  OutcomeWritePipeline,
  OutcomeWriteResult,
} from './write/outcome-write-pipeline';

export type LaneCompletionOutcomeInput = Omit<
  LaneOutcomeRecord,
  'executorKind' | 'telemetryJoin' | 'skillsLoaded' | 'sessionEvidenceClass'
> & {
  executorKind: Exclude<LaneOutcomeRecord['executorKind'], 'subagent'>;
} & Pick<LaneFailureClassificationInput, 'status' | 'failureKind' | 'exitCode'>;

export class LaneOutcomeRecorder {
  private readonly classificationInputs = new Map<
    string,
    LaneFailureClassificationInput
  >();
  constructor(
    private readonly pipeline: OutcomeWritePipeline,
    private readonly store: LaneOutcomeStore,
    private readonly logger: LaneOutcomeLogger,
    private readonly classifier?: LaneFailureClassifier,
  ) {}

  recordLaneCompletion(input: LaneCompletionOutcomeInput): void {
    const { status, failureKind, exitCode, ...facts } = input;
    const row: LaneOutcomeRecord = {
      ...facts,
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
    this.pipeline.enqueue({ kind: 'lane-completion', row });
  }

  onLaneRecordInserted(row: LaneOutcomeRecord): void {
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
          code: error instanceof Error ? error.name : 'UNKNOWN',
        }),
      );
  }

  recordSubagentStop(payload: SubagentStopPayload): void {
    const row: LaneOutcomeRecord = {
      runId: subagentRunId(payload.agentId),
      executorKind: 'subagent',
      laneId: SUBAGENT_LANE_ID,
      agentId: payload.agentId,
      subagentSessionId: payload.subagentSessionId,
      parentSessionId: payload.parentSessionId,
      workspaceRoot: payload.workspaceRoot,
      family: SUBAGENT_FAMILY,
      provider: null,
      model: LANE_DEFAULT_MODEL,
      role: payload.agentType || null,
      taskKind: null,
      taskId: null,
      verdict: 'unverified',
      failureClass: null,
      startedAt: null,
      endedAt: payload.timestamp,
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
    if (!LaneOutcomeRowSchema.safeParse(row).success) {
      this.logger.warn('Invalid subagent outcome', {
        agentId: payload.agentId,
      });
      return;
    }
    this.pipeline.enqueue({ kind: 'subagent-stop', row });
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
        expiresAt: now + 24 * 60 * 60 * 1000,
      },
    });
  }

  async attachReview(
    target: { runId: string },
    verdict: 'approved' | 'rejected' | 'revise',
  ): Promise<OutcomeWriteResult> {
    const payload = ReviewPayloadSchema.safeParse({ verdict });
    if (!payload.success) return { ok: false, error: 'invalid review' };
    const now = Date.now();
    return this.pipeline.submit({
      kind: 'review',
      report: {
        kind: 'review',
        reportId: randomUUID(),
        runId: target.runId,
        payload: JSON.stringify(payload.data),
        heldAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      },
    });
  }
}
