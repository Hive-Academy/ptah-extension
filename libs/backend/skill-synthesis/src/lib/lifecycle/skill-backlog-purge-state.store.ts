/**
 * SkillBacklogPurgeStateStore — the one-row `skill_backlog_purge_state`
 * marker (migration `0051`, TASK_2026_578).
 *
 * The row's presence means the one-time purge of the unclustered candidate
 * backlog has completed; its absence means it has never run.
 *
 * `read()` DEGRADES TO `null`. It returns `null` both when the marker is
 * absent and when it is unreadable (a missing table on a host whose database
 * predates `0051`, or a closed connection); the unreadable case is warned. The
 * purge treats `null` as "absent" and runs. That stays safe for an unreadable
 * marker: `markComplete` then throws inside the purge's transaction, the whole
 * purge rolls back, and the failure never reaches the curator.
 *
 * `markComplete()` IS A PLAIN STATEMENT AND THROWS. It runs inside the purge's
 * `inImmediateTransaction`, so a failure must roll that unit back rather than
 * be swallowed here. `ON CONFLICT(id) DO NOTHING` makes the first writer win:
 * two hosts cannot both claim the run.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';

/** The recorded outcome of the completed backlog purge. */
export interface BacklogPurgeState {
  /** Candidates created before this epoch-ms instant were in scope. */
  cutoffCreatedAt: number;
  /** Epoch ms at which the purge completed. */
  completedAt: number;
  /** Number of candidate rows the purge rejected. */
  rejected: number;
}

interface RawPurgeStateRow {
  cutoff_created_at: number;
  completed_at: number;
  rejected: number;
}

const SELECT_SQL = `SELECT cutoff_created_at, completed_at, rejected
       FROM skill_backlog_purge_state
      WHERE id = 1`;

const INSERT_SQL = `INSERT INTO skill_backlog_purge_state (
         id, cutoff_created_at, completed_at, rejected
       ) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`;

@injectable()
export class SkillBacklogPurgeStateStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  /** The completed purge's marker, or `null` when absent or unreadable. */
  read(): BacklogPurgeState | null {
    let raw: RawPurgeStateRow | undefined;
    try {
      raw = this.db.prepare(SELECT_SQL).get() as RawPurgeStateRow | undefined;
    } catch (error: unknown) {
      // degradation-audit: reported - warned; null reads as "absent", and the
      // purge's markComplete then throws in its transaction, rolling it back.
      this.logger.warn(
        '[skill-synthesis] backlog purge marker unreadable; purge will skip',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
    if (!raw) return null;
    return {
      cutoffCreatedAt: Number(raw.cutoff_created_at),
      completedAt: Number(raw.completed_at),
      rejected: Number(raw.rejected),
    };
  }

  /**
   * Record the purge as complete. Returns `true` when this call wrote the
   * marker and `false` when another writer already had.
   */
  markComplete(state: BacklogPurgeState): boolean {
    const result = this.db
      .prepare(INSERT_SQL)
      .run(state.cutoffCreatedAt, state.completedAt, state.rejected);
    return Number(result.changes) === 1;
  }
}
