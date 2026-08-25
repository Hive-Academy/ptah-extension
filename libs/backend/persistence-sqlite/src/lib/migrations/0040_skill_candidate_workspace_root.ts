// 0040_skill_candidate_workspace_root — the workspace a candidate came from
// (TASK_2026_322).
//
// `skill_candidates` was the ONE layer of the synthesis subsystem with no
// workspace column. `skill_synthesis_queue` has had `workspace_root` since
// `0032` and the drain's fairness rotation reads it; `skill_session_verdicts`
// has had it since `0034` and `SkillCandidateStore.getWinRates` reads it
// scoped. The candidate rows never got one, so the Skills tab's list — an
// unfiltered `SELECT * FROM skill_candidates WHERE status = ?` — showed every
// project's pending captures in every project, including a brand-new one that
// had produced no sessions at all.
//
// NULLABLE, NO DEFAULT, NO `NOT NULL`, NO `CHECK` — the same four decisions
// `0033` and `0036` made about the columns they added, for the same reasons,
// plus one that is specific to this column.
//
// The `0036` reasons still apply verbatim: a `NOT NULL` column without a
// default breaks `registerCandidate`'s fixed-column INSERT on every existing
// install, and SQLite cannot widen or drop a `CHECK` with `ALTER TABLE`.
//
// The reason specific to this column is that `workspace_root` is THREE-VALUED
// and the third value has to be representable:
//
//   a real path  — this candidate came from that workspace;
//   ''           — deliberately cross-project. Reserved, so the column means
//                  what it already means in `skill_synthesis_queue`; the
//                  candidate write path never produces it;
//   NULL         — UNKNOWN. Every row predating this migration that the
//                  backfill below could not resolve.
//
// A scoped read INCLUDES `NULL`, exactly as `getWinRates` does
// (`skill-candidate.store.ts:898-917` documents that rule and its reasoning).
// Excluding it would make every pre-migration candidate permanently invisible
// in every workspace — trading a display defect for silent data loss. A
// `NOT NULL DEFAULT ''` would be worse still: it would assert that all 36 of
// the user's orphaned candidates are deliberately cross-project, which is a
// claim nobody made.
//
// THE BACKFILL RESOLVES WHAT IS RESOLVABLE AND LEAVES THE REST NULL.
// `skill_synthesis_queue` carries both `workspace_root` and `candidate_id`
// (the drain writes the latter when a stage completes), so a candidate that a
// queue row produced can be traced back to its project. Three things bound it:
//
//   - `q.workspace_root <> ''` — the cross-project rows (clustering, the
//     embedding backfill) genuinely do not identify a project, and copying
//     their `''` in would manufacture the assertion the paragraph above
//     rejects;
//   - `ORDER BY q.enqueued_at ASC LIMIT 1` — a candidate can be referenced by
//     several stage rows (prefilter, then the chained gates). They carry the
//     same root by construction, but the ordering makes the result
//     deterministic rather than relying on that;
//   - `WHERE workspace_root IS NULL` — every row, on the first and only run of
//     this migration. Stated anyway so the statement is idempotent in shape;
//     the runner's `schema_migrations` ledger is what actually guarantees
//     exactly-once, the same guarantee `0026`, `0033` and `0036` rely on.
//
// Candidates older than the queue itself (`0032`), and candidates whose queue
// row was reaped by `0039`, stay `NULL` and are shown in every workspace. That
// is the honest answer and it is why the UI keeps an "all projects" toggle.
//
// THE INDEX IS NOT OPTIONAL HERE, unlike `0036`'s deliberate absence of one.
// `0036` added columns nothing queries on. This one adds the column the list
// read's WHERE clause is about to name, and that read backs an interactive
// list. `(status, workspace_root)` is ordered status-first because the scoped
// and the unscoped read share the leading column, so the existing
// `idx_skill_candidates_status` stays useful for every other caller and this
// one covers both halves of the new predicate.
//
// `ADD COLUMN IF NOT EXISTS` does not exist in SQLite and is not needed.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE skill_candidates ADD COLUMN workspace_root TEXT;

UPDATE skill_candidates
   SET workspace_root = (
         SELECT q.workspace_root
           FROM skill_synthesis_queue AS q
          WHERE q.candidate_id = skill_candidates.id
            AND q.workspace_root <> ''
          ORDER BY q.enqueued_at ASC
          LIMIT 1
       )
 WHERE workspace_root IS NULL;

CREATE INDEX idx_skill_candidates_status_workspace
  ON skill_candidates(status, workspace_root);
`;
