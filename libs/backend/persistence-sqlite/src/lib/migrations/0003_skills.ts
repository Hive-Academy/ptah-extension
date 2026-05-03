// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- 0003_skills.sql — Skill Synthesis
CREATE TABLE skill_candidates (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,        -- slug, also the folder name
  description        TEXT NOT NULL,
  body_path          TEXT NOT NULL,               -- absolute path to SKILL.md
  source_session_ids TEXT NOT NULL,               -- JSON array
  trajectory_hash    TEXT NOT NULL,               -- sha256 of normalized trajectory
  embedding_rowid    INTEGER,                     -- FK into skill_candidates_vec
  status             TEXT NOT NULL CHECK (status IN ('candidate','promoted','rejected')),
  success_count      INTEGER NOT NULL DEFAULT 0,
  failure_count      INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  promoted_at        INTEGER,
  rejected_at        INTEGER,
  rejected_reason    TEXT
);
CREATE INDEX idx_skill_candidates_status ON skill_candidates(status);
CREATE INDEX idx_skill_candidates_success ON skill_candidates(success_count DESC);
CREATE UNIQUE INDEX idx_skill_candidates_traj ON skill_candidates(trajectory_hash);

CREATE VIRTUAL TABLE skill_candidates_vec USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);

-- Each invocation of a skill (candidate or promoted) - drives the 3-success
-- promotion threshold and post-promotion reliability tracking.
CREATE TABLE skill_invocations (
  id            TEXT PRIMARY KEY,
  skill_id      TEXT NOT NULL REFERENCES skill_candidates(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  succeeded     INTEGER NOT NULL,                 -- 0/1
  invoked_at    INTEGER NOT NULL,
  notes         TEXT
);
CREATE INDEX idx_skill_invocations_skill ON skill_invocations(skill_id);
`;
