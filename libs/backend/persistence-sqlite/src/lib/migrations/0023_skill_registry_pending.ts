export const sql = `
-- 0023_skill_registry_pending.sql — record the pending upstream source hash on
-- a diverged clone so the Electron Skills-tab UI can surface "an update is
-- available" without re-reading every sidecar. Forward-only; the column is
-- NULL for non-diverged rows and for rows created before this migration.
-- SQLite ADD COLUMN does not support IF NOT EXISTS; the runner applies each
-- migration version exactly once, so a bare ADD COLUMN is safe.
ALTER TABLE skill_registry ADD COLUMN pending_source_hash TEXT;
`;
