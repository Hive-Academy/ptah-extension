/**
 * JobStore — CRUD over `scheduled_jobs` (schema 0004_cron.sql).
 *
 * Owns nothing beyond SQL generation + row mapping. Connection lifecycle is
 * handled by `SqliteConnectionService`; we re-resolve the prepared statement
 * each call rather than caching, since better-sqlite3 prepares are cheap
 * (~microseconds) and caching across reopens would be a footgun.
 *
 * IDs are ULIDs (architecture §8.5). The store is the only authority that
 * generates them: callers send `CreateJobInput` (no id) and we mint one.
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { JobId } from '@ptah-extension/shared';
import type {
  CreateJobInput,
  ScheduledJob,
  UpdateJobPatch,
  UpsertJobInput,
} from './types';

interface ScheduledJobRow {
  id: string;
  name: string;
  cron_expr: string;
  timezone: string;
  prompt: string;
  workspace_root: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
}

export interface IJobStore {
  create(input: CreateJobInput): ScheduledJob;
  get(id: JobId): ScheduledJob | null;
  list(filter?: { enabledOnly?: boolean }): ScheduledJob[];
  update(id: JobId, patch: UpdateJobPatch): ScheduledJob;
  delete(id: JobId): boolean;
  /**
   * Insert-or-replace a job with a caller-supplied ID. When a row with the
   * same `id` already exists the existing row is fully replaced. Used for
   * system jobs (e.g. `@ptah/daily-backup`) whose IDs are deterministic and
   * must survive repeated boot cycles without creating duplicates.
   *
   * System job IDs are arbitrary strings (not required to be ULIDs). The
   * returned `ScheduledJob.id` carries the raw string cast to `JobId`.
   */
  upsert(input: UpsertJobInput): ScheduledJob;
}

@injectable()
export class JobStore implements IJobStore {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  create(input: CreateJobInput): ScheduledJob {
    const now = Date.now();
    const id = ulid();
    const tz = input.timezone ?? 'UTC';
    const enabled = input.enabled === false ? 0 : 1;
    const workspaceRoot = input.workspaceRoot ?? null;
    this.sqlite.db
      .prepare(
        `INSERT INTO scheduled_jobs
         (id, name, cron_expr, timezone, prompt, workspace_root, enabled,
          created_at, updated_at, last_run_at, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        input.name,
        input.cronExpr,
        tz,
        input.prompt,
        workspaceRoot,
        enabled,
        now,
        now,
        input.nextRunAt,
      );
    this.logger.debug('[cron-scheduler] job created', { id, name: input.name });
    return {
      id: JobId.from(id),
      name: input.name,
      cronExpr: input.cronExpr,
      timezone: tz,
      prompt: input.prompt,
      workspaceRoot,
      enabled: enabled === 1,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: input.nextRunAt,
    };
  }

  get(id: JobId): ScheduledJob | null {
    const row = this.sqlite.db
      .prepare('SELECT * FROM scheduled_jobs WHERE id = ?')
      .get(id) as ScheduledJobRow | undefined;
    return row ? mapRow(row) : null;
  }

  list(filter?: { enabledOnly?: boolean }): ScheduledJob[] {
    const sql = filter?.enabledOnly
      ? 'SELECT * FROM scheduled_jobs WHERE enabled = 1 ORDER BY created_at ASC'
      : 'SELECT * FROM scheduled_jobs ORDER BY created_at ASC';
    const rows = this.sqlite.db.prepare(sql).all() as ScheduledJobRow[];
    return rows.map(mapRow);
  }

  update(id: JobId, patch: UpdateJobPatch): ScheduledJob {
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`JobStore.update: no scheduled_job with id ${id}`);
    }
    const merged: ScheduledJob = {
      ...existing,
      ...{
        name: patch.name ?? existing.name,
        cronExpr: patch.cronExpr ?? existing.cronExpr,
        timezone: patch.timezone ?? existing.timezone,
        prompt: patch.prompt ?? existing.prompt,
        workspaceRoot:
          patch.workspaceRoot === undefined
            ? existing.workspaceRoot
            : patch.workspaceRoot,
        enabled: patch.enabled === undefined ? existing.enabled : patch.enabled,
        nextRunAt:
          patch.nextRunAt === undefined ? existing.nextRunAt : patch.nextRunAt,
        lastRunAt:
          patch.lastRunAt === undefined ? existing.lastRunAt : patch.lastRunAt,
      },
      updatedAt: Date.now(),
    };
    this.sqlite.db
      .prepare(
        `UPDATE scheduled_jobs SET
           name = ?, cron_expr = ?, timezone = ?, prompt = ?,
           workspace_root = ?, enabled = ?, updated_at = ?,
           last_run_at = ?, next_run_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.cronExpr,
        merged.timezone,
        merged.prompt,
        merged.workspaceRoot,
        merged.enabled ? 1 : 0,
        merged.updatedAt,
        merged.lastRunAt,
        merged.nextRunAt,
        id,
      );
    return merged;
  }

  delete(id: JobId): boolean {
    const result = this.sqlite.db
      .prepare('DELETE FROM scheduled_jobs WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  /**
   * Insert-or-replace a job using a caller-supplied ID.
   * If a row with the same `id` already exists it is fully replaced
   * (timestamps reset to now). Subsequent boots calling `upsert` with the
   * same `id` update the schedule without creating duplicates.
   */
  upsert(input: UpsertJobInput): ScheduledJob {
    const now = Date.now();
    const tz = input.timezone ?? 'UTC';
    const enabled = input.enabled === false ? 0 : 1;
    const workspaceRoot = input.workspaceRoot ?? null;
    const nextRunAt = input.nextRunAt ?? null;
    this.sqlite.db
      .prepare(
        `INSERT INTO scheduled_jobs
         (id, name, cron_expr, timezone, prompt, workspace_root, enabled,
          created_at, updated_at, last_run_at, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           name          = excluded.name,
           cron_expr     = excluded.cron_expr,
           timezone      = excluded.timezone,
           prompt        = excluded.prompt,
           workspace_root = excluded.workspace_root,
           enabled       = excluded.enabled,
           updated_at    = excluded.updated_at,
           next_run_at   = excluded.next_run_at`,
      )
      .run(
        input.id,
        input.name,
        input.cronExpr,
        tz,
        input.prompt,
        workspaceRoot,
        enabled,
        now,
        now,
        nextRunAt,
      );
    this.logger.debug('[cron-scheduler] job upserted', {
      id: input.id,
      name: input.name,
    });
    return {
      // System job IDs are arbitrary strings; cast to JobId brand directly.
      id: input.id as unknown as JobId,
      name: input.name,
      cronExpr: input.cronExpr,
      timezone: tz,
      prompt: input.prompt,
      workspaceRoot,
      enabled: enabled === 1,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt,
    };
  }
}

function mapRow(row: ScheduledJobRow): ScheduledJob {
  return {
    // Cast without ULID validation — system jobs (@ptah/*) have non-ULID IDs
    // stored via `upsert()`. The DB is authoritative.
    id: row.id as unknown as JobId,
    name: row.name,
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    prompt: row.prompt,
    workspaceRoot: row.workspace_root,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
  };
}
