import type { Migration } from '../migrations';

// Migrations for sessions.sqlite only. Its ledger is separate from
// ptah.sqlite's, so versions start at 1 again.
//
// sessions: one row per session for every project and host. workspace_key is
// normalizeWorkspaceRoot(workspace_path), NULL for a projectless session.
// summary_json is the lean listing entry, detail_json the full record without
// bulk agent output (that lives in per-session files).
//
// session_migration_sources: one row per legacy workspace store copied in, so
// the copy-forward migration can be run again safely and leaves a receipt.
//
// SECURITY: SQL MUST stay static. No template interpolation.
const S0001_SESSIONS = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT    PRIMARY KEY,
  workspace_key  TEXT,
  workspace_path TEXT,
  host           TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  is_child       INTEGER NOT NULL DEFAULT 0,
  summary_json   TEXT    NOT NULL,
  detail_json    TEXT    NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_host_workspace
  ON sessions (host, workspace_key, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_host_recent
  ON sessions (host, last_active_at DESC);

CREATE TABLE IF NOT EXISTS session_migration_sources (
  host               TEXT    NOT NULL,
  source_path        TEXT    NOT NULL,
  source_fingerprint TEXT    NOT NULL,
  sessions_copied    INTEGER NOT NULL,
  migrated_at        INTEGER NOT NULL,
  PRIMARY KEY (host, source_path, source_fingerprint)
);
`;

export const SESSION_STORE_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'S0001_sessions', sql: S0001_SESSIONS },
];
