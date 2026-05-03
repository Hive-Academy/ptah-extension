/**
 * RunStore — CRUD over `job_runs` (schema 0004_cron.sql).
 *
 * The store's load-bearing primitive is {@link RunStore.tryClaim}: it inserts
 * a `pending` row with `UNIQUE(job_id, scheduled_for)`. The caller treats a
 * thrown `SQLITE_CONSTRAINT_UNIQUE` (better-sqlite3 surface: `err.code`) as
 * "another runner already claimed this slot — skip" rather than retrying or
 * upserting. This is the *single* primitive the architecture (§8.5) names as
 * the at-most-once mechanism for cron — no `INSERT OR IGNORE`, no UPSERT.
 *
 * Time format: integer epoch ms (architecture §8.5 / 0004_cron.sql).
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { JobId, RunId } from '@ptah-extension/shared';
import type { JobRun, JobRunStatus } from './types';

interface JobRunRow {
  id: string;
  job_id: string;
  scheduled_for: number;
  started_at: number | null;
  ended_at: number | null;
  status: JobRunStatus;
  result_summary: string | null;
  error_message: string | null;
}

/** Thrown when a slot is already claimed by another runner. */
export class SlotAlreadyClaimedError extends Error {
  constructor(jobId: JobId, scheduledFor: number) {
    super(
      `Slot already claimed for job ${jobId} scheduled_for=${scheduledFor}`,
    );
    this.name = 'SlotAlreadyClaimedError';
  }
}

/**
 * better-sqlite3 surfaces UNIQUE constraint violations with
 * `err.code === 'SQLITE_CONSTRAINT_UNIQUE'`. We deliberately catch *only*
 * that code — every other error must propagate.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export interface IRunStore {
  /**
   * Atomically reserves an at-most-once slot. Returns the new run on success;
   * throws {@link SlotAlreadyClaimedError} when the unique constraint fires.
   */
  tryClaim(jobId: JobId, scheduledFor: number): JobRun;
  markStarted(id: RunId, startedAt?: number): void;
  markSucceeded(id: RunId, summary?: string, endedAt?: number): void;
  markFailed(id: RunId, errorMessage: string, endedAt?: number): void;
  markSkipped(id: RunId, reason?: string, endedAt?: number): void;
  list(jobId: JobId, opts?: { limit?: number; offset?: number }): JobRun[];
  get(id: RunId): JobRun | null;
  /** Returns the most-recent run for a job (any status) or null. */
  latestForJob(jobId: JobId): JobRun | null;
}

@injectable()
export class RunStore implements IRunStore {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  tryClaim(jobId: JobId, scheduledFor: number): JobRun {
    const id = ulid();
    try {
      this.sqlite.db
        .prepare(
          `INSERT INTO job_runs
             (id, job_id, scheduled_for, started_at, ended_at, status,
              result_summary, error_message)
           VALUES (?, ?, ?, NULL, NULL, 'pending', NULL, NULL)`,
        )
        .run(id, jobId, scheduledFor);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new SlotAlreadyClaimedError(jobId, scheduledFor);
      }
      throw err;
    }
    return {
      id: RunId.from(id),
      jobId,
      scheduledFor,
      startedAt: null,
      endedAt: null,
      status: 'pending',
      resultSummary: null,
      errorMessage: null,
    };
  }

  markStarted(id: RunId, startedAt: number = Date.now()): void {
    this.sqlite.db
      .prepare(
        `UPDATE job_runs SET status = 'running', started_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(startedAt, id);
  }

  markSucceeded(
    id: RunId,
    summary?: string,
    endedAt: number = Date.now(),
  ): void {
    this.sqlite.db
      .prepare(
        `UPDATE job_runs SET status = 'succeeded', ended_at = ?,
           result_summary = ?
         WHERE id = ?`,
      )
      .run(endedAt, summary ?? null, id);
  }

  markFailed(
    id: RunId,
    errorMessage: string,
    endedAt: number = Date.now(),
  ): void {
    this.sqlite.db
      .prepare(
        `UPDATE job_runs SET status = 'failed', ended_at = ?,
           error_message = ?
         WHERE id = ?`,
      )
      .run(endedAt, errorMessage, id);
  }

  markSkipped(
    id: RunId,
    reason: string | undefined,
    endedAt: number = Date.now(),
  ): void {
    this.sqlite.db
      .prepare(
        `UPDATE job_runs SET status = 'skipped', ended_at = ?,
           result_summary = ?
         WHERE id = ?`,
      )
      .run(endedAt, reason ?? null, id);
  }

  list(jobId: JobId, opts?: { limit?: number; offset?: number }): JobRun[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const rows = this.sqlite.db
      .prepare(
        `SELECT * FROM job_runs
         WHERE job_id = ?
         ORDER BY scheduled_for DESC
         LIMIT ? OFFSET ?`,
      )
      .all(jobId, limit, offset) as JobRunRow[];
    return rows.map(mapRunRow);
  }

  get(id: RunId): JobRun | null {
    const row = this.sqlite.db
      .prepare('SELECT * FROM job_runs WHERE id = ?')
      .get(id) as JobRunRow | undefined;
    return row ? mapRunRow(row) : null;
  }

  latestForJob(jobId: JobId): JobRun | null {
    const row = this.sqlite.db
      .prepare(
        `SELECT * FROM job_runs WHERE job_id = ?
         ORDER BY scheduled_for DESC LIMIT 1`,
      )
      .get(jobId) as JobRunRow | undefined;
    return row ? mapRunRow(row) : null;
  }
}

function mapRunRow(row: JobRunRow): JobRun {
  return {
    id: RunId.from(row.id),
    jobId: JobId.from(row.job_id),
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    resultSummary: row.result_summary,
    errorMessage: row.error_message,
  };
}
