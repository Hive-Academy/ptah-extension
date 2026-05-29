/**
 * 0017_corpora — knowledge-agent corpora + per-corpus memory snapshots.
 *
 * Two base tables backing `KnowledgeAgentService`:
 *  - `corpora`: one row per named corpus, owns the build/rebuild/prime metadata.
 *  - `corpus_memories`: ordered join from a corpus to the memories it pinned at
 *    build time. ON DELETE CASCADE on both sides keeps the join consistent.
 *
 * Rollback story: forward-only per persistence-sqlite/CLAUDE.md. Manual
 * recovery is `DROP TABLE corpus_memories; DROP TABLE corpora;` via `db:reset`
 * followed by re-migration. `SqliteBackupService.pre-migration` is the
 * canonical recovery path.
 *
 * STATIC TEXT ONLY: no ${...} interpolation (ESLint no-template-curly-in-migration).
 */
export const sql = `
CREATE TABLE corpora (
  id                       TEXT    PRIMARY KEY,
  name                     TEXT    NOT NULL UNIQUE,
  workspace_root           TEXT,
  query_json               TEXT    NOT NULL,
  built_at                 INTEGER NOT NULL,
  rebuilt_at               INTEGER,
  primed_session_ids_json  TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_corpora_workspace ON corpora(workspace_root);

CREATE TABLE corpus_memories (
  corpus_id  TEXT    NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
  memory_id  TEXT    NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  PRIMARY KEY (corpus_id, memory_id)
);
CREATE INDEX idx_corpus_mem_corpus ON corpus_memories(corpus_id, ord);
`;
