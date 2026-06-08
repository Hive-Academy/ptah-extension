export const sql = `
CREATE TABLE IF NOT EXISTS skill_registry (
  slug             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('skill','agent','command')),
  user_path        TEXT NOT NULL,
  origin_plugin_id TEXT,
  origin_version   TEXT,
  source_hash      TEXT,
  clone_status     TEXT NOT NULL CHECK (clone_status IN ('clone','authored','synth','diverged')),
  diverged         INTEGER NOT NULL DEFAULT 0,
  history_dir      TEXT,
  last_enhanced_at INTEGER,
  candidate_id     TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (kind, slug)
);
CREATE INDEX IF NOT EXISTS idx_skill_registry_status ON skill_registry(clone_status);
`;
