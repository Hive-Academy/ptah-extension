import type { IStateStorage } from '@ptah-extension/platform-core';
import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import { ZodError } from 'zod';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import type {
  HeldOutcomeReport,
  LaneOutcomeStore,
} from '../store/lane-outcome.store';
import {
  DeliverablesPayloadSchema,
  reportEffectOf,
  ReviewPayloadSchema,
} from './report-effect';
import {
  KeyValueOutcomeJournal,
  OUTCOME_JOURNAL_LIMIT,
  OUTCOME_REJECTED_KEY,
  type HeldRunIndex,
  type JournalValue,
} from './key-value-outcome-journal';

export type OutcomeWriteOp =
  | {
      readonly kind: 'lane-completion' | 'subagent-stop';
      readonly row: LaneOutcomeRecord;
    }
  | { readonly kind: 'budget-stop'; readonly runId: string }
  | {
      readonly kind: 'deliverables' | 'review';
      readonly report: HeldOutcomeReport;
    };

export type OutcomeWriteResult =
  | {
      readonly ok: true;
      readonly state: 'applied' | 'held' | 'queued';
      readonly runId: string;
    }
  | { readonly ok: false; readonly error: string };

export interface OutcomeStoreAvailability {
  isOpen(): boolean;
  onDidOpen?(callback: () => void): { dispose(): void };
}

interface RejectedEntry {
  readonly kind: OutcomeWriteOp['kind'];
  readonly runId: string;
  readonly reportId?: string;
  readonly reason: string;
}

interface RejectedValue {
  readonly entries: readonly RejectedEntry[];
  readonly overflow: number;
}

const DELAYS = [250, 1000, 5000, 30000, 60000];
const HOLD_LIMIT = 500;
const HOLD_SWEEP_MS = 60000;

function validPayload(
  op: Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }>,
): boolean {
  if (op.report.kind !== op.kind) return false;
  try {
    const payload: unknown = JSON.parse(op.report.payload);
    return op.kind === 'deliverables'
      ? DeliverablesPayloadSchema.safeParse(payload).success
      : ReviewPayloadSchema.safeParse(payload).success;
  } catch {
    // degradation-audit: reported - submit rejects malformed payload before enqueue
    return false;
  }
}

function runIdOf(op: OutcomeWriteOp): string {
  return 'row' in op
    ? op.row.runId
    : 'report' in op
      ? op.report.runId
      : op.runId;
}

function isReport(
  op: OutcomeWriteOp,
): op is Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }> {
  return op.kind === 'deliverables' || op.kind === 'review';
}

function failureCode(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  return error instanceof ZodError ? 'ZOD_VALIDATION' : 'WRITE_FAILED';
}

function isPermanent(error: unknown): boolean {
  return (
    error instanceof ZodError ||
    error instanceof SyntaxError ||
    ['SQLITE_CONSTRAINT_CHECK', 'SQLITE_CONSTRAINT_NOTNULL'].includes(
      failureCode(error),
    )
  );
}

export class OutcomeWritePipeline {
  private readonly journal: KeyValueOutcomeJournal<OutcomeWriteOp> | null;
  private readonly queue: OutcomeWriteOp[] = [];
  private draining = false;
  private accepting = 0;
  private scheduled = false;
  private disposed = false;
  private closing = false;
  private failures = 0;
  private lastCapacityWarning = 0;
  private lastSweep = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly openListener: { dispose(): void } | undefined;
  private needsRebuild = true;

  constructor(
    private readonly store: LaneOutcomeStore,
    private readonly logger: LaneOutcomeLogger,
    private readonly storage?: IStateStorage,
    private readonly availability?: OutcomeStoreAvailability,
    private readonly onLaneRecordInserted?: (row: LaneOutcomeRecord) => void,
  ) {
    this.journal = storage
      ? new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
      : null;
    this.openListener = availability?.onDidOpen?.(() => {
      this.needsRebuild = true;
      this.schedule();
    });
    const dropped = this.journal?.snapshot().droppedAtCapacity ?? 0;
    const rejected =
      storage?.get<RejectedValue>(OUTCOME_REJECTED_KEY)?.entries.length ?? 0;
    if (dropped || rejected)
      this.logger.warn('Outcome journal has prior refusals', {
        droppedAtCapacity: dropped,
        rejected,
      });
    this.schedule();
  }

  enqueue(op: OutcomeWriteOp): void {
    if (this.closing || this.disposed) return;
    if (this.queue.length >= 1000 && !this.journal) {
      this.logger.warn('Outcome queue full', {
        runId: runIdOf(op),
        reason: 'queue-full',
      });
      return;
    }
    this.queue.push(op);
    this.schedule();
  }

  async submit(
    op: Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }>,
  ): Promise<OutcomeWriteResult> {
    if (this.closing || this.disposed)
      return { ok: false, error: 'outcome pipeline closed' };
    if (!validPayload(op))
      return { ok: false, error: 'invalid report payload' };
    const runId = op.report.runId;
    const pending = [
      ...(this.journal?.snapshot().entries.map((entry) => entry.op) ?? []),
      ...this.queue,
    ];
    const pendingInsert = pending.some(
      (item) => 'row' in item && item.row.runId === runId,
    );
    let readable = this.availability?.isOpen() ?? true;
    let row: LaneOutcomeRecord | null = null;
    let heldDeliverables = false;
    let heldCount = 0;
    if (readable) {
      try {
        [row, heldDeliverables, heldCount] = await Promise.all([
          this.store.get(runId),
          this.store.hasHeldDeliverables(runId, Date.now()),
          this.store.countHeldReports(Date.now()),
        ]);
      } catch (error: unknown) {
        readable = false;
        this.logger.warn('Outcome store read failed', {
          runId,
          code: failureCode(error),
        });
      }
    }
    if (pendingInsert || row) {
      if (!(await this.accept(op)))
        return { ok: false, error: 'outcome journal at capacity' };
      if (readable) await this.flush();
      return {
        ok: true,
        state:
          readable && !this.journal?.snapshot().entries.length
            ? 'applied'
            : 'queued',
        runId,
      };
    }
    const subagent = runId.startsWith('subagent:');
    const pendingHold = pending.some(
      (item) =>
        isReport(item) &&
        item.kind === 'deliverables' &&
        item.report.runId === runId,
    );
    const indexed =
      !readable &&
      (this.journal?.snapshot().heldRuns.find((item) => item.runId === runId)
        ?.expiresAt ?? 0) > Date.now();
    if (
      !subagent ||
      (op.kind === 'review' && !pendingHold && !heldDeliverables && !indexed)
    ) {
      const suffix = readable
        ? ''
        : ': the outcome store is not open yet, so the run could not be verified; retry after it opens';
      return { ok: false, error: `run ${runId} not found${suffix}` };
    }
    if (!readable) {
      heldCount =
        this.journal
          ?.snapshot()
          .heldRuns.reduce(
            (sum, item) =>
              sum +
              item.holdExpiries.filter((expiry) => expiry > Date.now()).length,
            0,
          ) ?? 0;
    }
    const pendingHolds = pending.filter(
      (item) =>
        isReport(item) &&
        item.report.runId.startsWith('subagent:') &&
        !pending.some(
          (other) => 'row' in other && other.row.runId === item.report.runId,
        ),
    ).length;
    if (heldCount + pendingHolds >= HOLD_LIMIT)
      return { ok: false, error: 'too many held reports' };
    if (!(await this.accept(op)))
      return { ok: false, error: 'outcome journal at capacity' };
    if (readable) await this.flush();
    return { ok: true, state: 'held', runId };
  }

  private async accept(op: OutcomeWriteOp): Promise<boolean> {
    if (this.journal) {
      const waiting = this.queue.splice(0);
      let accepted = false;
      this.accepting++;
      try {
        await this.journal.update((value) => {
          let next = value;
          for (const item of [...waiting, op]) {
            if (next.entries.length >= OUTCOME_JOURNAL_LIMIT) {
              next = { ...next, droppedAtCapacity: next.droppedAtCapacity + 1 };
            } else {
              if (item === op) accepted = true;
              next = {
                ...next,
                nextSeq: next.nextSeq + 1,
                entries: [...next.entries, { seq: next.nextSeq, op: item }],
              };
            }
          }
          return next;
        });
      } catch (error: unknown) {
        this.queue.unshift(...waiting);
        throw error;
      } finally {
        this.accepting--;
        this.schedule();
      }
      if (!accepted) this.warnCapacity();
      else this.schedule();
      return accepted;
    }
    if (this.queue.length >= 1000) return false;
    this.queue.push(op);
    this.schedule();
    return true;
  }

  private warnCapacity(): void {
    const count = this.journal?.snapshot().droppedAtCapacity ?? 0;
    if (
      count > 0 &&
      (this.lastCapacityWarning === 0 ||
        Math.floor(count / 100) > Math.floor(this.lastCapacityWarning / 100))
    ) {
      this.lastCapacityWarning = count;
      this.logger.warn('Outcome journal at capacity', { count });
    }
  }

  private schedule(): void {
    if (this.scheduled || this.draining || this.disposed) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  async flush(): Promise<void> {
    while (this.draining && !this.disposed)
      await new Promise<void>((resolve) => setImmediate(resolve));
    if (this.disposed) return;
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.disposed || this.accepting) return;
    this.draining = true;
    try {
      if (this.journal && this.queue.length) {
        const moved = [...this.queue];
        await this.journal.update((value) => {
          let next = value;
          for (const op of moved) {
            if (next.entries.length >= 5000) {
              next = { ...next, droppedAtCapacity: next.droppedAtCapacity + 1 };
            } else {
              next = {
                ...next,
                nextSeq: next.nextSeq + 1,
                entries: [...next.entries, { seq: next.nextSeq, op }],
              };
            }
          }
          return next;
        });
        this.queue.splice(0, moved.length);
        const count = this.journal.snapshot().droppedAtCapacity;
        if (count > 0) this.warnCapacity();
      }
      if (this.availability && !this.availability.isOpen()) return;
      if (this.journal && this.needsRebuild) {
        await this.rebuildIndex();
        this.needsRebuild = false;
      }
      if (Date.now() - this.lastSweep >= HOLD_SWEEP_MS)
        await this.expireHolds(Date.now());
      let processed = 0;
      const start = this.journal?.snapshot() ?? null;
      let next: JournalValue<OutcomeWriteOp> | null = start;
      while (processed < 25) {
        const op =
          next?.entries[processed]?.op ??
          (next ? undefined : this.queue[processed]);
        if (!op) break;
        try {
          const held = await this.apply(op);
          if (next) next = this.advanceIndex(next, op, held);
          processed++;
        } catch (error: unknown) {
          if (isPermanent(error)) {
            await this.reject(op, failureCode(error));
            processed++;
            continue;
          }
          this.failures++;
          if (this.failures === 1 || this.failures % 10 === 0)
            this.logger.warn('Outcome write deferred', {
              runId: runIdOf(op),
              code: failureCode(error),
              failures: this.failures,
            });
          this.defer(DELAYS[Math.min(this.failures - 1, DELAYS.length - 1)]);
          break;
        }
      }
      if (processed && this.journal && next) {
        const acknowledged = new Set(
          start?.entries.slice(0, processed).map((entry) => entry.seq),
        );
        const heldRuns = next.heldRuns;
        await this.journal.update((current) => ({
          ...current,
          entries: current.entries.filter(
            (entry) => !acknowledged.has(entry.seq),
          ),
          heldRuns,
        }));
      } else if (processed) this.queue.splice(0, processed);
      if (
        processed &&
        this.failures &&
        !(this.journal?.snapshot().entries.length ?? this.queue.length)
      ) {
        this.logger.info('Outcome backlog drained');
        this.failures = 0;
      }
    } catch (error: unknown) {
      this.logger.warn('Outcome journal update failed', {
        code: failureCode(error),
      });
      this.defer(250);
    } finally {
      this.draining = false;
      if (
        (this.journal?.snapshot().entries.length ?? 0) + this.queue.length >
          0 &&
        !this.retry &&
        (!this.availability || this.availability.isOpen())
      )
        this.schedule();
    }
  }

  private async expireHolds(now: number): Promise<void> {
    const expired = await this.store.expireHeldReports(now);
    for (const report of expired)
      this.logger.warn('Outcome hold expired', {
        runId: report.runId,
        reportId: report.reportId,
        kind: report.kind,
        reason:
          report.kind === 'budget-stop'
            ? 'budget-stop-expired'
            : 'held-report-expired',
      });
    if (this.journal && expired.length) {
      const counts = new Map<string, Map<number, number>>();
      for (const report of expired) {
        const byExpiry = counts.get(report.runId) ?? new Map<number, number>();
        byExpiry.set(
          report.expiresAt,
          (byExpiry.get(report.expiresAt) ?? 0) + 1,
        );
        counts.set(report.runId, byExpiry);
      }
      await this.journal.update((value) => ({
        ...value,
        heldRuns: value.heldRuns.map((run) => {
          const remaining = new Map(counts.get(run.runId));
          return {
            ...run,
            holdExpiries: run.holdExpiries.filter((expiry) => {
              const count = remaining.get(expiry) ?? 0;
              if (count === 0) return true;
              remaining.set(expiry, count - 1);
              return false;
            }),
          };
        }),
      }));
    }
    this.lastSweep = now;
  }

  private defer(delay: number): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.schedule();
    }, delay);
  }

  private advanceIndex(
    value: JournalValue<OutcomeWriteOp>,
    op: OutcomeWriteOp,
    held: boolean,
  ): JournalValue<OutcomeWriteOp> {
    if (op.kind === 'subagent-stop')
      return {
        ...value,
        heldRuns: value.heldRuns.filter((run) => run.runId !== op.row.runId),
      };
    if (!isReport(op) || !held) return value;
    const report = op.report;
    const existing = value.heldRuns.find((run) => run.runId === report.runId);
    const updated: HeldRunIndex = {
      runId: report.runId,
      expiresAt:
        op.kind === 'deliverables'
          ? Math.max(existing?.expiresAt ?? 0, report.expiresAt)
          : (existing?.expiresAt ?? 0),
      holdExpiries: [...(existing?.holdExpiries ?? []), report.expiresAt],
    };
    return {
      ...value,
      heldRuns: [
        ...value.heldRuns.filter((run) => run.runId !== report.runId),
        updated,
      ],
    };
  }

  private async rebuildIndex(): Promise<void> {
    const reports = await this.store.listHeldReports(Date.now());
    if (!this.journal) return;
    const groups = new Map<string, HeldOutcomeReport[]>();
    for (const report of reports)
      groups.set(report.runId, [...(groups.get(report.runId) ?? []), report]);
    const heldRuns: HeldRunIndex[] = [...groups].map(([runId, held]) => ({
      runId,
      expiresAt: Math.max(
        0,
        ...held
          .filter((report) => report.kind === 'deliverables')
          .map((report) => report.expiresAt),
      ),
      holdExpiries: held.map((report) => report.expiresAt),
    }));
    if (
      JSON.stringify(this.journal.snapshot().heldRuns) ===
      JSON.stringify(heldRuns)
    )
      return;
    await this.journal.update((value) => ({ ...value, heldRuns }));
  }

  private async apply(op: OutcomeWriteOp): Promise<boolean> {
    if ('row' in op) {
      const row = LaneOutcomeRowSchema.parse(op.row);
      if (op.kind === 'subagent-stop') {
        const result = await this.store.insertStopWithHeldReports(
          row,
          Date.now(),
          reportEffectOf,
        );
        for (const report of result.invalid)
          await this.reject(
            {
              kind: report.kind === 'review' ? 'review' : 'deliverables',
              report,
            },
            'invalid-payload',
          );
      } else {
        const inserted = await this.store.insertIfAbsent(row);
        if (inserted && this.onLaneRecordInserted) {
          try {
            this.onLaneRecordInserted(row);
          } catch (error: unknown) {
            this.logger.warn('Outcome insert callback failed', {
              runId: row.runId,
              code: error instanceof Error ? error.name : 'UNKNOWN',
            });
          }
        }
      }
    } else if (op.kind === 'budget-stop') {
      await this.store.markBudgetStopped(op.runId, Date.now());
    } else return this.applyReport(op);
    return false;
  }

  private async applyReport(
    op: Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }>,
  ): Promise<boolean> {
    const { report } = op;
    const result = await this.store.applyReportWithReceipt(
      report,
      Date.now(),
      reportEffectOf,
    );
    if (result === 'invalid') {
      await this.reject(op, 'invalid-payload');
      return false;
    }
    if (result === 'missing') {
      if (
        !report.runId.startsWith('subagent:') ||
        (op.kind === 'review' &&
          !(await this.store.hasHeldDeliverables(report.runId, Date.now())))
      ) {
        await this.reject(op, 'target-missing');
        return false;
      }
      if ((await this.store.countHeldReports(Date.now())) >= HOLD_LIMIT) {
        await this.reject(op, 'too-many-held-reports');
        return false;
      }
      await this.expireHolds(Date.now());
      return this.store.holdReport(report);
    }
    return false;
  }

  private async reject(op: OutcomeWriteOp, reason: string): Promise<void> {
    if (!this.storage) {
      this.logger.warn('Outcome write rejected', {
        runId: runIdOf(op),
        reason,
      });
      return;
    }
    const saved = this.storage.get<RejectedValue>(OUTCOME_REJECTED_KEY) ?? {
      entries: [],
      overflow: 0,
    };
    const reportId = isReport(op) ? op.report.reportId : undefined;
    if (
      saved.entries.some(
        (entry) =>
          entry.kind === op.kind &&
          (reportId
            ? entry.reportId === reportId
            : entry.runId === runIdOf(op)),
      )
    )
      return;
    const entries = [
      ...saved.entries,
      { kind: op.kind, runId: runIdOf(op), reportId, reason },
    ];
    await this.storage.update(OUTCOME_REJECTED_KEY, {
      entries: entries.slice(-200),
      overflow: saved.overflow + Math.max(0, entries.length - 200),
    });
    this.logger.warn('Outcome write rejected', {
      runId: runIdOf(op),
      reportId,
      reason,
    });
  }

  async dispose(): Promise<void> {
    this.closing = true;
    this.openListener?.dispose();
    if (this.retry) clearTimeout(this.retry);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => {
        deadline = setTimeout(() => {
          this.disposed = true;
          resolve();
        }, 2000);
      }),
    ]);
    if (deadline) clearTimeout(deadline);
    if (this.journal && this.queue.length) {
      const remaining = this.queue.splice(0);
      await this.journal.update((value) => {
        let next = value;
        for (const op of remaining)
          next =
            next.entries.length >= 5000
              ? { ...next, droppedAtCapacity: next.droppedAtCapacity + 1 }
              : {
                  ...next,
                  nextSeq: next.nextSeq + 1,
                  entries: [...next.entries, { seq: next.nextSeq, op }],
                };
        return next;
      });
    }
    if (!this.journal && this.queue.length)
      this.logger.warn('Outcome queue has unacknowledged ops', {
        count: this.queue.length,
      });
    this.disposed = true;
  }
}
