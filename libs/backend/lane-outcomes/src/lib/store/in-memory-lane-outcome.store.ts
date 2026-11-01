import type {
  LaneOutcomeRecord,
  OutcomeTaskKind,
} from '@ptah-extension/shared';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import { applyOutcomeEffect, heldReportJoinsRow } from './lane-outcome.store';
import type {
  HeldOutcomeReport,
  LaneOutcomeRow,
  LaneOutcomeStore,
  OutcomeEffectResolver,
  OutcomeReceipt,
} from './lane-outcome.store';

export class InMemoryLaneOutcomeStore implements LaneOutcomeStore {
  protected readonly rows = new Map<string, LaneOutcomeRecord>();
  protected readonly receipts = new Map<string, OutcomeReceipt>();
  protected readonly held = new Map<string, HeldOutcomeReport>();
  protected readonly budgetStops = new Set<string>();

  protected row(record: LaneOutcomeRecord): LaneOutcomeRow {
    return { ...record, budgetStopped: this.budgetStops.has(record.runId) };
  }

  async insertIfAbsent(input: LaneOutcomeRecord): Promise<boolean> {
    const row = LaneOutcomeRowSchema.parse(input);
    if (this.rows.has(row.runId)) return false;
    this.rows.set(row.runId, row);
    return true;
  }

  async insertStopWithHeldReports(
    input: LaneOutcomeRecord,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ): Promise<{
    inserted: boolean;
    joined: readonly HeldOutcomeReport[];
    invalid: readonly HeldOutcomeReport[];
    budgetStopped: boolean;
  }> {
    const inserted = !this.rows.has(input.runId);
    let row = inserted
      ? LaneOutcomeRowSchema.parse(input)
      : this.rows.get(input.runId);
    if (!row) throw new Error('outcome row unavailable');
    let budgetStopped = this.budgetStops.has(input.runId);
    const receipts: OutcomeReceipt[] = [];
    const joined: HeldOutcomeReport[] = [];
    const invalid: HeldOutcomeReport[] = [];
    const remove: string[] = [];
    const target = row;
    const reports = [...this.held.values()]
      .filter((r) => heldReportJoinsRow(r, target) && r.expiresAt > nowMs)
      .sort((a, b) => a.heldAt - b.heldAt);
    for (const held of reports) {
      const report = { ...held, runId: input.runId };
      remove.push(report.reportId);
      if (report.kind === 'budget-stop') {
        budgetStopped = true;
        continue;
      }
      if (this.receipts.has(report.reportId)) continue;
      const effect = resolve({ ...row, budgetStopped }, report);
      if (effect === null || effect.kind !== report.kind) {
        invalid.push(report);
        continue;
      }
      row = LaneOutcomeRowSchema.parse(applyOutcomeEffect(row, effect));
      receipts.push({
        reportId: report.reportId,
        runId: report.runId,
        kind: report.kind,
        appliedAt: nowMs,
      });
      joined.push(report);
    }
    this.rows.set(input.runId, row);
    if (budgetStopped) this.budgetStops.add(input.runId);
    for (const receipt of receipts)
      this.receipts.set(receipt.reportId, receipt);
    for (const id of remove) this.held.delete(id);
    return { inserted, joined, invalid, budgetStopped };
  }

  async applyReportWithReceipt(
    report: HeldOutcomeReport,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ): Promise<'applied' | 'duplicate' | 'missing' | 'invalid'> {
    if (this.receipts.has(report.reportId)) return 'duplicate';
    const current = this.rows.get(report.runId);
    if (!current) return 'missing';
    if (report.kind === 'budget-stop') return 'invalid';
    const effect = resolve(this.row(current), report);
    if (effect === null || effect.kind !== report.kind) return 'invalid';
    const updated = LaneOutcomeRowSchema.parse(
      applyOutcomeEffect(current, effect),
    );
    this.rows.set(report.runId, updated);
    this.receipts.set(report.reportId, {
      reportId: report.reportId,
      runId: report.runId,
      kind: report.kind,
      appliedAt: nowMs,
    });
    return 'applied';
  }

  async markBudgetStopped(
    runId: string,
    nowMs: number,
  ): Promise<'applied' | 'held' | 'duplicate'> {
    if (this.budgetStops.has(runId)) return 'duplicate';
    if (this.rows.has(runId)) {
      this.budgetStops.add(runId);
      return 'applied';
    }
    const reportId = `budget-stop:${runId}`;
    if (this.held.has(reportId)) return 'duplicate';
    this.held.set(reportId, {
      reportId,
      runId,
      kind: 'budget-stop',
      payload: '{}',
      heldAt: nowMs,
      expiresAt: nowMs + 86_400_000,
    });
    return 'held';
  }

  async update(
    runId: string,
    patch: Partial<LaneOutcomeRecord>,
  ): Promise<boolean> {
    const current = this.rows.get(runId);
    if (!current) return false;
    this.rows.set(
      runId,
      LaneOutcomeRowSchema.parse({ ...current, ...patch, runId }),
    );
    return true;
  }
  async setClassifiedTaskKind(
    runId: string,
    kind: OutcomeTaskKind,
  ): Promise<boolean> {
    const row = this.rows.get(runId);
    if (
      !row ||
      row.taskKind !== null ||
      (row.taskKindSource !== null &&
        row.taskKindSource !== undefined &&
        row.taskKindSource !== 'unclassified')
    )
      return false;
    this.rows.set(runId, {
      ...row,
      taskKind: kind,
      taskKindSource: 'classified',
    });
    return true;
  }
  async fillMissingSubagentJoin(
    runId: string,
    join: {
      readonly subagentSessionId: string | null;
      readonly parentSessionId: string | null;
      readonly workspaceRoot: string | null;
    },
  ): Promise<boolean> {
    const row = this.rows.get(runId);
    if (!row) return false;
    const subagentSessionId = row.subagentSessionId ?? join.subagentSessionId;
    const parentSessionId = row.parentSessionId ?? join.parentSessionId;
    const workspaceRoot = row.workspaceRoot ?? join.workspaceRoot;
    if (
      subagentSessionId === (row.subagentSessionId ?? null) &&
      parentSessionId === (row.parentSessionId ?? null) &&
      workspaceRoot === (row.workspaceRoot ?? null)
    )
      return false;
    this.rows.set(runId, {
      ...row,
      subagentSessionId,
      parentSessionId,
      workspaceRoot,
    });
    return true;
  }
  async get(runId: string): Promise<LaneOutcomeRow | null> {
    const row = this.rows.get(runId);
    return row ? this.row(row) : null;
  }
  async findLatestByAgent(agentId: string): Promise<LaneOutcomeRow | null> {
    const row = [...this.rows.values()]
      .filter((r) => r.agentId === agentId)
      .sort((a, b) => b.endedAt - a.endedAt)[0];
    return row ? this.row(row) : null;
  }
  async listByLane(
    laneId: string,
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.laneId === laneId && r.endedAt >= sinceMs)
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 2000)
      .map((r) => this.row(r));
  }
  async listByRoles(
    slugs: readonly string[],
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]> {
    const names = new Set(slugs);
    return [...this.rows.values()]
      .filter(
        (r) => r.role !== null && names.has(r.role) && r.endedAt >= sinceMs,
      )
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 2000)
      .map((r) => this.row(r));
  }
  async hasReceipt(reportId: string): Promise<boolean> {
    return this.receipts.has(reportId);
  }
  async holdReport(report: HeldOutcomeReport): Promise<boolean> {
    if (report.kind === 'budget-stop') return false;
    this.expire(Date.now());
    if (this.held.has(report.reportId)) return false;
    this.held.set(report.reportId, report);
    return true;
  }
  async listHeldReports(nowMs: number): Promise<readonly HeldOutcomeReport[]> {
    return [...this.held.values()]
      .filter((r) => r.kind !== 'budget-stop' && r.expiresAt > nowMs)
      .sort((a, b) => a.heldAt - b.heldAt);
  }
  async expireHeldReports(
    nowMs: number,
  ): Promise<readonly HeldOutcomeReport[]> {
    return this.expire(nowMs);
  }
  protected expire(nowMs: number): HeldOutcomeReport[] {
    const expired: HeldOutcomeReport[] = [];
    for (const [id, report] of this.held)
      if (report.expiresAt <= nowMs) {
        this.held.delete(id);
        expired.push(report);
      }
    return expired;
  }
  async countHeldReports(nowMs: number): Promise<number> {
    return [...this.held.values()].filter(
      (r) => r.kind !== 'budget-stop' && r.expiresAt > nowMs,
    ).length;
  }
  async hasHeldDeliverables(runId: string, nowMs: number): Promise<boolean> {
    return [...this.held.values()].some(
      (r) =>
        r.runId === runId && r.kind === 'deliverables' && r.expiresAt > nowMs,
    );
  }
  isPersistent(): boolean {
    return false;
  }
}
