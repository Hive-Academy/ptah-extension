// Migration 0048 — reversible memory quarantine state (TASK_2026_563).
//
// Two nullable columns on `memories`. `quarantined_at` (epoch ms) marks a row
// as hidden from every agent-facing read and from the lifecycle; NULL means
// active. `quarantine_reason` records why (for example `rule:<name>`), so a
// restore can target one rule. Quarantine is reversible: restoring a row sets
// both columns back to NULL and nothing else about the row changes.
//
// No default and no index: no row is rewritten at apply time, and every hot
// query keeps the index it already uses (the merge-candidate lookup still
// resolves through idx_memories_ws_normalized_subject from 0046).
//
// NOT IDEMPOTENT: bare ADD COLUMN relies on the migration runner's exactly-once
// schema_migrations bookkeeping, as do the other additive column migrations.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE memories ADD COLUMN quarantined_at INTEGER;
ALTER TABLE memories ADD COLUMN quarantine_reason TEXT;
`;
