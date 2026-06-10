export const sql = `
CREATE TABLE IF NOT EXISTS skill_invocation_events (
  id            TEXT PRIMARY KEY,
  skill_slug    TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  context_id    TEXT,
  source        TEXT NOT NULL,
  succeeded     INTEGER NOT NULL,
  is_error      INTEGER NOT NULL DEFAULT 0,
  invoked_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_slug ON skill_invocation_events(skill_slug);
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_ctx ON skill_invocation_events(context_id);
`;
