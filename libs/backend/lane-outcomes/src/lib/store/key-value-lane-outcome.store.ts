import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { z } from 'zod';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import type { HeldOutcomeReport, OutcomeReceipt } from './lane-outcome.store';
import { InMemoryLaneOutcomeStore } from './in-memory-lane-outcome.store';

export const LANE_OUTCOME_RECORDS_KEY = 'ptah.laneOutcomes.records.v1';
const ReceiptSchema = z.object({
  reportId: z.string().min(1),
  runId: z.string().min(1),
  kind: z.enum(['deliverables', 'review']),
  appliedAt: z.number().finite(),
});
const HeldSchema = z.object({
  reportId: z.string().min(1),
  runId: z.string().min(1),
  kind: z.enum(['deliverables', 'review']),
  payload: z.string(),
  heldAt: z.number().finite(),
  expiresAt: z.number().finite(),
});
const SnapshotSchema = z.object({
  rows: z.array(LaneOutcomeRowSchema),
  receipts: z.array(ReceiptSchema),
  held: z.array(HeldSchema),
});

/** One host storage key holds rows, receipts and holds in a single atomic update. */
export class KeyValueLaneOutcomeStore extends InMemoryLaneOutcomeStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly storage: IStateStorage) {
    super();
    const snapshot = SnapshotSchema.parse(
      storage.get<unknown>(LANE_OUTCOME_RECORDS_KEY) ?? {
        rows: [],
        receipts: [],
        held: [],
      },
    );
    for (const row of snapshot.rows) this.rows.set(row.runId, row);
    for (const receipt of snapshot.receipts)
      this.receipts.set(receipt.reportId, receipt);
    for (const report of snapshot.held) this.held.set(report.reportId, report);
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const before = this.snapshot();
      try {
        const value = await operation();
        this.evict();
        await this.storage.update(LANE_OUTCOME_RECORDS_KEY, this.snapshot());
        return value;
      } catch (error) {
        this.restore(before);
        throw error;
      }
    });
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private snapshot(): {
    rows: LaneOutcomeRecord[];
    receipts: OutcomeReceipt[];
    held: HeldOutcomeReport[];
  } {
    return {
      rows: [...this.rows.values()],
      receipts: [...this.receipts.values()],
      held: [...this.held.values()],
    };
  }

  private restore(
    snapshot: ReturnType<KeyValueLaneOutcomeStore['snapshot']>,
  ): void {
    this.rows.clear();
    this.receipts.clear();
    this.held.clear();
    for (const row of snapshot.rows) this.rows.set(row.runId, row);
    for (const receipt of snapshot.receipts)
      this.receipts.set(receipt.reportId, receipt);
    for (const report of snapshot.held) this.held.set(report.reportId, report);
  }

  private evict(): void {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const keep = [...this.rows.values()]
      .filter((row) => row.endedAt >= cutoff)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 2000);
    const ids = new Set(keep.map((row) => row.runId));
    for (const id of this.rows.keys()) if (!ids.has(id)) this.rows.delete(id);
    for (const [id, receipt] of this.receipts)
      if (!ids.has(receipt.runId)) this.receipts.delete(id);
  }

  override insertIfAbsent(row: LaneOutcomeRecord): Promise<boolean> {
    return this.write(() => super.insertIfAbsent(row));
  }
  override update(
    runId: string,
    patch: Partial<LaneOutcomeRecord>,
  ): Promise<boolean> {
    return this.write(() => super.update(runId, patch));
  }
  override recordReceipt(receipt: OutcomeReceipt): Promise<boolean> {
    return this.write(() => super.recordReceipt(receipt));
  }
  override holdReport(report: HeldOutcomeReport): Promise<boolean> {
    return this.write(() => super.holdReport(report));
  }
  override takeHeldReports(
    runId: string,
    nowMs: number,
  ): Promise<readonly HeldOutcomeReport[]> {
    return this.write(() => super.takeHeldReports(runId, nowMs));
  }
  override expireHeldReports(nowMs: number): Promise<number> {
    return this.write(() => super.expireHeldReports(nowMs));
  }
  override isPersistent(): boolean {
    return true;
  }
}
