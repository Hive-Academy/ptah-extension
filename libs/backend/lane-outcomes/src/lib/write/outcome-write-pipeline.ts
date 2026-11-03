/**
 * An operation leaves the journal only after the store applies it. The journal
 * retains operations while the database is closed or a write fails.
 * `enqueue` returns immediately; `submit` awaits admission and resolves to
 * applied, held, queued, or an error result. It never rejects for admission.
 * Reviews to a missing lane or subagent run, and deliverables to a missing
 * subagent run, are held for up to 24 hours, at most 500 at once. Lane and
 * subagent rows share one insert path that joins the run's held reports; an
 * expired hold enters the rejected ledger. Validation and constraint failures
 * enter the rejected ledger. Other failures retry after 250 ms to 60 s. The
 * journal admits at most OUTCOME_JOURNAL_LIMIT operations and counts refusals.
 */
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import { z, ZodError } from 'zod';
import { isSubagentRunId } from '../subagent-join';
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
import { OutcomeWriteOpSchema } from './outcome-write-op.schema';
import {
  KeyValueOutcomeJournal,
  appendEntries,
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

type RejectableOp =
  OutcomeWriteOp | { readonly kind: 'invalid-op'; readonly runId: string };

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
  readonly kind: RejectableOp['kind'];
  readonly runId: string;
  readonly reportId?: string;
  readonly reason: string;
}

interface RejectedValue {
  readonly entries: readonly RejectedEntry[];
  readonly overflow: number;
}
const RejectedValueSchema = z.object({
  entries: z.array(
    z.object({
      kind: z.enum([
        'lane-completion',
        'subagent-stop',
        'budget-stop',
        'deliverables',
        'review',
        'invalid-op',
      ]),
      runId: z.string(),
      reportId: z.string().optional(),
      reason: z.string(),
    }),
  ),
  overflow: z.number().int().nonnegative(),
});

const DELAYS = [250, 1000, 5_000, 30000, 60000];
const HOLD_LIMIT = 500;
const HOLD_SWEEP_MS = 60000;
const QUEUE_LIMIT = 1000;
const DRAIN_BATCH = 25;
const JOURNAL_RETRY_MS = 250;
const REJECTED_LIMIT = 200;
const DISPOSE_DEADLINE_MS = 2000;

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

function runIdOf(op: RejectableOp): string {
  return 'row' in op
    ? op.row.runId
    : 'report' in op
      ? op.report.runId
      : op.runId;
}

function isReport(
  op: RejectableOp,
): op is Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }> {
  return op.kind === 'deliverables' || op.kind === 'review';
}

/** A review to any missing run, or deliverables to a missing subagent run. */
function holdable(
  op: Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }>,
): boolean {
  return op.kind === 'review' || isSubagentRunId(op.report.runId);
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
      ? new KeyValueOutcomeJournal<OutcomeWriteOp>(
          storage,
          Date.now(),
          OutcomeWriteOpSchema,
        )
      : null;
    this.openListener = availability?.onDidOpen?.(() => {
      this.needsRebuild = true;
      this.schedule();
    });
    if (this.journal?.droppedOnRead) {
      this.logger.warn('Outcome journal unreadable', {
        dropped: this.journal.droppedOnRead,
        code: 'ZOD_VALIDATION',
      });
    }
    const dropped = this.journal?.snapshot().droppedAtCapacity ?? 0;
    const rejected = this.readRejected()?.entries.length ?? 0;
    if (dropped || rejected)
      this.logger.warn('Outcome journal has prior refusals', {
        droppedAtCapacity: dropped,
        rejected,
      });
    this.schedule();
  }

  private readRejected(): RejectedValue | undefined {
    if (!this.storage) return undefined;
    const raw = this.storage.get<unknown>(OUTCOME_REJECTED_KEY);
    if (raw === undefined) return undefined;
    try {
      return RejectedValueSchema.parse(raw);
    } catch {
      // degradation-audit: reported - unreadable rejected history resets with one warning
      this.logger.warn('Outcome rejected ledger unreadable', {
        code: 'ZOD_VALIDATION',
      });
      return undefined;
    }
  }

  enqueue(op: OutcomeWriteOp): void {
    if (this.closing || this.disposed) return;
    if (this.queue.length >= QUEUE_LIMIT && !this.journal) {
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
    let heldCount = 0;
    if (readable) {
      try {
        [row, heldCount] = await Promise.all([
          this.store.get(runId),
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
      const admission = await this.accept(op);
      if (admission !== 'accepted')
        return {
          ok: false,
          error:
            admission === 'capacity'
              ? 'outcome journal at capacity'
              : 'outcome journal write failed',
        };
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
    // A review waits for any run kind; deliverables wait only for a subagent
    // run, whose stop may arrive after the report. While the store is closed
    // a review is admitted only for a run the journal index already holds,
    // since an unindexed run cannot be told apart from a stored one.
    const indexed =
      this.journal
        ?.snapshot()
        .heldRuns.find((item) => item.runId === runId)
        ?.holdExpiries.some((expiry) => expiry > Date.now()) ?? false;
    const pendingHold = pending.some(
      (item) => isReport(item) && holdable(item) && item.report.runId === runId,
    );
    if (
      !holdable(op) ||
      (op.kind === 'review' && !readable && !indexed && !pendingHold)
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
        holdable(item) &&
        !pending.some(
          (other) => 'row' in other && other.row.runId === item.report.runId,
        ),
    ).length;
    if (heldCount + pendingHolds >= HOLD_LIMIT)
      return { ok: false, error: 'too many held reports' };
    const admission = await this.accept(op);
    if (admission !== 'accepted')
      return {
        ok: false,
        error:
          admission === 'capacity'
            ? 'outcome journal at capacity'
            : 'outcome journal write failed',
      };
    if (readable) await this.flush();
    return { ok: true, state: 'held', runId };
  }

  private async accept(
    op: OutcomeWriteOp,
  ): Promise<'accepted' | 'capacity' | 'write-failed'> {
    if (this.journal) {
      const waiting = this.queue.splice(0);
      let accepted = false;
      this.accepting++;
      try {
        await this.journal.update((value) => {
          const result = appendEntries(value, [...waiting, op]);
          accepted = result.accepted[result.accepted.length - 1];
          return result.value;
        });
      } catch (error: unknown) {
        // degradation-audit: reported - admission returns a fixed error after preserving waiting ops
        this.queue.unshift(...waiting);
        this.logger.warn('Outcome journal write failed', {
          runId: runIdOf(op),
          code: failureCode(error),
        });
        return 'write-failed';
      } finally {
        this.accepting--;
        this.schedule();
      }
      if (!accepted) this.warnCapacity();
      else this.schedule();
      return accepted ? 'accepted' : 'capacity';
    }
    if (this.queue.length >= QUEUE_LIMIT) return 'capacity';
    this.queue.push(op);
    this.schedule();
    return 'accepted';
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
        const moved = this.queue.splice(0);
        try {
          await this.journal.update(
            (value) => appendEntries(value, moved).value,
          );
        } catch (error: unknown) {
          this.queue.unshift(...moved);
          throw error;
        }
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
      while (processed < DRAIN_BATCH) {
        const entry = next?.entries[processed];
        if (next ? entry === undefined : this.queue[processed] === undefined)
          break;
        const candidate: unknown = next ? entry?.op : this.queue[processed];
        const parsed = OutcomeWriteOpSchema.safeParse(candidate);
        if (!parsed.success) {
          await this.reject(
            {
              kind: 'invalid-op',
              runId: entry ? `journal:${entry.seq}` : `queue:${processed}`,
            },
            'ZOD_VALIDATION',
          );
          processed++;
          continue;
        }
        const op = parsed.data;
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
      this.defer(JOURNAL_RETRY_MS);
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
    // An unmatched report hold (an early review whose target never arrived)
    // ends in the rejected ledger; the warning above is its one log line.
    for (const report of expired)
      if (report.kind !== 'budget-stop')
        await this.reject(
          {
            kind: report.kind === 'review' ? 'review' : 'deliverables',
            report,
          },
          'held-report-expired',
          false,
        );
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
    if ('row' in op)
      return {
        ...value,
        // The insert also joins a review held under the row's bare agent id.
        heldRuns: value.heldRuns.filter(
          (run) => run.runId !== op.row.runId && run.runId !== op.row.agentId,
        ),
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
      // One insert path for lane and subagent rows: it joins every report
      // held for the run, so an early review applies on its target insert.
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
      if (result.inserted) this.notifyInserted(row);
      else if (op.kind === 'subagent-stop')
        // A later stop producer only fills join fields the first one lacked.
        await this.store.fillMissingSubagentJoin(row.runId, {
          subagentSessionId: row.subagentSessionId ?? null,
          parentSessionId: row.parentSessionId ?? null,
          workspaceRoot: row.workspaceRoot ?? null,
        });
    } else if (op.kind === 'budget-stop') {
      await this.store.markBudgetStopped(op.runId, Date.now());
    } else return this.applyReport(op);
    return false;
  }

  /** Fires the insert callback exactly once per newly inserted row. */
  private notifyInserted(row: LaneOutcomeRecord): void {
    if (!this.onLaneRecordInserted) return;
    try {
      this.onLaneRecordInserted(row);
    } catch (error: unknown) {
      // degradation-audit: reported - a failing post-insert hook never undoes the stored row
      this.logger.warn('Outcome insert callback failed', {
        runId: row.runId,
        code: error instanceof Error ? error.name : 'UNKNOWN',
      });
    }
  }

  private async applyReport(
    op: Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }>,
  ): Promise<boolean> {
    let { report } = op;
    let result = await this.store.applyReportWithReceipt(
      report,
      Date.now(),
      reportEffectOf,
    );
    if (result === 'missing' && op.kind === 'review') {
      // A review naming a bare agent id whose run landed after the caller
      // resolved it: inserts run only in this drain, so the agent's row is
      // current here and the review joins it instead of a hold that no
      // later insert would take.
      const latest = await this.store.findLatestByAgent(report.runId);
      if (latest) {
        report = { ...report, runId: latest.runId };
        result = await this.store.applyReportWithReceipt(
          report,
          Date.now(),
          reportEffectOf,
        );
      }
    }
    if (result === 'invalid') {
      await this.reject(op, 'invalid-payload');
      return false;
    }
    if (result === 'missing') {
      if (!holdable(op)) {
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

  private async reject(
    op: RejectableOp,
    reason: string,
    log = true,
  ): Promise<void> {
    if (!this.storage) {
      if (log)
        this.logger.warn('Outcome write rejected', {
          runId: runIdOf(op),
          reason,
        });
      return;
    }
    const saved = this.readRejected() ?? {
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
      entries: entries.slice(-REJECTED_LIMIT),
      overflow: saved.overflow + Math.max(0, entries.length - REJECTED_LIMIT),
    });
    if (log)
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
        }, DISPOSE_DEADLINE_MS);
      }),
    ]);
    if (deadline) clearTimeout(deadline);
    if (this.journal && this.queue.length) {
      const remaining = this.queue.splice(0);
      await this.journal.update(
        (value) => appendEntries(value, remaining).value,
      );
    }
    if (!this.journal && this.queue.length)
      this.logger.warn('Outcome queue has unacknowledged ops', {
        count: this.queue.length,
      });
    this.disposed = true;
  }
}
