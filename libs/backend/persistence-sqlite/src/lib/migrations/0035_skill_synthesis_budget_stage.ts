// 0035_skill_synthesis_budget_stage — re-key the daily token ledger from
// `(day_key)` to `(day_key, stage)` (TASK_2026_180, phase 0, batch B0.8).
//
// WHY A TABLE REBUILD AND NOT AN `ALTER TABLE`.
// `0032` declared `day_key TEXT PRIMARY KEY`, which is a UNIQUE index on
// `day_key` alone. Adding the column is a one-liner (`ALTER TABLE … ADD COLUMN`
// works fine); DROPPING THE OLD KEY IS NOT — SQLite has no `ALTER TABLE … DROP
// CONSTRAINT` and no way to redefine a PRIMARY KEY. Leaving the old key in
// place while adding a `UNIQUE(day_key, stage)` index would not help either:
// the FIRST index still rejects a second stage row for the same day, which is
// precisely the write this migration exists to allow. So the table is rebuilt
// with the twelve-step pattern reduced to the four statements this table
// actually needs — it has no foreign keys in either direction, no triggers and
// no views over it, so the `PRAGMA foreign_keys = OFF` dance the general recipe
// prescribes is unnecessary (and would be a no-op anyway: the runner applies
// this inside `BEGIN IMMEDIATE`, and that pragma is ignored inside a
// transaction).
//
// THIS MIGRATION IS DELIBERATELY NOT RE-RUNNABLE, unlike `0032`/`0033`/`0034`.
// A rebuild cannot be `IF NOT EXISTS`-guarded: after it has run, re-running the
// same static text would copy the re-keyed table back down onto a single `''`
// stage and lose the split. That is safe because it is never re-run —
// `SqliteMigrationRunner` applies each version exactly once against its
// `schema_migrations` bookkeeping, the same guarantee `0033`'s bare
// `ADD COLUMN`s already depend on. Static SQL cannot express "rebuild only if
// not already rebuilt", and faking it with a probe would mean an imperative
// `run()` migration outside the transaction — strictly worse for a rebuild that
// must be atomic.
//
// EXISTING ROWS MIGRATE TO `stage = ''`, NOT TO A GUESS. A day row written
// before this migration is a day TOTAL with no attribution; inventing a stage
// for it would fabricate a per-stage figure nobody measured. `''` means
// "spend that no queue stage owned" and is a first-class member, not a
// placeholder: it is also what a lane run outside the drain (the foreground
// promotion gate's judge call) records from here on. Keeping it in the same
// table is what lets `spentToday()` stay the DAY total — the number B0.4's
// budget gate compares against `skillSynthesis.budget.maxTokensPerDay` — while
// the Activity strip reads the per-stage split from the same rows.
//
// `stage` carries NO `CHECK` constraint, matching `0033`'s `judge_status` and
// diverging from `0032`'s queue `stage` on purpose. The queue column had to
// enumerate all eleven stages up front because widening a CHECK means another
// rebuild; here the vocabulary is the eleven stages PLUS `''`, and a CHECK
// would buy one class of typo at the price of a second live-database rebuild
// the first time that set moves. `SkillBudgetStore` is the enforcing gate: it
// narrows an unrecognised stored stage back to `''` on read.
//
// No new index. The composite PRIMARY KEY's implicit index has `day_key` as its
// leading column, so both access paths — "today's total" and "today by stage" —
// are already covered by it.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
DROP TABLE IF EXISTS skill_synthesis_budget_rekeyed;

CREATE TABLE skill_synthesis_budget_rekeyed (
  day_key       TEXT    NOT NULL,
  stage         TEXT    NOT NULL DEFAULT '',
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL    NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (day_key, stage)
);

INSERT INTO skill_synthesis_budget_rekeyed
  (day_key, stage, input_tokens, output_tokens, cost_usd, updated_at)
  SELECT day_key, '', input_tokens, output_tokens, cost_usd, updated_at
    FROM skill_synthesis_budget;

DROP TABLE skill_synthesis_budget;

ALTER TABLE skill_synthesis_budget_rekeyed RENAME TO skill_synthesis_budget;
`;
