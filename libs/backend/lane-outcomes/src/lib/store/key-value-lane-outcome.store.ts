import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { z } from 'zod';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import type {
  HeldOutcomeReport,
  OutcomeEffectResolver,
  OutcomeReceipt,
} from './lane-outcome.store';
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
  kind: z.enum(['deliverables', 'review', 'budget-stop']),
  payload: z.string(),
  heldAt: z.number().finite(),
  expiresAt: z.number().finite(),
});
const SnapshotEnvelopeSchema = z.object({
  rows: z.array(z.unknown()),
  receipts: z.array(z.unknown()),
  held: z.array(z.unknown()),
  budgetStopped: z.array(z.unknown()),
});

function validItems<T>(items: readonly unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap((item) => {
    try {
      return [schema.parse(item)];
    } catch {
      // degradation-audit: reported - invalid snapshot items are counted and warned after validation
      return [];
    }
  });
}

/** One host storage key holds rows, receipts and holds in a single atomic update. */
export class KeyValueLaneOutcomeStore extends InMemoryLaneOutcomeStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: IStateStorage,
    private readonly logger: LaneOutcomeLogger,
  ) {
    super();
    const raw = storage.get<unknown>(LANE_OUTCOME_RECORDS_KEY);
    if (raw === undefined) return;
    let envelope: z.infer<typeof SnapshotEnvelopeSchema>;
    try {
      envelope = SnapshotEnvelopeSchema.parse(raw);
    } catch {
      // degradation-audit: reported - unreadable snapshots start empty with one warning
      this.logger.warn('Lane outcome snapshot unreadable', {
        code: 'ZOD_VALIDATION',
        rows: 0,
        receipts: 0,
        held: 0,
        budgetStopped: 0,
      });
      return;
    }
    const rows = validItems(envelope.rows, LaneOutcomeRowSchema);
    const receipts = validItems(envelope.receipts, ReceiptSchema);
    const held = validItems(envelope.held, HeldSchema);
    const budgetStopped = validItems(envelope.budgetStopped, z.string());
    const counts = {
      rows: envelope.rows.length - rows.length,
      receipts: envelope.receipts.length - receipts.length,
      held: envelope.held.length - held.length,
      budgetStopped: envelope.budgetStopped.length - budgetStopped.length,
    };
    if (Object.values(counts).some((count) => count > 0)) {
      this.logger.warn('Lane outcome snapshot entries skipped', {
        ...counts,
        code: 'ZOD_VALIDATION',
      });
    }
    for (const row of rows) this.rows.set(row.runId, row);
    for (const receipt of receipts)
      this.receipts.set(receipt.reportId, receipt);
    for (const report of held) this.held.set(report.reportId, report);
    for (const id of budgetStopped) this.budgetStops.add(id);
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const before = this.snapshot();
      try {
        const value = await operation();
        this.evict();
        const after = this.snapshot();
        if (JSON.stringify(before) !== JSON.stringify(after))
          await this.storage.update(LANE_OUTCOME_RECORDS_KEY, after);
        return value;
      } catch (error: unknown) {
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
    budgetStopped: string[];
  } {
    return {
      rows: [...this.rows.values()],
      receipts: [...this.receipts.values()],
      held: [...this.held.values()],
      budgetStopped: [...this.budgetStops],
    };
  }

  private restore(
    snapshot: ReturnType<KeyValueLaneOutcomeStore['snapshot']>,
  ): void {
    this.rows.clear();
    this.receipts.clear();
    this.held.clear();
    this.budgetStops.clear();
    for (const row of snapshot.rows) this.rows.set(row.runId, row);
    for (const receipt of snapshot.receipts)
      this.receipts.set(receipt.reportId, receipt);
    for (const report of snapshot.held) this.held.set(report.reportId, report);
    for (const id of snapshot.budgetStopped) this.budgetStops.add(id);
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
    for (const id of this.budgetStops)
      if (!ids.has(id)) this.budgetStops.delete(id);
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
  override insertStopWithHeldReports(
    row: LaneOutcomeRecord,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ) {
    return this.write(() =>
      super.insertStopWithHeldReports(row, nowMs, resolve),
    );
  }
  override applyReportWithReceipt(
    report: HeldOutcomeReport,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ) {
    return this.write(() =>
      super.applyReportWithReceipt(report, nowMs, resolve),
    );
  }
  override markBudgetStopped(runId: string, nowMs: number) {
    return this.write(() => super.markBudgetStopped(runId, nowMs));
  }
  override holdReport(report: HeldOutcomeReport): Promise<boolean> {
    return this.write(() => super.holdReport(report));
  }
  override expireHeldReports(
    nowMs: number,
  ): Promise<readonly HeldOutcomeReport[]> {
    return this.write(() => super.expireHeldReports(nowMs));
  }
  override isPersistent(): boolean {
    return true;
  }
}
