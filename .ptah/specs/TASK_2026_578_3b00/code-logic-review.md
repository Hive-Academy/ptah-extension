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

## Batch 4

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

Scope examined:
- `libs/backend/skill-synthesis/src/lib/types.ts`
- `libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts`
- `libs/backend/skill-synthesis/src/lib/skill-suggestion.store.spec.ts`
- `libs/backend/skill-synthesis/src/lib/skill-registry.store.ts`
- `libs/backend/skill-synthesis/src/lib/skill-registry.store.spec.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.ts`
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.spec.ts`
- `libs/backend/skill-synthesis/src/lib/di/tokens.ts`
- `libs/backend/skill-synthesis/src/lib/di/register.ts`
- `libs/backend/skill-synthesis/src/lib/di/register.spec.ts`
- `libs/backend/skill-synthesis/src/lib/skill-curator.service.ts` (:602 only)
- `libs/backend/skill-synthesis/src/lib/skill-curator.service.spec.ts`
- `libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.spec.ts`

Verification:
- `npx nx run @ptah-extension/skill-synthesis:test --testFile=skill-suggestion.store.spec.ts`: 1 suite passed, 28 tests passed, 0 skipped, 0 failed.
- `npx nx run @ptah-extension/skill-synthesis:test --testFile=skill-backlog-purge-state.store.spec.ts`: 1 suite passed, 6 tests passed, 0 skipped, 0 failed.
- `npx nx run @ptah-extension/skill-synthesis:test --testFile=skill-registry.store.spec.ts`: 1 suite passed, 15 tests passed, 0 skipped, 0 failed.
- `npx nx run @ptah-extension/skill-synthesis:test --skip-nx-cache --maxWorkers=2`: 82 suites passed, 1 skipped (unrelated), 1649 tests passed, 0 failed.
- `npx nx run @ptah-extension/skill-synthesis:typecheck`: passed with exit code 0.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: passed with exit code 0; `libs/backend/skill-synthesis: 6 ok (baseline 6)`.

---

### Checkpoints & Focus Answers

1. **`SkillSuggestionStore` Lineage & Status Guards:**
   - **`parseReferences` (`skill-suggestion.store.ts:342-382`):**
     Handles `null` by returning `[]`. JSON syntax errors are caught, logged with warning and row ID, and safely degraded to `[]`. Validates array payload and discards malformed entries (missing string `name` or `body`), logging the count of dropped items. Correct entries are mapped to `SkillReference[]`.
   - **`insert` & `insertPending` (`skill-suggestion.store.ts:75-125`):**
     Supports both `'pending'` and `'dismissed'`. When inserting with `'dismissed'`, sets `decided_at = createdAt`, ensuring rejected umbrella proposals remain recorded and deduplicated. Pre-insert references serialization handles optional references gracefully.
   - **Guarded `accept` & Concurrency:**
     `accept(id, promotedCandidateId)` delegates to `transition(id, 'accepted', promotedCandidateId)`. It retains the existing guard (`if (current.status !== 'pending') return current;`) and strengthens the underlying SQL with `WHERE id = ? AND status = 'pending'`.
     - *Caller impact:* Existing callers (`skill-curator.service.ts:602`, `digest/skill-gap-curator.service.spec.ts:506`, RPC accept handler) already guard or operate on pending suggestions (`skill-curator.service.ts:555` already returns `{ accepted: false, filePath: '' }` if `status !== 'pending'`). No caller depends on transitioning a non-pending suggestion.
     - *No-op accept handling:* A no-op accept on an already decided suggestion cleanly returns the row in its current status without executing an update or erroring, matching the store contract.
   - **`markMerged` (`skill-suggestion.store.ts:197-209`):**
     Deduplicates IDs via `[...new Set(ids)]`. Returns 0 immediately if the deduplicated array is empty. Uses parameterized `WHERE status = 'pending' AND id IN (${placeholders})` to only absorb pending suggestions into `umbrellaId` and returns `changes`. Runs as a single statement safe inside `inImmediateTransaction`.
   - **`listMemberCandidateIds` (`skill-suggestion.store.ts:216-243`):**
     Accepts optional status filter. Returns an empty `Set` immediately if `filter.statuses` is empty `[]`. Parameterizes `IN (${placeholders})` for non-empty status filters. Safely parses `member_candidate_ids` using `parseStringArray` and aggregates into a `Set<string>`.
   - **`listAcceptedWithoutPromotedCandidate` (`skill-suggestion.store.ts:249-258`):**
     Queries `WHERE status = 'accepted' AND promoted_candidate_id IS NULL ORDER BY decided_at ASC, id ASC`, correctly identifying unlinked accepted suggestions for startup reconciliation.

2. **`SkillRegistryStore.remove` (`skill-registry.store.ts:196-208`):**
   - Scoped deletion defaults to `onlyCloneStatus: CloneStatus = 'synth'`.
   - Guaranteed protection: `DELETE ... WHERE kind = ? AND slug = ? AND clone_status = ?` leaves `authored` and `diverged` entries untouched.
   - Respects `kind`, preventing accidental cross-kind deletions when a skill and an agent share a slug.
   - Returns boolean `changes === 1`. Single atomic statement; does not open its own transaction.

3. **`SkillBacklogPurgeStateStore` (`skill-backlog-purge-state.store.ts:1-96`):**
   - **Degradation in `read()`:** Catches missing table (pre-0051 DB) or closed connection errors, logs a warning with error details, and returns `null`. This informs the purge runner to skip cleanly without raising unhandled errors to the curator.
   - **First-writer-wins in `markComplete()`:** Uses `INSERT INTO skill_backlog_purge_state (id, cutoff_created_at, completed_at, rejected) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING`. Returns `changes === 1`.
   - **Error propagation (R-f, R-f2):** `markComplete()` does NOT catch exceptions. When executed within an `inImmediateTransaction` callback, any DB failure propagates upward, triggering an automatic rollback of the enclosing transaction.

4. **DI Token & Singleton Registration (`tokens.ts`, `register.ts`, `register.spec.ts`):**
   - Registered under `SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_PURGE_STATE_STORE` with `Symbol.for('PtahSkillBacklogPurgeStateStore')`.
   - Registered as singleton alias using `{ useToken: SkillBacklogPurgeStateStore }`.
   - `SkillBacklogPurgeStateStore` has explicit `@inject(TOKENS.LOGGER)` and `@inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)`.
   - Unit tests in `register.spec.ts` assert singleton resolution and token description uniqueness.

5. **Degradation-Audit Markers:**
   - Valid suppression markers present in `skill-suggestion.store.ts:348` and `skill-backlog-purge-state.store.ts:69`.
   - Both catch blocks log informative warnings via `this.logger.warn(...)`.
   - Degradation audit script exited with code 0 (`libs/backend/skill-synthesis: 6 ok (baseline 6)`).

6. **Spec Quality:**
   - Specs use `resolveOpener()` to run on `better-sqlite3` or `node:sqlite`.
   - `skill-backlog-purge-state.store.spec.ts` includes both SQLite-backed integration tests and isolated non-SQLite degradation unit tests that verify throw-propagation and closed-connection degradation.
   - 100% test pass rate across all modified test files with real DDL migrations (`0022`, `0023`, `0025`, `0051`).

---

### Five Logic Questions

#### 1. How does this fail silently?
- In `SkillSuggestionStore.markMerged(ids, umbrellaId)` (`skill-suggestion.store.ts:197-209`), if any ID in `ids` does not exist or has already been transitioned to `accepted` or `dismissed`, it is ignored by the `WHERE status = 'pending'` clause. The method returns `changes`, but callers that do not verify `changes === unique.length` would silently miss that certain members were not merged.
- In `SkillSuggestionStore.parseReferences` (`skill-suggestion.store.ts:342-382`), corrupt JSON or malformed reference objects are warned and dropped to `[]`, leaving the suggestion visible and usable without failing the entire query.

#### 2. What user action produces unexpected behaviour?
- Rapidly or concurrently accepting a suggestion from multiple UI tabs while a merge or purge pass is running: `accept()`'s CAS condition `WHERE id = ? AND status = 'pending'` prevents double-transitions, but returns the already-accepted/dismissed row without throwing, which could lead an uncoordinated client to believe it was the initiator.

#### 3. What input data produces a wrong answer?
- In `SkillSuggestionStore.markMerged(ids, umbrellaId)` (`skill-suggestion.store.ts:197`), if a caller accidentally includes `umbrellaId` within the `ids` array, the umbrella suggestion itself matches `WHERE id IN (...) AND status = 'pending'` and marks itself dismissed with `merged_into = umbrellaId`.

#### 4. What happens when a dependency fails?
- If SQLite throws due to a missing `skill_backlog_purge_state` table or connection drop during `SkillBacklogPurgeStateStore.read()`, the error is caught, logged, and `null` is returned, allowing the purge runner to skip safely.
- If SQLite throws during `markComplete()`, the error is not caught, allowing the outer `inImmediateTransaction` to intercept the failure and roll back all changes atomically.

#### 5. What is missing that the requirements never mentioned?
- Defensive self-exclusion in `markMerged`: filtering out `umbrellaId` from `ids` (`unique.filter((id) => id !== umbrellaId)`).
- A covering index on `skill_suggestions(status, promoted_candidate_id)` for `listAcceptedWithoutPromotedCandidate`. Given typical suggestion table sizes, table scans are fast, but as suggestions accumulate over months, an index would be optimal.

---

### Failure Modes

#### F-1: Accidental Self-Merge in `markMerged`
- **Trigger:** Calling `markMerged(memberIds, umbrellaId)` where `memberIds` contains `umbrellaId`.
- **Symptom:** The new umbrella suggestion is immediately transitioned to `dismissed` with `merged_into` pointing to itself.
- **Evidence:** `libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts:197-209`.
- **Current handling:** `unique` dedupes `ids`, but does not filter out `umbrellaId`.
- **Recommendation:** Add `.filter((id) => id !== umbrellaId)` before building SQL placeholders in `markMerged` (or ensure callers in Batch 8 enforce strict disjointness).

---

### Blocking Issues

None.

### Serious Issues

None.

### Moderate and Minor Issues

- **MODERATE (`skill-suggestion.store.ts:198`):** `markMerged` does not filter out `umbrellaId` from `ids`. If a caller includes the umbrella's ID among member IDs, the umbrella row marks itself as dismissed.
- **MINOR (`skill-suggestion.store.ts:250-258`):** `listAcceptedWithoutPromotedCandidate` performs a full table scan on `skill_suggestions` without an index on `(status, promoted_candidate_id)`.
- **MINOR (`skill-suggestion.store.ts:226-235`):** `listMemberCandidateIds` uses `WHERE status IN (...)` where status strings are case-sensitive; relies entirely on domain caller using typed lowercase enum values.

---

### Data Flow

1. Entry: `insert(input, status)` -> Generates ULID & timestamps -> Serializes references -> Executes parameterized INSERT -> Re-reads and returns `SkillSuggestionRow` `[OK]`.
2. Entry: `accept(id, promotedCandidateId)` -> Calls `transition()` -> Finds existing -> Asserts status is pending -> Executes parameterized UPDATE with `AND status = 'pending'` -> Re-reads row -> Exits `[OK]`.
3. Entry: `markMerged(ids, umbrellaId)` -> Deduplicates IDs -> Evaluates non-empty -> Executes UPDATE `WHERE status = 'pending' AND id IN (...)` -> Returns count of changed rows `[OK]`.
4. Entry: `listMemberCandidateIds(filter)` -> Parameterizes status check if provided -> Queries member candidate JSON -> Parses JSON arrays -> Assembles distinct `Set<string>` `[OK]`.
5. Entry: `listAcceptedWithoutPromotedCandidate()` -> Queries `WHERE status = 'accepted' AND promoted_candidate_id IS NULL` -> Maps via `toRow` -> Exits `[OK]`.
6. Entry: `remove(kind, slug, onlyCloneStatus)` -> Executes DELETE `WHERE kind = ? AND slug = ? AND clone_status = ?` -> Evaluates `changes === 1` -> Returns boolean `[OK]`.
7. Entry: `SkillBacklogPurgeStateStore.read()` -> Prepares SELECT -> Catches connection/table errors -> Logs warn & returns null on failure -> Maps row `[OK]`.
8. Entry: `SkillBacklogPurgeStateStore.markComplete(state)` -> Executes INSERT `ON CONFLICT(id) DO NOTHING` -> Does not catch errors -> Returns `changes === 1` `[OK]`.

---

### Requirements Fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 4.1: Suggestion lineage types (`SkillReference`, `mergedInto`, `promotedCandidateId`, `references`) | COMPLETE | None. Domain model and row interfaces fully defined. |
| Task 4.2: `SkillSuggestionStore` lineage API (`insert`, `accept`, `markMerged`, `listMemberCandidateIds`, `listAcceptedWithoutPromotedCandidate`, references parsing) | COMPLETE | None. All methods implemented, tested, and guarded. |
| Task 4.3: `SkillRegistryStore.remove` scoped to `'synth'` by default | COMPLETE | None. Authored and diverged protected; kind match verified. |
| Task 4.4: `SkillBacklogPurgeStateStore` (`read` degrade, `markComplete` atomic CAS) | COMPLETE | None. First writer wins; errors propagate per R-f2. |
| Task 4.5: DI token & singleton registration for purge-state store | COMPLETE | None. Registered, token description unique, verified in spec. |

---

### Edge Cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Corrupt `references_json` in DB | YES | `parseReferences` catches parse error, logs warn with ID, returns `[]` | None |
| Non-array `references_json` in DB | YES | Warns and returns `[]` | None |
| Array with malformed reference elements | YES | Filters out invalid elements, logs dropped count, keeps valid items | None |
| Empty ID list passed to `markMerged` | YES | Returns 0 immediately before executing SQL | None |
| Duplicate IDs passed to `markMerged` | YES | Deduplicated via `new Set(ids)` before placeholder generation | None |
| Calling `markMerged` on already accepted row | YES | Guarded by `AND status = 'pending'`, row left untouched | None |
| Empty status filter in `listMemberCandidateIds` | YES | Returns empty `Set` immediately | None |
| Pre-0051 DB (table missing) in `purgeState.read()` | YES | Caught in `try/catch`, logs warn, returns `null` | None |
| Database error during `purgeState.markComplete()` | YES | Not caught; propagates to enclosing `inImmediateTransaction` | None |
| Concurrent purge runs | YES | `ON CONFLICT(id) DO NOTHING` lets first writer win (`changes === 1`) | None |
| Removing non-synth registry row | YES | Default `clone_status = 'synth'` ensures authored/diverged return `false` | None |
| Cross-kind slug collision in `registry.remove` | YES | `WHERE kind = ? AND slug = ?` matches exact kind | None |

---

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: In `markMerged`, callers must ensure the newly created `umbrellaId` is not inadvertently included in the member `ids` list to prevent self-dismissal.
- What a robust implementation would add:
  1. An explicit self-exclusion guard `unique.filter((id) => id !== umbrellaId)` in `SkillSuggestionStore.markMerged`.
  2. A composite SQLite index on `skill_suggestions(status, promoted_candidate_id)`.

## Batch 5

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

Scope examined:
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts`
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.spec.ts`
- `libs/backend/skill-synthesis/src/lib/cosine-similarity.ts`
- `libs/backend/skill-synthesis/src/lib/cosine-similarity.spec.ts`
- `libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts`
- `libs/backend/skill-synthesis/src/lib/skill-clustering.service.spec.ts`
- `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.ts`
- `libs/backend/skill-synthesis/src/lib/skill-synthesizer.service.spec.ts`

Verification:
- `npx nx run @ptah-extension/skill-synthesis:typecheck`: passed cleanly with exit code 0 (43.6s).
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2`: 83 test suites passed, 1 skipped; 1709 tests passed, 0 failed (1m 17s).
- Old paths (`clusterCandidates`, `synthesizeFromCluster`, `buildClusterPrompt`) remain intact and covered by passing tests (R-d).
- Track B prompt surface (`buildSystemPrompt`) pinned and asserted byte-for-byte in snapshot spec (R-l).

---

### Checkpoints & Focus Answers

1. **Task 5.1: `SkillMdGenerator` Slug Collision & References (`skill-md-generator.ts:220-318`):**
   - **Occupied check:** Slug occupancy evaluates `occupied = (slug) => fs.existsSync(path.join(root, slug)) || isSlugTaken(slug)`. When `isSlugTaken(baseSlug)` is true despite no directory on disk, it walks `-2..-5` and creates the first unoccupied suffixed directory.
   - **Walk & collision exhaustion:** For `attempt` from 2 up to `MAX_SLUG_RETRIES` (5), if all attempts through `-5` are occupied, it throws `[skill-synthesis] slug collision: ${baseSlug} (tried up to -5)` at attempt 6, preserving the exact previous retry limit and error format.
   - **Reference validation & containment (R-k):** `validateReferences` runs before any filesystem mutation (`fs.mkdirSync` or `fs.writeFileSync`). It checks `SKILL_REFERENCE_NAME_PATTERN` (`/^[a-z0-9][a-z0-9-]{0,59}$/`) and rejects path-traversal inputs (`../x`, `a/b`, `a\b`) as well as uppercase and empty strings before touching the disk.
   - **Duplicate references:** Duplicate reference names are rejected in `validateReferences` via a `Set`, preventing accidental overwrites.
   - **Directory cleanup:** `removeActive` calls `fs.rmSync(materialized.dir, { recursive: true, force: true })`, completely removing the skill directory and its `references/` subdirectory.
   - **Partial-write evaluation:** Because `validateReferences` runs prior to directory creation, malformed or duplicate reference inputs cannot leave a half-written skill directory. However, an unhandled I/O error during writing of reference files after `SKILL.md` is written has no automatic filesystem rollback in `SkillMdGenerator`.

2. **Task 5.2: Union-Find `agglomerate` (`cosine-similarity.ts:37-69`):**
   - **Signature & linkage:** Keeps exact signature `agglomerate(embeddings: Float32Array[], threshold: number): number[]`. Implements single-linkage equivalence partitioning via union-find in a single $O(n^2 \cdot d)$ pairwise sweep.
   - **Strict threshold:** Correctly evaluates `if (cosineSimilarity(...) <= threshold) continue;`, guaranteeing strict `> threshold` linkage. Degenerate zero-norm vectors return 0 in `cosineSimilarity` (`:21`) and are not merged.
   - **Label stability (A3):** Implements union-by-smaller-root (`if (rootI < rootJ) parent[rootJ] = rootI; else parent[rootI] = rootJ;`). The representative root for each connected component is guaranteed to be the lowest member index in discovery order.
   - **Chain connectivity:** An indirect chain $a \sim b$ and $b \sim c$ with $a \not\sim c$ merges into a single component with label 0.
   - **Regression safety:** All pre-existing spec cases in `cosine-similarity.spec.ts` and downstream `skill-cluster-dedup.service.spec.ts` remain green with no weakened assertions.

3. **Task 5.3: `SkillClusteringService.partitionPool` (`skill-clustering.service.ts:99-178`):**
   - **Fail-open on missing vec:** When `!this.vecStatus.available`, returns `{ vecAvailable: false, truncated: false, clusters: [], orphans: [], unembedded: 0 }` without performing database queries.
   - **Pool composition & ordering:**
     1. Candidate rows: retrieved newest-first via `store.listByStatus('candidate')`, filtered against `exclusions.suggestionMemberIds`, and capped at `settings.suggestionMaxCandidates`. When `eligible.length > cap`, `truncated` is set to `true`.
     2. Suggestion rows: retrieved via `suggestionStore.listByStatus('pending')`, embedded as the centroid of member embeddings via `centroidOf`.
     3. Promoted rows: retrieved via `store.listByStatus('promoted')`, excluding pinned rows and `exclusions.exemptSlugs`.
   - **Centroid math:** `centroidOf` computes vector sum and averages by count. Returns `null` on empty members or missing embeddings. Mismatched vector dimensions are skipped safely (`vec.length !== sum.length`). Scale invariance of cosine similarity avoids normalization overhead.
   - **DI wiring:** Injects `SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE` with explicit `@inject`.
   - **Component classification:** Partitions connected components into `clusters` (size $\ge$ `suggestionMinClusterSize`) and `orphans` (smaller components).

4. **Task 5.4: `SkillSynthesizerService.synthesizeUmbrella` (`skill-synthesizer.service.ts:281-344`):**
   - **Prompt isolation (R-l):** Uses dedicated constant `UMBRELLA_SYSTEM_PROMPT`. `buildSystemPrompt` is completely untouched and pinned byte-for-byte in tests.
   - **Boundary validation (R-k):** `UmbrellaSkillSchema` parses and validates output with Zod: reference names must match `SKILL_REFERENCE_NAME_PATTERN`, reference bodies must be 1..20,000 characters, duplicate names are rejected, and references default to `[]`.
   - **Member clipping & ceiling:** Accepts up to `UMBRELLA_MAX_MEMBERS = 12` members; member bodies are clipped by `CLUSTER_MEMBER_MAX_CHARS` (3,000 chars) for prompt fairness.
   - **Generalized synthesis execution:** `runSynthesis` parameterised by schema and JSON parser. Existing per-session and cluster synthesis paths preserve identical behaviour and error-handling.
   - **Non-success handling:** Returns `null` on lane failure, parse failure, timeout, or empty cluster without throwing.

---

### Executor-Declared Deviations Evaluation

1. **`PoolMember` carries `embedding` (`skill-clustering.service.ts:43-52`):**
   - **Verdict:** ACCEPTED.
   - **Rationale:** Storing the calculated or retrieved `Float32Array` directly on each `PoolMember` prevents downstream consumers (such as `SkillUmbrellaMergeService` in Batch 8 sorting members by distance to cluster centroid) from re-querying SQLite or recalculating centroids.

2. **Duplicate reference names rejected (`skill-md-generator.ts:310-314`, `skill-synthesizer.service.ts:115-118`):**
   - **Verdict:** ACCEPTED.
   - **Rationale:** If multiple references had the same filename, `fs.writeFileSync` would overwrite earlier files, resulting in silent data loss. Refusing duplicates at both the Zod boundary and filesystem boundary enforces data integrity.

3. **`UMBRELLA_SKILL_JSON_SCHEMA` marks `references` required while Zod defaults it (`skill-synthesizer.service.ts:120, 147`):**
   - **Verdict:** ACCEPTED.
   - **Rationale:** Requesting the field explicitly in the JSON schema guides LLMs to return `references: []` when no variants exist, while the Zod `.default([])` gracefully handles models that omit the key.

4. **`UmbrellaMemberInput.kind` is a local union (`skill-synthesizer.service.ts:213-217`):**
   - **Verdict:** ACCEPTED.
   - **Rationale:** A localized union type (`'candidate' | 'promoted' | 'suggestion'`) avoids unnecessary coupling between the synthesizer and store/clustering row types.

5. **Exclusions passed by caller (`skill-clustering.service.ts:55-60, 100`):**
   - **Verdict:** ACCEPTED.
   - **Rationale:** Passing exclusions from the orchestrating caller avoids coupling `SkillClusteringService` to `SkillRegistryStore`, keeping clustering focused solely on geometric partitioning.

---

### Five Logic Questions

#### 1. How does this fail silently?
- In `SkillMdGenerator.writeAtRoot` (`skill-md-generator.ts:250-291`), if an unhandled disk I/O error or process abort occurs while writing reference files after `SKILL.md` has already been written, the skill directory is left on disk in a partially populated state without an internal compensating rollback.
- In `SkillClusteringService.centroidOf` (`skill-clustering.service.ts:239-255`), member vectors with differing vector dimensions are silently skipped without a warning log.

#### 2. What user action produces unexpected behaviour?
- Manually creating conflicting directories `foo`, `foo-2`, `foo-3`, `foo-4`, `foo-5` in the active skills directory: subsequent promotion of candidate `foo` exhausts all 5 suffix attempts and throws a fatal slug collision error.

#### 3. What input data produces a wrong answer?
- In `SkillClusteringService.partitionPool`: If candidate rows have zero-norm embeddings or if member embeddings cancel each other out to vector $\vec{0}$, `cosineSimilarity` returns 0 for those pairs, treating them as dissimilar rather than corrupt.

#### 4. What happens when a dependency fails?
- If `VecStatusService.available` is `false`: `SkillClusteringService.partitionPool` immediately returns `{ vecAvailable: false, truncated: false, clusters: [], orphans: [], unembedded: 0 }` without performing DB operations or throwing.
- If `LaneRunnerService.run` throws, times out, or returns a non-success status: `SkillSynthesizerService.runSynthesis` logs a warning and returns `null`.

#### 5. What is missing that the requirements never mentioned?
- Internal compensating cleanup in `SkillMdGenerator` if `fs.writeFileSync` throws while writing reference documents (higher-level callers like `SkillPromotionService` must handle directory removal on exception).

---

### Failure Modes

#### F-1: Partial Materialization Directory on Reference Write I/O Failure
- **Trigger:** Disk full (ENOSPC), permissions error (EACCES), or process termination while writing references inside `writeAtRoot` after `SKILL.md` is written.
- **Symptom:** Incomplete skill directory on disk containing `SKILL.md` and a subset of `references/` files.
- **Evidence:** `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:275-285`.
- **Current handling:** Input validation (`validateReferences`) runs first so invalid names do not create partial directories. However, filesystem write operations are not wrapped in a `try/catch` with compensating `removeActive`.
- **Recommendation:** Upper-level callers in Batch 6 (`SkillPromotionService`) must catch promotional write failures and invoke `removeActive` (addressed by design in Batch 6 plan R-f2).

---

### Blocking Issues

None.

### Serious Issues

None.

### Moderate and Minor Issues

- **MODERATE (`skill-md-generator.ts:275-285`):** `writeAtRoot` creates the directory and `SKILL.md` before writing reference files. An I/O error during reference writing leaves the created directory behind.
- **MINOR (`skill-clustering.service.ts:249`):** `centroidOf` silently ignores members with mismatched embedding dimensions via `continue` without logging a warning.
- **MINOR (`skill-synthesizer.service.ts:285`):** `synthesizeUmbrella` takes `members.slice(0, UMBRELLA_MAX_MEMBERS)` without validating that the caller sorted members by centroid distance.

---

### Data Flow

1. **Promotion Materialization Entry:** `promoteToActive(input, candidatesDir, options)` -> Validates reference names and uniqueness upfront -> Resolves active root -> Iterates `occupied(chosen)` checking disk and `isSlugTaken` -> Suffixes `-2..-5` (throws if exhausted) -> Creates directory and writes `SKILL.md` -> Writes valid `references/*.md` -> Logs success -> Returns `MaterializedSkill` `[OK]`.
2. **Agglomerative Clustering Entry:** `agglomerate(embeddings, threshold)` -> Initializes union-find array -> Computes pairwise cosine similarity -> Unifies components under lower index when similarity strictly `> threshold` -> Returns mapped roots `[OK]`.
3. **Lifecycle Pool Partition Entry:** `partitionPool(settings, exclusions)` -> Checks `vecStatus.available` (returns early if false) -> Queries candidate rows, filters excluded suggestion members, caps at `suggestionMaxCandidates` (tracks `truncated`) -> Reads embeddings -> Queries pending suggestions and computes centroids -> Queries non-pinned, non-exempt promoted rows -> Agglomerates pool embeddings -> Splits components into `clusters` ($\ge$ `minClusterSize`) and `orphans` -> Returns `PoolPartition` `[OK]`.
4. **Umbrella Synthesis Entry:** `synthesizeUmbrella(members, origin)` -> Validates non-empty input -> Slices up to 12 members -> Builds prompt with member kinds and clipped bodies -> Invokes lane runner with `UMBRELLA_SYSTEM_PROMPT` and `UMBRELLA_SKILL_JSON_SCHEMA` -> Extracts JSON -> Parses through `UmbrellaSkillSchema` (validating reference names and body lengths) -> Returns `UmbrellaSkill` or `null` `[OK]`.

---

### Requirements Fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 5.1: `SkillMdGenerator` DB-aware slug & references | COMPLETE | None. DB check, suffix walk, reference validation, and cleanup verified. |
| Task 5.2: Union-find `agglomerate` with stable lowest-index labels | COMPLETE | None. $O(n^2 \cdot d)$ sweep, strict $>$, and label stability (A3) verified. |
| Task 5.3: `SkillClusteringService.partitionPool` | COMPLETE | None. Pool ordering, exclusions, suggestion centroids, truncation, and DI verified. |
| Task 5.4: `SkillSynthesizerService.synthesizeUmbrella` | COMPLETE | None. System prompt isolation (R-l), Zod schema (R-k), member clipping, and null fail-soft verified. |
| Risk R-d: Preservation of legacy clustering and synthesis methods | COMPLETE | `clusterCandidates`, `synthesizeFromCluster`, and `buildClusterPrompt` remain intact. |
| Risk R-k: Reference name path-traversal prevention | COMPLETE | Validated at Zod boundary and re-checked at filesystem boundary. |
| Risk R-l: Track B prompt preservation | COMPLETE | `buildSystemPrompt` unchanged and pinned by snapshot spec. |

---

### Edge Cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Slug claimed in DB but not on disk | YES | `isSlugTaken` flags slug as occupied, triggers suffixing | None |
| All 5 slug retry attempts occupied | YES | Throws collision error on attempt 6 | None |
| Reference name containing `../` or `/` | YES | Rejected by regex at Zod and FS boundaries before write | None |
| Duplicate reference names in synthesis | YES | Refined in Zod schema and Set in `validateReferences` | None |
| Vec extension unavailable | YES | Returns `{ vecAvailable: false, ... }` without querying | None |
| Suggestion with zero embedded members | YES | `centroidOf` returns `null`; counted in `unembedded` | None |
| Chained similarity $a \sim b \sim c$ | YES | Unified into single component with label = lowest index | None |
| Synthesis lane timeout or malformed JSON | YES | Catches/validates and returns `null` safely | None |

---

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Unhandled disk write failure during reference writing in `SkillMdGenerator` leaves a partial directory on disk if caller does not clean up.
- What a robust implementation would add:
  1. A `try/catch` block wrapping file writes in `SkillMdGenerator.writeAtRoot` to invoke `fs.rmSync(dir, { recursive: true, force: true })` on write failures.
  2. A warning log in `SkillClusteringService.centroidOf` when member embedding dimensions mismatch.


## Batch 7

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Minor issues        | 3        |
| Failure modes found | 3        |

Scope examined (uncommitted Batch 7 changes only; Batch 5 files in the tree were excluded):
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts` (NEW, read in full)
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.spec.ts` (NEW, read in full)
- `libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `di/register.ts`, `di/register.spec.ts` (uncommitted diff, read in full)
- Contract reads: `skill-candidate.store.ts` (`listPromotedLastUse` :604-623, `setResidency` :476-488, `rejectIfStatus` :684-698, `inImmediateTransaction` :710-731), `skill-registry.store.ts` (`listAll` :108-114, `remove` :196-208), `skill-md-generator.ts` (`activeRoot` :165-167, `removeActive` :259-268), `skill-promotion.service.ts:502-519` (settings precedent), `platform-core/file-settings-keys.ts:245-246,536-537` (A6)

Verification:
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-retirement`: 1 suite, 15/15 passed (20s).
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=register`: passed (25s, includes the new singleton test).
- `npx nx run @ptah-extension/skill-synthesis:typecheck`: passed (39.4s, exit 0).

---

### Five logic questions

#### 1. How does this fail silently?

- A row whose `bodyPath` fails the containment check at idle >= N+M is removed from no result count (`retire()` returns `false` at `skill-retirement.service.ts:205`, the row is in none of `retired`/`dormant`/`skippedPinned`/`skippedExempt`) — the only signal is a per-pass warn (`:243-251`). See MODERATE-2.
- A repropagation failure is warned and the committed residency change stands (`:349-355`); this is by design (next activation's reconcile heals it, documented at `:330-334`) — not a defect, but the caller's result never reflects a partially propagated pass.
- A registry read failure makes the pass return `EMPTY_RESULT` (`:102`) — indistinguishable from a no-op pass except by the warn log (`:288-291`). See MINOR-1.

#### 2. What user action produces unexpected behaviour?

- Hand-editing either settings key to anything that is not a whole number in 1..3650 (0, 30.5, "thirty") falls back to 30 with a warn (`:301-327`, spec `:358-383`). Expected per spec; the warn names the key and value.
- A user authoring or diverging a skill mid-pass (after `readExemptSlugs` ran) leaves it non-exempt for that pass; the `registry.remove` `clone_status='synth'` guard (`skill-registry.store.ts:196-208`) is the defence in depth the plan names (`implementation-plan.md:745-747`). Narrow, self-limiting, accepted by the plan.
- Pinning a skill at day 100 keeps it untouched and counted as `skippedPinned` (`:116-119`, spec `:274-289`).

#### 3. What input data produces a wrong answer rather than an error?

- `now < lastUsedAt` (clock-skewed future-dated invocation events): `idleDays` is negative, `idleDays < dormantAfterDays` skips the row (`:114-115`) — safe, no retirement on skew.
- A `name` of `''` or `'..'` in a corrupted row: containment requires `row.name.length > 0`, `relative === row.name` and `!relative.startsWith('..')` (`:236-241`) — the root itself and `..`-escapes are refused. Redundant clauses, but the `..` clause closes an otherwise valid-looking path.
- A `bodyPath` outside the active root or under a foreign basename: refused with a warn, row never retired (spec `:333-356`). Correct per R-j — see MODERATE-2 for the counting gap only.

#### 4. What happens when a dependency fails?

- Registry not bound: pinned-only exemption after a warn (`:268-273`) — the plan's specified fail-soft shape (`implementation-plan.md:791-792`). Sound because with no registry bound there are no `authored`/`diverged` rows this library can know about.
- Registry bound but `listAll()` throws: the whole pass is skipped (`:287-294` -> `:102`) — the executor's deviation (2), accepted below.
- `registry.remove` throws inside the transaction: the whole unit rolls back (callback has no catch, `:207-216`; per-row catch wraps the `inImmediateTransaction` call at `:131`), the already-removed directory is re-removed idempotently next pass (`rmSync force`, `:254`) — R-f2 proven by spec `:396-422`.
- `rejectIfStatus` loses a race: transaction wrote nothing, registry row kept, not counted (`:217-223`, spec `:262-272`).
- Repropagation missing or throwing: skipped/warned, committed change stands (`:335-356`).
- Workspace missing or throwing: settings default 30 (`:302-303`), workspace root `''` with a debug log (`:359-370`).
- **The one uncontained dependency failure is `store.listPromotedLastUse()` at `:113`** — see MODERATE-1.

#### 5. What is missing that the requirements never mentioned?

Nothing material against the plan (`implementation-plan.md:727-810`); the component contract is fully implemented. The extras (deviations 1-5) are judged below. The only unrequested-but-consequential gap is the result's inability to represent "skipped pass" and "stuck row" states.

---

### Deviation decisions

| # | Deviation | Decision | Reason |
| - | --------- | -------- | ------ |
| 1 | Uncontained path leaves the row promoted with a warn instead of retiring it in the DB | **ACCEPT** | R-j is the HIGH risk precisely because retirement deletes a directory. A containment failure means `bodyPath` and the row disagree (migrated row, moved root); retiring the DB row then would either strand an active SKILL.md no row owns or delete a directory we could not prove is ours. Staying promoted/dormant with a per-pass warn is fail-safe, self-retrying and visible. The plan's own wording ("skip the filesystem step and warn") is ambiguous; this reading is the conservative one. Gap reduced to MODERATE-2 (counting only). |
| 2 | A registry read failure skips the whole pass rather than continuing with an empty exemption set | **ACCEPT** | Continuing with an empty exemption set could retire an `authored`/`diverged` skill — irreversible deletion of user-owned content. Skipping costs one pass and self-heals. The plan's fail-soft precedent (`:791-792`) covers only the *missing* registry, where no authored rows can exist; the *failing* registry is unspecified, and fail-closed is the only safe reading. Documented in-code at `:258-266`. |
| 3 | `removeMaterializations` returns the removed slugs | **ACCEPT** | Additive and useful: the Batch 9 accept path can know which materializations actually changed; rows whose removal failed are excluded from repropagation correctly (`:191`). |
| 4 | `SkillRegistryStore.remove` unchanged | **ACCEPT** | The plan's Revision-1 `remove(kind, slug, onlyCloneStatus='synth')` already landed in Batch 4 (commit bbd02ebf8) and matches the plan exactly: one plain parameterized guarded DELETE, `changes === 1` (`skill-registry.store.ts:196-208`). Nothing to change. |
| 5 | `fs.rmSync` directly with its own containment check instead of `mdGenerator.removeActive` | **ACCEPT** | The retirement path holds a row, not the `MaterializedSkill` that `removeActive` requires (`skill-md-generator.ts:259`), and `removeActive`'s check (`dir.startsWith(root + path.sep)`, `:262`) is *weaker* than R-j: no basename===slug check, no `..` refusal. The service's check (`relative === row.name && basename === row.name && !startsWith('..')`, `:236-241`) is strictly stronger and satisfies R-j exactly. Returning `false` instead of throwing also keeps `retire()`'s two outcomes clean. |

---

### Failure modes

#### FM1 — Unguarded aggregate read in `run()`

- Trigger: `store.listPromotedLastUse()` throws (connection closed during host teardown racing a curator pass, locked/corrupted DB file).
- Symptom: `run()` rejects with a store error; the caller gets an exception instead of a result. Every other dependency in the method is contained (registry `:275-292`, settings `:304-319`, per-row writes `:131-142`, repropagation `:349-355`, workspace root `:361-368`).
- Evidence: `skill-retirement.service.ts:113` — the only call outside any try/catch in `run()`.
- Current handling: none; propagates.
- Recommendation: wrap the loop input in the same per-pass containment shape (catch -> warn -> return `EMPTY_RESULT`), or rely on Batch 9's per-sub-pass try/catch explicitly and note it here. Impact today is bounded because Batch 9 Task 9.1 wraps each sub-pass; flagged Moderate for the broken fail-soft contract at this one seam, not Serious.

#### FM2 — Containment-failed row is stuck forever and invisible in the result

- Trigger: a promoted row whose `bodyPath` fails containment at idle >= N+M (host moved the active root via the Batch 5 `resolveSkillsRoot` key; imported row).
- Symptom: every pass warns (`:243-251`) and skips; the row can never retire, and the result counts it nowhere (`retire()` returns `false` at `:205`, no counter), so the Batch 9 report shows zero changes for a permanently stuck row.
- Evidence: `skill-retirement.service.ts:125-126`, `:242-253`.
- Current handling: warn per pass; DB untouched (correct direction — deviation 1 accepted).
- Recommendation: add a `skippedUncontained` counter to `SkillRetirementResult` and surface it in the curator report.

#### FM3 — Skipped pass indistinguishable from a no-op pass

- Trigger: registry bound but `listAll()` throws.
- Symptom: `run()` returns all-zero `EMPTY_RESULT` (`:102`); a caller logging only counts cannot tell "nothing was due" from "the pass refused to run".
- Evidence: `skill-retirement.service.ts:275-294`, `:67-74`, `:102`.
- Current handling: warn log only.
- Recommendation: a `skipped: true` field (or throwing the decision up to Batch 9's report shape) would make the fail-closed state observable without log grepping.

---

### Blocking issues

None.

### Serious issues

None.

### Moderate and minor issues

- **MODERATE (`skill-retirement.service.ts:113`):** `listPromotedLastUse()` is the one uncontained call in `run()` — a DB-level failure escapes the otherwise complete fail-soft contract (FM1). Bounded by Batch 9's per-sub-pass catch, but the seam is real for any other caller.
- **MODERATE (`skill-retirement.service.ts:125-126, :242-253`):** a row that can never satisfy containment is uncounted in the result and stuck forever; only the warn log tells anyone (FM2).
- **MINOR (`skill-retirement.service.ts:102`):** registry-read-failure skip returns `EMPTY_RESULT`, indistinguishable from a no-op pass (FM3).
- **MINOR (`skill-retirement.service.spec.ts`):** no case for a row already `residency='dormant'` at idle in [N, N+M) — the `row.residency === 'resident'` guard (`:127`) prevents a re-count/re-write but nothing pins it; and no case for a dormant row retiring at >= N+M (directory removal of a dormant row's materialization).
- **MINOR (`skill-retirement.service.spec.ts:262-272`):** the lost-race case does not assert the directory state. Analysis says removal is correct (the row was concurrently decided by a path that owns registry cleanup), but that invariant is untested.

---

### Data flow

1. `run(origin, now)` -> `readExemptSlugs()` (`:267-294`): registry `listAll()` filtered to `kind='skill'` + `authored`/`diverged`; not-bound -> pinned-only set + warn; read failure -> `null` -> early return `EMPTY_RESULT` (fail-closed, accepted) `[OK]`.
2. `readDays` x2 (`:301-328`): `getConfiguration('ptah', key, 30)` in Zod `int().min(1).max(3650)`; throw/undefined/null/invalid -> 30 with a warn `[OK]` (spec `:358-394`).
3. `listPromotedLastUse()` (`skill-candidate.store.ts:604-623`): one aggregate, `MAX(invoked_at)` else `promoted_at` else `created_at`, oldest first — **unguarded** (FM1) `[GAP]`.
4. Per row: `idleDays = (now - lastUsedAt)/DAY_MS`; `< N` skip; pinned -> `skippedPinned`; exempt slug -> `skippedExempt` `[OK]`.
5. `idleDays >= N+M` -> `retire()` (`:204-224`): containment check (`:236-241`, stricter than R-j) -> `fs.rmSync` (idempotent, crash between FS and DB self-heals next pass) -> ONE `inImmediateTransaction` whose body holds only plain statements `rejectIfStatus` (`skill-candidate.store.ts:684-698`) and conditional `registry.remove` (`skill-registry.store.ts:196-208`) (R-f) with no internal catch (R-f2); `false` -> not counted, registry row kept, info log `[OK]` (spec `:262-272`, `:396-422`).
6. `N <= idleDays < N+M` and `residency='resident'` -> `setResidency('dormant')`, counted `[OK]`; already-dormant rows are skipped uncounted `[OK]` (untested, MINOR).
7. Per-row catch wraps the whole unit including the transaction call (`:131-142`) — loop continues `[OK]`.
8. After the loop: one info log, then `emitRepropagation` over deduped changed slugs after commit (`:153`, `:335-356`), per-slug catch, never throws `[OK]`.
9. Result counts (`:155-162`) `[GAP]` — stuck rows and skipped passes are unrepresentable (FM2/FM3).

`removeMaterializations(rows, origin)` (`:171-193`): per-row containment + removal, per-row catch, repropagation of removed slugs only, returns removed slugs `[OK]` (spec `:437-458`).

---

### Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | -------- | --- |
| Settings `skillSynthesis.retirement.*`, Zod `int 1..3650`, default 30 on invalid or failed read | COMPLETE | None (`:42-53`, `:301-328`; spec `:358-394`). `RETIREMENT_DAYS_DEFAULT=30` matches `FILE_BASED_SETTINGS_DEFAULTS` (`platform-core/file-settings-keys.ts:536-537`). |
| Last use from `listPromotedLastUse()` (newest event, else promotion, else creation) | COMPLETE | None (`skill-candidate.store.ts:604-623`). |
| Idle >= N -> dormant; idle >= N+M -> retired; boundary values exact (29d/30d/60d; clock skew safe) | COMPLETE | None (`:114-125`; spec `:206-260`; negative idleDays skips). |
| Exempt pinned and registry `authored`/`diverged` | COMPLETE | None (`:116-123`, `:275-286`; spec `:274-308`). |
| Event at day 50 resets the clock | COMPLETE | Spec `:310-331` proves it via the aggregate. |
| Retire: FS first, then ONE transaction; `rejectIfStatus` -> conditional `registry.remove`; R-f plain-statement-only callback; R-f2 catch outside the callback | COMPLETE | None (`:204-224`; spec `:262-272`, `:396-422`). |
| R-j containment (inside `activeRoot()`, basename = slug) | COMPLETE | Strictly stronger than the plan's floor (`:236-241`; spec `:333-356`). |
| Lost race -> not counted, registry row kept | COMPLETE | Spec `:262-272`. |
| Repropagation after commit, per-slug fail-soft | COMPLETE | `:153`, `:335-356`. |
| Never throws into the caller | PARTIAL | `listPromotedLastUse()` at `:113` is uncontained (FM1, MODERATE); every other path is contained. |
| R-i: `SKILL_RETIREMENT_SERVICE` token, singleton, register.spec coverage | COMPLETE | `tokens.ts:84-85`, `register.ts:75,121-123`, `register.spec.ts:94-113` resolves token and class to the same instance. |
| A6: retirement keys readable as file-based settings | COMPLETE | Registered in Batch 2 (`file-settings-keys.ts:245-246`); read here via the workspace port (`:301-328`). |
| 6 explicit `@inject` deps, optional handled | COMPLETE | `:78-90`; registry/repropagation/workspace `isOptional: true` with null handling at `:268-273`, `:339`, `:302-303`. |

Implicit requirements not addressed: observability of the two permanent-ish states (stuck row, skipped pass) in the returned result — MODERATE-2 / MINOR-1.

---

### Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Exactly N idle (30d) | YES | `idleDays < N` is the skip, so 30.0 -> dormant (spec `:220-240`) | None |
| Exactly N+M idle (60d) | YES | `idleDays >= retireAfterDays` -> retire (spec `:242-260`) | None |
| `now < lastUsedAt` (clock skew) | YES | Negative idleDays fails `< N` -> skipped | None |
| Row already dormant at idle in [N, N+M) | YES | `residency === 'resident'` guard (`:127`) — no re-count | Untested (MINOR) |
| Dormant row at idle >= N+M | YES | Retire path removes its directory | Untested explicitly (MINOR) |
| Empty or `..` slug in a corrupted row | YES | `name.length > 0` + `relative === name` + `!startsWith('..')` (`:236-241`) | None |
| `bodyPath` outside root / foreign basename | YES | Containment refused, warn, row untouched (spec `:333-356`) | Row stuck + uncounted (FM2) |
| Registry not bound | YES | Pinned-only exemption + warn (`:268-273`) | None (plan-specified) |
| Registry bound, read fails | YES | Whole pass skipped, fail-closed (`:287-294`) | Result indistinguishable from no-op (FM3) |
| Invalid/failed settings read | YES | Default 30 with a warn per key (spec `:358-383`) | None |
| Crash between FS removal and DB write | YES | `rmSync force` idempotent; next pass completes the DB move (documented `:17-19`) | None |
| Mid-callback throw (registry.remove fails) | YES | Whole transaction rolls back; per-row catch continues the loop (spec `:396-422`) | None |

---

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: `run()` is fail-soft everywhere except the one bare `listPromotedLastUse()` call (`:113`), and a row that can never satisfy containment is permanently stuck with no signal in the result — both are observability/containment gaps, not data-loss paths.
- What a robust implementation would add:
  1. Contain the `listPromotedLastUse()` call (warn + `EMPTY_RESULT` on failure) so `run()` never throws.
  2. A `skippedUncontained` counter (and a `skipped` flag for registry-read failures) in `SkillRetirementResult`, surfaced in the Batch 9 curator report.
  3. Spec cases: an already-dormant row at idle in [N, N+M) is not re-counted; a dormant row retiring at >= N+M loses its directory.
---

## Batch 6

Scope: `SS/skill-promotion.service.ts` (+ both specs), `SS/queue/stage-handlers.service.ts` (+ spec), Tasks 6.1-6.3. Read in full: `skill-promotion.service.ts` (1084 raw lines), `stage-handlers.service.ts` judge-panel stage, the store primitives the tail calls (`skill-candidate.store.ts` `registerCandidate`/`promoteAtomically`/`inImmediateTransaction`/`rejectIfStatus`/`findByName`, `skill-registry.store.ts`), and the committed Batch 7 retirement exemption (`skill-retirement.service.ts`). Verification re-run by this reviewer: `test --testFile=skill-promotion` exit 0 (fresh, 0% cache), `test --testFile=stage-handlers` exit 0, `typecheck` exit 0, `lint` 0 errors (max-lines below).

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 0                                    |
| Serious issues      | 1                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 4                                    |

### Five logic questions

#### 1. How does this fail silently?

The registry link overwrites `clone_status` `'authored'`/`'diverged'` with `'synth'` and the promotion *succeeds* — the spec even asserts the wrong value (`skill-promotion.service.spec.ts` adopt case seeds an `'authored'` row and asserts `cloneStatus: 'synth'` after the adopt). The user sees nothing until the Batch 7 retirement pass, 30+30 idle days later, deletes `<activeRoot>/<slug>/` — because the retirement exemption (`skill-retirement.service.ts:343-351`) covers only `'authored'`/`'diverged'` registry rows plus pinned, and `registry.remove` (`skill-registry.store.ts:196-208`) deletes exactly the `'synth'` row the flip produced. Nothing in any log connects the deletion to the adopt.

#### 2. What user action produces unexpected behaviour?

Accepting (or reconciling) a suggestion whose slug is already held by a **non-promoted** `skill_candidates` row: `adoptMaterializedSkill` skips link-only only for `status === 'promoted'` (`skill-promotion.service.ts:489`), falls into the tail, and `registerCandidate` INSERTs a duplicate `name` → UNIQUE(name) violation (`skill-candidate.store.ts:310` documents the index) → throw on every start, permanently (M-1).

Also: a user who authored a skill with the same name as an accepted suggestion silently loses authorship protection on the next reconcile (S-1).

#### 3. What input data produces a wrong answer?

None found on the suggestion path: a slug held in the DB without a directory suffixes to `-2` and stores the suffixed name (spec case); a slug held only as a live directory suffixes via `writeAtRoot`'s `existsSync`; the judge gate at-threshold and CAS-lost cases both answer correctly. The wrong-answer class in this batch is state, not input: the pre-existing registry `clone_status` (S-1) and the pre-existing same-named candidate row (M-1).

#### 4. What happens when a dependency fails?

- Registry unbound: `linkRegistryRow` silently returns (`skill-promotion.service.ts:583`) — documented optional-dependency pattern; the promotion lands without a registry link. Acceptable, consistent with the rest of the library.
- Registry read/write fails inside the transaction: throws → full rollback → directory removed → rethrow. Fail-closed, correct.
- `mdGenerator.promoteToActive` throws (slug exhaustion, disk error): propagates before the `try` — no log from this service; the caller (Batch 9) owns it. Batch 5's fix-up owns partial-write cleanup. MINOR-1.
- Repropagation absent/fails: warn only, never throws (`:702-723`). Correct per plan.
- Judge lane fails: unchanged pre-existing `unscored` mapping; the new gate is not on that path.

#### 5. What is missing that the requirements never mentioned?

The plan (implementation-plan.md:626) itself hard-codes `cloneStatus:'synth'` in the tail's `registry.upsert` and never says the link must preserve an existing `'authored'`/`'diverged'` status — the interaction with Batch 7's committed exemption rule is a plan-level hazard the executor reproduced and pinned in a spec. Second gap: the plan specifies the promoted-row skip for adopt (:634) but is silent on the non-promoted-row case (M-1).

### Failure modes

#### FM-1 — registry link strips authored/diverged protection

- Trigger: `adoptMaterializedSkill` (or `promoteSuggestion`) on a slug whose `skill_registry` row has `clone_status` `'authored'` or `'diverged'`.
- Symptom: no immediate symptom; 30+30 idle days later the retirement pass deletes the skill directory and the registry row; earlier, the cap may demote the skill to dormant (it also disappears from `authoredSlugs()`, `skill-promotion.service.ts:620`).
- Evidence: `skill-promotion.service.ts:578-599` (`linkRegistryRow` upserts `cloneStatus: 'synth'` unconditionally); `skill-registry.store.ts:74` (`clone_status = excluded.clone_status`); exemption filter `skill-retirement.service.ts:343-351`; `registry.remove` default `'synth'` `skill-registry.store.ts:196-208`; spec pins the flip (`skill-promotion.service.spec.ts` adopt case).
- Current handling: none — intended by the executor, spec-pinned.
- Recommendation: in `linkRegistryRow`, preserve the existing status when it is `'authored'` or `'diverged'` (link `candidateId`/`userPath`, keep the status); update the adopt spec case to assert the status survives. This keeps the settings-docs promise (Batch 2 F-2: "Pinned, user-authored or user-edited skills are exempt") and Batch 7 review S1's rationale ("without the authored/diverged set, a pass could delete user-owned content").

#### FM-2 — adopt on a slug held by a non-promoted row throws forever

- Trigger: reconcile preconditions hold (`<activeRoot>/<slug>/SKILL.md` exists) and `findByName(slug)` returns a `candidate`- or `rejected`-status row (dormant rows are safe: `status='promoted'`).
- Symptom: `registerCandidate` INSERT violates UNIQUE(name) → rollback → throw; the reconcile's per-row catch (Batch 9) warns; the suggestion is permanently un-adoptable and warns every start. Plan A1's "second start is a no-op" cannot hold.
- Evidence: `skill-promotion.service.ts:488-515`; `skill-candidate.store.ts:208-250` (INSERT by name, no name guard), `:310` (UNIQUE index).
- Current handling: none; unspecified in the plan (:634 covers only the promoted case).
- Recommendation: define the rule before Batch 9 wires the call — reuse and promote the existing `candidate` row, or skip + warn for `rejected` (terminal decision already taken).

#### FM-3 — stale cap victim fails the promotion

- Trigger: another promotion demotes the selected victim (or fills the cap) between `selectWeakestResident` (`skill-promotion.service.ts:407`) and the transaction — a window that now includes the SKILL.md materialization.
- Symptom: `promoteAtomically`'s demotion CAS throws (`skill-candidate.store.ts:544-548`) → whole unit rolls back → the accept fails and retries next pass. Fail-safe: no double-demotion (the CAS) and no orphan directory (the catch at `:434-449` removes it).
- Current handling: correct fail-safe; the user-visible retry is the cost. No change required.
- Recommendation: record; optionally re-check the residency count inside the transaction if accept storms appear.

#### FM-4 — cap under-count race promotes over the cap

- Trigger: `residentCount < maxActiveSkills` at selection time; a concurrent promotion fills the cap during materialization; this promotion then lands with no demotion.
- Symptom: cap exceeded by one until the next pass. Pre-existing pattern (the automatic path selects outside the transaction too); the suggestion path widens the window.
- Evidence: `skill-promotion.service.ts:407-416`.
- Current handling: accepted as the existing cap semantics.
- Recommendation: record for `future-enhancements.md`; not fixed in this task.

### Serious issues

#### S-1 — `linkRegistryRow` flips authored/diverged registry rows to synth

- File: `skill-promotion.service.ts:585-598` (upsert with `cloneStatus: 'synth'`); spec adopt case asserts the flip.
- Scenario: user-authored skill `legacy` (registry row `'authored'`); an accepted suggestion with the same slug is reconciled (Batch 9 Task 9.3; plan A1 *expects* authored rows for the 2 live accepted suggestions); adopt runs the tail and flips the row to `'synth'`.
- Impact: silent loss of the retirement and cap exemptions the Batch 7 review fought for; 60 idle days later the retirement pass deletes the user's SKILL.md directory and the registry row. User-authored content destroyed by automation, with no signal. Data loss, gated only by Batch 9 wiring and dormancy.
- Fix: preserve `existing.cloneStatus` when it is `'authored'` or `'diverged'` in `linkRegistryRow`; re-pin the spec. The fix is this batch's code — doing it now is cheaper than re-pinning it in Batch 9's review after Task 9.3 builds on the wrong primitive.

### Moderate and minor issues

- M-1 (FM-2): adopt on a slug held by a non-promoted row → UNIQUE(name) throw every start; permanent wedge; needs a defined rule before Batch 9 (plan gap).
- M-2 (FM-4): cap-victim selection vs transaction race — stale victim fails safely (FM-3, good), under-count promotes one over the cap; pre-existing pattern, wider window; record.
- MINOR-1: `promoteSuggestion` logs nothing when `promoteToActive` itself throws (`:408-417`, before the `try`); Batch 9's catch must log it or the failure is invisible. One-line fix: move the materialization inside the `try` (the catch is already a no-op-safe `removeActiveAfterRollback` guarded on `materialized`).
- MINOR-2: judge-panel null-score branch (`score === null` with `'scored'` status, `stage-handlers.service.ts:577`) is untested; the plan's verification seam (plan:832-833) lists only below/at/CAS-lost, so this is coverage beyond the plan, not a gap against it.
- MINOR-3 (file size): `skill-promotion.service.ts` is 1084 raw lines; ESLint `max-lines` warning reports **1008** (limit 700) — "File has too many lines (1008). Maximum allowed is 700". The executor's "~1145" is wrong; the plan predicted ~900 (plan:648-649). **Facade split: recommended as a follow-up, not now.** The file is one promotion contract — three entries over one shared tail plus the pre-existing gate pipeline — and cohesive; Batches 8-9 are in flight in the same lib and a split now risks conflicts. Record in the QA handoff / `future-enhancements.md` and revisit after Batch 12; do not let Batch 9 add further code here without a look.

### Verification evidence

- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-promotion` — exit 0 (fresh run, 0% cache).
- `--testFile=stage-handlers` — exit 0 (fresh).
- `npx nx run @ptah-extension/skill-synthesis:typecheck` — exit 0.
- `npx nx run @ptah-extension/skill-synthesis:lint` — 0 errors; `max-lines` for `skill-promotion.service.ts` = 1008 (also visible: `skill-candidate.store.ts` 1302, the R-h baseline).

### Checked contract items (Tasks 6.1-6.3, R-f, R-f2)

1. Automatic path: `isSlugTaken = slug !== candidate.name && store.findByName(slug) !== null` (`:324-325`); `name: materialized.slug` stored (`:333`); repropagation emits `materialized.slug`, not `candidate.name` (`:366`, spec-pinned in the repropagation spec). COMPLETE.
2. `promoteSuggestion`: cap victim first (`:407`), then materialize (`:408`), then ONE `inImmediateTransaction` (`commitResidentPromotion`, `:550-569`): `registerCandidate` (trajectory `'suggestion:'+id`) → `promoteAtomically` → `linkRegistryRow` → `onCommit`. R-f: every call inside the callback is a plain statement or the re-entrant `promoteAtomically` (`registerCandidate` = SELECT + plain INSERT + `insertEmbedding` plain INSERT `skill-candidate.store.ts:1690-1697`; `promoteAtomically`'s own transaction is depth-tracked re-entrant `:710-718`; registry `getBySlug`/`upsert` are plain statements on the same connection). `onCommit` is caller-supplied. R-f2: no try/catch inside the callback or anything it calls; the catch (`:434-449`) wraps the whole call, removes the directory (`removeActiveAfterRollback`), and rethrows. Cap-victim validity inside the transaction: `promoteAtomically` CAS-demotes (`WHERE status='promoted' AND residency='resident'`, store `:529-548`) and throws on 0 changes — a stale victim fails the promotion, never double-demotes; the demotion is inside the transaction, so it rolls back on any later throw (real-store spec case asserts the resident stays `resident` after an `onCommit` throw). COMPLETE.
3. `adoptMaterializedSkill`: link-only when the slug is already promoted (`:489-500`, spec-pinned); same tail without materialization (`:502-515`); never removes the directory — no `removeActiveAfterRollback` on this path, and the spec case "a failure rolls back and leaves the existing directory in place" pins it. COMPLETE, except S-1/M-1.
4. Task 6.2: `applyJudgePanelGate` (`stage-handlers.service.ts:571-595`) — `score === null || score >= minJudgeScore` → no write, reason unchanged (matches the plan's `score !== null && score < min`); below → `rejectIfStatus(id,'candidate','below-judge-score')`; `true` → `${result.reason}:rejected`; `false` → `:not-candidate`; exactly-at-threshold unchanged (spec at 6.0); promoted-meanwhile → CAS lost → `:not-candidate` (spec). COMPLETE.
5. Task 6.3 doc comment reworded (`:363`, "the curator's umbrella-merge pass"). COMPLETE.
6. Catches audited: every catch logs or rethrows, degradation-audit markers present where a catch degrades (`runGatePipeline` write-failed, `removeActiveAfterRollback` cleanup, `emitRepropagation`, `workspaceRoot`, `winRatesBySlug`, `authoredSlugs`); no `return` inside a catch skips work — the `write-failed` return in `runGatePipeline` IS the failure contract. No catch inside any transaction callback. PASS.
7. File size: see MINOR-3.

### Deviation decisions

| # | Deviation (executor notes) | Decision |
| - | -------------------------- | -------- |
| 1 | `promoteSuggestion`/`adoptMaterializedSkill` rethrow after rollback instead of returning `{promoted:false, reason:'write-failed'}` (plan:628) | **ACCEPT.** Consistent with Batch 9 Task 9.2's own contract — "`{accepted:false}` comes from a catch around the whole transaction call, after rollback" (batches.md:833) — and with the R-f2 rule that the catch wraps the whole call. `ResidentPromotion<T>` is a typed success; the caller owns fail-soft. HARD CONDITION on Batch 9: both calls wrapped in try/catch with the plan's spec case (a throw after the promotion write leaves the suggestion pending and no promoted row); Batch 9 review checks it. |
| 2 | `linkRegistryRow` changes an existing registry row's `cloneStatus` from `'authored'` to `'synth'` on adopt | **REJECT — S-1.** Batch 7 retirement exempts only `'authored'`/`'diverged'` rows and `registry.remove` deletes only `'synth'` rows, so an authored skill adopted here becomes eligible for automatic retirement and directory deletion. Plan A1 says reconcile accepts either authored or synth registry rows — it does not say adopt may downgrade the row. Correct rule: preserve `authored`/`diverged` on link (link `candidateId`, keep the status). |
| 3 | Adopt on a slug held by a non-promoted row hits UNIQUE on `name` and throws on every start | **Plan gap — M-1.** Not acceptable as shipped; define the rule (reuse the candidate row / skip + warn for rejected) before Batch 9 wires the call. Contained by the reconcile's per-row catch, but a permanent warn-forever wedge is not "idempotent, second start is a no-op". |
| 4 | Cap victim selected outside the transaction | **ACCEPT (pre-existing pattern).** The demotion CAS inside `promoteAtomically` makes a stale victim fail the promotion safely; the demotion rolls back with the transaction. Residual over-cap race recorded as FM-4/M-2. |
| 5 | File grew to 1008 ESLint lines (plan said ~900; repo ceiling 700) | **ACCEPT with a follow-up record — MINOR-3.** No facade split demanded now (Batches 8-9 in flight, file cohesive); revisit after Batch 12. |

### Data flow (`promoteSuggestion`, entry to exit)

1. `selectWeakestResident` — plain reads outside the transaction. OK.
2. `promoteToActive` — filesystem first; occupied = dir on disk OR `findByName`; suffix walk; partial-write cleanup owned by the Batch 5 fix-up. OK.
3. `BEGIN IMMEDIATE` (outermost, depth-tracked). OK.
4. `registerCandidate` — trajectory `'suggestion:'+id`, UNIQUE reuse on re-accept; plain INSERT (+ embedding plain INSERT). OK.
5. `promoteAtomically` — re-entrant transaction; CAS promote (0 changes → throw) + CAS demote (0 changes → throw). OK.
6. `linkRegistryRow` — registry upsert, plain statement. **GAP: S-1 (status overwrite).**
7. `onCommit(row)` — caller lineage write, inside the transaction by contract. OK (Batch 9 review checks the real callback).
8. `COMMIT` → `afterResidencyChange` (log, dedup invalidate) → `emitRepropagation` (never throws) → `ResidentPromotion`. OK.

### Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | -------- | --- |
| Automatic path: `isSlugTaken`, stored `name = materialized.slug`, repropagated materialized slug | COMPLETE | None (specs) |
| `selectWeakestResident` shared by all three entries | COMPLETE | None |
| `promoteSuggestion`: no dedup/judge gates, cap applies, `trajectoryHash 'suggestion:'+id`, FS first / DB one transaction / remove directory on DB throw | COMPLETE | Rethrow instead of `{promoted:false}` — ACCEPTED deviation 1 |
| `adoptMaterializedSkill`: link-only when promoted, same tail, never removes the directory | PARTIAL | S-1 (authored→synth flip), M-1 (non-promoted-row collision) |
| R-f: only plain-statement calls inside the callback | COMPLETE | Verified per method |
| R-f2: no catch inside the callback; whole-call catch removes the directory and rethrows; spec proves no partial row | COMPLETE | Real-store spec cases (throw after `registerCandidate`, `onCommit` throw, UNIQUE on name) |
| Task 6.2 judge gate: below → `:rejected`, at-threshold unchanged, CAS lost → `:not-candidate` | COMPLETE | Null-score branch untested (MINOR-2) |
| Task 6.3 doc comment | COMPLETE | None |
| Plan quality req: file grows to about 900 lines | PARTIAL | 1084 raw / 1008 ESLint |

Implicit requirements not addressed: preserving the authored/diverged exemption on registry link (from plan A1 + Batch 7 exemption + Batch 2 F-2 docs promise) — MISSING (S-1); adopt behaviour for a slug held by a non-promoted row — MISSING (M-1).

### Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Suggestion slug held by a DB row, no directory | YES | Suffixes `-2`, stores suffixed name (spec) | None |
| Suggestion slug is a live directory only | YES | `writeAtRoot` `existsSync` suffixes | None |
| Throw after `registerCandidate` | YES | Full rollback, no row, no directory, resident untouched (spec, R-f2) | None |
| `onCommit` throw | YES | Same (spec) | None |
| UNIQUE on `name` race | YES | Backstop rollback + directory removal (spec) | None |
| Cap demotion on the suggestion path | YES | Weakest resident demoted (spec) | Over-cap race FM-4 |
| Adopt slug already promoted (incl. dormant) | YES | Link-only, `onCommit` in transaction (spec) | None |
| Adopt slug held by a candidate/rejected row | NO | UNIQUE(name) throw every start | M-1 — permanent wedge |
| Adopt of an authored registry row | WRONG | Flips to `'synth'` (spec-pinned) | S-1 — data loss via retirement |
| Judge below / exactly-at / CAS-lost | YES | Spec cases for all three | None |
| Judge scored with null score | YES | No write, reason unchanged (`:577`) | Untested (MINOR-2) |

### Verdict

- Recommendation: **REVISE** (NEEDS_REVISION)
- Confidence: HIGH
- Top risk: S-1 — the spec-pinned registry flip converts user-authored content into retirement-eligible synth content; once Batch 9 wires the reconcile it is a silent deletion path for user skills.
- What a robust implementation would add:
  1. `linkRegistryRow` preserves `authored`/`diverged` `clone_status`; the adopt spec asserts the status survives the link (S-1, required before Batch 9).
  2. A defined rule for adopt when the slug is held by a non-promoted row: reuse the candidate row, skip + warn for rejected (M-1, required before Batch 9).
  3. Batch 9 hard condition: try/catch around both promotion entries, with the plan's pending-suggestion rollback spec case (deviation 1).
  4. Follow-up record: facade split for the 1008-line file after Batch 12; null-score judge-panel spec case.


### Batch 6 re-review

Scope: Re-review of finding S-1 in Batch 6 (`skill-promotion.service.ts`, `skill-promotion.service.spec.ts`, and consistency with `skill-registry-catalog.service.ts`).

Verification:
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-promotion` passed (2 test suites, 81 tests passed, 0 failed, 100% pass rate).

#### S-1 Status: RESOLVED

1. **Implementation audit (`skill-promotion.service.ts:167-177, 493-497, 612-641`):**
   - **(a) Diverged preservation:** `linkRegistryRow` evaluates `existing?.diverged === true || existing?.cloneStatus === 'diverged'` at `:625-626`. When diverged, `cloneStatus: 'diverged'` is written along with `diverged: true`, `candidateId`, and `userPath` (`:638-639`), preserving retirement and cap immunity.
   - **(b) Plugin clone protection:** If `existing.cloneStatus === 'clone' || existing.originPluginId !== null` (`:619-624`), it throws `RegistrySlugOwnedByPluginError`. This runs directly inside the `inImmediateTransaction` callback of `commitResidentPromotion` (`:574-593`) without an inner `try/catch`. The error propagates, initiating an immediate SQLite rollback. In `promoteSuggestion`, the outer catch at `:452-458` invokes `removeActiveAfterRollback`, deleting the materialized directory. In `adoptMaterializedSkill`, the outer catch lets the existing directory remain intact without deletion (`:490-491`).
   - **(c) Authored/Synth/New row transition to synth:** If there is no row or the status is `synth` or `authored` (without diverged or plugin ownership), `cloneStatus` resolves to `'synth'` (`:638`). This is consistent with `SkillRegistryCatalogService.deriveStatus` (`skill-registry-catalog.service.ts:91-96`), where a matching candidate row overrides `authored` to `synth`. Hand-written skills are safeguarded by Task 9.3's reconcile rule (only adopting folders proven to originate from accepted suggestions).

2. **Transaction atomicity (R-f, R-f2):**
   - No `try/catch` block exists inside the `inImmediateTransaction` callback in `commitResidentPromotion` (`:574-593`).
   - The thrown `RegistrySlugOwnedByPluginError` rolls back candidate registration and atomic promotion cleanly.

3. **Spec coverage (`skill-promotion.service.spec.ts:1602-1621, 1738-1777, 1831-1914`):**
   - `seedRegistry` helper sets up real SQLite `skill_registry` entries.
   - `promoteSuggestion` asserts that diverged rows retain `diverged` status and have `candidateId` linked (`:1738-1754`), while plugin clone collisions throw `RegistrySlugOwnedByPluginError`, rollback candidate creation, and delete the created active directory (`:1756-1777`).
   - `adoptMaterializedSkill` asserts that diverged rows retain `diverged` status (`:1872-1888`), plugin clone collisions throw `RegistrySlugOwnedByPluginError` without deleting the existing directory (`:1890-1914`), and authored rows transition to `synth` while retaining history and candidate linking (`:1831-1870`).

#### New Findings
- None. Implementation matches requirements and edge cases are verified.

#### Metrics & Verdict
- Score: 8/10
- Verdict: APPROVED
- Blocking issues: 0
- Serious issues: 0 (S-1 resolved)
- Moderate issues: 2 (M-1, M-2 unchanged from earlier review; deferred to Batch 9 / future enhancements)
- Failure modes: 3 (FM-2, FM-3, FM-4 unchanged from earlier review; FM-1 resolved)


## Batch 8

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 3        |

Scope examined:
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.ts` (NEW, read in full)
- `libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.spec.ts` (NEW, read in full)
- `libs/backend/skill-synthesis/src/lib/skill-suggestion.store.ts` (`markMerged`, `insert`, `listMemberCandidateIds`, read in full)
- `libs/backend/skill-synthesis/src/lib/skill-suggestion.store.spec.ts` (Batch 8 test updates, read in full)
- `libs/backend/skill-synthesis/src/lib/di/tokens.ts`, `di/register.ts`, `di/register.spec.ts` (Batch 8 additions, read in full)
- `libs/backend/skill-synthesis/src/lib/types.ts` (`MERGED_INTO_PREFIX`, `BACKLOG_PURGE_REASON`)

Verification:
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-umbrella-merge`: passed (1 suite, 25/25 passed, 0 failed, 52.1s).
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=skill-suggestion.store`: passed (1 suite, 29/29 passed, 0 failed, 21.0s).
- `npx nx run @ptah-extension/skill-synthesis:test --maxWorkers=2 --testFile=register`: passed (1 suite, 12/12 passed, 0 failed, 21.2s).
- `npx nx run @ptah-extension/skill-synthesis:typecheck`: passed with exit code 0.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: passed with exit code 0 (`libs/backend/skill-synthesis: 6 ok (baseline 6)`).

---

### Five logic questions

#### 1. How does this fail silently?
- In `SkillUmbrellaMergeService.rejectCandidates` (`skill-umbrella-merge.service.ts:578-582`), when `store.rejectIfStatus` returns `false` (because a member was concurrently transitioned by another writer), the row is omitted from `rejectedIds` and accounted for only in `lost`. The commit still succeeds with `kind: 'created'`, and the caller logs `{ skipped: commit.lost }` (`:609-614`), but the returned `UmbrellaPassResult` indicates `umbrellasCreated: 1` while one member was not merged into the umbrella. This is intentional fail-soft design so concurrent candidate transitions do not abort the entire umbrella.
- In `readCandidateBody` (`:810-823`), if reading the markdown file on disk fails (e.g., file deleted, unreadable permissions), the error is caught at `logger.debug` level and falls back to `${candidate.name}\n\n${candidate.description}`. Umbrella synthesis continues with the placeholder description rather than failing.
- In `planCluster` (`:316-320`), the authored-dominance guard checks `dominant && exemptSlugs.has(dominant)`. Because this is an exact-case lookup while Batch 7 retirement normalizes exempt slugs to lowercase (`skill-retirement.service.ts:281`), a case variation between `skill_invocation_events.skill_slug` and `skill_registry.slug` causes the guard to evaluate `false`, allowing umbrella synthesis to proceed over sessions dominated by an authored skill.

#### 2. What user action produces unexpected behaviour?
- If a user authoring an external skill registers it with casing (e.g. `My-Custom-Skill`) and runs sessions invoking it, the exact-case check in `planCluster` may not recognise the dominant slug if invocation logs record a different case format, generating an unwanted umbrella suggestion in Recommended.
- If a candidate's markdown file on disk is removed by the user while the database row is still `candidate`, `readCandidateBody` falls back to the name and description. The synthesized umbrella and singleton suggestions receive the raw name/description without alerting the user that the markdown source was missing.

#### 3. What input data produces a wrong answer?
- In `orderByCentroidDistance` (`:846-868`), if a member in a cluster has an embedding vector dimension differing from `members[0]`, its similarity is assigned `Number.NEGATIVE_INFINITY`, pushing it to the end of `ordered`. However, if the total cluster size is $\le 12$ (`UMBRELLA_MAX_MEMBERS`), that mismatched member is still included in `umbrellaInputs` and passed to `synthesizeUmbrella` despite being unmeasurable in the cluster's vector space.
- Zero-norm embeddings: `cosineSimilarity` returns 0 for zero vectors, placing them behind positively similar vectors; they are not rejected.

#### 4. What happens when a dependency fails?
- `clustering.partitionPool` throws: caught in `readPartition` (`:231-241`), logged as warning, returns `null`. `runPass` skips the pass and cleanly returns `UmbrellaPassResult` with `purgeSkippedReason: 'failed'` without throwing into the caller.
- `rateLimiter.tryAcquire` denies acquisition: cluster loop breaks immediately, `tally.rateLimited = true` is set, and unvisited clusters are reported in `tally.clustersRemaining`.
- `synthesizer.synthesizeUmbrella` returns `null` (lane timeout, malformed output): logged at info level (`:419-424`), cluster commit is skipped, and cluster remains untouched for future passes.
- `judge.judge` returns `unscored`, `disabled`, or `score === null`: logged at info level (`:440-446`), cluster commit is skipped, and no database mutations occur.
- Store error inside `commitUmbrella` transaction: `inImmediateTransaction` rolls back all changes (the umbrella insertion, suggestion markMerged, and candidate rejections). The outer `try/catch` in `mergeClusters` (`:278-288`) catches the error, logs a warning, and continues with remaining clusters.
- `suggestions.markMerged` count mismatch (R-n): throws an explicit error inside the callback (`:528-532`), rolling back the entire transaction.
- Store error inside `purgeInTransaction`: rolls back all candidate rejections and marker write. Outer catch in `runPurge` (`:728-734`) catches the error, sets `tally.purgeSkippedReason = 'failed'`, logs a warning, and retries on the next pass.

#### 5. What is missing that the requirements never mentioned?
- Case-folding normalization for `exemptSlugs.has(dominant)`: Batch 7's retirement service adopted lowercase normalization for registry slug comparisons, but `SkillUmbrellaMergeService` accepts caller-provided `exemptSlugs` and performs exact-case `Set.has()`.
- Suggestion-only clusters: When a cluster consists purely of pending suggestions without candidate rows, `planClusterDraft` has no candidates to draft. `judgeAnchor` falls back to reading `memberCandidateIds` from the store. If none resolve, the cluster is skipped with an info log (`:408-414`).

---

### Failure modes

#### FM-1: Case-Sensitive Authored-Dominance Miss
- Trigger: Dominant skill slug returned by `getDominantSkillSlugForSessions` differs in casing from the caller-supplied `exemptSlugs` (e.g. `MySkill` vs `myskill` on Windows or across varying input sources).
- Symptom: `exemptSlugs.has(dominant)` returns `false`; cluster is not skipped; umbrella synthesis proceeds despite authored dominance.
- Evidence: `libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.ts:316`.
- Current handling: Exact-case `Set.has()`.
- Recommendation: Normalize both `dominant.toLowerCase()` and `exemptSlugs` to lowercase, matching the case-insensitive exemption pattern in `skill-retirement.service.ts:281`.

#### FM-2: Mismatched Embedding Dimension Inclusion Under Cap
- Trigger: A pool member within a cluster has an embedding vector dimension differing from the first member, and the cluster size is $\le 12$.
- Symptom: `orderByCentroidDistance` assigns `Number.NEGATIVE_INFINITY` similarity and places it at the tail, but `umbrellaInputs` still includes it because fewer than 12 members exist.
- Evidence: `libs/backend/skill-synthesis/src/lib/lifecycle/skill-umbrella-merge.service.ts:862-864`, `:461-480`.
- Current handling: The member is included in the synthesis prompt.
- Recommendation: Filter out members with mismatched embedding dimensions prior to constructing `UmbrellaMemberInput` payloads.

#### FM-3: Precondition False-Negative on Unreadable Purge State Table
- Trigger: SQLite table `skill_backlog_purge_state` is unreadable or connection issues occur during `purgeState.read()`.
- Symptom: `SkillBacklogPurgeStateStore.read()` catches the DB error, warns, and returns `null`. `purgePrecondition` treats `null` as "marker absent" and proceeds into `purgeInTransaction`, where it executes candidate selection before failing at `markComplete`.
- Evidence: `libs/backend/skill-synthesis/src/lib/lifecycle/skill-backlog-purge-state.store.ts:68-75`, `skill-umbrella-merge.service.ts:740`.
- Current handling: Fails safely during `markComplete`, rolls back transaction, sets `purgeSkippedReason = 'failed'`.
- Recommendation: Conflating absent row with unreadable table is fail-safe due to the subsequent rollback, but distinguishing unreadable state in `purgeState.read()` would avoid executing candidate filtering queries.

---

### Blocking issues

None.

### Serious issues

None.

### Moderate and minor issues

- **MODERATE (`skill-umbrella-merge.service.ts:316`):** `exemptSlugs.has(dominant)` performs exact-case matching, whereas committed Batch 7 retirement service normalizes exempt slugs case-insensitively (`toLowerCase()`). Inconsistency risks missing authored dominance when slugs diverge in case (FM-1).
- **MODERATE (`skill-umbrella-merge.service.ts:862-864`):** Members with mismatched vector dimensions in `orderByCentroidDistance` are assigned `Number.NEGATIVE_INFINITY` but are not filtered out when cluster length $\le 12$, passing them to the synthesizer (FM-2).
- **MINOR (`types.ts:22`):** Stale doc comment states `MERGED_INTO_PREFIX + umbrellaSlug`. The code and Plan R3 correctly store `MERGED_INTO_PREFIX + umbrella.id`.
- **MINOR (`skill-backlog-purge-state.store.ts:68-75`):** `read()` returns `null` for both missing row and missing/corrupt table, causing `purgePrecondition` to enter transaction before failing on `markComplete` (FM-3).

---

### Deviation decisions

| # | Deviation | Decision | Reason |
| - | --------- | -------- | ------ |
| 1 | `memberSessionIds` includes sessions from merged suggestions | **ACCEPT** | The plan (:529) specified `memberSessionIds = draft.draftedSessionIds`. Merging an umbrella consolidates both candidates and pending suggestions; including the underlying suggestions' session IDs ensures the umbrella preserves the complete historical lineage of sessions it was synthesized from. |
| 2 | `purgeSkippedReason` carries `'failed'` | **ACCEPT** | The plan (:554) listed only `'already-complete' \| 'no-vec' \| 'pool-truncated'`. Adding `'failed'` allows the caller and diagnostics report to distinguish an unexecuted purge due to database or transaction errors from normal skips. |
| 3 | `clustersRemaining` counts unvisited clusters in partition | **ACCEPT** | Accurately tracks clusters left unprocessed when the loop terminates early due to `SUGGESTION_MAX_CLUSTERS_PER_PASS` (3) or rate-limit exhaustion. |
| 4 | Judge anchor row uses candidate closest to centroid, with fallback for suggestion-only clusters | **ACCEPT** | The judge requires a `SkillCandidateRow`. Sourcing the anchor from the candidate closest to the centroid (or the candidate underlying a suggestion member) provides an accurate representative anchor. Skipping when none resolve is fail-soft. |
| 5 | Singletons processed in individual transactions with fresh CAS status check | **ACCEPT** | Isolating each singleton into its own transaction prevents a single corrupted or concurrently modified candidate from aborting other eligible singletons. The re-check prevents double-surfacing on concurrent hosts. |
| 6 | Verbatim copy of `technologyFingerprint` and `readCandidateBody` with log prefix updated | **ACCEPT** | Fully adheres to implementation plan (:564) and prepares for removal of legacy curator copies in Batch 9. |
| 7 | Exact-case matching in authored-dominance guard vs case-insensitive in Batch 7 | **ACCEPT WITH RESERVATION (MODERATE)** | While standard skill slugs follow lowercase kebab-case (`/^[a-z0-9][a-z0-9-]*$/`), the casing mismatch between Batch 7 and Batch 8 leaves an edge case. Non-blocking because suggestions are non-destructive and require user acceptance. Addressed in Batch 9 caller normalization. |

---

### Data flow

1. **Entry:** `runPass(settings, exemptSlugs, origin, now)` -> Initializes `PassTally` with default `purgeSkippedReason: 'failed'`.
2. **Pool Partitioning:** `readPartition()` -> Calls `clustering.partitionPool()` with exclusion sets (catches errors, logs warn, returns null on failure) `[OK]`.
3. **Cluster Processing:** `mergeClusters()`:
   - Sorts clusters by size descending `[OK]`.
   - Iterates up to `SUGGESTION_MAX_CLUSTERS_PER_PASS = 3` `[OK]`.
   - Plans cluster: orders members by centroid distance (`orderByCentroidDistance`), reserves B3.6 holdout over candidate/promoted rows, checks authored dominance `[OK]`.
   - Acquires rate-limit permit (`skill.analyze` bucket, max 6/h) `[OK]`.
   - Synthesizes umbrella via `synthesizer.synthesizeUmbrella` (fails soft on null) `[OK]`.
   - Judges proposal via `judge.judge` (unscored/disabled skips cleanly) `[OK]`.
   - Commits transaction (`inImmediateTransaction`):
     - Below threshold: Inserts `dismissed` umbrella, rejects candidate members with `below-judge-score:umbrella:<id>`, leaves promoted and suggestion members untouched (R7) `[OK]`.
     - Scored at or above: Re-reads members (`membersUnchanged`), aborts if changed. Inserts `pending` umbrella. Calls `markMerged(suggestionIds, umbrella.id)` and asserts returned count matches `suggestionIds.length` (R-n). Rejects candidate members with `merged-into:<umbrellaId>`. Promoted members untouched (R2) `[OK]`.
   - Per-cluster try/catch wraps entire transaction unit (R-f2) `[OK]`.
4. **Singleton Surfacing:** `surfaceSingletons()`:
   - Filters orphans for judge-passed candidates (`isJudgePassed`), capped at `SINGLETON_MAX_PER_PASS = 5` `[OK]`.
   - Each singleton runs in its own `inImmediateTransaction`, re-verifying row is still `candidate` and unrepresented in suggestions `[OK]`.
5. **Backlog Purge:** `runPurge()`:
   - Evaluates `purgePrecondition` (marker absent, vec available, pool not truncated) `[OK]`.
   - Runs `purgeInTransaction`: verifies marker again, identifies candidates older than 30d, unclustered, not in pending/accepted suggestions, with embedding, not judge-passed `[OK]`.
   - Rejects eligible candidates via `rejectCandidates(..., BACKLOG_PURGE_REASON)` `[OK]`.
   - Writes marker via `purgeState.markComplete()` (asserts true, throws and rolls back if already written) `[OK]`.
6. **Exit:** Calculates final counts and returns `UmbrellaPassResult` `[OK]`.

---

### Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 8.1: `SkillUmbrellaMergeService` orchestration, rate-limiting, synthesis, judge gate, transaction management | COMPLETE | None. All contracts and fail-soft boundaries honoured. |
| Task 8.2: DI registration and tokens for `SKILL_UMBRELLA_MERGE_SERVICE` | COMPLETE | None. Registered as singleton alias and verified in `register.spec.ts`. |
| Task 8.3: `markMerged` drops `umbrellaId` prior to empty check and UPDATE | COMPLETE | None. Self-exclusion verified and tested in `skill-suggestion.store.spec.ts`. |
| Risk R-f: Transaction callbacks call only plain-statement methods | COMPLETE | None. Only `findById`, `insert`, `markMerged`, `rejectIfStatus`, and `markComplete` called inside callbacks. |
| Risk R-f2: No try/catch inside transaction callbacks; per-unit catch wraps `inImmediateTransaction` | COMPLETE | None. All try/catch blocks wrap the transaction externally. Spec proves mid-cluster throw leaves no partial rows. |
| Risk R-n: `umbrellaId` omitted from `markMerged`; count mismatch throws inside callback | COMPLETE | None. `suggestionIds.filter(id => id !== umbrella.id)` and count comparison throw verified by spec. |
| Member re-read (`membersUnchanged`) before write | COMPLETE | None. Aborts if candidate not `candidate` or suggestion not `pending`. |
| Member ordering by centroid distance prior to 12-member synthesis cut | COMPLETE | None. `orderByCentroidDistance` implemented and spec verifies 2 farthest dropped. |
| Below-threshold umbrella handling (R7) | COMPLETE | None. `dismissed` umbrella inserted, candidate members rejected, promoted and suggestions untouched. |
| Backlog purge rules (R5, R6) | COMPLETE | None. Preconditions (vec, truncation, marker) and candidate filter criteria (30d, unclustered, not pending/accepted, embedding, not judge-passed) verified. |
| Clean error isolation: `runPass` never throws into caller | COMPLETE | None. Top-level and sub-routine try/catch wrappers guarantee fail-soft return. |

---

### Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Umbrella ID passed into `markMerged` | YES | Filtered out before empty check and SQL UPDATE | None |
| Member transitions between pool partition and transaction | YES | `membersUnchanged` re-reads rows inside transaction; aborts commit if altered | None |
| Member suggestion becomes non-pending between re-read and `markMerged` | YES | `markMerged` return count mismatches `suggestionIds.length`, throwing error and rolling back transaction (R-n) | None |
| Candidate already decided by concurrent writer (`rejectIfStatus === false`) | YES | Filtered out of `rejectedIds`, counted in `lost`, does not abort commit | None |
| Judge verdict unscored or disabled | YES | Cluster skipped cleanly, no rows written, retried next pass | None |
| Rate-limit bucket exhausted mid-pass | YES | Halts cluster iteration, sets `rateLimited: true`, records `clustersRemaining` | None |
| Cluster dominated by authored skill | YES | Checked before rate limit; skipped cleanly | Exact-case matching (MODERATE) |
| Cluster has >12 members | YES | Sorted closest-to-centroid first; synthesizer drops farthest | None |
| Cluster contains vector dimension mismatch | YES | Mismatched member assigned $-\infty$ similarity and sorted last | Included in prompt if cluster $\le 12$ (MODERATE) |
| Suggestion-only cluster | YES | Resolves candidate anchor from suggestion members | None |
| Pool partition read fails | YES | Caught in `readPartition`, pass skipped, returns `purgeSkippedReason: 'failed'` | None |
| Purge run on pre-0051 DB (missing purge state table) | YES | `read()` catches error and returns null; transaction throws on `markComplete`, rolls back, logs warn | None |
| Second purge run after completion | YES | `purgePrecondition` skips with `'already-complete'`, 0 candidates purged | None |

---

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Exact-case matching in authored-dominance guard could miss case-divergent skill slugs on Windows/macOS.
- What a robust implementation would add:
  1. Case-insensitive normalization for `exemptSlugs` and `dominant` in `planCluster`.
  2. Filtering out vector dimension mismatches in `orderByCentroidDistance` prior to slicing and prompt generation.
  3. Updating the stale comment on `MERGED_INTO_PREFIX` in `types.ts:22`.


## Batch 11

### Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

Scope examined:
- `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.queue.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.activity-feed.integration.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.parity.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.live-poll.integration.spec.ts`

Verification:
- `npx nx run @ptah-extension/rpc-handlers:test --testFile=skills-synthesis-rpc --maxWorkers=2`: 5 test suites passed, 523 passed, 0 failed.
- `npx nx run @ptah-extension/rpc-handlers:typecheck`: passed with exit code 0.

---

### Checkpoints & Focus Answers

1. **`SkillDiagnosticsResult` Type Extension (`rpc-curator-diagnostics.types.ts:259-261`):**
   - Appends strictly `readonly totalMerged: number;`, `readonly totalRetired: number;`, and `readonly totalDormant: number;`.
   - Adheres strictly to the minimal-edit boundary: no existing fields modified or reordered, no touches to `rpc.types.ts`, and no unintended interface expansions.

2. **RPC Handler Method Wiring (`skills-synthesis-rpc.handlers.ts`):**
   - **`skillSynthesis:stats` (`:505-523`):**
     - Correctly maps `activeSkills = s.active` (reflecting resident promoted skills only, excluding dormant skills) and `totalInvocations = s.invocations` (reflecting events joined by candidate slug).
   - **`skillSynthesis:diagnostics` (`:696-745`):**
     - Correctly projects `activeSkills: stats.active`, `totalInvocations: stats.invocations`, and the three new lifecycle totals: `totalMerged: stats.merged`, `totalRetired: stats.retired`, and `totalDormant: stats.dormant`.
     - 586-shared lines preserved: `recentEvents: snapshot.recentEvents.map(toSkillSynthesisEventWire)` (`:720`) remains untouched.
     - Preserves error reporting via `this.report(error, ...)` and rethrowing `RpcUserError(..., 'PERSISTENCE_UNAVAILABLE')` without swallowing.
   - **`skillSynthesis:invocations` (`:487-503`):**
     - Switches store read from deprecated `this.store.listInvocations` to `this.store.listInvocationEvents(skillId, limit)` (R-c).
     - Wire mapping via `toInvocation` (`:2580-2589`) projects `notes` directly from the event `source`.
     - Guard `if (!skillId) return { invocations: [] }` handles missing or empty `skillId` without hitting SQLite.
     - `clampLimit(params?.limit, 200)` enforces bounds between 1 and 200.
   - **RPC Registration Integrity:**
     - No new RPC methods introduced.
     - Static `METHODS` array and method prefix configurations remain unchanged.

3. **Acceptance Criteria Verification (AC 2 and AC 4):**
   - **Acceptance 2:** When a suggestion is accepted and promoted, `SkillCandidateStore` writes `status = 'promoted'` and `is_resident = 1`. In `store.getStats()`, `promoted` and `active` both increment. The RPC handler maps `totalPromoted = stats.promoted` and `activeSkills = stats.active`. When a skill is later marked dormant, `is_resident = 0`, decrementing `activeSkills` while `totalPromoted` retains the full historical count. This accurately supports UI counters.
   - **Acceptance 4:** `store.getStats().invocations` counts rows in `skill_invocation_events` whose `skill_slug` matches a promoted candidate's `name`. The handler passes this directly as `totalInvocations: stats.invocations`. Similarly, `skillSynthesis:invocations` delegates to `listInvocationEvents`, which queries invocation events by candidate slug/id.

4. **Error Handling and Re-throw Discipline:**
   - Every catch block (`:498-501`, `:519-522`, `:734-745`) explicitly logs via `this.report(...)` and rethrows. No catch block returns a fabricated default or swallows an error.

5. **Test Fixtures & Assertions:**
   - `skills-synthesis-rpc.handlers.spec.ts` covers resident-only `activeSkills`, slug-based `invocations`, empty `skillId` defaults, and default/explicit limit bounds.
   - Fixture updates in `skills-synthesis-rpc.queue.spec.ts`, `skills-synthesis-rpc.activity-feed.integration.spec.ts`, and frontend specs (`skill-diagnostics-state.service.spec.ts`, `skill-synthesis-tab.component.spec.ts`, `skill-triggers-settings.parity.spec.ts`, `skill-activity-feed.live-poll.integration.spec.ts`) cleanly supply default zeros for new fields. No test assertions were weakened.

---

### Five logic questions

#### 1. How does this fail silently?
- In `skillSynthesis:invocations` (`skills-synthesis-rpc.handlers.ts:494`), passing an empty, undefined, or whitespace-only `skillId` returns `{ invocations: [] }` with code 200 instead of returning an error or throwing `RpcUserError`. This is intentional fail-soft behavior so client widgets querying without a selected skill id do not produce disruptive toast errors.

#### 2. What user action produces unexpected behaviour?
- Selecting a non-promoted or dismissed candidate in a UI tool and invoking `skillSynthesis:invocations`: `listInvocationEvents` queries events matching that candidate ID. Since runtime invocation events record slugs of active promoted skills, unpromoted candidates return an empty list without indicating that the candidate was never promoted.

#### 3. What input data produces a wrong answer?
- In `clampLimit(params?.limit, 200)`: If an extreme non-numeric or float value (e.g. `NaN`) is passed in an unvalidated RPC environment, `Math.min(Math.max(1, limit), max)` evaluates to NaN, which could reach the store query if not parsed by schema validation upstream. However, `SkillDiagnosticsParamsSchema` and runtime guards sanitize inputs before hitting handlers.

#### 4. What happens when a dependency fails?
- If `this.store.getStats()` or `this.store.listInvocationEvents()` throws (e.g. SQLite database locked or I/O failure):
  - In `skillSynthesis:invocations` and `skillSynthesis:stats`: caught, logged via `this.report(...)`, and re-thrown to the RPC layer, returning an RPC error to the client.
  - In `skillSynthesis:diagnostics`: caught, reported, logged via `this.logger.error`, and re-thrown as `RpcUserError` with code `PERSISTENCE_UNAVAILABLE`.
  - In all paths, the failure is reported and propagated; no partial or corrupt result is returned.

#### 5. What is missing that the requirements never mentioned?
- `SkillSynthesisStatsResult` (`libs/shared/src/lib/types/rpc.types.ts:2766-2772`) was deliberately not augmented with `totalMerged`, `totalRetired`, and `totalDormant` to avoid modifying no-touch core RPC definitions; those counters are instead provided via `SkillDiagnosticsResult` in `skillSynthesis:diagnostics`.

---

### Failure modes

None detected within the review scope.

---

### Blocking issues

None.

### Serious issues

None.

### Moderate and minor issues

- **MINOR (`libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.spec.ts:36-39`):** Pre-existing mock fixture sets `totalPromoted: 2` and `activeSkills: 3`. Under the lifecycle data model, `activeSkills` represents resident promoted skills (`is_resident = 1 AND status = 'promoted'`), which is a strict subset of `totalPromoted` (`status = 'promoted'`). An `activeSkills > totalPromoted` state is impossible in production SQLite data. While this unit test only asserts signal propagation and does not validate domain invariants, aligning mock numbers with domain constraints is recommended.

---

### Data flow

1. **`skillSynthesis:stats`:**
   - Client invokes `skillSynthesis:stats` -> `this.store.getStats()` executes aggregation query over `skill_candidates` and `skill_invocation_events` -> maps `totalCandidates`, `totalPromoted`, `totalRejected`, `totalInvocations: s.invocations`, `activeSkills: s.active` -> returns `SkillSynthesisStatsResult` `[OK]`.
2. **`skillSynthesis:diagnostics`:**
   - Client invokes `skillSynthesis:diagnostics` with params -> validates schema -> `diagnostics.getSnapshot()` -> `this.store.getStats()` -> combines snapshot metadata and event wire array with store lifecycle counts (`active`, `merged`, `retired`, `dormant`, `invocations`) -> returns `SkillDiagnosticsResult` `[OK]`.
3. **`skillSynthesis:invocations`:**
   - Client invokes `skillSynthesis:invocations` with `skillId` and optional `limit` -> checks non-empty `skillId` -> clamps limit to 1..200 -> `this.store.listInvocationEvents(skillId, limit)` -> maps rows via `toInvocation` -> returns `{ invocations }` `[OK]`.

---

### Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Task 11.1: Append `totalMerged`, `totalRetired`, `totalDormant` to `SkillDiagnosticsResult` | COMPLETE | None. Appended strictly to `rpc-curator-diagnostics.types.ts`. |
| Task 11.2: `skillSynthesis:stats` maps `activeSkills = s.active`, `totalInvocations = s.invocations` | COMPLETE | None. Resident-only active count and event-based invocations wired. |
| Task 11.2: `skillSynthesis:diagnostics` maps new lifecycle fields and active/invocations | COMPLETE | None. All 4 status fields correctly mapped from `store.getStats()`. |
| Task 11.2: `skillSynthesis:invocations` uses `store.listInvocationEvents` | COMPLETE | None. Switches to event-based read; maps wire notes from event source. |
| Minimal-edit boundary: 586 `recentEvents` mapping untouched | COMPLETE | None. Mapping at `:720` preserved verbatim. |
| No new RPC methods or `ALLOWED_METHOD_PREFIXES` changes | COMPLETE | None. Preserved. |
| Fixture compatibility in dependent spec files | COMPLETE | None. All 4 frontend specs and 2 backend integration specs updated with zero assertions weakened. |

---

### Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Missing or empty `skillId` in `skillSynthesis:invocations` | YES | Returns `{ invocations: [] }` immediately without hitting SQLite | None |
| Non-positive or excessively large limit | YES | `clampLimit(params?.limit, 200)` constrains to [1, 200] | None |
| Store throws on `getStats` or `listInvocationEvents` | YES | Caught, reported via `this.report(...)`, and re-thrown | None |
| Concurrent promotion/demotion between `getSnapshot` and `getStats` | YES | Read-only point-in-time reads; benign eventual consistency | None |
| Dormant skills present in database | YES | `activeSkills` reflects resident skills only; `totalPromoted` includes dormant | None |

---

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None. Changes are tightly scoped, typechecked, and fully verified by unit and integration suites.
- What a robust implementation would add:
  1. Align the mock numbers in `skill-diagnostics-state.service.spec.ts:36-39` so `activeSkills <= totalPromoted` reflects database invariants.

---

## Batch 9

Reviewer: code-logic-reviewer (in-process; an antigravity lane re-reviews later). Reviewed 2026-10-02.

### Scope

Read in full: `skill-curator.service.ts` (834 lines), `lifecycle/adoptable-slug.ts`, `lifecycle/curator-report.ts`, the
`linkPromotedCandidate` diff in `skill-suggestion.store.ts` (+ its 4 specs), `skill-curator.service.spec.ts` (accept /
reconcile / orchestration cases), `gates/cluster-holdout-end-to-end.spec.ts` (header, harness, imports), the
`register.spec.ts` diff. Collaborators opened for contracts: `skill-promotion.service.ts:400-660`
(`promoteSuggestion`, `adoptMaterializedSkill`, `commitResidentPromotion`, `linkRegistryRow`, `emitRepropagation`),
`lifecycle/skill-retirement.service.ts:201-261` (`removeMaterializations`, `retire`), `skill-md-generator.ts:279-290,419`
(`promoteToActive`, `sanitizeSlug`). Frontend changes ignored.

### Verification

- `npx nx run @ptah-extension/skill-synthesis:test --skip-nx-cache --testPathPattern=...`: the pattern did not narrow
  (jest ran the whole project): 85 suites, 84 passed, 1 skipped; 1788 tests passed, 1 skipped, 0 failed.
- `npx nx run @ptah-extension/skill-synthesis:typecheck --skip-nx-cache`: completed with no errors.
- Grep (libs, apps): `clusterCandidates`, `synthesizeFromCluster`, `insertPending`, `hasExistingForCluster` no longer
  appear in the curator, its spec, or `cluster-holdout-end-to-end.spec.ts`. Remaining hits are the definitions
  (`skill-clustering.service.ts:186`, the store) and their own specs, plus `skill-gap-curator.service.spec.ts` (calls the
  store's `insertPending`, which the store still defines until Batch 12) and an rpc-handlers spec mock object. No
  production caller outside the defining files.

### Score: 7/10

### Verdict: NEEDS_REVISION

The production logic is sound on every R-f / R-f2 / fail-closed question I traced. The verdict rests on two explicit
Batch 6 HARD-carry spec obligations and the R-f2 adopt equivalent that are not met in the spec (S-1), plus one
fail-open path in the exempt-set builder (M-1). Both are small fixes. 7 rather than 8 because a HARD carry is
unproven; not lower because the code itself holds.

### BLOCKING

None.

### SERIOUS

**S-1 Missing specs for the adopt path (Batch 6 HARD carry 1, review focus 1).**
- `skill-curator.service.spec.ts:1015-1029` is the only adopt-failure case and it uses
  `jest.spyOn(promotion, 'adoptMaterializedSkill').mockRejectedValue(...)`. That proves the catch at
  `skill-curator.service.ts:610-620` and the `'failed'` count, but NOT that a throw after the adopt's writes rolls
  back. The accept side has the real proof (`:774-791`: `rejectIfStatus` throws mid-callback, suggestion pending, no
  promoted row, directory gone). There is no equivalent for adopt: nothing makes `mergeMembers` or
  `linkPromotedCandidate` throw inside `commitReconcile` (`:627-638`) and then asserts that no promoted row exists,
  `promoted_candidate_id` is still NULL and the registry row is not flipped to `synth`.
- No adopt-side `RegistrySlugOwnedByPluginError` spec. The accept side has one (`:793-810`). The carry required "a
  spec each". `findAdoptableSlug` filters to `authored|synth` so the throw is normally unreachable, but a registry row
  turned `clone` between `findAdoptableSlug` and the transaction would hit `linkRegistryRow`
  (`skill-promotion.service.ts:620-624`), and that branch has no curator-level proof it returns `'failed'` without
  throwing out of `start()`.
- Also untested: the `linkedOnly` adopt branch (slug already `promoted`, `holder.status === 'promoted'` at
  `skill-curator.service.ts:583-584`), where `onCommit` runs on an existing row via a bare `inImmediateTransaction`
  (`skill-promotion.service.ts:512-516`); a pass awaiting an in-flight reconcile (`:271`); and a reconcile that merges
  a promoted member (only a `candidate` member is asserted at spec `:889-891`).
- Fix: three real-DB cases in the reconcile describe: (a) `jest.spyOn(suggestions,'linkPromotedCandidate')` or
  `store.rejectIfStatus` throwing once; assert no new candidate row, link NULL, registry row unchanged, adopt reports
  `failed`, and a second start (spy removed) then adopts. (b) a registry row for the proven slug turned to
  `clone`/`originPluginId` after the proof (spy on `registry.getBySlug` once), assert warn and row left. (c) the
  `linkedOnly` branch plus a promoted-member merge with `removeMaterializations` called.

### MODERATE

**M-1 `readExemptSlugs` can return a partial set (fail-open) on a mid-build throw.** `skill-curator.service.ts:690-699`:
`exempt = new Set(owned)` is assigned at `:690` before `this.store.listByStatus('promoted')` runs at `:691`. If that
read throws, the catch at `:696` only warns and `:701` returns the authored/diverged set WITHOUT the pinned and
case-variant promoted names. The doc comment (`:666-670`) and the plan promise `null` (fail closed) on an unreadable
read. Impact: the umbrella pass receives a set missing pinned promoted skills, so `partitionPool` may pool them
(accept still skips pinned members via `member.pinned` at `:452`, which limits the damage to a wrongly proposed
umbrella). Fix: build into a local and assign `exempt` only after the loop succeeds (or set `exempt = null` in the
catch). Add a spec where `store.listByStatus` throws and assert the umbrella pass is skipped with
`registry-unavailable`.

**M-2 Reconcile applies the full member merge (including deleting promoted members' directories) to legacy accepted
suggestions at startup, with no user action.** `commitReconcile` -> `mergeMembers` (`:637`, `:458-464`) then
`afterMerge` -> `removeMaterializations` (`:622`). Plan component 10 asks for "the same member merge", so this is as
designed, but for a suggestion accepted weeks earlier any member that was independently promoted since (and is neither
pinned nor `authored`/`diverged`) is rejected `merged-into:` and its directory deleted on boot. The pre-578 accept only
ever merged `candidate` members. Safer: reconcile merges only `candidate` members and leaves promoted ones to the
retirement pass, or the plan owner explicitly accepts this. Raise with the architect before the lane re-review.

**M-3 Unproven rows warn forever and stay outside the lifecycle.** `holdsBody` (`adoptable-slug.ts:79-94`) requires the
on-disk body to equal `suggestion.body` exactly. A legacy accepted skill that was later enhanced
(`SkillEnhancerService` rewrites `SKILL.md` for `synth` clones) or hand-edited stops matching, so it is `missing` on
every start (`skill-curator.service.ts:571-582`): never linked, so retirement and the cap never see it, and a warn per
suggestion per start. Same for `blockedByCandidateRow` (`:583-595`). Safe (fail-closed) but unbounded. Record as a
follow-up: surface the counts in the Batch 11 diagnostics, or log one summary line instead of one warn per row.

**M-4 A pass blocks on the reconcile with no timeout.** `skill-curator.service.ts:271` awaits `this.reconciliation`.
Each adopt awaits `emitRepropagation` per slug with origin `{}` (`skill-promotion.service.ts:552`, `:750-756`), the
non-user-initiated path, which can wait on the background governor. N legacy suggestions x slugs delays every pass,
including a user-initiated `runManual`, behind a startup repair. Only two live rows are expected, so likelihood is low.
Consider `{ userInitiated: true }` for the reconcile (it is data repair) or bounding the await.

### MINOR

- Plan says 9 constructor deps; there are 10 (`mdGenerator` kept for `activeRoot()` at `:211-213`, `:567`). Justified
  in a comment; update the plan or batches note.
- `reconcileAcceptedSuggestions` builds `exempt` once before the loop (`:547`); earlier adopts in the same loop do not
  change authored/diverged membership, so staleness is harmless today.
- `acceptSuggestion` reads `exempt` before the awaited promotion (`:381`); negligible window.
- `start()` called twice leaks the first `setInterval` handle (`:229-241`): identical to pre-batch behaviour, noted only.
- `CuratorReport` exposes an extra `lifecycle` field (`:100`) beyond the plan's four keys; additive and harmless.
  `overlaps` is gone from the type while the frontend tab still reads `report.overlaps` (optional,
  `skill-synthesis-tab.component.ts:638`), so it is safe.

### Focus answers

1. **R-f / R-f2: holds in code, accept proven, adopt not proven (S-1).** `commitAccept` (`:412-428`), `mergeMembers`
   (`:437-468`) and `commitReconcile` (`:627-638`) call only: `suggestionStore.accept` (single `transition`, no own
   transaction), `linkPromotedCandidate` (one UPDATE), `store.findById`, `store.rejectIfStatus`, `registry.remove`.
   No `try/catch` inside any callback or function they call. The fail-soft answers come from catches around the whole
   call: accept `:383-401`, adopt `:597-620`, whole reconcile `:506-518`. `commitResidentPromotion`
   (`skill-promotion.service.ts:561-594`) runs `onCommit` inside the same `inImmediateTransaction`, and
   `promoteSuggestion` removes the directory it created on any throw (`:453-463`). Accept spec `:774-791` (mid-callback
   throw: pending, no promoted row, no dir) and `:828-840` (decided after read: rolled back) are real-DB proofs.
   Adopt equivalent absent: see S-1.
2. **Batch 6 HARD carries: code yes, specs partial.** Catch around `promoteSuggestion`: yes (`:383-401`); specs for
   `RegistrySlugOwnedByPluginError` (`:793-810`) and a generic failure (`:812-826`). Catch around
   `adoptMaterializedSkill`: yes (`:597-620`, any throw incl. the plugin error becomes `'failed'`); spec generic only
   (S-1). Adoption provenance: only a slug that is the sanitized base or `-2..-5`, with an `authored|synth`
   `kind='skill'` registry row, an existing `SKILL.md` and an exactly equal body (`adoptable-slug.ts:33-62`); more than
   one proven slug adopts nothing. Specs: hand-written same-name skill not adopted (`:962-973`), ambiguous
   (`:975-995`), `it.each` synth/authored with a hand-written base slug and a suffixed proven one (`:~881-918`).
   Non-promoted holder (Batch 6 M-1 carry): skipped with warn and counted, never thrown (`:583-595`), spec `:997-1013`.
3. **Reconcile: yes on all four.** It runs in `start()` before the `curatorEnabled` return (`:224` vs `:225`), spec
   `:252-266`. Idempotent: it selects `promoted_candidate_id IS NULL` rows and `linkPromotedCandidate` is guarded on
   `status='accepted' AND promoted_candidate_id IS NULL`; the second-start spec (`:920-941`) asserts no adopt call and
   no new rows. `start()` cannot throw from it: `startReconciliation` (`:504-519`) chains `.catch`, and the sync part
   of `reconcileAcceptedSuggestions` runs inside an async function, so even
   `listAcceptedWithoutPromotedCandidate` throwing becomes a caught rejection. A pass awaits it (`:271`); no spec
   asserts that ordering (S-1 list).
4. **Exempt set: fail closed except one path.** No registry or unreadable `listAll()` gives `null`: umbrella pass
   skipped with `umbrellaSkippedReason: 'registry-unavailable'` (`:330-335`, spec `:430-439`) and accept leaves every
   promoted member unmerged (`:459-460`). The partial-set hole when `listByStatus` throws is M-1. Authored/diverged
   skills are protected twice: exempt names are never merged (`isExempt`, `:830-833`, case-insensitive; spec
   `:728-772` asserts `owned-skill` stays promoted with an `authored` registry row), and `removeMaterializations`
   only receives rows whose conditional reject succeeded. Per-row containment is the retirement service's (Batch 7).
5. **runPass: yes.** Order retirement (`:274`), umbrella (`:275`), enhancement (`:276`), report (`:281`),
   `curator-pass` event (`:283-287`); retirement and umbrella each in their own catch with a `NOT_RUN_*` result
   (`:305-361`), enhancement catches per slug and on selection, report write catches and returns `''` (`:806-817`),
   `onPassComplete` guarded. Specs `:297-387`, `:389-486`. The 0-promoted early return and the LLM overlap review are
   gone; the old-symbol grep and the e2e spec are clean (see Verification). The e2e spec drives a real
   `SkillUmbrellaMergeService.runPass`.
6. **`materializedBaseSlug` duplicate: low correctness risk, real drift risk, no pin.** Today the body is equivalent to
   `SkillMdGenerator.sanitizeSlug` (`skill-md-generator.ts:419-426`) except the time-based fallback (returns
   `null`). If the generator's rule changes, the reconcile derives a different base and `findAdoptableSlug` returns
   `missing`: it fails closed, never adopts a wrong directory, but silently strands legacy skills. There is no spec for
   `adoptable-slug.ts` and none pinning the two together; the reconcile specs use only the plain name `deploy-flow`,
   which any sanitizer handles. Recommend exporting `sanitizeSlug` as a pure function used by both, or one parity spec
   over `'Foo Bar!'`, `'--x--'`, a 70-char name and a non-ASCII name. Treated as MINOR for this verdict.
7. **Silent failures, stale state, races.** Concurrent accepts of the same id: both materialize and commit
   synchronously (no await between `promoteToActive` and `commitResidentPromotion`,
   `skill-promotion.service.ts:424-452`), the loser gets a suffixed directory, throws in `commitAccept`, and
   `removeActiveAfterRollback` removes only its own directory: safe. Accept vs pass on shared members: member status is
   re-read inside the IMMEDIATE transaction and written with compare-and-set, so a member already merged is skipped,
   not double-merged. Accept vs reconcile touch disjoint suggestion rows (pending vs accepted-unlinked). A post-commit
   directory removal failure is logged and the merge stays committed (orphan folder; existing Batch 7 behaviour, not
   new). `purgeSkippedReason: 'failed'` and the retirement/umbrella skip reasons surface in the report and the event
   (`curator-report.ts:107-133`, `skill-curator.service.ts:283-287`; spec `:389-405`). One quiet gap: `skippedExempt`
   members of an accept are only logged (`:493-500`), not returned to the caller.

### Data flow (accept)

1. RPC to `acceptSuggestion`: pending check on a fresh read `:377-380` OK (re-validated inside the transaction).
2. `readExemptSlugs` `:381`: M-1 on a mid-build throw.
3. `promoteSuggestion` (cap read, materialize, one transaction: register, promote, registry link, `commitAccept`) OK.
4. `commitAccept`: `accept(id,row.id)` verified by the returned row `:418-426`; `mergeMembers` CAS per member OK.
5. Throw anywhere in 3-4: rollback, directory removed, caught `:390`, `{accepted:false}` OK.
6. `afterMerge` -> `removeMaterializations` after commit, failure contained OK.
7. Reconcile mirror: `findAdoptableSlug` (proof), holder check, `adoptMaterializedSkill`, `commitReconcile`
   (`linkPromotedCandidate` throws on false), `afterMerge`. Rollback proof for adopt missing (S-1).

## Batch 9 re-review

Reviewer: code-logic-reviewer (in-process; antigravity lane re-reviews later). Reviewed 2026-10-02. Read in full:
`skill-curator.service.ts`, `skill-curator.service.spec.ts` (new cases `:441-460`, `:1036-1275`), `lifecycle/adoptable-slug.ts`,
`lifecycle/adoptable-slug.spec.ts`, and `skill-promotion.service.ts:490-640` (adopt, `commitResidentPromotion`, `linkRegistryRow`).

### Verification

- `npx jest -c libs/backend/skill-synthesis/jest.config.ts skill-curator.service.spec`: 1 suite passed, 31 tests passed, 0 failed.
- `npx jest -c libs/backend/skill-synthesis/jest.config.ts adoptable-slug.spec`: 1 suite passed, 12 tests passed, 0 failed.
- R-f / R-f2 regression grep: every `try`/`catch` in `skill-curator.service.ts` sits outside the callbacks. The callback bodies
  (`commitAccept :412-428`, `mergeMembers :437-468`, `commitReconcile :627-638`) contain none. The adopt catch is at `:597-620`,
  outside `onCommit`. Writes inside callbacks stay plain statements: `accept`, `linkPromotedCandidate`, `rejectIfStatus`,
  `registry.remove`. No regression.

### Resolution of the revision list

- S-1(a) RESOLVED. `spec :1073-1120`. It is real-DB (the store, suggestion store and registry are real). The spy on `store.rejectIfStatus`
  throws once, and `reject` called once proves the throw happened in `mergeMembers` after the `linkPromotedCandidate` UPDATE
  (`commitReconcile :628-633`). It asserts `promotedCandidateId` NULL, no candidate row for the slug, 0 rows with the trajectory
  hash, registry still `authored` with `candidateId` null, member still `candidate`, directory kept and
  `removeMaterializations` not called. It then restores the spy and shows that the next start adopts. The executor's claim is
  accurate. The spec is load-bearing: without the transaction, the link and the registered row would persist and the NULL, row and
  registry assertions would fail.
- S-1(b) RESOLVED. `spec :1122-1156`. The registry row is flipped to `clone` after the proof, through a wrapped
  `adoptMaterializedSkill` (`:1125-1131`). The real `linkRegistryRow` throws, which is `RegistrySlugOwnedByPluginError`
  (`skill-promotion.service.ts:620-624`). The spec asserts `errorName`, `failed: 1`, no candidate row, link NULL and the registry
  row untouched. Real throw, real rollback, not a mocked return.
- S-1(c) RESOLVED. `spec :1158-1188`. A promoted holder is created, so the `linkedOnly` branch (`skill-promotion.service.ts:512-516`)
  is taken. The spec asserts the link points at the holder, the row count is unchanged, there is no trajectory-hash row, the
  member is merged, and `adopted: 1`. Load-bearing: a fall-through to `registerCandidate` would add a row or hit UNIQUE. Gap
  (minor): the `linkedOnly` rollback is not exercised on its own; the shared transaction wrapper is proven by (a).
- S-1(d) RESOLVED. `spec :1190-1230`. The adopt is held on a gate. After a `setImmediate` flush the spec asserts that
  `retirement.run` has not been called. After release, it asserts the suggestion was already linked at the moment retirement
  ran (`linkedWhenPassRan` equals the candidate id and is truthy). If `runPass` stopped awaiting `this.reconciliation`
  (`skill-curator.service.ts:271`), retirement would run during the flush and the first assertion would fail. Load-bearing.
- S-1(e) RESOLVED. `spec :1232-1273`. A promoted member is merged. `removeMaterializations` is replaced by a probe that runs
  `BEGIN IMMEDIATE` on the shared connection; that throws inside an open transaction, so `committedAtRemoval === true` proves
  no transaction is open at removal. The probe also records the member as already `rejected` at removal, and the spec asserts
  the registry row is gone, the removed rows are `['old-skill']` and the origin is `{}`. The executor's claim is accurate
  (`outsideTransaction :1057-1066`). The probe is sound: a real nested `BEGIN` fails, so a false pass is unlikely. Load-bearing.
- M-1 RESOLVED. Code `skill-curator.service.ts:680-701`: `built` is local, `exempt = built` runs only after the loop, and the
  catch leaves `null`. Spec `:441-460` makes `listAll` succeed (one `authored` row) and `listByStatus` throw. It asserts
  `listAll` was called, `umbrella.runPass` was not called, `umbrellaSkippedReason === 'registry-unavailable'`, retirement ran
  once, and the exact warn payload. Reverting to the old partial assignment would run the umbrella pass and fail it.
  Load-bearing, and it covers the exact hole. One caveat: the retirement and enhancement steps are mocks here, so "retirement
  still runs" is only shown by the call count; that is adequate for this contract.
- Slug pin (decision 2) RESOLVED. `adoptable-slug.spec.ts:46-71` drives the real `SkillMdGenerator.promoteToActive` against
  `materializedBaseSlug` for 10 names (kebab, spaces, uppercase, punctuation, `--x--`, accented, emoji/CJK mix, 70 characters,
  a long name cut at a separator, a long name with spaces). It asserts the written slug equals the derived one and that
  `SKILL.md` exists there. `:73-83`: the two names that sanitize to nothing return `null`, while the generator writes
  `skill-<time>`. Tests pass, 12 in all. Load-bearing: a change on either side makes the generator output differ from the helper.

### New findings

None blocking or serious. Minor only: (1) S-1(c) has no linkedOnly-specific rollback case (covered by the shared transaction in
(a)). (2) The M-1 spec makes `listByStatus` throw for every caller, so it does not distinguish a throw on the first versus a
later call; acceptable, since the read is single-shot.

Carried by decision and not re-scored: M-2, M-3, M-4 and the MINOR items.

### Score: 8/10

The previous 7 was held down by an unproven HARD carry. All five adopt-path proofs are now real-DB and would fail on regression,
the fail-open hole is closed with a matching spec, and drift between the sanitizers is pinned against the real generator. Not 9:
the carried M-2 (boot-time directory removal) and M-3/M-4 are unresolved by decision.

### Verdict: APPROVED

## Batch 13

Reviewed: `libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts` (read in full), against `skill-synthesis.service.ts:334-430`, `skill-curator.service.ts:216-356,504-556`, `skill-promotion.service.ts:417-600`, `queue/stage-handlers.service.ts:560-600`, `SqliteConnectionService.openAndMigrate` (`sqlite-connection.service.ts:194`).

### Verification output

- Unmutated: `npx jest -c libs/backend/skill-synthesis/jest.config.ts skill-lifecycle.reachability` gives `Tests: 4 passed, 4 total` (112 s).
- Mutations. Each was applied to production, the spec re-run, then restored from a backup. `git diff --stat -- libs/` was empty afterwards; only the untracked spec remains.

| Mutation | Result |
| --- | --- |
| `skill-curator.service.ts:224` `startReconciliation` commented out | 1 failed, 3 passed (proof 1) |
| `skill-umbrella-merge.service.ts:220` `runPurge` commented out | 1 failed, 3 passed (proof 2) |
| `skill-curator.service.ts:274` `runRetirementStep` replaced by a not-run stub | 1 failed, 3 passed (proof 2) |
| `skill-curator.service.ts:275` `runUmbrellaStep` replaced by a not-run stub | 2 failed, 2 passed (proofs 2 and 3; proof 3 needs the umbrella id) |
| `stage-handlers.service.ts:578` `rejectIfStatus` short-circuited with `false &&` | 1 failed, 3 passed (proof 4) |
| `skill-promotion.service.ts:576,588` row named by the base slug instead of the suffixed slug | 1 failed (proof 3, `findByName(suffixed)` returns null), 3 passed |

My first slug mutation, at `skill-promotion.service.ts:351`, did not compile (`suggestion` is out of scope there), so it gave `Tests: 0 total`. It was also the wrong site: line 351 is the candidate path, and `acceptSuggestion` goes through `commitResidentPromotion` at 576/588. I replaced it with the 576/588 mutation above.

I did not mutate the interval itself (`curator.start` `setInterval`). Without it, `advanceTimersByTime` fires nothing, so `report written` is never logged and the umbrella/purge/retirement assertions fail. That is by inspection, not run.

### Per-proof load-bearing judgement

- **Proof 1: load-bearing.**
  - The only caller of `startReconciliation` is `curator.start`, at `skill-curator.service.ts:224`, reached from `synthesis.start()` at `skill-synthesis.service.ts:426`. The seeded accepted suggestion has `promotedCandidateId` null and no candidate row, so nothing else can link it. Removing the call fails the proof.
  - The `settle()` at spec:477 does not assert its return value. The `expect`s that follow are what carry the proof, so this is harmless.
- **Proof 2: load-bearing.**
  - `jest.useFakeTimers` fakes only the interval clock; `Date` and `setTimeout` stay real (spec:458). `start()` is called after the fakes are installed, so the production `setInterval` is captured. `advanceTimersByTime(HOUR_MS)` at spec:499 fires the production callback, not `runPass` directly.
  - Pre-conditions are asserted: `purgeState.read()` is null and no report has been logged. Without the interval nothing fires.
  - Removing `runPurge`, `runRetirementStep` or `runUmbrellaStep` each fails the proof.
  - Pinned and recently-used negative controls exist, and the retired skill's directory and synth registry row are asserted gone.
- **Proof 3: load-bearing.**
  - Mutating the row name fails it.
  - The collision is staged by the test creating the base directory (spec:561). Production then picks `-2` through `promoteToActive`. This is a legitimate way to force the collision.
  - The base-slug event is a real negative control: the base slug has no row, and `invocations` rises by exactly 1.
- **Proof 4: load-bearing.**
  - Short-circuiting `rejectIfStatus` fails it: the rejection is not written, and `reason` ends in `:not-candidate`.
  - The fake judge gives criterion 3, below the floor, through the real panel and the real drain.
  - Positive control is missing (see MODERATE below).

### Deviation rulings

- **(a) `openAndMigrate()` before `start()`: ACCEPTED, does not weaken proof 1.**
  - `start()` guards with `if (!this.connection.isOpen) await this.connection.openAndMigrate()` (`skill-synthesis.service.ts:351`), and `openAndMigrate` is idempotent (`sqlite-connection.service.ts:195`).
  - Production migration is exercised, not mocked. The spec calls the real `SqliteConnectionService.openAndMigrate` with the real migration runner. Only the vec table is a plain-table substitute.
  - Proof 1's claim is `curator.start` to `startReconciliation`, which sits well after line 353. The skipped branch is an unrelated no-op guard, and the proof does not depend on it.
  - Residual: no proof asserts that `start()` itself opens the DB (line 352). That is out of this batch's claim.
- **(b) Proof 4 candidate created inside the proof: ACCEPTED.** It must be a fresh `candidate` row, and the earlier rows are consumed by proof 2. See MODERATE for the related order dependence.

### Acceptance coverage (2, 4, 5)

I did not open the task-description text. Coverage is judged from the batch claims and the code paths exercised.

- Reconcile, retirement, umbrella merge, backlog purge and its marker, the suffixed slug (A4), and the judge-panel rejection all have a production-entry proof that fails on mutation.
- Promoted and Active +1 are asserted (spec:579-580).

### Findings

**BLOCKING:** none.

**SERIOUS:** none.

**MODERATE**
1. spec:136-649 — The proofs are order-dependent. Proof 3 needs `umbrellaId`, set in proof 2 (guarded by `expect(umbrellaId).not.toBe('')`, so it fails loudly rather than silently). Proof 4 depends on `start()` from proof 1, which registers the stage handlers (`skill-synthesis.service.ts:343`). Running with `-t` or `--randomize` breaks them. Either document this at the top of the file or move `start()` and the umbrella pass into `beforeAll`.
2. spec:609-648 — There is no positive control for proof 4. The proof shows the below-threshold rejection, but not that a candidate at or above the threshold survives. A mutation that always rejects, for example `score !== null`, would pass. Add a second candidate with score at or above the floor and assert it stays `candidate`.
3. spec:222-225 (`loggedInfo`) and spec:500 — The report-written signal is a log string from `logger.info`. A renamed message would fail proof 2 with a misleading timeout-shaped assertion. Acceptable, but brittle.

**MINOR**
1. spec:477 — the return value of `settle` is unchecked in proofs 1 and 2. The following assertions cover it, but an explicit `expect(await settle(...)).toBe(true)` would give a clearer failure.
2. spec:97-98 — `describe.skip` when the sqlite factory is unavailable. A CI environment without it would silently skip all four proofs. Confirm that CI resolves the factory.
3. Run time is about 112 s for 4 tests; `PROOF_TIMEOUT_MS` is 30 s per test, so the cost sits in `beforeAll`. Check that `beforeAll` has a sufficient timeout under CI load.

### Score: 8/10

Evidence for the band: all four proofs fail on removal of the production call they claim to reach, shown by six local mutations (plus the extra interval-by-inspection check), with no production edits left behind. The fakes (rate limit, LLM and judge) feed real inputs through real services and do not make the assertions trivially true. The gaps are order dependence and a missing positive control, not unproven claims, so this is not a 9-10.

### Verdict: APPROVED


---

## Batch 15

Reviewer: code-logic-reviewer (in-process). Scope: the uncommitted diff of `adoptable-slug.ts`, `skill-curator.service.ts`, `skill-promotion.service.ts`, `skill-candidate.store.ts`, the new `skill-candidate.row-mappers.ts`, and the curator and adoptable-slug specs. Source and specs were not modified.

### Verification output

```
npx jest -c libs/backend/skill-synthesis/jest.config.ts skill-curator.service.spec adoptable-slug.spec skill-candidate.store.spec
Test Suites: 3 passed, 3 total
Tests:       164 passed, 164 total
```

I did not run mutations, because the worktree is shared. Load-bearing judgements below come from reading the assertions against the code.

- **Score:** 7/10
- **Verdict:** APPROVED
- **Blocking issues:** 0
- **Serious issues:** 0

The two live shapes are fixed and their rollback is proven. The revive path keeps columns it has no reason to keep. None of them re-rejects or hides the revived skill. The one real hazard is a retirement-clock edge case (M2).

### Stale-column table (revived `rejected` row, `repromote-rejected` path)

The revive path never calls `registerCandidate`. `commitResidentPromotion` (skill-promotion.service.ts:589-606) and the UPDATE at skill-candidate.store.ts:503-509 write only these columns:
- `status`, `promoted_at`, `body_path`, `name`;
- `residency = 'resident'`, `rejected_at = NULL`, `rejected_reason = NULL`.

Every other column keeps the rejected row's value.

| Column | Reader(s) file:line | Effect | Harmful? |
|---|---|---|---|
| `status`, `promoted_at`, `body_path`, `name` | store.ts:503-509 (written) | Overwritten. `body_path` is set to `args.filePath` (the SKILL.md under activeRoot), confirmed at store.ts:507 and by spec (a) asserting `bodyPath`. | No |
| `residency`, `rejected_at`, `rejected_reason` | `getStats` store.ts:1585-1593; `listActiveOrderedByDecayScore` store.ts:386; retirement.service.ts:142 | Reset to resident and null. Without the reset, a dormant revived row would count in `dormant` and be skipped by the cap. Spec (a) seeds `dormant` and asserts `resident`. | No (the fix itself) |
| `description` | `toSummary` rpc-handlers:2395; trigger-eval; UI list | Keeps the OLD candidate description. The suggestion's description (`input.description`, curator.ts:603) is dropped on this path. SKILL.md frontmatter is authoritative for the harness. | Acceptable. Cosmetic mismatch in the UI list (M3) |
| `display_name` | rpc-handlers:2410 | Stale label from the old candidate. | Acceptable (cosmetic) |
| `embedding_rowid` | `partitionPool` skill-clustering.service.ts:150-154; `searchActiveByEmbedding` store.ts:1569; trigger-eval.service.ts:529; umbrella-merge.service.ts:793 | The suggestion centroid (`input.embedding`, curator.ts:605) is silently dropped. The old candidate embedding stays, or NULL. NULL makes the promoted row `unembedded` and excluded from the umbrella pool and the dedup search. A stale vector clusters by the old candidate's content. | Acceptable but a gap (M1). Nothing breaks |
| `source_session_ids` | umbrella-merge.service.ts:687; stage-handlers.service.ts:701 | Old candidate sessions, not the suggestion's `memberSessionIds`. An umbrella built from this row lists those sessions. | Acceptable (m1) |
| `trajectory_hash` | `findByTrajectoryHash` store.ts:147 | Keeps the old hash. `suggestion:<id>` is not written (spec (a) asserts `rowsWithHash(...) === 0`). | Acceptable. Same dedup behaviour as before the revive |
| `success_count` / `failure_count` | `toSummary` rpc-handlers:2397; store.ts:977, 989 | Only the DTO and two accessors read them. `getWinRates` and the decay score use `skill_invocation_events`, not these columns. | No |
| `judge_score`, `judge_status`, `judge_reason`, `judge_*` criteria, `judge_panel_rationales`, `judged_at` | `isJudgePassed` umbrella-merge.service.ts:850-856 (fed only by `listByStatus('candidate')`, :783); `applyJudgePanelGate` stage-handlers.service.ts:578; `toSummary` rpc-handlers:2412-2420; skill-candidates-table.component.ts:605 | **Not a re-reject or hide risk.** The `judge_status` union is `scored/unscored/disabled` (types.ts:40), so a rejected status never exists. The judge gate and the purge read only `status='candidate'`. The only judge-driven write is a compare-and-set on `status = 'candidate'` (stage-handlers:578-588), which leaves a promoted row alone. The old low score and reason do render as a judge badge on an active skill in the candidates table. | Acceptable. Cosmetic and misleading (M3) |
| `replay_*`, `trigger_*` | gates run on candidates only; DTO rpc-handlers:2429 | A promoted row is never re-gated. The values are echoed to the DTO. | No |
| `pinned` | retirement.service.ts:134; clustering.service.ts:166; curator.ts:459 | A pinned rejected row stays pinned, so retirement, the umbrella pool and `mergeMembers` all exempt it. That is the user's explicit choice. | No |
| `workspace_root` | scoped reads store.ts:357 | The old candidate's project root stays. The normal adopt registers `workspaceRoot: null` ("unknown", included everywhere). A revived row is hidden from other workspaces' scoped candidate lists. It does not affect skill injection. | Acceptable (M3) |
| `created_at` | `listPromotedLastUse` store.ts:559 (last fallback only) | Old value. `promoted_at = now` is read before it, so no stale clock comes from this column. | No |
| Idle clock (derived) | store.ts:559 `COALESCE(max invoked_at for slug, promoted_at, created_at)` | Events are keyed by slug, so OLD events survive the rejection. A non-diverged revive whose last invocation was more than N+M days ago can be retired by the next hourly sweep. Diverged revives are exempt (retirement.service.ts:134-136, :350). | Policy-consistent, but surprising for a just-adopted skill (M2) |

### Findings

**BLOCKING:** none.

**SERIOUS:** none.

**MODERATE**

- **M1. The revive path drops the suggestion centroid.**
  - `repromoteRejectedId` skips `registerCandidate` (skill-promotion.service.ts:589-599), the only writer of `embedding_rowid`. `input.embedding` is computed (curator.ts:605) and then ignored on this path.
  - Impact: the promoted skill carries an unrelated old vector, or none. If none, it is `unembedded` and invisible to umbrella clustering and `searchActiveByEmbedding` dedup.
  - Fix: on revive, call `store.setEmbedding(id, embedding)` inside the transaction (a plain statement), or document the loss as accepted.
- **M2. The retirement idle clock is not reseeded for a non-diverged revive.**
  - Old `skill_invocation_events` for the slug win over `promoted_at` (store.ts:559).
  - A revived `synth` row whose last invocation was more than N+M days ago can be retired at the next sweep (retirement.service.ts:136-139), removing the directory the user just had adopted.
  - A `retired:unused` holder is the sharpest case. It should not normally have a directory and a registry row, because retirement removes both. If both reappear, the sweep deletes them again.
  - Fix: block `retired:*` holders in `slugHolderDecision` (adoptable-slug.ts:93-105), or exempt a freshly adopted row for one cycle.
- **M3. Revived rows show stale labels and scope in the UI.**
  - `description`, `display_name` and the judge score and reason are the old candidate's (rpc-handlers:2395-2420), and `workspace_root` hides the row from other workspaces' scoped lists.
  - Fix: write `description = input.description` and `workspace_root = NULL`, and clear `judge_*`, in the revive UPDATE. Or leave it and note it.
- **M4. Diverged adoption has no content tie-back.**
  - The diverged proof is slug plus registry row plus file exists (adoptable-slug.ts:132-134).
  - A different synthesized diverged skill that happens to share the suggestion's base slug, with no candidate holder, is adopted as this suggestion's output. The `-2` to `-5` ambiguity check does not cover a single hit.
  - Narrow: sidecar `pluginId: null` marks a synthesized skill (origin-sidecar.types.ts:123), so a hand-written skill is not adopted.
  - Fix: optionally require the frontmatter `name`, or a candidate or suggestion link, to match.

**MINOR**

- **m1.** `source_session_ids` and `trajectory_hash` stay stale on revive. No reader is harmed.
- **m2.** No store-level spec for `promoteAtomically({ fromStatus: 'rejected' })` (skill-candidate.store.spec.ts is untouched). It is covered only through the curator spec.
- **m3.** A diverged adopted row counts toward the resident cap and can be demoted as the weakest. `authoredSlugs` (promotion.service.ts:980) includes only `authored`, so cap demotion can hide an edited skill although retirement exempts it. This is pre-existing, but the diverged adopt widens it.
- **m4.** The specs do not assert the stale columns, the embedding, or the cap-demotion interaction on revive. The combination of a diverged registry row and a rejected holder is untested. The two shapes compose, but only separately.

### Answers to secondary checks

1. **R-f / R-f2 and rollback.**
   - Compliant. Inside `inImmediateTransaction` (skill-promotion.service.ts:589-610) there is no try/catch, and every statement is plain or the re-entrant `promoteAtomically`.
   - The guarded UPDATE throws when `changes !== 1` (store.ts:518-523), so the adopt rolls back.
   - Spec (b) proves it. It flips the row to `promoted` just before the transaction, then asserts:
     - the suggestion link is unset;
     - the registry row is unchanged;
     - the member is still `candidate`;
     - `outsideTransaction()` is true;
     - `failed: 1` with `was not promotable` is logged.
   - Spec (f) proves rollback of the registry throw (`RegistrySlugOwnedByPluginError`).
2. **Ordinary candidate path.**
   - The UPDATE (store.ts:503-509) now sets `residency = 'resident'` and clears `rejected_*` for every promotion.
   - A `candidate` row cannot be dormant. The residency column defaults to `resident` (migration 0026) and `registerCandidate` does not write it.
   - The only writers of dormant are `setResidency` (retirement, promoted rows only, retirement.service.ts:143) and the cap demotion (store.ts:483-489, promoted rows only).
   - `rejected_*` on a `candidate` row is always NULL. So the change is a no-op on that path.
3. **Skipped transition check.**
   - Safe. `promoteAtomically` has exactly two callers: skill-promotion.service.ts:347 (always the default `'candidate'`) and :601 (`'rejected'` only when `args.rejectedId` is set).
   - `rejectedId` is set only when `existing.id === input.repromoteRejectedId`, which only the curator's `repromote-rejected` decision supplies (curator.ts:610-611, promotion.service.ts:543-546).
   - The UPDATE is a compare-and-set on `status = @fromStatus`, so a row that changed is not promoted, and the call throws.
4. **Diverged adoption without a body check.**
   - A hand-written skill is not adopted. A diverged row with `originPluginId === null` is a synthesized skill the user edited: sidecar `pluginId: null` marks it (origin-sidecar.types.ts:123), and `deriveStatus` yields `diverged` only from `clone.diverged` (skill-registry-catalog.service.ts:92). A hand-written skill has no sidecar.
   - After adoption the row stays `diverged`:
     - `linkRegistryRow` keeps it (promotion.service.ts:643, 655);
     - retirement exempts it (retirement.service.ts:350);
     - the curator's exempt set includes it (curator.ts:700);
     - the umbrella pool excludes it through `exemptSlugs` (clustering.service.ts:166).
   - It still counts toward the resident cap and can be demoted by the cap (m3). That inconsistency is pre-existing, not new.
   - See M4 for the residual same-slug collision risk.
5. **`slugHolderDecision`.**
   - Reviving a judge-rejected or purge-rejected row is correct. The user accepted the suggestion, and the live proof is the directory plus the registry row.
   - `merged-into:*` is blocked, which is correct.
   - A `retired:*` row can fight the sweep. A retired row normally has no directory or registry row, so it is rarely adoptable. When it is, old events make it retire again (M2).
6. **Row-mappers move.**
   - Behaviour-identical. I diffed the mapper body line by line. The `JSON.parse` fallback to `[]`, the `?? null` normalizations, `residency === 'dormant'`, and `toJudgeStatus` downgrading unknown values to `'unscored'` are unchanged. The logger is injected, and `listPromotedLastUse` goes through the store's `toCandidateRow`.
   - The swallowing catch (row-mappers.ts:101) is unchanged. It turns a corrupt `source_session_ids` into an empty list with no log. It is a pre-existing silent fallback with no degradation-audit marker (MINOR).
7. **Specs (a)-(g).**
   - Load-bearing for the two live shapes:
     - (a) is shape 1, a rejected row plus a `synth` registry row, with the `dormant` seed, the no-second-row assertion and the merge flow.
     - (c) is shape 2, a diverged registry row with an edited body.
     - (b) and (f) prove rollback.
     - (d) is the missing-file negative.
     - (e) covers both blocked holders (live candidate, merged).
     - (g) shows retirement leaves the diverged adoption alone, with an `idle-synth` positive control.
   - Gaps are listed in m2 and m4. No spec pins the stale-column behaviour.

## Batch 15 re-review

Reviewer: code-logic-reviewer (in-process). Scope: the Batch 15 fix delta (`resetRevivedContent`, `listPromotedLastUse`, `slugHolderDecision`) and its specs. No source or spec file was modified or mutated.

### Verification output

```
npx jest -c libs/backend/skill-synthesis/jest.config.ts skill-candidate.store.spec skill-curator.service.spec skill-retirement adoptable-slug.spec skill-lifecycle.reachability
Test Suites: 5 passed, 5 total
Tests:       198 passed, 198 total
```

- **Score:** 8/10
- **Verdict:** APPROVED
- **Blocking:** 0 / **Serious:** 0 / **Moderate:** 0 / **Minor:** 3

### 1. M1-M3 resolution

- **M1 (embedding) resolved.** `resetRevivedContent` (skill-candidate.store.ts:564-604) writes a new vec row from `input.embedding` only when `vecStatus.available`, else NULL (:572-575). `embedding_rowid` is set in the UPDATE (:579). The adopt input's centroid now replaces the stale vector.
- **M3 (stale labels and scope) resolved.** The same UPDATE (:578-593) sets description and `source_session_ids` from the input, and NULLs `display_name`, `workspace_root`, every `judge_*` column, `judged_at`, `replay_*` and `trigger_*`. It is called inside the revive transaction (skill-promotion.service.ts:608-610), and the guard `WHERE id=? AND status='promoted'` throws when `changes !== 1` (store.ts:597-603), so the unit rolls back.
- **M2 (idle clock) resolved.**
  - `listPromotedLastUse` (store.ts:614-629) takes `MAX(COALESCE(event, promoted_at, created_at), COALESCE(promoted_at, created_at))`. Old events can no longer predate the promotion clock.
  - `slugHolderDecision` blocks `retired:*` (adoptable-slug.ts:103-110, `RETIRED_REASON_PREFIX` at :36).

### 2. Embedding and the vec table

- **Orphan:** yes, the old vec row is orphaned. It is dead weight (one vector of storage), not a correctness problem. The pattern is pre-existing: the supersede path overwrites `embedding_rowid` the same way (store.ts:282-291), and nothing in the store ever DELETEs from `skill_candidates_vec`.
- **kNN / similarity readers:** none read the vec table directly. The only SQL touching it is `insertEmbedding` (store.ts:1694) and `readEmbedding` (:1704, a lookup by rowid). `searchActiveByEmbedding` (:1627-1643) iterates candidate rows and reads each row's own `embeddingRowid`. `getEmbedding(rowid)` serves `partitionPool`. An orphan vec row is never returned, never attributed to a candidate, and no join can see it.
- **R-f / R-f2:** compliant. `insertEmbedding` is a plain `INSERT` with no catch. `resetRevivedContent` has no try/catch, and a failure rolls the transaction back. The skill-promotion.service.ts:589-610 callback still has no catch.

### 3. M2 grace semantics: APPROVED and intended

- **Scope 4 reading.** Scope item 4 is "no use for N days". Measuring the "no use" interval from promotion for a skill that has never been used since it was promoted is a faithful reading. The previous code already fell back to `promoted_at` for rows with no events (the earlier review's table showed `COALESCE(max, promoted_at, created_at)`).
- **Behavioural delta.** The new clause changes behaviour only when an event predates `promoted_at`. That happens on a re-promotion or an adopt, or when a slug was used before it was (re)promoted. A normally promoted row has `promoted_at <= every event`, because events are written after promotion, so it is unchanged. A skill promoted long ago and never invoked still has an old `promoted_at` and is still dormant at N days and retired at N+M. A long-idle skill is not shielded.
- **Specs and proofs.** The reachability proof (dormant at 45 days, retired at 100 days) and the retirement specs still pass (198 tests) and mean what they claim. They seed `promoted_at` and events consistently, so the new clause is inert for them.
- **Cost.** The only delay is one grace window for a freshly adopted or revived skill, which is the desired behaviour (M2).

### 4. Are the new specs load-bearing? (reasoned, no mutation)

- **curator (h):** seeds the stale columns, then asserts each is overwritten or NULL after the adopt. It would fail if any column were dropped from the UPDATE.
- **curator (i):** seeds old events plus a revive and asserts the row is not idle at the next sweep. It fails without the `MAX(..., promoted_at)` clause.
- **curator (e3):** the `retired:*` holder is blocked. It fails if the prefix check is removed.
- **store specs:** cover the vec and no-vec embedding paths and the not-promoted throw (the guard).
- **adoptable-slug spec:** the retired-to-blocked case is a direct assertion of `slugHolderDecision`.
- **Gap (MINOR m5):** I could not confirm by mutation that (h) distinguishes a NULLed column from one never written. It does if it asserts `toBeNull()` against a non-null seed. I read it that way, but did not run a mutation.

### 5. Regressions

None found.
- **R-f / R-f2:** compliant, see answer 2.
- **Counters:** `success_count`, `failure_count` and `pinned` are kept. Stats read `status` and `residency`, which `promoteAtomically` already resets.
- **UI DTO:** the DTO passes `displayName ?? null` (skills-synthesis-rpc.handlers.ts:2407). The table's `buildTitle` (skill-candidates-table.component.ts:542-546) renders `Untitled · <created date>` for a NULL display name. This is the same rendering a freshly adopted row gets.
- **Judge fields:** `toJudgeStatus` maps NULL to null (row-mappers.ts:80). The old low score no longer appears on an active skill.

### New findings

- **MINOR m5:** see answer 4.
- **MINOR m6:** a revived row shows `Untitled · <old created_at>`, because `created_at` is kept. The date is old, so the title can look stale. Cosmetic.
- **MINOR m7:** orphan vec rows accumulate on every revive and supersede. They are bounded and harmless. A vacuum or DELETE of the old rowid in `resetRevivedContent` would clean it up.

M4 (diverged adoption without a content tie-back) and m1-m4 from the earlier review are unchanged. M4 is accepted as a narrow residual risk.
