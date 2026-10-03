// Migration 0051 — skill suggestion lineage and backlog purge marker
// (TASK_2026_578).
//
// Extends `skill_suggestions` with lineage tracking for merged suggestions,
// promoted candidate links, and modular reference documents.
//
// Adds `skill_backlog_purge_state` as a durable single-row marker to record
// that the one-time unclustered candidate backlog purge (>30d) has run.
//
// COLUMNS on `skill_suggestions`:
//   - `merged_into`: TEXT, nullable. The umbrella suggestion ID that absorbed
//     this suggestion, or NULL if unmerged.
//   - `promoted_candidate_id`: TEXT, nullable. The candidate ID resulting from
//     accepting this suggestion, or NULL if not yet accepted / pre-migration.
//   - `references_json`: TEXT, nullable. JSON-encoded array of modular reference
//     documents ({ name: string, body: string }[]).
//
// NULLABLE, NO DEFAULT, NO `NOT NULL`, NO `CHECK` — the same choices as 0036
// and 0040. SQLite cannot easily widen or drop a CHECK with ALTER TABLE, and
// pre-existing suggestion rows remain valid with NULL.
//
// TABLE `skill_backlog_purge_state`:
//   - Single-row table: `id INTEGER PRIMARY KEY CHECK (id = 1)` rejects any
//     writer using another key. Absence of the row means the purge has never run.
//   - `cutoff_created_at` and `completed_at` are NOT NULL because the purge
//     writes both together upon completion.
//   - `rejected` defaults to 0 counters for rejected candidate rows.
//
// IDEMPOTENT: static DDL only. No backfill, INSERT, or data mutation.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE skill_suggestions ADD COLUMN merged_into           TEXT;
ALTER TABLE skill_suggestions ADD COLUMN promoted_candidate_id TEXT;
ALTER TABLE skill_suggestions ADD COLUMN references_json       TEXT;
CREATE TABLE IF NOT EXISTS skill_backlog_purge_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  cutoff_created_at INTEGER NOT NULL,
  completed_at      INTEGER NOT NULL,
  rejected          INTEGER NOT NULL DEFAULT 0
);
`;
