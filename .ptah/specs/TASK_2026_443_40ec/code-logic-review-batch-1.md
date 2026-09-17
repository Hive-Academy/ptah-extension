# Code Logic Review — `TASK_2026_443_40ec` — Batch 1 (Migration 0044)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Minor issues        | 3        |
| Failure modes found | 2 (test-coverage gaps; 0 runtime) |

Scope reviewed in full: `0044_memory_lifecycle.ts`, `0044_memory_lifecycle.spec.ts`,
`migrations/index.ts`, all eight ratchet specs (via `git diff`), `migration-runner.ts`,
`0043_memory_retention.ts`, `0002_memory.ts`, `0017_memory_schema_v2.ts`,
`0018_corpora.ts`, `memory-writer.adapter.ts`, plan Component 1
(`implementation-plan.md:231-300`), `batches.md` Task 1.1 + Plan validation,
`batch-1-report.md`.

Independent verification performed for this review (not just read from the report):

- `npx jest --config libs/backend/persistence-sqlite/jest.config.ts 0044_memory_lifecycle`
  → **1 suite passed, 6 tests passed, 0 skipped** on the real `node:sqlite` binding
  (`better-sqlite3` fails the ABI probe on this machine, so the fallback path is the
  one that actually ran — the same path the report claims).
- `git diff` over `libs/backend/persistence-sqlite/src/lib/migrations/` shows exactly
  one line changed in each of the eight ratchet specs (43 → 44) and a pure
  six-line addition in `index.ts` (import + registry entry). No older migration
  SQL or comment was touched.

## Confirmation of the requested checks

1. **SQL matches the plan, static, not vec-gated, drops before the rebase.**
   The migration body (`0044_memory_lifecycle.ts:10-40`) is byte-for-byte the plan's
   exact SQL (`implementation-plan.md:241-271`). Static: no `${` (spec:71 asserts it),
   header comment repeats the rule (`0044_memory_lifecycle.ts:9`). Not vec-gated:
   registry entry carries only `sql` (`index.ts:333-337`); the spec asserts
   `vecSql`/`requiresVec`/`run` are all undefined (spec:68-70). The two `DROP INDEX`
   statements (lines 13-14) precede both rebase `UPDATE`s (lines 23 and 27), and the
   spec pins that ordering with index-of comparisons (spec:74-89).

2. **Rebase predicates do not hit writer-adapter rows.**
   `memory-writer.adapter.ts:77` stores `sessionId: null` and `:83` stores
   `salience: req.salience ?? (req.pinned ? 1.0 : 0.6)`. The `-0.45` rebase predicate
   `pinned = 0 AND session_id IS NOT NULL` (`0044_memory_lifecycle.ts:25`) therefore
   excludes every writer row; the clamp predicate `pinned = 1 OR session_id IS NULL`
   (`:29`) catches them and leaves 0.6 at 0.6. The spec seeds exactly this row and
   asserts 0.6 → 0.6 (spec:169-174, 204). Pinned rows are only clamped, never
   decremented (spec:175-180, 205 asserts 1.0 → 1.0). Note: `salience` is
   `REAL NOT NULL DEFAULT 0` (`0002_memory.ts:17`), so the rebase can never produce
   a NULL through the `MIN`/`MAX` scalar functions.

3. **Archival backfill touches only `tier = 'archival'` rows.**
   Predicate `WHERE tier = 'archival' AND archived_at IS NULL`
   (`0044_memory_lifecycle.ts:21`). The spec proves an archival row gains a non-null
   `archived_at` while all five recall rows keep `NULL` (spec:206-209).

4. **No older migration SQL was edited.** `git diff` confirms: the only changes
   under `migrations/` are the eight one-line ratchet bumps, the `index.ts`
   six-line addition, and the two new untracked 0044 files. `0043_memory_retention.ts`
   and every other migration file is untouched.

5. **Spec assertions match the required set.** 0.75 → 0.30 (spec:201, `toBeCloseTo`
   for the 0.30000000000000004 IEEE-754 result of `0.75 - 0.45`), 1.9 → 1.0
   (spec:202), 0.5 → 0.05 (spec:203), null-session 0.6 → 0.6 (spec:204), pinned
   1.0 → 1.0 (spec:205). Old indexes absent + three new indexes present
   (spec:228-236), including `idx_corpus_mem_memory` on `corpus_memories(memory_id)`
   — the plan is right that `memory_id` alone has no index, since `0018_corpora.ts`
   defines only the composite PK `(corpus_id, memory_id)` and
   `idx_corpus_mem_corpus(corpus_id, ord)`. All nine `memory_retention_state`
   columns with correct defaults and nullability (spec:255-279): three
   `NOT NULL DEFAULT 0` counters, six nullable with no default.

6. **ALTERs safe at version 43; exactly-once inside one transaction.**
   `openAtVersion43` (spec:105-121) applies all base SQL ≤ 43 (skipping `run`-type
   and vec-only migrations, exactly as the runner does when vec is absent) and the
   ALTERs then succeed — proven by the 6 passing tests on real SQLite. The runner
   wraps each migration's SQL plus its bookkeeping row plus `PRAGMA user_version`
   in one `BEGIN IMMEDIATE` … `COMMIT` with `ROLLBACK` on any throw
   (`migration-runner.ts:245-271`), and skips any version already in
   `schema_migrations` (`migration-runner.ts:87,113-116`). SQLite DDL is
   transactional, so a mid-migration failure (e.g. one ALTER failing) reverts every
   prior statement of 0044 — no partial application, no re-run hazard. A
   double-apply outside the runner would fail loudly on the duplicate column, not
   silently corrupt.

7. **Silent-failure / data-loss / re-run audit.** No silent path found in the
   migration itself: it is branch-free static SQL. The one permanent user-data
   rewrite (the salience rebase) is atomic per the runner and preceded by the
   runner's pre-migration backup (`migration-runner.ts:88-104`) — whose failure is
   logged and non-fatal, a pre-existing runner property outside this batch.
   `archived_at` uses `CAST(strftime('%s','now') AS INTEGER) * 1000` — UTC epoch
   ms, consistent with the run-record timestamps in 0043.

## Five logic questions

### 1. How does this fail silently?

No runtime silent failure found in the migration. The two silent-failure risks are
in the *test suite's* sensitivity, listed as failure modes F1 and F2 below: the spec
stays green if the clamp `UPDATE` is deleted, and stays green if the backfill
timestamp loses its `* 1000` scale.

### 2. What user action produces unexpected behaviour?

None — the migration runs once at boot. The visible effect (unpinned, session-bound
memories drop 0.45 salience, permanently) is the plan's declared one-time
reinterpretation (`implementation-plan.md:275-276`), not an accident.

### 3. What input data produces a wrong answer?

Only corrupt input: a non-numeric value in the `REAL` `salience` column would make
`salience - 0.45` evaluate to NULL, the `SET` violate `NOT NULL`, and the migration
abort with rollback — a loud failure, not a wrong answer. Every production writer
(`memory.store.ts` insert paths, `memory-writer.adapter.ts:83`) binds JS numbers.

### 4. What happens when a dependency fails?

The spec's only dependency is a SQLite binding: `resolveOpener` returns null when
neither `better-sqlite3` nor `node:sqlite` loads, and the binding test then FAILS
(`expect(opener).not.toBeNull()`, spec:101-103); the behavioural tests throw in
`openAtVersion43` (spec:106-110) rather than skip. Verified live: this review ran
the suite on the `node:sqlite` fallback after the `better-sqlite3` ABI probe failed.
The migration itself has no external dependency.

### 5. What is missing that the requirements never mentioned?

One plan-level observation, not a batch defect: the rebase predicate is not
tier-filtered (`0044_memory_lifecycle.ts:25`), so any `tier = 'core'` or pre-existing
`tier = 'archival'` row that carries a `session_id` also loses 0.45. Such rows can
exist — the decay job sets `nextTier = 'core'` (`memory-decay.job.ts:89`) on
curator-inserted rows, which do carry `session_id`. The plan's justification derives
0.45 from the recall insert-time score (`implementation-plan.md:275-276`), so the
offset for core rows may not be exactly right — but the plan's exact SQL includes
them and this batch matches it verbatim, so this is recorded for the orchestrator,
not scored against Batch 1.

## Failure modes

### F1 — Clamp `UPDATE` is invisible to the spec (deletion undetectable)

- Trigger: any future edit removes or breaks the second `UPDATE`
  (`0044_memory_lifecycle.ts:27-29`) — e.g. a bad merge or a refactor of the SQL
  body.
- Symptom: every seeded value that the clamp statement covers is already in range
  (writer 0.6, pinned 1.0, archival 0.6), and its effect on in-range values is the
  identity — so all six behavioural tests still pass with the statement gone.
- Evidence: spec seeds and assertions at `0044_memory_lifecycle.spec.ts:169-180,201-209`
  never give the clamp a row with `salience > 1` or `salience < 0` where
  `pinned = 1 OR session_id IS NULL` is the only statement that would fix it
  ('merged' 1.9 is pinned 0, so the first `UPDATE`'s `MIN(1.0, …)` handles it).
- Current handling: unguarded.
- Recommendation: add two rows — pinned with salience 1.9 and session-null with
  salience 1.9 (assert → 1.0), plus one negative-salience row (assert → 0.0).

### F2 — Backfill timestamp scale is unguarded

- Trigger: a future edit drops the `* 1000` (or changes `strftime('%s','now')` to a
  wrong epoch), changing `archived_at` from epoch ms to epoch seconds.
- Symptom: deletion windows (M days from `archived_at`, Batch 5/6) would compare
  seconds against ms and never fire — a silent retention failure. The spec's
  `expect(byId.get('archived')?.archived_at).toEqual(expect.any(Number))`
  (spec:206) accepts 0, a negative number, or a seconds-scale value.
- Evidence: `0044_memory_lifecycle.spec.ts:206`; the 0038/0043 convention is epoch
  ms everywhere (`0043_memory_retention.ts` header: "Every timestamp is epoch ms").
- Current handling: unguarded.
- Recommendation: assert the value is within a sane window of `Date.now()` taken
  just before `db.exec(sql0044)` (e.g. `>= before && <= after`), which also proves
  non-zero.

No runtime failure mode of the migration itself survived the audit: static SQL,
atomic transaction, exactly-once ledger, loud failure on every malformed-input
path.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### M1 (moderate) — F1 as a numbered finding

`0044_memory_lifecycle.spec.ts:169-180` — the clamp `UPDATE`'s removal keeps the
suite green. Failure scenario: a refactor in a later task deletes
`0044_memory_lifecycle.ts:27-29`; CI passes; out-of-range salience values in
writer/pinned rows survive into the ranking-only phase this migration is supposed
to guarantee.

### M2 (moderate) — F2 as a numbered finding

`0044_memory_lifecycle.spec.ts:206` — `expect.any(Number)` accepts any number for
the backfill, including wrong scale. Failure scenario: `* 1000` is dropped; the
suite passes; Batch 5/6 deletion logic never sees a row as M days old.

### m3 (minor) — Archival row's salience is never asserted

`0044_memory_lifecycle.spec.ts:181-209` seeds the 'archived' row at 0.6 but reads
back only `archived_at` for it. A regression that let the `-0.45` rebase hit
session-null rows would change it to 0.15 and stay green on that row (the 'writer'
row at the same shape does guard this, so the practical risk is low — the two rows
are shape-identical apart from tier).

### m4 (minor) — Ratchet provenance comments are now stale

Each of the eight ratchet specs still reads `// 43 since TASK_2026_440 appended
0043_memory_retention.` directly above `expect(...).toBe(44)` (e.g.
`0028_gateway_conversation_workspace_root.spec.ts:77-78`,
`0043_memory_retention.spec.ts:47-48`). No `44 since TASK_2026_443 …` line was
added, so the convention's history chain has a gap. Borderline style-review
territory, recorded here because it is factual staleness of a version provenance
trail, not formatting.

### m5 (minor) — Report's "no files outside Batch 1 ownership" claim needs one caveat

`batch-1-report.md:38` is true of Batch 1's own edits, but the shared worktree also
carries in-flight changes from the parallel batch (`memory-contracts` tokens/index,
`platform-core` file-settings-keys, `memory-usage-recorder.port.ts`) — visible in
`git status`. Anyone reviewing this batch's diff must not mistake those for Batch 1
output. The report could have said so explicitly.

## Data flow

1. Boot → `SqliteMigrationRunner.applyAll` → pending = version 44 → pre-migration
   backup (non-fatal on failure, logged) — `migration-runner.ts:87-104`. OK.
2. `BEGIN IMMEDIATE` → `exec(sql0044)` → all 19 statements inside one transaction —
   `migration-runner.ts:245-247`. OK.
3. `ALTER memories ADD archived_at` (unnullable-free additive; no default needed —
   SQL NULL is the intended "not archived") — `0044_memory_lifecycle.ts:11`. OK.
4. Two index drops, three index creates — drops precede the rebase `UPDATE`s so
   the UPDATE does not maintain `idx_memories_salience` — `:13-17`. OK.
5. Archival backfill stamps migration-time epoch ms onto pre-existing archival rows
   only — `:19-21`. OK, but see F2 (scale unasserted).
6. Rebase `UPDATE` 1: unpinned session-bound rows, `salience - 0.45`, clamped —
   `:23-25`. One-time, irreversible, atomic; pre-migration backup is the recovery.
   OK.
7. Rebase `UPDATE` 2: clamp pinned and session-null rows — `:27-29`. OK, but see F1
   (deletion invisible to the spec).
8. Nine additive `ALTER`s on `memory_retention_state` (three `NOT NULL DEFAULT 0`
   counters, six nullable preview/note columns, no CHECK on `lifecycle_note`,
   matching the plan's stated reason) — `:31-39`. OK.
9. Bookkeeping `INSERT` + `PRAGMA user_version = 44` + `COMMIT` in the same
   transaction; `ROLLBACK` reverts everything on any throw —
   `migration-runner.ts:251-266`. OK — no re-run hazard.

## Requirements fulfilment

| Requirement (plan Component 1 / Task 1.1)                       | Status   | Gap |
| -------------------------------------------------------------- | -------- | --- |
| Registry entry 44, plain `sql`, appended after 43               | COMPLETE | —   |
| SQL byte-identical to plan `:241-271`                          | COMPLETE | —   |
| Static, no `${}`, not vec-gated                                | COMPLETE | —   |
| Drops before rebase UPDATEs                                    | COMPLETE | —   |
| Archival-only backfill, epoch ms                               | COMPLETE | —   |
| Rebase excludes writer rows and pinned beyond clamping         | COMPLETE | —   |
| Nine run-record columns, correct defaults/nullability          | COMPLETE | —   |
| Spec on real SQLite, fails (never skips) without binding      | COMPLETE | —   |
| Spec asserts the five salience cases + index set + columns     | COMPLETE | —   |
| Eight ratchets 43 → 44                                         | COMPLETE | —   |
| No older migration edited                                      | COMPLETE | —   |
| Clamp UPDATE exercised with out-of-range input                 | MISSING  | M1  |
| Backfill value proven to be epoch-ms scale                     | MISSING  | M2  |

Implicit requirements honoured: temp-file-only databases (spec:47-51, `afterAll`
cleanup at :95-99); no TODO/PLACEHOLDER/stub markers anywhere in the batch; the
migration's non-idempotent `ADD COLUMN` is correct-by-design under the runner's
exactly-once ledger (plan `:281-282`).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| salience NULL | N/A (impossible) | `REAL NOT NULL DEFAULT 0` (`0002_memory.ts:17`) | none |
| salience > 1, unpinned session-bound | YES | `MIN(1.0, …)` in rebase 1, asserted ('merged' → 1) | — |
| salience < 0 | YES at runtime | `MAX(0.0, …)` both UPDATEs | not covered by any seeded row |
| salience > 1 / < 0 on clamp rows (pinned / session-null) | YES at runtime | rebase 2 | never exercised — M1 |
| `core`/`archival` rows with session_id | YES (per plan SQL) | rebase 1 hits them too | offset derived for recall — Q5 observation |
| Migration fails mid-way | YES | single `BEGIN IMMEDIATE`/`ROLLBACK` (`migration-runner.ts:245-266`) | none |
| Version already applied / re-run | YES | `schema_migrations` ledger (`:87,113-116`) | none |
| No SQLite binding in spec | YES | binding test fails; helpers throw (spec:101-110) | none — verified live |
| `archived_at` = 0 / wrong scale | NO | `expect.any(Number)` | M2 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the spec cannot detect the removal of the clamp `UPDATE` or a
  wrong-scale backfill timestamp — two small seeded rows and one range assertion
  close both holes before the lifecycle store (Batch 5/6) builds on this schema.
- What a robust implementation would add: the two F1 rows (pinned 1.9, session-null
  1.9, plus a negative), the F2 timestamp-window assertion, an assertion that the
  'archived' row's salience stays 0.6, and a `44 since TASK_2026_443` line in each
  ratchet comment. All are test/comment-only; none touch shipped SQL.
- Evidence basis: full read of every reviewed file, `git diff` of the whole batch,
  and a live run of the 0044 suite (6/6 passed, 0 skipped, `node:sqlite` binding).