import type { IStateStorage } from '@ptah-extension/platform-core';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { InMemoryLaneOutcomeStore } from '../store/in-memory-lane-outcome.store';
import { SqliteLaneOutcomeStore } from '../store/sqlite-lane-outcome.store';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import { heldReport } from '../store/store.test-support';
import type {
  OutcomeWriteOp,
  OutcomeStoreAvailability,
} from './outcome-write-pipeline';

export class MemoryState implements IStateStorage {
  readonly values = new Map<string, unknown>();
  readonly writes: string[] = [];
  rejectNext: ((key: string) => boolean) | undefined;

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? fallback;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.writes.push(key);
    if (this.rejectNext?.(key)) {
      this.rejectNext = undefined;
      throw new Error('injected storage failure');
    }
    this.values.set(key, structuredClone(value));
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

export class GatedMemoryState extends MemoryState {
  private gated = false;
  private releaseGate: (() => void) | undefined;
  private enteredGate: (() => void) | undefined;
  readonly entered = new Promise<void>((resolve) => {
    this.enteredGate = resolve;
  });
  readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });
  readonly journalSnapshots: unknown[] = [];

  override async update(key: string, value: unknown): Promise<void> {
    if (key === 'ptah.laneOutcomes.journal.v1' && !this.gated) {
      this.gated = true;
      this.enteredGate?.();
      await this.gate;
    }
    if (key === 'ptah.laneOutcomes.journal.v1')
      this.journalSnapshots.push(structuredClone(value));
    await super.update(key, value);
  }

  release(): void {
    this.releaseGate?.();
  }
}

export class Availability implements OutcomeStoreAvailability {
  open = false;
  private readonly listeners = new Set<() => void>();
  isOpen(): boolean {
    return this.open;
  }
  onDidOpen(callback: () => void): { dispose(): void } {
    this.listeners.add(callback);
    return {
      dispose: () => {
        this.listeners.delete(callback);
      },
    };
  }
  reopen(): void {
    this.open = true;
    for (const callback of this.listeners) callback();
  }
}

export class FaultStore extends InMemoryLaneOutcomeStore {
  failInsert = 0;
  code: 'SQLITE_BUSY' | 'SQLITE_IOERR' = 'SQLITE_IOERR';
  override async insertStopWithHeldReports(
    ...args: Parameters<InMemoryLaneOutcomeStore['insertStopWithHeldReports']>
  ): ReturnType<InMemoryLaneOutcomeStore['insertStopWithHeldReports']> {
    if (this.failInsert-- > 0)
      throw Object.assign(new Error('injected'), { code: this.code });
    return super.insertStopWithHeldReports(...args);
  }
}

export async function drainTurns(
  pipeline: import('./outcome-write-pipeline').OutcomeWritePipeline,
  turns: number,
): Promise<void> {
  for (let i = 0; i < turns; i++) await pipeline.flush();
}

export const testLogger = (): LaneOutcomeLogger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

export function reportOp(
  runId: string,
  id: number,
  kind: 'deliverables' | 'review' = 'deliverables',
): Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }> {
  const now = Date.now();
  return {
    kind,
    report: {
      ...heldReport(id, now),
      runId,
      kind,
      expiresAt: now + 86_400_000,
      payload:
        kind === 'review'
          ? JSON.stringify({ verdict: 'revise' })
          : heldReport(id, now).payload,
    },
  };
}

export function sqliteFixture(file: string): {
  db: { exec(sql: string): void; close(): void };
  store: SqliteLaneOutcomeStore;
} {
  const Database = require('better-sqlite3') as new (path: string) => {
    exec(sql: string): void;
    close(): void;
  };
  const db = new Database(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lane_outcome_records (
      run_id TEXT NOT NULL PRIMARY KEY, executor_kind TEXT NOT NULL,
      lane_id TEXT NOT NULL, agent_id TEXT NOT NULL, family TEXT,
      subagent_session_id TEXT, parent_session_id TEXT, workspace_root TEXT,
      provider TEXT, model TEXT NOT NULL, role TEXT, task_kind TEXT,
      task_id TEXT, verdict TEXT NOT NULL, failure_class TEXT,
      budget_stopped INTEGER NOT NULL DEFAULT 0, started_at INTEGER,
      ended_at INTEGER NOT NULL, duration_ms INTEGER, input_tokens INTEGER,
      output_tokens INTEGER, cost_usd REAL, routing_source TEXT NOT NULL,
      revise_rounds INTEGER NOT NULL DEFAULT 0, final_review TEXT,
      deliverables_declared_at INTEGER, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lane_outcome_report_receipts (
      report_id TEXT NOT NULL PRIMARY KEY, run_id TEXT NOT NULL,
      kind TEXT NOT NULL, applied_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lane_outcome_held_reports (
      report_id TEXT NOT NULL PRIMARY KEY, run_id TEXT NOT NULL,
      kind TEXT NOT NULL, payload TEXT NOT NULL,
      held_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
  const connection = Object.create(
    SqliteConnectionService.prototype,
  ) as SqliteConnectionService;
  Object.defineProperty(connection, 'db', { value: db });
  Object.defineProperty(connection, 'isOpen', { value: true });
  return { db, store: new SqliteLaneOutcomeStore(connection, testLogger()) };
}
