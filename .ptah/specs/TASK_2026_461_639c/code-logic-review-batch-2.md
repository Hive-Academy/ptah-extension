# Code Logic Review — Batch 2 — TASK_2026_461_639c (migration 0045 skill backlog cleanup state)

Reviewer: code-logic-reviewer. Scope: `libs/backend/persistence-sqlite/src/lib/migrations` only — `0045_skill_backlog_cleanup.ts` + `.spec.ts` (untracked), `index.ts`, and the nine ratchet specs. Batch 1 (`libs/backend/skill-synthesis`) was out of scope and was not reviewed here.

Evidence read in full: the 0045 migration and its spec, `migrations/index.ts` (registry + `Migration` contract, `migrations/index.ts:76-115`), `migration-runner.ts` (apply order, exactly-once, transaction shape), `0043_memory_retention.ts` + `0043_memory_retention.spec.ts` (the assigned reference shape), the full `git diff` of `libs/backend/persistence-sqlite`, `implementation-plan.md` Components 4a/4b/4c, `batches.md` Task 2.1 and XB1-XB4, `batch-2-report.md`, and `TASK_2026_439_1310/HANDOFF.md`.

Verification I ran myself (from `W`, tooling from the main checkout `node_modules`):

- `node:sqlite` binding: `jest --config libs/backend/persistence-sqlite/jest.config.ts --testPathPatterns 0045_skill_backlog_cleanup --runInBand` — **8 passed, 8 total, 0 skipped**.
- `better-sqlite3` binding (Electron-as-Node, `ELECTRON_RUN_AS_NODE=1`): same command — **8 passed, 8 total, 0 skipped**.

Both match the executor's pasted outputs. No spec was skipped on either binding.

## Verdict

**APPROVED** — score **8/10** (0 blocking, 0 major, 2 minor findings).

The migration is correct against the plan, the registry entry matches the runner contract, the column set is complete for Component 4c, no shipped migration SQL changed, and the spec cannot pass vacuously on either binding. The two findings are coverage and handoff gaps only. Fix finding 1 before commit if convenient — after commit the file is append-only, so the shape pin closes or never does.

## Check results for the five requested checks

### 1. DDL only, idempotent, no boot-path cost, registry entry matches the runner contract — PASS

- The SQL is one `CREATE TABLE IF NOT EXISTS` (`0045_skill_backlog_cleanup.ts:18-38`). No INSERT, UPDATE, DELETE, index, backfill, ALTER or DROP. No template interpolation. The spec pins all of this (`0045_skill_backlog_cleanup.spec.ts:41-52`).
- Registry entry `{ version: 45, name: '0045_skill_backlog_cleanup', sql: sql0045SkillBacklogCleanup }` is appended after 0044 (`migrations/index.ts:339-343` in the diff) and matches the plain-SQL shape of 0043/0044: `sql` only, `vecSql`/`requiresVec`/`run` all absent — the runner's `applyOne` sql path applies it (`migration-runner.ts:242-271`), and the mutual-exclusion guards in `migration-runner.ts:195-212` cannot fire. The spec pins `vecSql`/`requiresVec`/`run` undefined and version 45 unique (`0045_skill_backlog_cleanup.spec.ts:16-33`).
- Ordering: the runner sorts by version before applying (`migration-runner.ts:74`), so array position is not a runtime behaviour; the spec pins uniqueness (exactly one version-45 entry), 44 present, and 45 highest.
- Boot cost: DDL on one empty table; the only extra cost is the runner's existing pre-migration backup (`migration-runner.ts:88-104`), which the plan explicitly accepts (implementation-plan.md:267-268).

### 2. Column set supports Component 4c — PASS

All 16 columns named in the plan Component 4a (implementation-plan.md:263-266) are present, correctly spelled, with no extras: `version`, `cutoff_created_at`, `cursor_created_at`, `cursor_id`, `started_at`, `finished_at`, `last_run_at`, `last_outcome`, `last_reason`, and the seven counters `examined`, `kept_evidence`, `kept_verdict`, `kept_degraded_verdict`, `rejected_no_evidence`, `rejected_transcript_unreadable`, `invocations_deleted` (`0045_skill_backlog_cleanup.ts:20-36`). Everything 4c needs is covered:

- Keyset paging: `cursor_created_at` + `cursor_id` (Component 4b predicate `(created_at, id) > (:cursorCreatedAt, :cursorId)`).
- First-run and gate state: `version`, `cutoff_created_at`, `started_at`, `finished_at` (the `complete` gate reads `finished_at` for the current version).
- Outcome reporting: `last_run_at`, `last_outcome`, `last_reason`.
- All seven counters including `invocations_deleted` and `rejected_transcript_unreadable`.

Naming note for Batch 4: plan line 325 mentions `last_error` in a degradation-audit comment example, but Component 4a's authoritative column list, the 4f report table and Task 4.2's XB2 marker text all say `last_reason`. The table correctly has `last_reason`; Batch 4 must use that name, not `last_error`.

### 3. No shipped migration source changed — PASS

The full `git diff -- libs/backend/persistence-sqlite` touches exactly ten tracked files: `migrations/index.ts` (one import + one appended entry) and the nine ratchet specs, each a single `toBe(44)` → `toBe(45)` bump plus one provenance comment. No migration SQL for 0044 or earlier changed. The two 0045 files are untracked, so they cannot have modified shipped content.

### 4. Spec covers registry, idempotent double apply, one-row CHECK, defaults; not vacuous — PASS

- Registry: `0045_skill_backlog_cleanup.spec.ts:16-33` (version/name/sql identity, plain-sql flags, unique entry, highest version).
- Idempotent double apply: `:126-154` — applies onto a version-44 lineage, inserts a state row, re-applies, and asserts the row survived unchanged. This proves `IF NOT EXISTS` semantics, not just absence of a throw.
- One-row CHECK: `:212-228` inserts `id = 2` and asserts a throw matching `/CHECK/i`. The required mutation (remove `CHECK (id = 1)`) was pasted in the report making exactly this test fail (1 failed, 7 passed), then restored (8 passed). I verified the CHECK is present at `0045_skill_backlog_cleanup.ts:20`.
- Columns and defaults: `:156-209` asserts the exact ordered 17-column list (16 + `id`), `id` is pk, `last_reason` nullable, and all seven counters `INTEGER NOT NULL DEFAULT 0`.
- Not vacuous: `:104-106` fails (never skips) when no binding loads, and `openAtVersion44` (`:108-124`) throws on the same condition, so every behaviour test fails rather than skips. The behavioural half applies the real bundled lineage through version 44 (base `sql` only), so the DDL is proved against the actual schema, not an empty database. My own runs show 0 skipped on both bindings.

### 5. Anything in Task 2.1 silently not done — nothing found

Every Task 2.1 deliverable is present and verified: the two CREATE files, the `index.ts` append, all nine ratchet bumps with the provenance comment in each file's own convention (0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043, 0044 — including the multi-line `0044` form the plan's grep originally missed), the acceptance grep (I re-ran it: every `Math.max(...MIGRATIONS.map(...))` ratchet reads 45, and no stale `toBe(44)` migration assertion remains anywhere in the repo), and the mutation with fail + restore + `git diff --stat`. One report nit, not a defect: batches.md asks each report to say "how each listed risk was handled", and the report does not walk the risk table — none of R1-R9 applies to a DDL-only batch, so nothing was concealed, but the report could have said so in one line.

## Findings

### 1. [minor] The spec does not pin the nullability of the nine non-counter columns

- File: `libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.spec.ts:189-206`
- The shape test asserts the ordered column list, `id` pk = 1, `last_reason.notnull = 0`, and the seven counters. It asserts nothing about `notnull` for `version`, `cutoff_created_at`, `started_at` (currently NOT NULL) or for `cursor_created_at`, `cursor_id`, `finished_at`, `last_run_at`, `last_outcome` (currently nullable).
- Failure scenario: before this batch commits, any edit flipping one of those columns' nullability passes the whole suite. After commit the migration is append-only, so the shipped shape is frozen with semantics no spec pinned; Batch 4 then builds its store against an assumption nobody tested.
- Fix: extend the `byName` loop to assert `notnull` (and `dflt_value` null) for all 16 non-id columns. One small `for` loop; no runtime change.

### 2. [minor] `version` / `cutoff_created_at` / `started_at` are NOT NULL — a deliberate divergence the task text never approved, and Batch 4 must know it

- File: `libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.ts:21-25`
- Task 2.1 lists the nine state columns followed by "(nullable)" (`batches.md:334-336`), and the 0043 reference table makes every non-`id` column nullable (`0043_memory_retention.ts:57-76` — that is what lets its store do skip-only upserts naming few columns). This table instead makes the three first-run fields NOT NULL.
- Assessment: the choice is defensible and in the safe direction — Component 4c says the first run always writes `version`, `started_at`, `cutoff_created_at` together (implementation-plan.md:303-304), the row is inserted once, and a NOT NULL violation fails loudly, never silently. But it is a divergence from both the batch text's plain reading and the 0043 shape, and it constrains the next batch.
- Failure scenario: Batch 4's `SkillBacklogCleanupStore` implements the state upsert as `INSERT OR REPLACE` (the 0043 store's upsert style) and names only the changed columns; the write throws `NOT NULL constraint failed` on the first cursor advance, and the failure surfaces during Batch 4's integration spec instead of being designed against.
- Fix: no change to the migration. Record the constraint in the Batch 4 task context: the store must either UPDATE in place or rebind `version`, `cutoff_created_at`, `started_at` on every full-row write. Finding 1's added assertions would then also pin this contract.

## Five logic questions

1. **How does this fail silently?** No path found. A migration failure rolls back per-migration and throws at boot (`migration-runner.ts:265-271`); a second apply is a guarded no-op; the spec fails loudly when no binding loads. The nearest silent path is finding 1: a pre-commit nullability edit that no test notices — silent in review, not at runtime.
2. **What user action produces unexpected behaviour?** None. The migration runs once on the boot path; the table is written only by the future cleanup job. No user input reaches it.
3. **What input data produces a wrong answer?** Only a pre-existing table named `skill_backlog_cleanup_state` with a different shape would be silently accepted by `IF NOT EXISTS` — nothing in the product creates that name (the only writer of the name is this migration), and a later cleanup store would fail loudly on a missing column, not corrupt data.
4. **What happens when a dependency fails?** A failed apply rolls back the whole migration including its bookkeeping row, so the next boot retries it. A missing SQLite binding turns the spec red, not green (verified: 0 skipped under both bindings).
5. **What is missing that the requirements never mentioned?** Nothing material for a DDL batch. The plan's own loose `last_error` wording (implementation-plan.md:325) is resolved in favour of `last_reason` by the 4a column list and Task 4.2's XB2 text; recorded above so Batch 4 does not re-litigate it.

## Requirements fulfilment

| Requirement (Task 2.1 / XB rules) | Status | Gap |
| --- | --- | --- |
| CREATE migration, 0043 one-row shape, `id INTEGER PRIMARY KEY CHECK (id = 1)` | COMPLETE | — |
| All 16 columns from plan 4a, exact names | COMPLETE | — |
| Counters `INTEGER NOT NULL DEFAULT 0`, no CHECK on outcome text | COMPLETE | — |
| DDL only: no INSERT/backfill/index, idempotent | COMPLETE | — |
| Registry append matching runner contract (plain sql) | COMPLETE | — |
| Spec: registry, double apply, columns + defaults, `id = 2` rejected, fails when no binding | COMPLETE | nullability of non-counter columns unpinned (finding 1) |
| Nine ratchet bumps with provenance comments (Deviation 5) | COMPLETE | — |
| No shipped migration source changed (append-only) | COMPLETE | — |
| XB1 both bindings, outputs pasted | COMPLETE | independently re-run: 8/8 on both, 0 skipped |
| Mutation (remove CHECK) fail + restore pasted | COMPLETE | — |
| Acceptance grep `MIGRATIONS.map` all at 45 | COMPLETE | independently re-ran; no stale `toBe(44)` anywhere |

Implicit requirements honoured: temp-file databases only (never the live DB, HANDOFF rule 5), static SQL with the security header, `catch` style not applicable (no catch blocks added — degradation-audit stays at baseline 5).

## Edge cases

| Case | Handled | Evidence |
| --- | --- | --- |
| Double apply with a live state row | YES | spec `:126-154` (row survives re-apply unchanged) |
| `id = 2` insert | YES | CHECK rejects; proven by the pasted mutation |
| No SQLite binding loads | YES | spec fails, never skips (`:104-106`, `:108-124`) |
| `node:sqlite` vs `better-sqlite3` differences | YES | both bindings green (report + my re-run); all statements bind every positional parameter |
| Applying onto the real 44-migration lineage | YES | `openAtVersion44` applies the bundled lineage, not an empty DB |
| Fresh install (migrations 1-45 in one boot) | YES | runner applies in order; `sqlite-connection.service.spec.ts:47-54` asserts every version recorded |

## Verdict detail

- Recommendation: **APPROVE**. Both findings are minor; neither blocks the Batch 4 build-on. Finding 1 should ideally land before commit because the migration freezes at commit.
- Confidence: HIGH — I read every changed and created file in full, read the runner and the reference migration, and re-ran the spec on both bindings myself.
- Top risk: the store in Batch 4 assumes 0043-style nullable state columns and trips the NOT NULL trio on its first full-row write — prevented by recording finding 2 in the Batch 4 task context.
- What a robust implementation would add: pin nullability for all columns in the spec (finding 1); optionally one comment line in the migration header stating why the three first-run fields are NOT NULL, so the divergence from 0043 is deliberate on the record.