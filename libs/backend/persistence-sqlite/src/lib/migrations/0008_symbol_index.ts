// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- TASK_2026_THOTH_CODE_INDEX: Index on memories(subject) for efficient
-- deleteBySubjectPrefix LIKE queries used by CodeSymbolIndexer.
-- Without this index, DELETE FROM memories WHERE subject LIKE ? performs
-- a full table scan (100-500ms on 10k+ symbol indexes).

CREATE INDEX IF NOT EXISTS memories_subject_idx ON memories(subject);
`;
