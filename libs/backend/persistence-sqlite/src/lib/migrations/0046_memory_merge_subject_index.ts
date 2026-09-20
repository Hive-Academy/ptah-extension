// Migration 0046 — indexed normalized subject lookup for curator merges.
//
// MemoryStore.findMergeCandidates scopes by workspace and compares the
// trimmed, lowercased subject. The expression here deliberately matches that
// predicate byte-for-byte so SQLite can seek to the requested subjects instead
// of evaluating TRIM(LOWER(subject)) for every memory in the workspace.
//
// Measured on a copy of the 1.26 GB production database (36,278 memories,
// 35,255 in the largest workspace): the index built in 127 ms and the file did
// not grow because SQLite reused free pages. The 30-iteration warm lookup
// median fell from 70.72 ms to 2.09 ms. This reads only the memories table, not
// the much larger observation_queue, so its measured boot cost is acceptable.
//
// IDEMPOTENT: IF NOT EXISTS keeps direct reapplication harmless; the migration
// runner's schema_migrations ledger still guarantees exactly-once application.
//
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `
CREATE INDEX IF NOT EXISTS idx_memories_ws_normalized_subject
  ON memories(workspace_root, TRIM(LOWER(subject)));
`;
