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
  if (effect.kind === 'deliverables')
    return {
      ...row,
      verdict: effect.verdict,
      deliverablesDeclaredAt: row.deliverablesDeclaredAt ?? effect.declaredAt,
      taskKind: effect.taskKind ?? row.taskKind,
      taskId: effect.taskId ?? row.taskId,
      routingSource: effect.routingSource ?? row.routingSource,
    };
  if (effect.verdict === 'revise')
    return { ...row, reviseRounds: row.reviseRounds + 1 };
  return { ...row, finalReview: effect.verdict };
}

export interface LaneOutcomeStore {
  insertIfAbsent(row: LaneOutcomeRecord): Promise<boolean>;
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
  applyReportWithReceipt(
    report: HeldOutcomeReport,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ): Promise<'applied' | 'duplicate' | 'missing' | 'invalid'>;
  markBudgetStopped(
    runId: string,
    nowMs: number,
  ): Promise<'applied' | 'held' | 'duplicate'>;
  update(runId: string, patch: Partial<LaneOutcomeRecord>): Promise<boolean>;
  get(runId: string): Promise<LaneOutcomeRow | null>;
  findLatestByAgent(agentId: string): Promise<LaneOutcomeRow | null>;
  listByLane(
    laneId: string,
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]>;
  listByRoles(
    slugs: readonly string[],
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]>;
  hasReceipt(reportId: string): Promise<boolean>;
  holdReport(report: HeldOutcomeReport): Promise<boolean>;
  listHeldReports(nowMs: number): Promise<readonly HeldOutcomeReport[]>;
  expireHeldReports(nowMs: number): Promise<readonly HeldOutcomeReport[]>;
  countHeldReports(nowMs: number): Promise<number>;
  hasHeldDeliverables(runId: string, nowMs: number): Promise<boolean>;
  isPersistent(): boolean;
}
