// 0019_memory_chunks_vec_cleanup — VEC-ONLY migration (requiresVec).
//
// `memory_chunks_vec` (vec0) has no content-table linkage like the FTS5
// external-content index, so deleting a chunk — directly, or via the
// `memories ... ON DELETE CASCADE` triggered by forget / decay / purge — left
// its embedding row orphaned. This AFTER DELETE trigger mirrors the existing
// `memory_chunks_ad` FTS trigger and removes the matching vec row by rowid.
//
// Verified: SQLite fires AFTER DELETE triggers for FK CASCADE actions even
// with `recursive_triggers` OFF, so this also covers cascade deletes (the
// path forget/decay actually take).
//
// Static SQL only — no `${}` interpolation (enforced by ESLint
// `no-template-curly-in-migration` + Semgrep `sql-injection-in-migration`).
export const vecSql = `
CREATE TRIGGER IF NOT EXISTS memory_chunks_vec_ad AFTER DELETE ON memory_chunks BEGIN
  DELETE FROM memory_chunks_vec WHERE rowid = old.rowid;
END;
`;
