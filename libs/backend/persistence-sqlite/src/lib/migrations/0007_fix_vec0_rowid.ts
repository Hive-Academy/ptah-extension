// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- Fix vec0 tables: remove the explicit \`rowid INTEGER PRIMARY KEY\` partition
-- key definition from 0002_memory and 0003_skills.
--
-- Root cause: naming a vec0 partition key "rowid" conflicts with SQLite's
-- built-in rowid alias. INSERT statements that specify \`rowid\` in the
-- column list set the implicit SQLite rowid (correct) but leave the
-- partition key column NULL, which sqlite-vec rejects with
-- "Only integers are allows for primary key values".
--
-- Fix: rely on the implicit SQLite rowid (the default primary key for any
-- table). All existing INSERT / SELECT statements that reference \`rowid\`
-- continue to work unchanged.
--
-- Data loss is intentional: both tables are derived indexes. Embeddings
-- are regenerated from the source rows in memory_chunks / skill_candidates
-- on the next indexing pass.

DROP TABLE IF EXISTS memory_chunks_vec;
CREATE VIRTUAL TABLE memory_chunks_vec USING vec0(
  embedding FLOAT[384]
);

DROP TABLE IF EXISTS skill_candidates_vec;
CREATE VIRTUAL TABLE skill_candidates_vec USING vec0(
  embedding FLOAT[384]
);
`;
