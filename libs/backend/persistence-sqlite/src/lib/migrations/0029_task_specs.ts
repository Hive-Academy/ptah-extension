// 0029_task_specs — derived index for `.ptah/specs/TASK_*/task.md` (TASK_2026_157).
//
// Files remain the source of truth; this table is a rebuildable index keyed by
// (workspace_root, folder_name). Excluded folders (no valid frontmatter) get
// NO row — the excluded count rides in `task_specs_scan_meta`.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS task_specs (
  workspace_root    TEXT    NOT NULL,
  folder_name       TEXT    NOT NULL,
  task_id           TEXT    NOT NULL,
  status            TEXT    NOT NULL,
  type              TEXT,
  title             TEXT    NOT NULL,
  description       TEXT,
  assignee          TEXT,
  depends_on        TEXT    NOT NULL DEFAULT '[]',
  executor          TEXT,
  claim             TEXT,
  created_at        TEXT,
  updated_at        TEXT,
  frontmatter_valid INTEGER NOT NULL DEFAULT 1,
  validation_issues TEXT    NOT NULL DEFAULT '[]',
  last_indexed_at   INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, folder_name)
);

CREATE INDEX IF NOT EXISTS idx_task_specs_ws_status
  ON task_specs (workspace_root, status);

CREATE TABLE IF NOT EXISTS task_specs_scan_meta (
  workspace_root    TEXT PRIMARY KEY,
  excluded_count    INTEGER NOT NULL DEFAULT 0,
  last_full_scan_at INTEGER
);
`;
