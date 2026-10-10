import {
  normalizeWorkspaceRoot,
  type ISessionRecordRepository,
  type SessionRecord,
  type SessionRecordHost,
  type SessionRecordInput,
  type SessionRecordListOptions,
} from '@ptah-extension/platform-core';
import type { SessionStoreDatabase } from './session-store-database';

interface SessionRow {
  session_id: string;
  workspace_path: string | null;
  host: string;
  name: string;
  created_at: number;
  last_active_at: number;
  is_child: number;
  summary_json: string;
  detail_json: string;
}

const COLUMNS =
  'session_id, workspace_path, host, name, created_at, last_active_at, is_child, summary_json, detail_json';

const UPSERT = `
INSERT INTO sessions (session_id, workspace_key, workspace_path, host, name, created_at,
  last_active_at, is_child, summary_json, detail_json, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (session_id) DO UPDATE SET
  workspace_key = excluded.workspace_key,
  workspace_path = excluded.workspace_path,
  host = excluded.host,
  name = excluded.name,
  created_at = excluded.created_at,
  last_active_at = excluded.last_active_at,
  is_child = excluded.is_child,
  summary_json = excluded.summary_json,
  detail_json = excluded.detail_json,
  updated_at = excluded.updated_at`;

function toRecord(row: SessionRow): SessionRecord {
  return {
    sessionId: row.session_id,
    workspacePath: row.workspace_path,
    host: row.host as SessionRecordHost,
    name: row.name,
    createdAt: Number(row.created_at),
    lastActiveAt: Number(row.last_active_at),
    isChild: Number(row.is_child) === 1,
    summary: JSON.parse(row.summary_json) as Record<string, unknown>,
    detail: JSON.parse(row.detail_json) as Record<string, unknown>,
  };
}

/** {@link ISessionRecordRepository} over `sessions.sqlite`, for one host. */
export class SqliteSessionRecordRepository implements ISessionRecordRepository {
  constructor(
    private readonly store: SessionStoreDatabase,
    private readonly host: SessionRecordHost,
  ) {}

  async get(sessionId: string): Promise<SessionRecord | null> {
    const db = await this.store.ready();
    const row = db
      .prepare(`SELECT ${COLUMNS} FROM sessions WHERE session_id = ?`)
      .get(sessionId) as SessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  async upsert(record: SessionRecordInput): Promise<void> {
    const db = await this.store.ready();
    db.prepare(UPSERT).run(
      record.sessionId,
      record.workspacePath === null
        ? null
        : normalizeWorkspaceRoot(record.workspacePath),
      record.workspacePath,
      this.host,
      record.name,
      record.createdAt,
      record.lastActiveAt,
      record.isChild ? 1 : 0,
      JSON.stringify(record.summary),
      JSON.stringify(record.detail),
      Date.now(),
    );
  }

  async delete(sessionId: string): Promise<void> {
    const db = await this.store.ready();
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  }

  async listForWorkspace(
    workspacePath: string,
    options?: SessionRecordListOptions,
  ): Promise<SessionRecord[]> {
    const db = await this.store.ready();
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions
         WHERE host = ? AND workspace_key = ? AND (? = 1 OR is_child = 0)
         ORDER BY last_active_at DESC`,
      )
      .all(
        this.host,
        normalizeWorkspaceRoot(workspacePath),
        options?.includeChildren ? 1 : 0,
      ) as SessionRow[];
    return rows.map(toRecord);
  }

  async listAll(options?: SessionRecordListOptions): Promise<SessionRecord[]> {
    const db = await this.store.ready();
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions
         WHERE host = ? AND (? = 1 OR is_child = 0)
         ORDER BY last_active_at DESC`,
      )
      .all(this.host, options?.includeChildren ? 1 : 0) as SessionRow[];
    return rows.map(toRecord);
  }

  async hasMigrationSource(
    sourcePath: string,
    fingerprint: string,
  ): Promise<boolean> {
    const db = await this.store.ready();
    return (
      db
        .prepare(
          `SELECT 1 FROM session_migration_sources
           WHERE host = ? AND source_path = ? AND source_fingerprint = ?`,
        )
        .get(this.host, sourcePath, fingerprint) !== undefined
    );
  }

  async recordMigrationSource(
    sourcePath: string,
    fingerprint: string,
    sessionsCopied: number,
  ): Promise<void> {
    const db = await this.store.ready();
    db.prepare(
      `INSERT OR REPLACE INTO session_migration_sources
         (host, source_path, source_fingerprint, sessions_copied, migrated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(this.host, sourcePath, fingerprint, sessionsCopied, Date.now());
  }
}
