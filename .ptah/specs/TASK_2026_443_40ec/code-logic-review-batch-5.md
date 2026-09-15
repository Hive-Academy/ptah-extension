# Code Logic Review — Batch 5, TASK_2026_443_40ec

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Verdict             | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Minor issues        | 3        |

Scope read in full: `retention-run-budget.ts`, `memory-lifecycle.store.ts`, `memory-lifecycle.service.ts`, `memory-lifecycle-config.ts`, and all three new specs. The git diff of all 11 modified files was read. `memory-retention.service.spec.ts` is unchanged from HEAD, so no assertion in it changed.

No TODO, PLACEHOLDER, STUB, or `.skip` marker exists in any new file.

## Confirmation items

### 1. Service swap is behaviour-preserving — CONFIRMED

- The old `msLeft`, `hardStop`, `adaptBatch`, governor closures, private `yieldToGovernor`, the duplicate event-loop helper, and the old `GOVERNOR_LANE` literal are gone from `memory-retention.service.ts`. `GOVERNOR_LANE` exists once, in `retention-run-budget.ts:11`. The only other occurrence of the string `'memory-retention'` is a spec assertion (`memory-retention.service.spec.ts:975`).
- Branch equivalence traced: fast path on clear or absent governor; deadline skip; `AbortError` maps to `aborted`; `signal.aborted` in the catch maps to `aborted`; other rejections fail open with one warn per run; the hard-stop check after the wait is unchanged. The old row budget from the tally equals the new `consumeQueueRows` accounting.
- `memory-retention.service.spec.ts` was not modified by this batch (git status). All seven PR #513 governor cases still exist: busy-then-clear at `memory-retention.service.spec.ts:957`, `maxDeferMs` bounds at `:995-1000`, timeout proceeds at `:1002`, AbortError at `:1038`, fail-open warn-once at `:1055-1079`, deadline-past skips `whenClear` at `:1103`, row-budget precedence at `:559` and `:573`.
- Only `memory.store.spec.ts` and `register.spec.ts` changed among existing specs. Both diffs are additive or formatting-only. No assertion was weakened.

### 2. RetentionRunBudget — CONFIRMED

- `maxDeferMs = Math.max(1, msLeft())` and the cap is pinned by `retention-run-budget.spec.ts:120-138` at (1000 → 59000) and (59500 → 500).
- No governor call after the deadline: `retention-run-budget.spec.ts:140-149` asserts `'time-budget'` and zero `whenClear` calls.
- AbortError maps to `aborted`: `retention-run-budget.spec.ts:151`.
- Warn-once per budget on unexpected failure: `retention-run-budget.spec.ts:163` — two waits produce one warn, and a new budget warns again.
- Halving per kind down to the floor: `retention-run-budget.spec.ts:83` shows `[250,200,100]` from `[500,400,200]` and a delete floor of 50.
- Queue and memory allowances are independent: `retention-run-budget.spec.ts:71`.
- `hardStop` order (abort → battery → foreground → time) is unchanged: `retention-run-budget.spec.ts:47`.

### 3. MemoryLifecycleStore — CONFIRMED

- Every SQL constant matches the plan text in `implementation-plan.md` (Component 4) verbatim.
- One `BEGIN IMMEDIATE`/`COMMIT` per batch method, with `ROLLBACK` on throw and `RetentionStepError` mapping: `memory-lifecycle.store.ts:280-313`. The forced-ABORT spec proves the chunk delete rolls back with the memory delete: `memory-lifecycle.store.spec.ts:234-250`. SQLITE_BUSY maps to `database-busy`: `memory-lifecycle.store.spec.ts:252-263`.
- `INDEXED BY` is present on every lifecycle select: `memory-lifecycle.store.ts:12,17,33,39,55,59`. The EXPLAIN QUERY PLAN spec binds every named parameter and proves the intended indexes are used without `sqlite_stat1`: `memory-lifecycle.store.spec.ts:56-96`.
- Chunks and memories delete in one transaction: `deletePair` at `memory-lifecycle.store.ts:273-278`, inside `inTransaction`.
- Archive stamps `archived_at` and preserves `updated_at`: `memory-lifecycle.store.ts:22-23`, pinned by `memory-lifecycle.store.spec.ts:118-132`.
- The delete predicate counts from `archived_at` (AC2): `memory-lifecycle.store.ts:13`. Cutoffs are strict `<`, and the edge row (archivedAt equal to cutoff) is kept: `memory-lifecycle.store.spec.ts:143-148,187-191`.
- Exemptions (`tier <> 'core'`, `pinned = 0`, corpus via `NOT EXISTS corpus_memories`) appear in the archive select and update, the delete select, both evict selects, the over-cap count, and both delete-pair statements: `memory-lifecycle.store.ts:12-23,25-31,33-42,44-50`.
- NULL and `''` workspace groups stay distinct through `IS @ws`: `memory-lifecycle.store.ts:34,40`, pinned by `memory-lifecycle.store.spec.ts:194-221`.
- Cap grace: the archival evict select adds `archived_at < @graceCutoff`: `memory-lifecycle.store.ts:35`. The service passes `nowMs - limits.capEvictionGraceMs` (7 days): `memory-lifecycle.service.ts:160,174`. A row archived this run is therefore never evicted this run.
- `canDelete()` blocks every delete and evict path: the service checks it once at `memory-lifecycle.service.ts:97` and skips the age-delete loop and the whole cap loop when not allowed (`:104-121`, `:146-183`). The truth table is pinned with a real reopened database: `memory-lifecycle.store.spec.ts:223-232`.

### 4. MemoryLifecycleService — CONFIRMED

- Order is age-delete → archive → cap → preview: `memory-lifecycle.service.ts:104-185`, pinned by the call sequence assertion `memory-lifecycle.service.spec.ts:134-142`.
- XB3 gate order: `beforeBatch` runs `hardStop()` → `memoryRowRoom()` → `await waitForGovernor()` before each batch: `memory-lifecycle.service.ts:240-263`. The spec proves no store batch runs while the governor is held and that `whenClear` is called once per batch (4 calls for 2 deletes + 2 archives): `memory-lifecycle.service.spec.ts:240-264`.
- Preview reads do not wait on the governor; the disabled path calls preview without any governor interaction: `memory-lifecycle.service.spec.ts:155-172`. Preview is omitted on any stop (`memory-lifecycle.service.ts:185`, spec at `:195-221`).
- `enabled: false` writes nothing and still produces a preview: `memory-lifecycle.service.ts:91-95`.
- Cache invalidation: `markWorkspacesChanged` is called once with the deduplicated root union after all committed batches: `memory-lifecycle.service.ts:186`, spec at `memory-lifecycle.service.spec.ts:150-152`.
- Config clamps: archive 7–365, delete 7–730, cap 1000–1,000,000, with defaults matching `FILE_BASED_SETTINGS_DEFAULTS`: `memory-lifecycle-config.ts`, pinned by `memory-lifecycle.service.spec.ts:288-311`.

### 5. XB1 — CONFIRMED

Every prepared statement in the new and changed specs binds all named and positional parameters, including the EXPLAIN QUERY PLAN helpers (`memory-lifecycle.store.spec.ts:62-95`) and the seed helper (12 bound positional parameters in `retention-sqlite.test-support.ts`).

### 6. XB2 — CONFIRMED

New fail-open/default catches carry annotations: `retention-run-budget.ts:73`, `memory-lifecycle.store.ts:202,248,258,300`, `memory-lifecycle.service.ts:282`. The degradation audit reports 20/20 against the baseline for memory-curator.

### 7. Vec harness and tsconfig — CONFIRMED

`openRetentionTestDb({ vec: true })` throws when `sqlite-vec` cannot load; no test skips. `tsconfig.lib.json` excludes `src/**/*.test-support.ts`.

### 8. DI — CONFIRMED

`MEMORY_LIFECYCLE_STORE` and `MEMORY_LIFECYCLE_SERVICE` tokens use `Symbol.for(...)` in `di/tokens.ts`; both register as tsyringe singletons in `di/register.ts`; the service injects the existing `MEMORY_STORE` token, so no second `MemoryStore` instance exists. `register.spec.ts` asserts the singleton identity.

### 9. Destructive-safety sweep — NO DEFECT FOUND

- No path deletes a memory without its chunks: the delete pair runs both statements in one transaction (`memory-lifecycle.store.ts:273-278`), and the rollback spec proves atomicity.
- A memory a user is using is protected: `core` tier, `pinned`, and corpus members are excluded from every archive, delete, and evict predicate.
- Bounded on the Electron main thread: each batch is one short transaction; the memory row budget is 25,000 per run; the wall budget is 60 s; `setImmediate` yields between batches (`memory-lifecycle.service.ts:206,235`); the governor is awaited before each batch; the archive and delete loops stop at the first zero-count batch (`memory-lifecycle.service.ts:205`).

## Five logic questions

### 1. How does this fail silently?

The read-failure paths (`overCapWorkspaces`, `readPreview`) return empty or null values and push a message into `readErrors`. Nothing today reads `readErrors`, so a persistent read failure shows the user a preview of `null` fields with no surfaced reason. This is finding 1.

### 2. What user action produces unexpected behaviour?

None found in the write paths. The one user-visible oddity: when the cap loop stops mid-workspace, the result reports `evicted` counts from committed batches only, and `exhausted: false` signals the next run continues. This is correct behaviour, not a defect.

### 3. What input data produces a wrong answer?

A `workspace_root` of `''` and one of `NULL` are separate cap groups, by design; a user who expects them merged sees two smaller groups. This matches the approved decision list. No wrong answer found in the traced paths.

### 4. What happens when a dependency fails?

- Governor rejects with AbortError → step stops as `aborted`, committed counts kept: `memory-lifecycle.service.spec.ts:266-286`.
- Governor disposed → fail open, one warn per run: `retention-run-budget.spec.ts:163`.
- SQLITE_BUSY on BEGIN IMMEDIATE → `RetentionStepError` reason `database-busy`, no partial batch: `memory-lifecycle.store.spec.ts:252-263`.
- Rollback itself fails → the original error stays authoritative, rollback failure logged at debug: `memory-lifecycle.store.ts:299-306`.
- `connection.db` unavailable inside `canDelete()` → the throw propagates to the caller. The future Batch 6 retention run is expected to catch it, but nothing today catches or tests it (finding 3).

### 5. What is missing that the requirements never mentioned?

Clearing `readErrors` between runs (finding 1), and spec coverage for the read-failure paths (finding 2). Batch 6 may add both; neither blocks this batch.

## Findings

### 1. MODERATE — `readErrors` accumulates on the singleton store and is never cleared

- File: `memory-lifecycle.store.ts:124`
- Scenario: a read fails once (for example a transient SQLITE_BUSY on a preview count). The message enters `readErrors` and stays there for the process lifetime. A later run succeeds, but the array still holds the old message.
- Impact: Batch 6 plans to consume store diagnostics. It cannot tell a current-run error from a stale one. On a persistent read failure, the array grows without bound, one entry per read, for the app lifetime.
- Contrast: the existing precedent returns `readErrors` as a field of a per-call result object (`observation-retention.store.ts:224`, built from a local array at `:424`), so each read reports only its own failures.
- Fix: clear `readErrors` at the start of each lifecycle run (the service can reset it when `runStep` begins), or return a fresh array per call as the observation store does.

### 2. MODERATE — no spec covers the read-failure paths

- File: `memory-lifecycle.store.ts:188-207` and `:234-271` (the `overCapWorkspaces` and `readPreview` catch blocks)
- Scenario: a preview read throws. `readPreview` returns null fields and `overCapWorkspaces` returns `[]`. No spec forces either path, so the null-vs-zero semantics (`overCap` stays null when the over-cap read failed, `memory-lifecycle.store.ts:262-269`) and the `readErrors` accumulation are unpinned.
- Impact: a regression in these catches (for example swallowing a write error, or reporting `0` instead of `null`) passes the suite.
- Fix: add a spec that fails a preview count read and asserts the null fields and the diagnostic strings.

### 3. MINOR — `canDelete()` does not guard an unavailable connection

- File: `memory-lifecycle.store.ts:139-146`
- Scenario: `this.connection.db` throws when the persistence layer is unavailable. `canDelete()` has no try/catch, so the throw propagates out of `runStep`.
- Impact: today no caller catches it inside this lib. The Batch 6 retention run is expected to, but that contract is untested.
- Fix: either annotate and degrade to `{ allowed: false, reason: 'vec-unavailable' }`-style refusal with a distinct reason, or pin the Batch 6 catch with a spec.

### 4. MINOR — unused assignment in the cap loop

- File: `memory-lifecycle.service.ts:151-162`
- Scenario: `archivalExcess` is computed, then reassigned from the `runEviction` return value, and the second value is never read.
- Impact: cosmetic; a reader may assume the remaining-excess value feeds the recall decision, but `recallExcess` is computed from `workspace.recallEvictable` independently (correct per the approved rule).
- Fix: drop the reassignment, or use the returned remaining value to skip the recall step when archival eviction already freed enough — only if that matches the approved AC4 rule.

### 5. MINOR — removed doc paragraph about the hourly cron tick

- File: `memory-retention.service.ts` (diff)
- Scenario: the swap deleted an accurate doc paragraph that said the cron job ticks hourly. The text was documentation, not code.
- Impact: documentation-only loss. Route to code-style-reviewer; not a logic defect.

## Data flow

1. Batch 6 caller (future) constructs `RetentionRunBudget` and calls `runStep(budget, now)` — OK.
2. `readSettings` reads and clamps the four settings; on throw, falls back to defaults with a warn (`memory-lifecycle.service.ts:278-289`) — OK.
3. `enabled: false` → preview only, no writes, no governor wait (`:91-95`) — OK.
4. `canDelete()` gate; refusal skips delete and cap but keeps archive (`:97-122`) — OK, see finding 3 for the unguarded `connection.db`.
5. Age-delete loop: gate → batch → consume → yield, stops on zero count or stop (`:104-121,190-208`) — OK.
6. Archive loop, same shape (`:124-144`) — OK.
7. Cap loop per over-cap workspace: archival eviction first with 7-day grace, then recall only when recall alone exceeds the cap (`:146-183`) — OK; archived-this-run rows are inside the grace window, so never evicted this run.
8. Preview only when `stop === null` (`:185`) — OK.
9. `markWorkspacesChanged(root union)` when any root changed (`:186`) — OK; the union is a `Set`, so no duplicate bumps.

## Requirements fulfilment

| Requirement                                     | Status   | Gap                          |
| ----------------------------------------------- | -------- | ---------------------------- |
| Behaviour-preserving retention swap             | COMPLETE | None                         |
| RetentionRunBudget (time, rows, batches, gate)   | COMPLETE | None                         |
| Lifecycle store SQL per plan                    | COMPLETE | None                         |
| AC2 delete counted from archived_at             | COMPLETE | None                         |
| Exemptions in every predicate                   | COMPLETE | None                         |
| NULL vs '' cap groups                           | COMPLETE | None                         |
| 7-day grace; no same-run evict-after-archive     | COMPLETE | None                         |
| Service order and XB3 gate order                 | COMPLETE | None                         |
| Disabled preview-only; vec-gate archive-only     | COMPLETE | None                         |
| Cache invalidation after writes                 | COMPLETE | None                         |
| XB1 parameter binding                           | COMPLETE | None                         |
| XB2 annotations, baseline 20                    | COMPLETE | None                         |
| Vec harness throws, tsconfig exclude            | COMPLETE | None                         |
| DI tokens, singletons, no second MemoryStore     | COMPLETE | None                         |
| Read-failure diagnostics lifecycle               | PARTIAL  | Never cleared (finding 1)     |
| Read-failure path specs                         | MISSING  | Finding 2                    |

Implicit requirements not addressed: none beyond findings 1 and 2.

## Edge cases

| Case                                 | Handled | How                                              | Concern                     |
| ------------------------------------ | ------- | ------------------------------------------------ | --------------------------- |
| Cutoff exactly at boundary           | YES     | Strict `<`, spec pins the edge row kept          | None                        |
| Pinned / core / corpus rows          | YES     | Predicate in every statement, specs pin each     | None                        |
| NULL vs '' workspace                 | YES     | `IS @ws`, spec pins group separation            | None                        |
| Row archived this run then cap       | YES     | 7-day grace excludes it from archival evict     | None                        |
| Mid-batch failure                    | YES     | ROLLBACK, spec forces ABORT and checks counts  | None                        |
| SQLITE_BUSY on BEGIN                 | YES     | `database-busy` reason, spec with second handle | None                        |
| Governor AbortError mid-run          | YES     | Stop `aborted`, committed counts kept, spec    | None                        |
| Memory row budget exhausted          | YES     | Stop `memory-row-budget`, no preview, spec      | None                        |
| Settings garbage (NaN, wrong type)   | YES     | Clamp to defaults, spec pins 7/730/25000        | None                        |
| Read failure in preview              | PARTIAL | Null fields plus readErrors entry               | Never cleared; no spec (1,2)|
| Connection unavailable in canDelete  | NO      | Throw propagates                                | Finding 3                   |

## Verdict

- Score: 8/10
- Verdict: APPROVED
- Confidence: HIGH
- Top risk: the never-cleared `readErrors` array on the singleton store can mislead the Batch 6 diagnostics consumer with stale entries.
- What a robust implementation would add: per-run reset of `readErrors`; specs for the two read-failure paths; a guard or pinned contract for `canDelete()` on an unavailable connection.