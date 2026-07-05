export const sql = `
-- 0025_skill_suggestions.sql — cluster-level skill suggestions surfaced to the
-- Skills tab for human approval. A suggestion is synthesized from a cluster of
-- similar candidate trajectories; accepting it materializes a promoted skill,
-- dismissing keeps the row for dedup. Base relational table only — never
-- gated behind sqlite-vec so its existence survives a vec-load failure.
CREATE TABLE IF NOT EXISTS skill_suggestions (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL,
  body                   TEXT NOT NULL,
  member_session_ids     TEXT NOT NULL,
  member_candidate_ids   TEXT NOT NULL,
  cluster_size           INTEGER NOT NULL,
  technology_fingerprint TEXT NOT NULL,
  judge_score            REAL NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('pending','accepted','dismissed')),
  created_at             INTEGER NOT NULL,
  decided_at             INTEGER
);
CREATE INDEX IF NOT EXISTS idx_skill_suggestions_status ON skill_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_skill_suggestions_fingerprint ON skill_suggestions(technology_fingerprint);
`;
