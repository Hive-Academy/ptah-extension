// Migration 0050 — session organization (TASK_2026_580).
//
// Three tables keyed by (workspace_root, session_id). Sessions themselves live
// in the JSON session store, so there are NO foreign keys to them; a row here
// is created lazily the first time a session is organized or captured, and a
// session without a row reads as the defaults.
//
// - session_organization: priority, workflow status, pin, worktree/branch, and
//   lineage (parent_session_id, fork_of_session_id, started_by). Lineage columns
//   are nullable so a child or fork can be recorded without its parent's row.
// - session_task_links: session <-> task folder links. At most one 'primary'
//   link per session, enforced by the partial unique index.
// - session_pr_links: pull requests attached to a session, keyed by URL.
//
// NO CHECK constraints on enum columns (priority, status, started_by, role,
// source, state): SQLite cannot alter a CHECK without rebuilding the table, so
// the vocabulary is validated at the boundary and read tolerantly.
//
// IDEMPOTENT: every statement uses IF NOT EXISTS; the schema_migrations ledger
// prevents a second application regardless.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS session_organization (
  workspace_root     TEXT    NOT NULL,
  session_id         TEXT    NOT NULL,
  priority           TEXT    NOT NULL DEFAULT 'normal',
  status             TEXT    NOT NULL DEFAULT 'active',
  pinned             INTEGER NOT NULL DEFAULT 0,
  worktree_path      TEXT,
  branch             TEXT,
  parent_session_id  TEXT,
  fork_of_session_id TEXT,
  started_by         TEXT    NOT NULL DEFAULT 'user',
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_org_parent
  ON session_organization (workspace_root, parent_session_id);

CREATE TABLE IF NOT EXISTS session_task_links (
  workspace_root TEXT    NOT NULL,
  session_id     TEXT    NOT NULL,
  task_id        TEXT    NOT NULL,
  role           TEXT    NOT NULL,
  source         TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, session_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_session_task_links_task
  ON session_task_links (workspace_root, task_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_task_links_primary
  ON session_task_links (workspace_root, session_id) WHERE role = 'primary';

CREATE TABLE IF NOT EXISTS session_pr_links (
  workspace_root TEXT    NOT NULL,
  session_id     TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  number         INTEGER,
  repo           TEXT,
  state          TEXT,
  source         TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, session_id, url)
);
`;
