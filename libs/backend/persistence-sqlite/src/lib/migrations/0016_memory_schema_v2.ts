/**
 * 0016_memory_schema_v2 — claude-mem 5-field summary + type taxonomy +
 * concepts/files JSON storage + concepts FTS5 contentless index.
 *
 * Additive over the `memories` table from 0002_memory. All new columns ship
 * with NOT NULL DEFAULT clauses (or nullable summary fields) so pre-existing
 * rows backfill at apply time without a separate UPDATE pass.
 *
 * Concepts FTS5 uses a contentless external-content shape with explicit
 * `memory_id UNINDEXED, concept` columns. ALL inserts/deletes are driven by
 * the application layer via `INSERT FROM SELECT` shadow commands — never the
 * `('rebuild')` command. See [[project_fts5_external_content_column_mismatch]].
 *
 * Rollback story: forward-only per persistence-sqlite/CLAUDE.md. Manual
 * recovery requires `ALTER TABLE memories DROP COLUMN` reverse-engineering
 * plus `DROP TABLE memory_concepts_fts; DROP TRIGGER memories_concepts_ad`.
 * `SqliteBackupService.pre-migration` is the canonical recovery path.
 *
 * STATIC TEXT ONLY: no ${...} interpolation (ESLint no-template-curly-in-migration).
 */
export const sql = `
ALTER TABLE memories ADD COLUMN request          TEXT;
ALTER TABLE memories ADD COLUMN investigated     TEXT;
ALTER TABLE memories ADD COLUMN learned          TEXT;
ALTER TABLE memories ADD COLUMN completed        TEXT;
ALTER TABLE memories ADD COLUMN next_steps       TEXT;
ALTER TABLE memories ADD COLUMN type             TEXT NOT NULL DEFAULT 'discovery';
ALTER TABLE memories ADD COLUMN concepts_json    TEXT NOT NULL DEFAULT '[]';
ALTER TABLE memories ADD COLUMN files_json       TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_memories_type ON memories(type);

CREATE VIRTUAL TABLE memory_concepts_fts USING fts5(
  memory_id UNINDEXED,
  concept,
  content='',
  tokenize='unicode61'
);

CREATE TRIGGER memories_concepts_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_concepts_fts(memory_concepts_fts, memory_id, concept)
  SELECT 'delete', old.id, json_each.value
  FROM json_each(old.concepts_json);
END;
`;
