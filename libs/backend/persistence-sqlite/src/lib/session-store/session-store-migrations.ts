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

const S0002_SESSION_STATS = `
CREATE TABLE session_usage_turns (
  session_id TEXT NOT NULL,
  producer TEXT NOT NULL,
  run_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  known_cost_micro_usd INTEGER,
  cost_authority TEXT NOT NULL,
  source TEXT NOT NULL,
  pricing_version TEXT,
  revision INTEGER NOT NULL,
  workspace_key TEXT,
  host TEXT,
  PRIMARY KEY (session_id, producer, event_key, model_id)
);
CREATE INDEX idx_session_usage_turns_time ON session_usage_turns (occurred_at_ms, provider_id, model_id);
CREATE INDEX idx_session_usage_turns_session_time ON session_usage_turns (session_id, occurred_at_ms);
CREATE INDEX idx_session_usage_workspace_time ON session_usage_turns (workspace_key, occurred_at_ms);
CREATE INDEX idx_sessions_workspace_key ON sessions (workspace_key, session_id);
CREATE TABLE session_stats (
  session_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  workspace_key TEXT,
  provider_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  last_usage_at_ms INTEGER NOT NULL,
  finalized_at_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  known_cost_micro_usd INTEGER,
  has_unpriced INTEGER NOT NULL,
  source TEXT NOT NULL,
  pricing_version TEXT,
  revision INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_session_stats_workspace_time ON session_stats (workspace_key, last_usage_at_ms);
CREATE TABLE session_usage_coverage (
  workspace_key TEXT PRIMARY KEY,
  first_captured_at_ms INTEGER NOT NULL,
  last_captured_at_ms INTEGER NOT NULL
);
`;

const S0003_SESSION_FINALIZATION = `
ALTER TABLE session_stats ADD COLUMN finalize_revision INTEGER;
ALTER TABLE session_stats ADD COLUMN finalize_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_stats ADD COLUMN finalize_retry_at_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_session_stats_finalization ON session_stats (status, finalize_retry_at_ms, last_usage_at_ms);
`;

// host_run_leases: one heartbeat per running host process (Electron or CLI),
// beside the session records it vouches for, so every host sharing this file
// can tell a live writer of a `running` CLI reference from a dead one.
const S0004_HOST_RUN_LEASES = `
CREATE TABLE IF NOT EXISTS host_run_leases (
  host_run_id  TEXT    PRIMARY KEY,
  pid          INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_host_run_leases_heartbeat
  ON host_run_leases (heartbeat_at);
`;

export const SESSION_STORE_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'S0001_sessions', sql: S0001_SESSIONS },
  { version: 2, name: 'S0002_session_stats', sql: S0002_SESSION_STATS },
  { version: 3, name: 'S0003_session_finalization', sql: S0003_SESSION_FINALIZATION },
  { version: 4, name: 'S0004_host_run_leases', sql: S0004_HOST_RUN_LEASES },
];
