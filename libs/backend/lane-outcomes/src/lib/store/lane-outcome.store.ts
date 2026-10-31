import type {
  LaneCompletionVerdict,
  LaneOutcomeRecord,
  OutcomeRoutingSource,
  OutcomeTaskKind,
} from '@ptah-extension/shared';

export interface LaneOutcomeRow extends LaneOutcomeRecord {
  readonly budgetStopped: boolean;
}
export interface OutcomeReceipt {
  readonly reportId: string;
  readonly runId: string;
  readonly kind: 'deliverables' | 'review';
  readonly appliedAt: number;
}
export type HeldEntryKind = 'deliverables' | 'review' | 'budget-stop';
/** Payload contains checked stat facts and metadata, never source paths. */
export interface HeldOutcomeReport {
  readonly reportId: string;
  readonly runId: string;
  readonly kind: HeldEntryKind;
  readonly payload: string;
  readonly heldAt: number;
  readonly expiresAt: number;
}
/**
 * A held report joins an inserted row held under its run id, or, for a review
 * that named only an agent before any run of that agent landed, under the
 * row's bare agent id. The held report is deleted on its first join, so it
 * reaches at most one row.
 */
export function heldReportJoinsRow(
  report: HeldOutcomeReport,
  row: LaneOutcomeRecord,
): boolean {
  return (
    report.runId === row.runId ||
    (report.kind === 'review' && report.runId === row.agentId)
  );
}

export type OutcomeReportEffect =
  | {
      readonly kind: 'deliverables';
      readonly verdict: LaneCompletionVerdict;
      readonly declaredAt: number;
      readonly taskKind?: OutcomeTaskKind;
      readonly taskId?: string;
      readonly routingSource?: OutcomeRoutingSource;
    }
  | {
      readonly kind: 'review';
      readonly verdict: 'approved' | 'rejected' | 'revise';
    };
export type OutcomeEffectResolver = (
  row: LaneOutcomeRow,
  report: HeldOutcomeReport,
) => OutcomeReportEffect | null;

export function applyOutcomeEffect(
  row: LaneOutcomeRecord,
  effect: OutcomeReportEffect,
): LaneOutcomeRecord {
  if (effect.kind === 'deliverables') {
    const explicitTaskKind =
      effect.taskKind !== undefined && row.taskKindSource !== 'explicit';
    return {
      ...row,
      verdict:
        row.executorKind !== 'subagent' &&
        (row.verdict === 'failed' || row.failureClass !== null)
          ? row.verdict
          : effect.verdict,
      deliverablesDeclaredAt: row.deliverablesDeclaredAt ?? effect.declaredAt,
      taskKind: explicitTaskKind ? effect.taskKind : row.taskKind,
      taskKindSource: explicitTaskKind
        ? 'explicit'
        : (row.taskKindSource ?? null),
      taskId: effect.taskId ?? row.taskId,
      routingSource: effect.routingSource ?? row.routingSource,
    };
  }
  if (effect.verdict === 'revise')
    return { ...row, reviseRounds: row.reviseRounds + 1 };
  return { ...row, finalReview: effect.verdict };
}

export interface LaneOutcomeStore {
  /** True inserts a new run; false leaves its existing row intact. */
  insertIfAbsent(row: LaneOutcomeRecord): Promise<boolean>;
  /** Inserts any run row and joins that run's held reports; also returns invalid reports and budget-stop state. */
  insertStopWithHeldReports(
    row: LaneOutcomeRecord,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ): Promise<{
    inserted: boolean;
    joined: readonly HeldOutcomeReport[];
    invalid: readonly HeldOutcomeReport[];
    budgetStopped: boolean;
  }>;
  /** Applied writes a receipt; duplicate is already receipted; missing lets the pipeline hold a subagent report; invalid is rejected. */
  applyReportWithReceipt(
    report: HeldOutcomeReport,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ): Promise<'applied' | 'duplicate' | 'missing' | 'invalid'>;
  /** Applied updates a run, held waits for its stop, and duplicate has already been recorded. */
  markBudgetStopped(
    runId: string,
    nowMs: number,
  ): Promise<'applied' | 'held' | 'duplicate'>;
  /** True updates an existing row; false tells the caller the run is missing. */
  update(runId: string, patch: Partial<LaneOutcomeRecord>): Promise<boolean>;
  /** Sets a classified kind only while the row remains unclassified. */
  setClassifiedTaskKind(runId: string, kind: OutcomeTaskKind): Promise<boolean>;
  /** Fills only missing join identifiers; true when at least one field changed. */
  fillMissingSubagentJoin(
    runId: string,
    join: {
      readonly subagentSessionId: string | null;
      readonly parentSessionId: string | null;
      readonly workspaceRoot: string | null;
    },
  ): Promise<boolean>;
  /** Returns the run or null when the caller must treat it as missing. */
  get(runId: string): Promise<LaneOutcomeRow | null>;
  /** Returns the latest agent run or null when no run matches. */
  findLatestByAgent(agentId: string): Promise<LaneOutcomeRow | null>;
  /** Returns matching lane rows for readers; an empty list means no matches. */
  listByLane(
    laneId: string,
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]>;
  /** Returns matching role rows for readers; an empty list means no matches. */
  listByRoles(
    slugs: readonly string[],
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]>;
  /** True means the report was already applied and must not be replayed. */
  hasReceipt(reportId: string): Promise<boolean>;
  /** True holds a new report; false means a report with that ID is already held. */
  holdReport(report: HeldOutcomeReport): Promise<boolean>;
  /** Returns unexpired holds for the pipeline to join or rebuild its index. */
  listHeldReports(nowMs: number): Promise<readonly HeldOutcomeReport[]>;
  /** Returns expired holds removed from the store for rejection or cleanup. */
  expireHeldReports(nowMs: number): Promise<readonly HeldOutcomeReport[]>;
  /** Returns the active hold count used to enforce admission capacity. */
  countHeldReports(nowMs: number): Promise<number>;
  /** True allows a review to wait for its earlier deliverables report. */
  hasHeldDeliverables(runId: string, nowMs: number): Promise<boolean>;
  /** True identifies durable storage for reader behavior. */
  isPersistent(): boolean;
}
