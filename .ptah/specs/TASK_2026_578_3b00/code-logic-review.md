# Code Logic Review — TASK_2026_578_3b00

## Batch 1

Scope: 0051_skill_lifecycle.ts, 0051_skill_lifecycle.spec.ts, migrations/index.ts, and the 12 bumped specs (0028, 0030, 0038-0047). Read in full. Compared against migration-runner.ts, batches.md and the plan's migration section.

Verification: `persistence-sqlite:test --skip-nx-cache` passed: 46 suites, 541 passed, 3 skipped, 0 failed. `lint` passed with 0 errors and 22 pre-existing warnings, none in the 0051 files.

Score: 8/10

Verdict: APPROVED

### BLOCKING

None.

### MODERATE

None.

### MINOR

1. `0051_skill_lifecycle.ts:25` — the header says "IDEMPOTENT: static DDL only". The SQL is not re-runnable: `ADD COLUMN` throws "duplicate column" on a second raw exec. The spec itself asserts this (`0051_skill_lifecycle.spec.ts`, last test). Exactly-once is guaranteed by the runner, not by the SQL (`migration-runner.ts` `applyOne` runs inside BEGIN IMMEDIATE, and `applyAll` skips versions already in `schema_migrations`). The comment should say "exactly-once via the runner", not "idempotent". This is a misleading comment only.
2. `0051_skill_lifecycle.ts:20` — "`rejected` defaults to 0 counters for rejected candidate rows" is garbled wording. The column is a count of candidates rejected by the purge.
3. `0051_skill_lifecycle.spec.ts` registry test: `expect(entry?.sql).toBe(sql0051SkillLifecycle)` compares an import against itself through the registry. It only proves wiring, not content, which is acceptable. The behavioural tests carry the real regression value.
4. `PRAGMA user_version` is written as the version just applied (`migration-runner.ts` `applyOne`). If TASK_580's 0050 later applies on a DB already at 51, `user_version` drops 51 to 50. No code reads `user_version` for gating: `sqlite-connection.service.ts:514` already documents that it "may skip", and the RPC type is informational. No action needed. Note it for the 580 merge.

### Focus answers

1. SQL correctness. The three `ADD COLUMN ... TEXT` statements are nullable with no DEFAULT, NOT NULL or CHECK, which is valid for SQLite ALTER and matches the 0036/0040 precedent. Existing rows read NULL. The spec seeds a legacy row and asserts that. No existing reader of `skill_suggestions` breaks, because the columns are additive and nothing in the repo uses `SELECT *` positionally against them. `CREATE TABLE IF NOT EXISTS skill_backlog_purge_state` with `id INTEGER PRIMARY KEY CHECK (id = 1)` enforces the single row. The spec proves it: id=2 throws /CHECK/, and the default for `rejected` is 0. Re-run behaviour matches the runner contract above. A failure mid-way rolls back all four statements, so there is no partial schema.
2. Coexistence with 0050. `applyAll` computes `pending = sorted.filter(!applied.has(version))`, so a DB at 51 still applies a later 0050, and the loop skips only versions in the applied set. The refuse-downgrade check compares `dbMaxVersion` to `bundledMaxVersion`, which stays 51 and is unaffected. The 0051 spec's "follows version 49" test uses `toContain(49)` and `max == 51`, so it is unaffected by inserting 50. The `<= 49` setup helper excludes 0050, so the spec does not depend on it. The 12 bumped specs assert only `max == 51`, so they stay green with 0050 inserted.
3. Column match. The names, types and nullability agree with batches.md lines ~122-124 and the plan lines 254-261. The later consumers (`merged_into`, `promoted_candidate_id`, `references_json`, and the purge-state `cutoff_created_at` / `completed_at` / `rejected`) need no further migration. Batch 4 already handles a missing table (batches.md:91).
4. 0051 spec quality. It builds a real v<=49 schema from `MIGRATIONS`. It seeds a pre-existing row. It checks PRAGMA table_info metadata. It checks the CHECK rejection. It checks the duplicate-column replay. A regression such as dropping a column, adding NOT NULL or a default, widening the CHECK, or breaking the table would fail it. The binding-load test fails instead of skipping.
5. R-a and R-b. All 12 asserts are 51, with no stray 50 or 49 asserts in the bumped files. 0044 and 0046 keep their multi-line `toBe(\n 51,\n)` form. The 12 added `// 51 since TASK_2026_578 ...` comments sit directly under the TASK_2026_563 comment line.

### Five logic questions (brief)

1. Silent failure: none found. A migration error throws with the version and name, and the transaction rolls back.
2. Unexpected user action: restoring a DB or a TASK_580 build with 0050 applies cleanly (see item 2).
3. Wrong-answer input: legacy rows read NULL by design. Later batches must treat NULL as "unmerged / no references".
4. Dependency failure: the pre-migration backup is non-fatal (runner). No vec dependency exists.
5. Missing: no index on `merged_into` / `promoted_candidate_id`. The plan does not query by them, so this is acceptable.


## Batch 3

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

Scope examined:
- `libs/backend/skill-synthesis/src/lib/types.ts`
- `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- `libs/backend/skill-synthesis/src/lib/skill-candidate.store.spec.ts`

Verification:
- `npx nx run @ptah-extension/skill-synthesis:test --testFile=skill-candidate.store.spec.ts --skip-nx-cache`: 1 suite passed, 98 tests passed, 0 skipped, 0 failed (13.6s).
- `npx nx run @ptah-extension/skill-synthesis:typecheck`: passed with exit code 0 (1m 1s).
- Workspace check on `listActiveOrderedByActivity`: 0 live callers in production code.

### Checkpoints & Focus Answers

1. **Re-entrant `inImmediateTransaction` (`skill-candidate.store.ts:710-731`):**
   - **Depth counter correctness:** `transactionDepth` is incremented on nested calls (`:712`) and decremented in `finally` (`:716`). The outermost call sets `this.transactionDepth = 1` (`:720`) and unconditionally resets `this.transactionDepth = 0` in its `finally` block (`:729`).
   - **Outer-only control:** Only depth 0 issues `BEGIN IMMEDIATE` and `COMMIT` or `ROLLBACK`. Nested calls run inline.
   - **Inner exception handling:** An exception in an inner call triggers the inner `finally` (decrementing depth) and propagates up to the outer `catch` block, issuing `ROLLBACK` and resetting depth to 0.
   - **Swallowed errors & savepoints:** SQLite `SAVEPOINT` is not used. If an inner closure swallows an error without rethrowing, statements executed before that error will NOT be rolled back and will commit when the outer transaction finishes. This is a design constraint clearly documented in the method docstring (`:700-709`).
   - **Engine compatibility:** `better-sqlite3` and `node:sqlite` behave consistently because depth tracking is maintained entirely within `SkillCandidateStore` rather than relying on driver-specific `db.inTransaction`.

2. **`promoteAtomically` with `COALESCE(@name, name)` (`skill-candidate.store.ts:499-582`):**
   - **Empty-slug rejection:** `options.name !== undefined && options.name.trim() === ''` is checked at `:522-526`, throwing before entering `inImmediateTransaction` or executing any SQL.
   - **Slug persistence:** `options.name ?? null` is bound to `@name`. `name = COALESCE(@name, name)` at `:557` updates `name` when provided and retains the original candidate name when `options.name` is undefined.
   - **UNIQUE collision handling:** If `@name` collides with an existing candidate name, SQLite throws a `UNIQUE constraint failed` error on the promotion `UPDATE`. Because this occurs inside `inImmediateTransaction`, the transaction catches it and issues `ROLLBACK`, restoring any prior demotion of `demotedResidentId`. Tested and verified at `skill-candidate.store.spec.ts:1191-1221`.

3. **`rejectIfStatus` Compare-and-Set (`skill-candidate.store.ts:684-698`):**
   - **Atomicity:** Uses a single `UPDATE skill_candidates SET status = 'rejected', rejected_at = ?, rejected_reason = ? WHERE id = ? AND status = ?`.
   - **Return value:** Returns `result.changes === 1`. If the row is not in `expected` status, no write occurs and `false` is returned.
   - **Lost race resolution:** If another process has already rejected or transitioned the candidate, the status check fails, leaving the first writer's `rejected_reason` and `rejected_at` untouched. Tested at `skill-candidate.store.spec.ts:1303-1322`.

4. **Slug-Based Reads (`skill-candidate.store.ts:443-469, 604-623, 1579-1604`):**
   - **`listActiveOrderedByDecayScore`:** Queries `skill_invocation_events WHERE skill_slug = ? ORDER BY invoked_at DESC LIMIT 1000`. The 1000-event limit ensures bounded memory and query execution. For heavily invoked skills, older events (>1000 invocations ago) have already decayed to near zero; such skills have high scores and are far from the demotion threshold, so the cap does not alter eviction order. Tested with suffix isolation at `skill-candidate.store.spec.ts:1123-1142`.
   - **`listInvocationEvents`:** Correctly maps `skill_invocation_events` to the wire `SkillInvocationRow` format (`skillId = candidateId`, `notes = source`, `succeeded = (r.succeeded === 1)`). Returns `[]` for unknown IDs or non-positive limits.
   - **`listPromotedLastUse`:** Executes a single `LEFT JOIN` on a subquery grouped by `skill_slug`. `COALESCE(e.max_invoked_at, c.promoted_at, c.created_at)` provides a complete fallback hierarchy: latest event -> promotion timestamp -> creation timestamp (which is non-null).
   - **Index utilization & N+1:** `idx_skill_inv_events_slug` on `skill_invocation_events(skill_slug)` exists (`0021_skill_invocation_events.ts:12`). However, `listActiveOrderedByDecayScore` queries `skill_invocation_events` in a loop per promoted resident candidate (N+1 query pattern).

5. **`getStats` Lifecycle Counts & RPC Semantics (`skill-candidate.store.ts:1638-1674`):**
   - **Conditional counts:** `active` and `dormant` require `status = 'promoted'`. `merged` requires `status = 'rejected' AND rejected_reason LIKE 'merged-into:%'`. `retired` requires `status = 'rejected' AND rejected_reason = 'retired:unused'`.
   - **Invocation counting:** `invocations` counts events in `skill_invocation_events` whose `skill_slug` matches a promoted skill's `name`.
   - **Semantic change:** Legacy `skill_invocations` table rows and events for unpromoted/rejected skills are no longer counted. In `skills-synthesis-rpc.handlers.ts:510, :700`, `totalInvocations` reflects this narrower definition, while `activeSkills` still maps to `stats.promoted` until Batch 11 switches it to `stats.active`.

6. **Task 3.6 Deletion (`skill-candidate.store.ts`):**
   - `listActiveOrderedByActivity` removed completely from `SkillCandidateStore`.
   - Workspace search confirmed zero production callers remain. Only a test mock property in `skill-promotion.service.spec.ts:103` remains, slated for removal in Batch 12.

7. **Spec Quality:**
   - 98 tests pass without cache. Test suites verify empty states, suffix collision isolation (`skill-suffix-2`), UNIQUE constraints with demotion rollback, re-entrant transaction depth and rollback propagation, race condition losses, and multi-tier fallback orders. Assertions are concrete and regression-sensitive.

---

### Five Logic Questions

#### 1. How does this fail silently?
- In `inImmediateTransaction` (`skill-candidate.store.ts:710-731`), if a nested function catches an error internally and swallows it without rethrowing, SQLite retains any uncommitted operations executed prior to the error. When the outer block completes successfully, it executes `COMMIT`, persisting partial changes without notifying the caller.

#### 2. What user action produces unexpected behaviour?
- Rapidly toggling or re-promoting a skill that is concurrently being retired or merged across processes: `rejectIfStatus` will cleanly reject the lost race by returning `false`, but upstream callers that do not inspect the return boolean could assume their status update succeeded.

#### 3. What input data produces a wrong answer?
- In `promoteAtomically` (`skill-candidate.store.ts:522`), if a caller supplies a slug containing leading/trailing whitespace (e.g. `' my-slug '`), it passes the `.trim() === ''` guard and is persisted as-is into `skill_candidates.name`, potentially mismatching normalized slugs from `SkillMdGenerator`.

#### 4. What happens when a dependency fails?
- If SQLite throws a disk I/O or lock error during `promoteAtomically`, `inImmediateTransaction` catches the error, triggers `this.db.exec('ROLLBACK')`, resets `transactionDepth = 0`, and rethrows to the caller, preventing state corruption.

#### 5. What is missing that the requirements never mentioned?
- A composite index on `skill_invocation_events(skill_slug, invoked_at DESC)`. While `idx_skill_inv_events_slug` exists, queries ordering by `invoked_at DESC LIMIT 1000` perform a temporary filesort on the filtered subset for each candidate.

---

### Failure Modes

#### F-1: Swallowed Inner Exception in Re-entrant Transaction
- **Trigger:** An inner callback invoked within `inImmediateTransaction` catches and swallows a DB error or validation failure instead of re-raising it.
- **Symptom:** Incomplete writes prior to the failure are committed by the outer transaction.
- **Evidence:** `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:710-731`.
- **Current handling:** Code documents that inner throws must propagate; no savepoints are created.
- **Recommendation:** Maintain strict discipline in store callers (Batches 6, 8, 9) to never catch-and-suppress inside transaction callbacks.

#### F-2: N+1 Execution in Decay Ordering
- **Trigger:** Calling `listActiveOrderedByDecayScore` when a substantial number of resident skills exist.
- **Symptom:** 1 query for promoted rows followed by N queries against `skill_invocation_events`.
- **Evidence:** `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:451-464`.
- **Current handling:** Prepared statement `eventTimes` is executed in a loop.
- **Recommendation:** In future performance refactors, batch event timestamps using a single query with `WHERE skill_slug IN (...)` or a window function.

---

### Blocking Issues

None.

### Serious Issues

None.

### Moderate and Minor Issues

- **MODERATE (`skill-candidate.store.ts:710-731`):** Pseudo-nested transaction depth tracking lacks SQLite `SAVEPOINT` support. Swallowed errors in inner calls lead to partial commits.
- **MODERATE (`skill-candidate.store.ts:451-464`):** N+1 query loop in `listActiveOrderedByDecayScore`. Bounded by resident cap, but scales with resident skill count.
- **MINOR (`skill-candidate.store.ts:522`):** `options.name` is validated against empty string via `.trim() === ''`, but the stored value is not trimmed before saving into `name = COALESCE(@name, name)`.
- **MINOR (`0021_skill_invocation_events.ts:12`):** Index `idx_skill_inv_events_slug` is single-column; adding `invoked_at DESC` would avoid sorting overhead for `LIMIT 1000` queries.
- **MINOR (`skill-candidate.store.ts:1659-1663`):** `invocations` subquery `skill_slug IN (SELECT name FROM skill_candidates WHERE status = 'promoted')` re-evaluates across all promoted names on each `getStats()` call.

---

### Data Flow

1. Entry: `promoteAtomically(id, options)` -> Validates transition and non-empty slug -> `inImmediateTransaction` -> Demotes resident if specified (asserts changes === 1) -> Promotes candidate and updates slug via `COALESCE(@name, name)` (asserts changes === 1) -> Fetches updated row -> `COMMIT` -> Exits `[OK]`.
2. Entry: `rejectIfStatus(id, expected, reason, rejectedAt)` -> Executes single atomic CAS `UPDATE` -> Evaluates `changes === 1` -> Returns boolean `[OK]`.
3. Entry: `listPromotedLastUse()` -> Executes `SELECT` with `LEFT JOIN` on grouped `skill_invocation_events` -> Computes `COALESCE(e.max_invoked_at, c.promoted_at, c.created_at)` -> Maps to `{ row, lastUsedAt }` -> Exits `[OK]`.
4. Entry: `getStats()` -> Executes single `SUM(CASE ...)` aggregation query over `skill_candidates` -> Executes count query over `skill_invocation_events` for promoted slugs -> Returns `SkillCandidateStats` -> Exits `[OK]`.

---

### Requirements Fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 3.1: Export reason constants (`MERGED_INTO_PREFIX`, `RETIRED_UNUSED_REASON`, `BACKLOG_PURGE_REASON`) | COMPLETE | None. Constants exported from `types.ts:24-26`. |
| Task 3.2: Re-entrant `inImmediateTransaction` & slug-aware `promoteAtomically` | COMPLETE | None. Handles UNIQUE collision rollback and empty slug check. |
| Task 3.3: Compare-and-set `rejectIfStatus` | COMPLETE | None. Single statement atomic CAS. |
| Task 3.4: Event-based reads by slug (`listActiveOrderedByDecayScore`, `listInvocationEvents`, `listPromotedLastUse`) | COMPLETE | None. Fallback hierarchy and limit semantics verified. |
| Task 3.5: Lifecycle counts in `getStats()` | COMPLETE | None. All lifecycle statuses and promoted invocations accounted for. |
| Task 3.6: Delete `listActiveOrderedByActivity` | COMPLETE | None. Method deleted; no live production callers. |

---

### Edge Cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Nested transaction throws | YES | Outer catch intercepts, issues ROLLBACK, resets depth | None |
| Nested transaction swallows error | NO | Changes remain in open transaction, committed by outer | Callers must propagate errors |
| Slug collision on promotion | YES | SQLite UNIQUE constraint throws, rolling back demotion | None |
| Empty or whitespace slug passed | YES | Pre-check throws before transaction | Whitespace padding not trimmed if non-empty |
| Concurrently rejected candidate | YES | `rejectIfStatus` matches 0 rows, returns `false`, preserves first reason | Callers must check return value |
| Promoted skill with zero invocations | YES | `listPromotedLastUse` falls back to `promoted_at`, then `created_at` | None |
| Legacy skill with null `promoted_at` | YES | `listPromotedLastUse` falls back to `created_at` | None |
| Suffixed `-2` slug invocations | YES | Read by exact slug equality, isolated from base slug | None |

---

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Any caller using `inImmediateTransaction` that swallows an error will commit unrolled-back statements due to lack of savepoints.
- What a robust implementation would add:
  1. Named savepoints for nested transaction levels.
  2. A composite index `(skill_slug, invoked_at DESC)` on `skill_invocation_events`.
  3. Single-query batching for decay scores across resident skills.
