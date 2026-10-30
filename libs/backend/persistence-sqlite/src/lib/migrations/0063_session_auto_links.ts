// Migration 0063 — automatic session <-> task links and todo progress
// (TASK_2026_854).
//
// - session_task_links.auto_rule / auto_evidence: the host auto-link rule that
//   owns an automatic link ('R3'..'R7') and the evidence it was decided from.
//   NULL on explicit links (user, agent, board-start) and on every row written
//   before this migration. Being columns of the link row, they move with the
//   existing rekey SQL and disappear with the existing delete SQL.
// - session_task_link_suppressions: a user unlink. Automatic rules never
//   re-add a suppressed (session, task) pair; an explicit link clears it.
// - session_todo_progress: the latest main-thread TodoWrite snapshot of a
//   session (done / total / in-progress label).
// - idx_session_org_worktree: worktree peers (sessions sharing a worktree).
//
// NO CHECK constraints on the text enums, as in 0050: the vocabulary is
// validated at the boundary and read tolerantly.
//
// BARE `ALTER`s, as in 0055 and 0060-0062: the runner applies each version
// exactly once and owns BEGIN/COMMIT/ROLLBACK. The CREATEs use IF NOT EXISTS.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE session_task_links ADD COLUMN auto_rule TEXT;
ALTER TABLE session_task_links ADD COLUMN auto_evidence TEXT;
CREATE TABLE IF NOT EXISTS session_task_link_suppressions (
  workspace_root TEXT    NOT NULL,
  session_id     TEXT    NOT NULL,
  task_id        TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, session_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_session_task_link_suppressions_session
  ON session_task_link_suppressions (session_id);
CREATE TABLE IF NOT EXISTS session_todo_progress (
  workspace_root TEXT    NOT NULL,
  session_id     TEXT    NOT NULL,
  done           INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  in_progress    TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_todo_progress_session
  ON session_todo_progress (session_id);
CREATE INDEX IF NOT EXISTS idx_session_org_worktree
  ON session_organization (workspace_root, worktree_path);
`;
