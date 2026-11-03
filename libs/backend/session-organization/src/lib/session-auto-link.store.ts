/**
 * Session auto-link store — all SQL for the two tables of migration 0063
 * (`session_task_link_suppressions`, `session_todo_progress`), plus the
 * bounded "which sessions name this task" lookup over `session_organization`.
 *
 * It implements `SessionOrganizationSideTables`: the main store calls those
 * methods inside its own transactions (delete cascade, rekey, unlink,
 * explicit link, todo upsert), so every multi-table change is atomic. The
 * methods never open a transaction themselves.
 *
 * Every SQL string is static with `?` parameters. Methods are synchronous
 * (better-sqlite3); the `db` getter throws while the connection is closed.
 */
import { inject, injectable } from 'tsyringe';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type { SessionTodoProgress } from '@ptah-extension/shared';
import type { SessionOrganizationSideTables } from './session-organization-side-tables';

/** Upper bound on sessions one task-folder event reconciles (RR1-6). */
export const MAX_SESSIONS_NAMING_TASK = 50;

interface RawRootRow {
  workspace_root: string;
}

interface RawSessionRow {
  session_id: string;
}

interface RawTaskRow {
  task_id: string;
}

interface RawTodoRow {
  session_id: string;
  done: number | bigint;
  total: number | bigint;
  in_progress: string | null;
  updated_at: number | bigint;
}

const SQL = {
  rootsOf: `
    SELECT workspace_root FROM session_task_link_suppressions WHERE session_id = ?
    UNION
    SELECT workspace_root FROM session_todo_progress WHERE session_id = ?
    ORDER BY workspace_root`,
  deleteSuppressions: `
    DELETE FROM session_task_link_suppressions
     WHERE workspace_root = ? AND session_id = ?`,
  deleteTodo: `
    DELETE FROM session_todo_progress WHERE workspace_root = ? AND session_id = ?`,
  copySuppressions: `
    INSERT OR IGNORE INTO session_task_link_suppressions
      (workspace_root, session_id, task_id, created_at)
    SELECT workspace_root, ?, task_id, created_at
      FROM session_task_link_suppressions
     WHERE workspace_root = ? AND session_id = ?`,
  copyTodo: `
    INSERT OR IGNORE INTO session_todo_progress
      (workspace_root, session_id, done, total, in_progress, updated_at)
    SELECT workspace_root, ?, done, total, in_progress, updated_at
      FROM session_todo_progress
     WHERE workspace_root = ? AND session_id = ?`,
  suppress: `
    INSERT OR IGNORE INTO session_task_link_suppressions
      (workspace_root, session_id, task_id, created_at)
    VALUES (?, ?, ?, ?)`,
  clearSuppression: `
    DELETE FROM session_task_link_suppressions
     WHERE workspace_root = ? AND session_id = ? AND task_id = ?`,
  listSuppressed: `
    SELECT task_id FROM session_task_link_suppressions
     WHERE workspace_root = ? AND session_id = ?`,
  listTodo: `
    SELECT session_id, done, total, in_progress, updated_at
      FROM session_todo_progress
     WHERE workspace_root = ?`,
  getTodo: `
    SELECT session_id, done, total, in_progress, updated_at
      FROM session_todo_progress
     WHERE workspace_root = ? AND session_id = ?`,
  upsertTodo: `
    INSERT INTO session_todo_progress
      (workspace_root, session_id, done, total, in_progress, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_root, session_id) DO UPDATE SET
      done = excluded.done,
      total = excluded.total,
      in_progress = excluded.in_progress,
      updated_at = excluded.updated_at`,
  /** Prefix-filtered by `idx_session_org_worktree` (workspace_root first). */
  sessionsNamingTask: `
    SELECT session_id FROM session_organization
     WHERE workspace_root = ?
       AND (instr(worktree_path, ?) > 0 OR instr(branch, ?) > 0)
     ORDER BY session_id
     LIMIT ?`,
} as const;

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function toTodo(row: RawTodoRow): SessionTodoProgress {
  return {
    done: toNumber(row.done),
    total: toNumber(row.total),
    inProgress: row.in_progress,
    updatedAt: toNumber(row.updated_at),
  };
}

@injectable()
export class SessionAutoLinkStore implements SessionOrganizationSideTables {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  rootsOf(sessionId: string): string[] {
    return (
      this.db.prepare(SQL.rootsOf).all(sessionId, sessionId) as RawRootRow[]
    ).map((row) => row.workspace_root);
  }

  deleteSession(root: string, sessionId: string): number {
    return (
      this.db.prepare(SQL.deleteSuppressions).run(root, sessionId).changes +
      this.db.prepare(SQL.deleteTodo).run(root, sessionId).changes
    );
  }

  rekeySession(root: string, oldId: string, newId: string): void {
    if (oldId === newId) return;
    this.db.prepare(SQL.copySuppressions).run(newId, root, oldId);
    this.db.prepare(SQL.deleteSuppressions).run(root, oldId);
    this.db.prepare(SQL.copyTodo).run(newId, root, oldId);
    this.db.prepare(SQL.deleteTodo).run(root, oldId);
  }

  suppress(root: string, sessionId: string, taskId: string, now: number): void {
    this.db.prepare(SQL.suppress).run(root, sessionId, taskId, now);
  }

  clearSuppression(root: string, sessionId: string, taskId: string): void {
    this.db.prepare(SQL.clearSuppression).run(root, sessionId, taskId);
  }

  listSuppressed(root: string, sessionId: string): Set<string> {
    return new Set(
      (
        this.db.prepare(SQL.listSuppressed).all(root, sessionId) as RawTaskRow[]
      ).map((row) => row.task_id),
    );
  }

  listTodoProgress(root: string): Map<string, SessionTodoProgress> {
    const rows = this.db.prepare(SQL.listTodo).all(root) as RawTodoRow[];
    return new Map(rows.map((row) => [row.session_id, toTodo(row)]));
  }

  getTodoProgress(root: string, sessionId: string): SessionTodoProgress | null {
    const row = this.db.prepare(SQL.getTodo).get(root, sessionId) as
      | RawTodoRow
      | undefined;
    return row === undefined ? null : toTodo(row);
  }

  upsertTodoProgress(
    root: string,
    sessionId: string,
    progress: SessionTodoProgress,
  ): boolean {
    const stored = this.getTodoProgress(root, sessionId);
    if (
      stored !== null &&
      stored.done === progress.done &&
      stored.total === progress.total &&
      stored.inProgress === progress.inProgress
    ) {
      return false;
    }
    this.db
      .prepare(SQL.upsertTodo)
      .run(
        root,
        sessionId,
        progress.done,
        progress.total,
        progress.inProgress,
        progress.updatedAt,
      );
    return true;
  }

  /**
   * Sessions of a workspace whose worktree path or branch contains `taskId`
   * as a substring, at most `limit`. The caller re-checks the exact token
   * boundaries (`taskIdsInWorktreeName`) when it reconciles them.
   */
  findSessionsNamingTask(
    root: string,
    taskId: string,
    limit = MAX_SESSIONS_NAMING_TASK,
  ): string[] {
    return (
      this.db
        .prepare(SQL.sessionsNamingTask)
        .all(root, taskId, taskId, limit) as RawSessionRow[]
    ).map((row) => row.session_id);
  }
}
