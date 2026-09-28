// Migration 0049 — one-time quarantine of stale commitlint scope facts
// (TASK_2026_563, rule R4 `rule:commitlint-scope-facts`).
//
// The rule and its evidence live in
// .ptah/specs/TASK_2026_563_2939/quarantine-rules.md (revision r2, sections 5
// and 6). On a read-only copy of a 26,706-row database the rule matched 125
// rows before the guard and 89 after it (0.33%). 72 matched rows were read
// across content, request, investigated, learned, completed and next_steps:
// every one restates `.commitlintrc.json` (stale scope lists, "X is not a
// valid scope") and 0 were durable. Workflow lessons stored as `preference`,
// commitlint facts that do not mention scope, and every event row are out of
// reach of the predicate by construction.
//
// The common guard never quarantines a pinned row, a core-tier row or a row
// linked to a corpus, because each of those expresses explicit curation (the
// lifecycle protects them the same way). The rule is not workspace-scoped, so
// rows with a NULL workspace_root are quarantined too and are restored under
// the explicit NULL scope.
//
// REVERSIBLE: quarantine hides a row; it does not remove it. This statement
// touches only the two columns 0048 added (quarantined_at, quarantine_reason).
// There is no DELETE: every memory, chunk, FTS row and corpus link stays in
// place, and a restore by id or by reason sets both columns back to NULL.
//
// IDEMPOTENT: `quarantined_at IS NULL` in the guard makes a second application
// change nothing, and never moves an existing quarantine timestamp.
//
// The timestamp is computed by SQLite (whole seconds scaled to epoch ms) so the
// statement stays static text.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
UPDATE memories
   SET quarantined_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
       quarantine_reason = 'rule:commitlint-scope-facts'
 WHERE pinned = 0 AND tier <> 'core' AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = memories.id) AND quarantined_at IS NULL
   AND kind = 'fact' AND TRIM(LOWER(subject)) LIKE '%commitlint%' AND LOWER(content) LIKE '%scope%';
`;
