import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { z } from 'zod';
import { LaneOutcomeRowSchema } from '../lane-outcome.schema';
import type {
  HeldOutcomeReport,
  LaneOutcomeStore,
  OutcomeReceipt,
} from './lane-outcome.store';

const columns = [
  ['runId', 'run_id'],
  ['executorKind', 'executor_kind'],
  ['laneId', 'lane_id'],
  ['agentId', 'agent_id'],
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
  kind: z.enum(['deliverables', 'review']),
  payload: z.string(),
  held_at: z.number(),
  expires_at: z.number(),
});

export class SqliteLaneOutcomeStore implements LaneOutcomeStore {
  constructor(private readonly connection: SqliteConnectionService) {}
  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  private decode(raw: unknown): LaneOutcomeRecord | null {
    if (raw === undefined) return null;
    const values = z.record(z.string(), z.unknown()).parse(raw);
    const record: Record<string, unknown> = {};
    for (const [key, column] of columns) record[key] = values[column];
    record.telemetryJoin = 'not-applicable';
    record.skillsLoaded = null;
    record.sessionEvidenceClass = null;
    return LaneOutcomeRowSchema.parse(record);
  }

  private decodeMany(raw: readonly unknown[]): LaneOutcomeRecord[] {
    return raw
      .map((row) => this.decode(row))
      .filter((row): row is LaneOutcomeRecord => row !== null);
  }

  private values(row: LaneOutcomeRecord): unknown[] {
    const parsed = LaneOutcomeRowSchema.parse(row);
    const values: Record<string, unknown> = { ...parsed };
    return columns.map(([key]) => values[key]);
  }

  async insertIfAbsent(input: LaneOutcomeRecord): Promise<boolean> {
    const row = LaneOutcomeRowSchema.parse(input);
    const now = Date.now();
    return (
      this.db.prepare(INSERT).run(...this.values(row), now, now).changes > 0
    );
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

  async get(runId: string): Promise<LaneOutcomeRecord | null> {
    return this.decode(
      this.db.prepare(`${SELECT} WHERE run_id = ?`).get(runId),
    );
  }

  async findLatestByAgent(agentId: string): Promise<LaneOutcomeRecord | null> {
    return this.decode(
      this.db
        .prepare(`${SELECT} WHERE agent_id = ? ORDER BY ended_at DESC LIMIT 1`)
        .get(agentId),
    );
  }

  async listByLane(
    laneId: string,
    sinceMs: number,
  ): Promise<readonly LaneOutcomeRecord[]> {
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
  ): Promise<readonly LaneOutcomeRecord[]> {
    if (slugs.length === 0) return [];
    const result: LaneOutcomeRecord[] = [];
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

  async recordReceipt(receipt: OutcomeReceipt): Promise<boolean> {
    return (
      this.db
        .prepare(
          'INSERT OR IGNORE INTO lane_outcome_report_receipts (report_id, run_id, kind, applied_at) VALUES (?, ?, ?, ?)',
        )
        .run(receipt.reportId, receipt.runId, receipt.kind, receipt.appliedAt)
        .changes > 0
    );
  }

  async holdReport(report: HeldOutcomeReport): Promise<boolean> {
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

  async takeHeldReports(
    runId: string,
    nowMs: number,
  ): Promise<readonly HeldOutcomeReport[]> {
    const take = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM lane_outcome_held_reports WHERE expires_at <= ?')
        .run(nowMs);
      const rows = this.db
        .prepare(
          'SELECT * FROM lane_outcome_held_reports WHERE run_id = ? ORDER BY held_at',
        )
        .all(runId);
      this.db
        .prepare('DELETE FROM lane_outcome_held_reports WHERE run_id = ?')
        .run(runId);
      return rows.map((raw) => {
        const row = HeldSchema.parse(raw);
        return {
          reportId: row.report_id,
          runId: row.run_id,
          kind: row.kind,
          payload: row.payload,
          heldAt: row.held_at,
          expiresAt: row.expires_at,
        };
      });
    });
    return take();
  }

  async expireHeldReports(nowMs: number): Promise<number> {
    return this.db
      .prepare('DELETE FROM lane_outcome_held_reports WHERE expires_at <= ?')
      .run(nowMs).changes;
  }

  async countHeldReports(nowMs: number): Promise<number> {
    const raw = this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM lane_outcome_held_reports WHERE expires_at > ?',
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
