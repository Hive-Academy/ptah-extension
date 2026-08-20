// 0031_task_specs_metadata — additive metadata columns on the derived task
// index (TASK_2026_181, family B).
//
// Files remain the source of truth; `task_specs` is a rebuildable read model,
// so these columns are FORWARD-ONLY WITH NO BACKFILL. Existing rows take the
// declared defaults and nothing rewrites a carrier on disk — the next scan
// repopulates every row from the files anyway, and a backfill would be
// indistinguishable from Ptah editing task metadata nobody asked it to touch.
//
// The JSON-in-TEXT + `DEFAULT '[]'` shape matches what `depends_on` established
// in 0029, so `parseJsonArray` in the store handles all four array columns the
// same way.
//
// `ADD COLUMN IF NOT EXISTS` does not exist in SQLite. It is not needed: the
// runner's `schema_migrations` bookkeeping guarantees each version runs exactly
// once, which is the same guarantee 0028 relies on for its bare ADD COLUMN.
//
// The reserved `claim` column is NOT repurposed — it is phase-2 territory and
// overloading it would give one column two meanings.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE task_specs ADD COLUMN labels     TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN estimate   TEXT;
ALTER TABLE task_specs ADD COLUMN parent     TEXT;
ALTER TABLE task_specs ADD COLUMN duplicates TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task_specs ADD COLUMN relates_to TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_task_specs_ws_parent
  ON task_specs (workspace_root, parent);
`;
