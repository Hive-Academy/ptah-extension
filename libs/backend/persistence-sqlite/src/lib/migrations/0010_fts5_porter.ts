// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- Rebuild memory_chunks_fts with porter unicode61 tokenizer for stemming.
-- Drop + recreate; repopulate from memory_chunks in the same transaction.
--
-- 0002_memory already defined memory_chunks_fts with porter unicode61, but
-- installations that migrated before that schema was finalised may have an
-- older tokenizer. This migration enforces the canonical definition and adds
-- the UNINDEXED chunk_id column for efficient lookup joins.
--
-- The three AFTER INSERT/UPDATE/DELETE triggers (memory_chunks_ai, _ad, _au)
-- created in 0002_memory continue to function unchanged because they reference
-- the table by name; the DROP + recreate below preserves the name. The trigger
-- bodies supply (rowid, text) which is sufficient for an external-content
-- FTS5 table even when additional UNINDEXED columns are present.
--
-- Risk note: on a corpus of 50 000+ chunks this INSERT can take 30-60s
-- and holds an IMMEDIATE transaction for the duration. The pre-migration
-- backup is the recovery path if the migration fails midway.

DROP TABLE IF EXISTS memory_chunks_fts;
CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  content='memory_chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
INSERT INTO memory_chunks_fts(rowid, chunk_id, text)
  SELECT rowid, id, text FROM memory_chunks;
`;
