export const sql = `
-- Index on memories(subject) for efficient deleteBySubjectPrefix LIKE
-- queries used by CodeSymbolIndexer.
-- Without this index, DELETE FROM memories WHERE subject LIKE ? performs
-- a full table scan (100-500ms on 10k+ symbol indexes).

CREATE INDEX IF NOT EXISTS memories_subject_idx ON memories(subject);
`;
