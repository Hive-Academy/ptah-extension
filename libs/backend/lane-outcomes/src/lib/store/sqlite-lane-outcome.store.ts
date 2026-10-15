import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { z } from 'zod';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import { applyOutcomeEffect } from './lane-outcome.store';
import type {
  HeldOutcomeReport,
  LaneOutcomeRow,
  LaneOutcomeStore,
  OutcomeEffectResolver,
} from './lane-outcome.store';

const columns = [
  ['runId', 'run_id'],
  ['executorKind', 'executor_kind'],
  ['laneId', 'lane_id'],
  ['agentId', 'agent_id'],
  ['subagentSessionId', 'subagent_session_id'],
  ['parentSessionId', 'parent_session_id'],
  ['workspaceRoot', 'workspace_root'],
  ['family', 'family'],
  ['provider', 'provider'],
  ['model', 'model'],
  ['role', 'role'],
  ['taskKind', 'task_kind'],
  ['taskId', 'task_id'],
  ['verdict', 'verdict'],
  ['failureClass', 'failure_class'],
  ['startedAt', 'started_at'],
  ['endedAt', 'ended_at'],
  ['durationMs', 'duration_ms'],
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
  ['costUsd', 'cost_usd'],
  ['routingSource', 'routing_source'],
  ['reviseRounds', 'revise_rounds'],
  ['finalReview', 'final_review'],
  ['deliverablesDeclaredAt', 'deliverables_declared_at'],
] as const;
const names = columns.map(([, column]) => column);
const INSERT = `INSERT OR IGNORE INTO lane_outcome_records (${names.join(', ')}, created_at, updated_at) VALUES (${names.map(() => '?').join(', ')}, ?, ?)`;
const UPDATE = `UPDATE lane_outcome_records SET ${names
  .slice(1)
  .map((name) => `${name} = ?`)
  .join(', ')}, updated_at = ? WHERE run_id = ?`;
const SELECT = 'SELECT * FROM lane_outcome_records';
const HeldSchema = z.object({
  report_id: z.string(),
  run_id: z.string(),
  kind: z.enum(['deliverables', 'review', 'budget-stop']),
  payload: z.string(),
  held_at: z.number(),
  expires_at: z.number(),
});

export class SqliteLaneOutcomeStore implements LaneOutcomeStore {
  constructor(private readonly connection: SqliteConnectionService) {}
  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  private decode(raw: unknown): LaneOutcomeRow | null {
    if (raw === undefined) return null;
    const values = z.record(z.string(), z.unknown()).parse(raw);
    const record: Record<string, unknown> = {};
    for (const [key, column] of columns) record[key] = values[column];
    record.telemetryJoin = 'not-applicable';
    record.skillsLoaded = null;
    record.sessionEvidenceClass = null;
    return {
      ...LaneOutcomeRowSchema.parse(record),
      budgetStopped: values['budget_stopped'] === 1,
    };
  }

  private decodeMany(raw: readonly unknown[]): LaneOutcomeRow[] {
    return raw
      .map((row) => this.decode(row))
      .filter((row): row is LaneOutcomeRow => row !== null);
  }

  private values(row: LaneOutcomeRecord): unknown[] {
    const parsed = LaneOutcomeRowSchema.parse(row);
    const values: Record<string, unknown> = { ...parsed };
    return columns.map(([key]) => values[key] ?? null);
  }

  async insertIfAbsent(input: LaneOutcomeRecord): Promise<boolean> {
    const row = LaneOutcomeRowSchema.parse(input);
    const now = Date.now();
    return (
      this.db.prepare(INSERT).run(...this.values(row), now, now).changes > 0
    );
  }

  private heldReport(raw: unknown): HeldOutcomeReport {
    const row = HeldSchema.parse(raw);
    return {
      reportId: row.report_id,
      runId: row.run_id,
      kind: row.kind,
      payload: row.payload,
      heldAt: row.held_at,
      expiresAt: row.expires_at,
    };
  }

  private receiptExists(reportId: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM lane_outcome_report_receipts WHERE report_id = ?',
        )
        .get(reportId) !== undefined
    );
  }

  private applyInTransaction(
    report: HeldOutcomeReport,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ): 'applied' | 'duplicate' | 'missing' | 'invalid' {
    if (this.receiptExists(report.reportId)) return 'duplicate';
    const current = this.decode(
      this.db
        .prepare('SELECT * FROM lane_outcome_records WHERE run_id = ?')
        .get(report.runId),
    );
    if (!current) return 'missing';
    if (report.kind === 'budget-stop') return 'invalid';
    const effect = resolve(current, report);
    if (effect === null || effect.kind !== report.kind) return 'invalid';
    const updated = LaneOutcomeRowSchema.parse(
      applyOutcomeEffect(current, effect),
    );
    if (effect.kind === 'review' && effect.verdict === 'revise')
      this.db
        .prepare(
          'UPDATE lane_outcome_records SET revise_rounds = revise_rounds + 1, updated_at = ? WHERE run_id = ?',
        )
        .run(nowMs, report.runId);
    else
      this.db
        .prepare(UPDATE)
        .run(...this.values(updated).slice(1), nowMs, report.runId);
    this.db
      .prepare(
        'INSERT INTO lane_outcome_report_receipts (report_id, run_id, kind, applied_at) VALUES (?, ?, ?, ?)',
      )
      .run(report.reportId, report.runId, report.kind, nowMs);
    return 'applied';
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
    return this.db.transaction(() => {
      const row = LaneOutcomeRowSchema.parse(input);
      const inserted =
        this.db.prepare(INSERT).run(...this.values(row), nowMs, nowMs).changes >
        0;
      const joined: HeldOutcomeReport[] = [];
      const invalid: HeldOutcomeReport[] = [];
      const reports = this.db
        .prepare(
          'SELECT * FROM lane_outcome_held_reports WHERE run_id = ? AND expires_at > ? ORDER BY held_at, rowid',
        )
        .all(input.runId, nowMs)
        .map((raw) => this.heldReport(raw));
      for (const report of reports) {
        if (report.kind === 'budget-stop')
          this.db
            .prepare(
              'UPDATE lane_outcome_records SET budget_stopped = 1, updated_at = ? WHERE run_id = ?',
            )
            .run(nowMs, input.runId);
        else {
          const result = this.applyInTransaction(report, nowMs, resolve);
          if (result === 'applied') joined.push(report);
          if (result === 'invalid') invalid.push(report);
        }
        this.db
          .prepare('DELETE FROM lane_outcome_held_reports WHERE report_id = ?')
          .run(report.reportId);
      }
      const current = this.decode(
        this.db
          .prepare('SELECT * FROM lane_outcome_records WHERE run_id = ?')
          .get(input.runId),
      );
      if (!current) throw new Error('inserted outcome row unavailable');
      return {
        inserted,
        joined,
        invalid,
        budgetStopped: current.budgetStopped,
      };
    })();
  }

  async applyReportWithReceipt(
    report: HeldOutcomeReport,
    nowMs: number,
    resolve: OutcomeEffectResolver,
  ): Promise<'applied' | 'duplicate' | 'missing' | 'invalid'> {
    return this.db.transaction(() =>
      this.applyInTransaction(report, nowMs, resolve),
    )();
  }

  async markBudgetStopped(
    runId: string,
    nowMs: number,
  ): Promise<'applied' | 'held' | 'duplicate'> {
    return this.db.transaction(() => {
      const current = this.decode(
        this.db
          .prepare('SELECT * FROM lane_outcome_records WHERE run_id = ?')
          .get(runId),
      );
      if (current) {
        if (current.budgetStopped) return 'duplicate';
        this.db
          .prepare(
            'UPDATE lane_outcome_records SET budget_stopped = 1, updated_at = ? WHERE run_id = ?',
          )
          .run(nowMs, runId);
        return 'applied';
      }
      const reportId = `budget-stop:${runId}`;
      const result = this.db
        .prepare(
          'INSERT OR IGNORE INTO lane_outcome_held_reports (report_id, run_id, kind, payload, held_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(reportId, runId, 'budget-stop', '{}', nowMs, nowMs + 86_400_000);
      return result.changes > 0 ? 'held' : 'duplicate';
    })();
  }

  async update(
    runId: string,
    patch: Partial<LaneOutcomeRecord>,
  ): Promise<boolean> {
    const current = await this.get(runId);
    if (!current) return false;
    const row = LaneOutcomeRowSchema.parse({ ...current, ...patch, runId });
    return (
      this.db
        .prepare(UPDATE)
        .run(...this.values(row).slice(1), Date.now(), runId).changes > 0
    );
  }

  async get(runId: string): Promise<LaneOutcomeRow | null> {
    return this.decode(
      this.db.prepare(`${SELECT} WHERE run_id = ?`).get(runId),
    );
  }

  async findLatestByAgent(agentId: string): Promise<LaneOutcomeRow | null> {
    return this.decode(
      this.db
        .prepare(`${SELECT} WHERE agent_id = ? ORDER BY ended_at DESC LIMIT 1`)
        .get(agentId),
    );
  }

  async listByLane(
    laneId: string,
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]> {
    return this.decodeMany(
      this.db
        .prepare(
          `${SELECT} WHERE lane_id = ? AND ended_at >= ? ORDER BY ended_at DESC LIMIT 2000`,
        )
        .all(laneId, sinceMs),
    );
  }

  async listByRoles(
    slugs: readonly string[],
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRow[]> {
    if (slugs.length === 0) return [];
    const result: LaneOutcomeRow[] = [];
    for (const slug of slugs) {
      result.push(
        ...this.decodeMany(
          this.db
            .prepare(
              `${SELECT} WHERE role = ? AND ended_at >= ? ORDER BY ended_at DESC LIMIT 2000`,
            )
            .all(slug, sinceMs),
        ),
      );
    }
    return result.sort((a, b) => b.endedAt - a.endedAt).slice(0, 2000);
  }

  async hasReceipt(reportId: string): Promise<boolean> {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM lane_outcome_report_receipts WHERE report_id = ?',
        )
        .get(reportId) !== undefined
    );
  }

  async holdReport(report: HeldOutcomeReport): Promise<boolean> {
    if (report.kind === 'budget-stop') return false;
    this.db
      .prepare('DELETE FROM lane_outcome_held_reports WHERE expires_at <= ?')
      .run(Date.now());
    return (
      this.db
        .prepare(
          'INSERT OR IGNORE INTO lane_outcome_held_reports (report_id, run_id, kind, payload, held_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          report.reportId,
          report.runId,
          report.kind,
          report.payload,
          report.heldAt,
          report.expiresAt,
        ).changes > 0
    );
  }

  async listHeldReports(nowMs: number): Promise<readonly HeldOutcomeReport[]> {
    return this.db.transaction(() =>
      this.db
        .prepare(
          "SELECT * FROM lane_outcome_held_reports WHERE expires_at > ? AND kind IN ('deliverables', 'review') ORDER BY held_at, rowid",
        )
        .all(nowMs)
        .map((raw) => this.heldReport(raw)),
    )();
  }

  async expireHeldReports(
    nowMs: number,
  ): Promise<readonly HeldOutcomeReport[]> {
    return this.db.transaction(() => {
      const expired = this.db
        .prepare(
          'SELECT * FROM lane_outcome_held_reports WHERE expires_at <= ? ORDER BY held_at, rowid',
        )
        .all(nowMs)
        .map((raw) => this.heldReport(raw));
      this.db
        .prepare('DELETE FROM lane_outcome_held_reports WHERE expires_at <= ?')
        .run(nowMs);
      return expired;
    })();
  }

  async countHeldReports(nowMs: number): Promise<number> {
    const raw = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM lane_outcome_held_reports WHERE expires_at > ? AND kind IN ('deliverables', 'review')",
      )
      .get(nowMs);
    return z.object({ count: z.number() }).parse(raw).count;
  }

  async hasHeldDeliverables(runId: string, nowMs: number): Promise<boolean> {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM lane_outcome_held_reports WHERE run_id = ? AND kind = 'deliverables' AND expires_at > ? LIMIT 1",
        )
        .get(runId, nowMs) !== undefined
    );
  }

  isPersistent(): boolean {
    return this.connection.isOpen;
  }
}
