import type { LaneOutcomeRecord } from '@ptah-extension/shared';

export interface OutcomeReceipt {
  readonly reportId: string;
  readonly runId: string;
  readonly kind: 'deliverables' | 'review';
  readonly appliedAt: number;
}

/** Payload contains checked stat facts and metadata, never the source paths. */
export interface HeldOutcomeReport {
  readonly reportId: string;
  readonly runId: string;
  readonly kind: 'deliverables' | 'review';
  readonly payload: string;
  readonly heldAt: number;
  readonly expiresAt: number;
}

export interface LaneOutcomeStore {
  insertIfAbsent(row: LaneOutcomeRecord): Promise<boolean>;
  update(runId: string, patch: Partial<LaneOutcomeRecord>): Promise<boolean>;
  get(runId: string): Promise<LaneOutcomeRecord | null>;
  findLatestByAgent(agentId: string): Promise<LaneOutcomeRecord | null>;
  listByLane(
    laneId: string,
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRecord[]>;
  listByRoles(
    slugs: readonly string[],
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRecord[]>;
  hasReceipt(reportId: string): Promise<boolean>;
  recordReceipt(receipt: OutcomeReceipt): Promise<boolean>;
  holdReport(report: HeldOutcomeReport): Promise<boolean>;
  takeHeldReports(
    runId: string,
    nowMs: number,
  ): Promise<readonly HeldOutcomeReport[]>;
  expireHeldReports(nowMs: number): Promise<number>;
  countHeldReports(nowMs: number): Promise<number>;
  hasHeldDeliverables(runId: string, nowMs: number): Promise<boolean>;
  isPersistent(): boolean;
}
