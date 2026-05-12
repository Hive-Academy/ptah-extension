// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
export const sql = `
-- TASK_2026_114: User-controlled workspace indexing state.
-- One row per workspace (keyed by fingerprint). Additive — no existing tables modified.

CREATE TABLE IF NOT EXISTS indexing_state (
  workspace_fingerprint      TEXT    NOT NULL PRIMARY KEY,
  git_head_sha               TEXT,
  last_indexed_at            INTEGER,
  symbols_enabled            INTEGER NOT NULL DEFAULT 1,
  memory_enabled             INTEGER NOT NULL DEFAULT 1,
  symbols_cursor             TEXT,
  disclosure_acknowledged_at INTEGER,
  last_dismissed_stale_sha   TEXT,
  last_error                 TEXT,
  created_at                 INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at                 INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
`;
