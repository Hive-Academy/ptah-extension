# Code Logic Review — `TASK_2026_443_40ec` — Batch 7

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 2        |
| Failure modes found | 0        |

Scope reviewed in full: `memory-retention-job.ts` (127 lines), `memory-retention-job.spec.ts`, `start-thoth-cron.spec.ts` (1,114 lines), cli-engine `thoth-runtime.spec.ts` (863 lines), `memory-retention.integration.spec.ts` (changed blocks plus assertions), `retention-sqlite.test-support.ts` (455 lines), the production `start-thoth-cron.ts`, cli-engine `thoth-runtime.ts` (retention block), `memory-retention.service.ts` (663 lines), and `batch-7-report.md`.

Independent checks I ran (not taken from the report):

- `expect(` count in `memory-retention.integration.spec.ts`: **159 before, 159 after** (counted with `grep -c` on the working tree and on `HEAD:`).
- `git diff --stat` on `start-thoth-cron.ts`, cli-engine `thoth-runtime.ts`, `memory-retention.service.ts`: **empty**. The only production diff is the `memory-retention-job.ts:98` summary literal.
- Both reachability proofs run live by me and **pass**: thoth-runtime (`-t lifecycle`: 1 passed / 42 skipped) and cli-engine (`-t lifecycle`: 1 passed / 20 skipped). The 1/31 and 1/21 totals in the mutation outputs match this filter shape, so the recorded mutation runs targeted the same test.

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path. The handler's resolve-failure → `skipped` / `retention-service-unavailable` mapping (`memory-retention-job.ts:77-82`) is pre-existing, deliberate, and documented in the file header (`:55-60`). The new `seedMemories` catch rolls back and **rethrows** (`retention-sqlite.test-support.ts:394-397`), so a seed failure fails the test rather than shrinking the cohort — a shrunk cohort would break the exact `memoriesEvicted: 6` / `10` assertions at `memory-retention.integration.spec.ts:544,583`.

### 2. What user action produces unexpected behaviour?

None introduced. The only user-visible change is the cron run summary text, which now carries the memory counts. The text is pinned literally in `memory-retention-job.spec.ts:122-125,139-142`, so drift fails a test.

### 3. What input data produces a wrong answer?

None found. The summary reads `report.memoriesArchived|Deleted|Evicted` (`memory-retention-job.ts:98`); those fields are produced only from the lifecycle step result in `memory-retention.service.ts:536-538`. A missing field would print `undefined` into the summary and fail the pinned spec strings.

### 4. What happens when a dependency fails?

The reachability proofs fake the service's collaborators (store, reclaimer, sqlite handle) by design; the service, its gates, its budget and its report mapping are real. Dependency-failure behaviour of the production service is unchanged and was not in this batch's scope. In the test support, an insert failure inside `seedMemories` rolls back the whole cohort and rethrows — the test fails loudly.

### 5. What is missing that the requirements never mentioned?

Mutation B's adjusted source text is not quoted in the report (see Minor 1). Nothing else: all four tasks and the three cross-batch rules are implemented.

## Confirmation of the requested checks

### 1. Task 7.2 — Electron proof is genuine

`start-thoth-cron.spec.ts:965-987` calls the real `startThothCron` (imported at `:17`), then takes `handlers.get('memory:retention')` (`:970`) — the handler that production `registerMemoryRetentionJob` registered at `start-thoth-cron.ts:277-286` (wrapped in `withActivityEmit`, built from `createMemoryRetentionHandler(container)`). It is not hand-built.

- (a) If `startThothCron` stopped registering the job, `handlers.get('memory:retention')` is `undefined` and `handler({...})` at `:971` throws `TypeError` — the test fails.
- (b) If the handler stopped calling `service.run`, `execute` never runs, so `runStep` receives 0 calls and `expect(runStep).toHaveBeenCalledTimes(1)` at `:977` fails.
- (c) If `execute` stopped calling `lifecycle.runStep` (`memory-retention.service.ts:378`), the same call-count assertion fails.

The summary assertion at `:982-986` (`stringContaining('archived 4 / deleted 2 / evicted 1 memories')`) can only pass when the spy's return value flows through `execute` → `finish` (`memory-retention.service.ts:536-538`) → handler summary — the chain the umbrella rule wants proven. The fake collaborators cannot produce that substring any other way: the store and reclaimer fakes return zeros, and the numbers 4/2/1 exist only in the spy result.

### 2. Task 7.3 — CLI proof is genuine

`thoth-runtime.spec.ts:597-629` calls the real `activateThoth(container, 'runtime', logger)` (`:605`), takes the `memory:retention` registration out of `handlerRegistry.register.mock.calls` (`:607-610`, asserted defined at `:610`), and invokes it. Production `registerMemoryRetentionJob` (`thoth-runtime.ts:528-549`) registers the same shared `createMemoryRetentionHandler` behind the three-token guard. The `overrides` map at `thoth-runtime.spec.ts:187` replaces only the `resolve` return for `MEMORY_RETENTION_SERVICE`, while `isRegistered` still consults `WITH_RETENTION` (`:468-471`), so the production guard sees a registered service and the handler resolves the real one.

The oneshot test is intact at `thoth-runtime.spec.ts:707-716` and still asserts the oneshot tier registers nothing, upserts nothing, and never calls `retention.run`.

### 3. Mutation evidence

- **Mutation A** (remove `lifecycle.runStep` from `execute`): both host proofs failed at the call-count assertion (`batch-7-report.md:99-114`). Consistent with the code I read.
- **Mutation B** (remove `service.run` from the handler): the first attempt failed at compile time; the adjusted rerun failed both proofs with `runStep` at 0 calls (`batch-7-report.md:121-135`). Judgment: a mutation that still called `service.run` with an intact `execute` would show 1 call; 0 calls is only producible when the handler no longer reaches `service.run` → `execute` → `runStep`. The adjusted mutation therefore still genuinely removed the `service.run` call — it changed the fabricated report's type shape, not the removed call. The adjusted source text is not quoted, so this rests on the output signature plus the restore proof (Minor 1 records the gap).
- **Restore**: I verified it myself. `git diff` on `memory-retention.service.ts`, `start-thoth-cron.ts` and cli-engine `thoth-runtime.ts` is empty; `memory-retention-job.ts` differs only at `:98` (summary literal). Matches the report's restore proof.

### 4. Task 7.1 — summary only

`git diff` on `memory-retention-job.ts` shows exactly one changed line (`:98`). The guarded resolve block (`:69-82`), job id / name / handler name / cron (`:39-45`), skipped mapping (`:90-92`), failed-report throw (`:93-97`) and partial suffix (`:100-103`) are unchanged. The `thoth-runtime/CLAUDE.md` bullet addition is accurate against the code: the summary template matches `:98` exactly, and "runs the lifecycle step inside the same budget" matches `execute` passing its single `RetentionRunBudget` to `runStep` (`memory-retention.service.ts:278-288,378`).

### 5. Task 7.4 — R-TL11

- `expect(` count: **159 → 159**, counted by me. The diff touches only seed construction — no assertion was changed, removed, weakened, or moved into a conditional or skipped branch. No `it.skip` / `describe.skip` was added.
- Seed counts unchanged: 1,003 old + 3 grace + 20 workspace-B + 2 protected = the 1,006-row cap cohort; 1,010 recall rows (`memory-retention.integration.spec.ts:510-543,575-582`). The 40/10/2/2/2/5 main cohort is untouched by the diff.
- Row contents identical: same ids, workspace roots, tiers (`'archival' as const` — same value), `archivedAt`, `lastUsedAt` expressions, pinned flags; `cap-b-*` keeps the implicit `lastUsedAt` default (1,000) in both versions; insertion order is preserved, so rowids are unchanged.
- No shared fixture was added; `seedMemories` runs on each test's own temp database, so no cross-case leakage is possible.
- No per-test timeout was added. The two existing `120_000` timeouts (`memory-retention.integration.spec.ts:569,591`) are pre-existing (present at `HEAD`) and carry no measured-reason comment, but this batch did not add or move them, so no new obligation arises. They are now ~300× the measured post-change duration (~0.4 s); shrinking them is optional follow-up, not a defect.

### 6. XB1 / XB2 / XB3

- **XB1**: every statement in `seedMemories` binds all positional parameters on every execution — memory insert has 12 `?` and 12 bound values (`retention-sqlite.test-support.ts:312-357`), chunk insert 6/6 (`:360-367`), rowid lookup 1 (`:368`), vec insert 2 (`:369-372`), concept insert 2 (`:374-376`). The Electron better-sqlite3 run in the report (43 suites / 702 tests) is consistent.
- **XB2**: the only new catch (`retention-sqlite.test-support.ts:394-397`) rolls back and rethrows — not fail-open, no annotation required. No other new catch exists in the diff.
- **XB3**: neither proof bypasses the budget. The real `execute` constructs `new RetentionRunBudget(...)` (`memory-retention.service.ts:278-288`) and passes it to `runStep` (`:378`); both proofs assert `expect.any(RetentionRunBudget)` (`start-thoth-cron.spec.ts:979`, cli-engine `thoth-runtime.spec.ts:621`), which checks the real class. Governor `null` exercises the defined fast path (`retention-run-budget.ts:63`: `if (governor === null ...) return this.hardStop()`).

### 7. Fakes passing for the wrong reason

None found. Every gate the real service checks is passed through its real code, not skipped: `bootDeferralMs: 0` clears gate 3 through the real comparison (`memory-retention.service.ts:231`), the power monitor fake feeds the real handler's `isOnBattery` closure, the absent foreground tracker takes the handler's real `Infinity` branch (`memory-retention-job.ts:117-121`), `readState() → null` reaches the real due check (`:249-257`), and `autoVacuumMode: 0` drives the real non-incremental reclaim branch (`:447-448`). The expected summary substring is not returned by any fake directly.

## Failure modes

None in production code — this batch changed one production string literal, and that literal's shape is pinned by three specs. The two minor items below are evidence-quality and test-support notes, not runtime failure modes.

## Minor issues

### 1. Mutation B's adjusted source is not recorded

- File: `batch-7-report.md:116-135`
- Scenario: a future reader cannot re-verify that the adjusted mutation removed `service.run` rather than altering another path; the report quotes only the failure output.
- Impact: low. The output signature (0 `runStep` calls on both hosts) plus my reading of the code makes any other removed call impossible, but the report asked for "every mutation-check output" and the source is the check, not just the output.
- Fix: none required for approval. If the report is ever revised, paste the adjusted handler body into the mutation section.

### 2. `seedMemories` rollback can mask the original seed error

- File: `retention-sqlite.test-support.ts:394-397`
- Scenario: a seed insert fails and the binding has already auto-rolled-back the transaction; `raw.exec('ROLLBACK')` then throws ("no transaction is active") and replaces the seed error, so the failing test names the rollback, not the bad row.
- Impact: test-only, and only mislabels a failure cause; it never hides the failure.
- Fix: optional — wrap the rollback in its own try/catch that rethrows the original error. Note the identical pre-existing shape in `seedObservations` (`:443-446`); consistency is an acceptable reason to leave it.

## Data flow

1. Cron tick → `JobRunner` resolves handler `memory:retention` — OK.
2. `withActivityEmit` wrapper calls the `createMemoryRetentionHandler` closure — OK (emission covered by the separate activity-events describe, `start-thoth-cron.spec.ts:1032-1099`).
3. Handler resolves service, monitor, foreground reader per run (`memory-retention-job.ts:69-82`) — OK.
4. `service.run` → gates in order (`memory-retention.service.ts:171-257`) — OK; proof passes each through real code.
5. `execute` builds the real `RetentionRunBudget` (`:278-288`) — OK.
6. `lifecycle.runStep(budget, startedAt)` (`:378`) — OK; both proofs assert the real budget class and a number.
7. Step result → report fields (`:536-538`) → handler summary (`memory-retention-job.ts:98`) — OK; substring assertion proves the chain.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| 7.1 summary names memory counts; only the literal changes | COMPLETE | none |
| 7.2 Electron reachability proof through real `startThothCron` + real service | COMPLETE | none |
| 7.3 CLI reachability proof through real `activateThoth`; oneshot intact | COMPLETE | none |
| 7.4 load robustness, identical assertion set, same seed counts | COMPLETE | pre-existing 120 s timeouts now loose (optional follow-up) |
| Mutation A fails both host proofs | COMPLETE | none |
| Mutation B fails both host proofs | COMPLETE | adjusted source not quoted (Minor 1) |
| Restore: production files unchanged | COMPLETE | verified by me via `git diff` |
| XB1 parameter binding | COMPLETE | none |
| XB2 no un-annotated fail-open catch | COMPLETE | none |
| XB3 real budget in both proofs | COMPLETE | none |
| Umbrella rule: proof fails when the production path stops calling the lifecycle | COMPLETE | all three cut points (registration, `service.run`, `runStep`) each fail the test |

Implicit requirements not addressed: none.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| `seedMemories` called with an empty array | YES | BEGIN/COMMIT with no rows; harmless | none |
| `seedMemories` insert failure mid-cohort | YES | ROLLBACK + rethrow | rollback error can mask cause (Minor 2) |
| Nested transaction (future caller inside `db.transaction`) | YES | binding throws "cannot start a transaction" — fail-fast | acceptable |
| Proof handler missing (registration broken) | YES | Electron: `TypeError` on invoke; CLI: `toBeDefined()` first | failure message less clear on Electron; still fails |
| Governor absent | YES | real fast path, `null` passed positionally | none |
| `runStep` spy returning `exhausted: false` | YES | real `finish` maps to `partial`; summary still carries counts; status mapping pinned elsewhere | none |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: none in the changed code; the residual item is that mutation B's validity rests on its recorded output signature rather than its source text.
- What a robust implementation would add: (1) quote mutation sources in future batch reports; (2) optionally guard the `seedMemories` rollback so the original seed error survives; (3) optionally tighten the two pre-existing 120 s cap-case timeouts to match the new ~0.4 s measurements.