import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import type {
  HeldOutcomeReport,
  LaneOutcomeStore,
  OutcomeReceipt,
} from './lane-outcome.store';

export class InMemoryLaneOutcomeStore implements LaneOutcomeStore {
  protected readonly rows = new Map<string, LaneOutcomeRecord>();
  protected readonly receipts = new Map<string, OutcomeReceipt>();
  protected readonly held = new Map<string, HeldOutcomeReport>();

  async insertIfAbsent(input: LaneOutcomeRecord): Promise<boolean> {
    const row = LaneOutcomeRowSchema.parse(input);
    if (this.rows.has(row.runId)) return false;
    this.rows.set(row.runId, row);
    return true;
  }

  async update(
    runId: string,
    patch: Partial<LaneOutcomeRecord>,
  ): Promise<boolean> {
    const current = this.rows.get(runId);
    if (!current) return false;
    const row = LaneOutcomeRowSchema.parse({ ...current, ...patch, runId });
    this.rows.set(runId, row);
    return true;
  }

  async get(runId: string): Promise<LaneOutcomeRecord | null> {
    return this.rows.get(runId) ?? null;
  }

  async findLatestByAgent(agentId: string): Promise<LaneOutcomeRecord | null> {
    return (
      [...this.rows.values()]
        .filter((row) => row.agentId === agentId)
        .sort((a, b) => b.endedAt - a.endedAt)[0] ?? null
    );
  }

  async listByLane(
    laneId: string,
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.laneId === laneId && row.endedAt >= sinceMs)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 2000);
  }

  async listByRoles(
    slugs: readonly string[],
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRecord[]> {
    const names = new Set(slugs);
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.role !== null && names.has(row.role) && row.endedAt >= sinceMs,
      )
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 2000);
  }

  async hasReceipt(reportId: string): Promise<boolean> {
    return this.receipts.has(reportId);
  }
  async recordReceipt(receipt: OutcomeReceipt): Promise<boolean> {
    if (this.receipts.has(receipt.reportId)) return false;
    this.receipts.set(receipt.reportId, receipt);
    return true;
  }

  async holdReport(report: HeldOutcomeReport): Promise<boolean> {
    this.expire(Date.now());
    if (this.held.has(report.reportId)) return false;
    this.held.set(report.reportId, report);
    return true;
  }

  async takeHeldReports(
    runId: string,
    nowMs: number,
  ): Promise<readonly HeldOutcomeReport[]> {
    this.expire(nowMs);
    const reports = [...this.held.values()]
      .filter((report) => report.runId === runId)
      .sort((a, b) => a.heldAt - b.heldAt);
    for (const report of reports) this.held.delete(report.reportId);
    return reports;
  }

  async expireHeldReports(nowMs: number): Promise<number> {
    return this.expire(nowMs);
  }

  protected expire(nowMs: number): number {
    let removed = 0;
    for (const [id, report] of this.held) {
      if (report.expiresAt <= nowMs) {
        this.held.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async countHeldReports(nowMs: number): Promise<number> {
    return [...this.held.values()].filter((report) => report.expiresAt > nowMs)
      .length;
  }

  async hasHeldDeliverables(runId: string, nowMs: number): Promise<boolean> {
    return [...this.held.values()].some(
      (report) =>
        report.runId === runId &&
        report.kind === 'deliverables' &&
        report.expiresAt > nowMs,
    );
  }

  isPersistent(): boolean {
    return false;
  }
}
