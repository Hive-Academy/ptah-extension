// Migration 0047 — retention health attempt history (TASK_2026_511).
//
// Two additive columns on the single-row retention state. No table rebuild,
// queue scan or backfill: existing installs start observing attempts at zero,
// with no invented first-attempt timestamp. All timestamps are epoch ms.
//
// NOT IDEMPOTENT: bare ADD COLUMN relies on the migration runner's exactly-once
// schema_migrations bookkeeping, as do the other additive column migrations.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE memory_retention_state ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_retention_state ADD COLUMN first_attempt_at INTEGER;
`;
