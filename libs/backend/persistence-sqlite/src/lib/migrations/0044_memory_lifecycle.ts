// Migration 0044 — memory lifecycle persistence and retention run metrics.
//
// This migration is intentionally static and forward-only. The runner applies
// it exactly once, so the additive columns do not need idempotency guards.
// Dropping the obsolete salience and tier indexes before the data rebase avoids
// maintaining them during the update. The replacement indexes match lifecycle
// queries, and the corpus join gains its missing memory-first lookup.
//
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `
ALTER TABLE memories ADD COLUMN archived_at INTEGER;

DROP INDEX IF EXISTS idx_memories_salience;
DROP INDEX IF EXISTS idx_memories_tier;
CREATE INDEX IF NOT EXISTS idx_memories_tier_last_used ON memories(tier, last_used_at);
CREATE INDEX IF NOT EXISTS idx_memories_tier_archived  ON memories(tier, archived_at);
CREATE INDEX IF NOT EXISTS idx_corpus_mem_memory       ON corpus_memories(memory_id);

UPDATE memories
   SET archived_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE tier = 'archival' AND archived_at IS NULL;

UPDATE memories
   SET salience = MIN(1.0, MAX(0.0, salience - 0.45))
 WHERE pinned = 0 AND session_id IS NOT NULL;

UPDATE memories
   SET salience = MIN(1.0, MAX(0.0, salience))
 WHERE pinned = 1 OR session_id IS NULL;

ALTER TABLE memory_retention_state ADD COLUMN memories_archived        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_retention_state ADD COLUMN memories_deleted         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_retention_state ADD COLUMN memories_evicted         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_retention_state ADD COLUMN lifecycle_note           TEXT;
ALTER TABLE memory_retention_state ADD COLUMN preview_measured_at      INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_for_run_at       INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_archive_eligible INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_delete_eligible  INTEGER;
ALTER TABLE memory_retention_state ADD COLUMN preview_over_cap         INTEGER;
`;
