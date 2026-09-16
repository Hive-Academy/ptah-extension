# Code Logic Review — `TASK_2026_443_40ec` Batch 11 (Gate 3 fixes)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Minor issues        | 3        |
| Failure modes found | 3        |

Scope reviewed: the uncommitted diff over the 14 listed files (whole files read, not only changed lines), `batch-11-report.md`, `batches.md` Batch 11, `code-logic-review-branch.md`, and the retention/lifecycle/boot code paths the fixes touch. The `.ptah/specs/TASK_2026_439_1310/context.md` edit and the new `TASK_2026_45x_*` folders are excluded per the orchestrator.

Verification I ran myself (read-only commands, this worktree):

- `npx nx test @ptah-extension/memory-curator --testPathPatterns='"memory-retention.service.spec|memory-lifecycle.service.spec|memory-retention.integration.spec|memory.store.spec"' --runInBand` — 4 suites, 111 passed, 9 skipped, exit 0. Matches the report.
- `npx nx run-many -t test -p @ptah-extension/cli-engine @ptah-extension/rpc-handlers --testPathPatterns='"register-thoth-libraries.spec|resolve-handler-plan.spec"' --parallel=1` — cli-engine 8 passed, rpc-handlers 6 passed, exit 0. Matches the report.
- `npx nx run degradation-audit:lint` — exit 0, `TOTAL 303 unsuppressed site(s)`, no `orphaned-suppression`, no baseline raised. Matches the report.

No file outside the listed set was changed: `git status` shows only the 14 in-scope files plus the orchestrator-owned spec files.

## Gate 3 findings — closure status

### S1 (11.1) memory-row-budget reclaim — CLOSED

- One named predicate `isRowBudgetStop` at `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:79-81`, used at both post-row guards (`:393` and `:409`). No third copy of the two-value union exists in the file.
- A reclaim stop still fills only a null stop: `memory-retention.service.ts:413` (`if (reclaim.stop && stop === null)`). The 11.1 spec pins the reported reason: it asserts `reason: 'memory-row-budget'` after reclaim ran (`memory-retention.service.spec.ts:718-736`).
- The lifecycle entry gate at `:381` (`stop === null || stop === 'row-budget'`) is correctly left alone — `'memory-row-budget'` can only be produced by the lifecycle itself, so it cannot be set before that gate.
- Per-run memory cap and ledger-prune guard unchanged: `beforeBatch` still stops on `memoryRowRoom() <= 0` (`memory-lifecycle.service.ts:274-279`), the prune guard is still `continueAfterRows && budget.hardStop() === null` (`:396`).
- Spec quality: it fails on the original code for the right reason (the pasted pre-fix failure `pagesReclaimed: 0` is the defect itself, not a proxy), and it fails if only ONE guard is fixed — fixing only `continueAfterRows` leaves `pagesReclaimed: 0` (reclaim condition false); fixing only the reclaim condition leaves prune and reclaim both skipped (`h.store.calls` misses `'prune'`, `h.log` misses `'reclaim'`).

### S2 (11.2) crash-safe lifecycle accounting — CLOSED

- `finally` invalidation: `memory-lifecycle.service.ts:209-211`, guarded by `roots.size > 0`, covers every committed batch on both the return path and the rethrow path (non-`RetentionStepError` throws included). The disabled path returns before the `try` and touches no rows, so its no-call behavior is unchanged.
- The `finally` cannot mask the original error: `markWorkspacesChanged` is a plain `Map.set` loop (`memory.store.ts:161-169`) — it cannot throw.
- Committed counts only: counters accumulate in the `consume` callbacks after a store method returns (`memory-lifecycle.service.ts:122-129, 144-151`); the failing batch throws before its `consume` runs, and the store throws `RetentionStepError` only after its transaction rolled back (`observation-retention.store.ts:198-206`). No optimistic total is possible.
- Re-throw wiring: `runStep` attaches the error and returns (`:201-208`); `MemoryRetentionService` assigns `lifecycleResult` and `lifecycleReadErrors` BEFORE re-throwing (`memory-retention.service.ts:383-385`), so `finish` records the real counters (`:542-544`) and `record` persists them (`:631-633`).
- Outcome mapping unchanged: the rethrown error lands in the pre-existing outer catch (`:417-426`): `database-busy` → `stop = 'database-busy'` → `partial`; anything else → `failure` → `failed` with `reason = error.reason`. Single-flight release unchanged (`:205-207`).
- XB3 untouched: `beforeBatch` keeps hardStop → `memoryRowRoom` → `waitForGovernor` → batch (`memory-lifecycle.service.ts:264-287`). No store file changed, so no SQL constant, statement, predicate or transaction shape moved, and no `await` entered a transaction.
- Spec quality — both halves proven: the unit spec asserts the resolved counters AND `markWorkspacesChanged` called with the touched roots (`memory-lifecycle.service.spec.ts:231-252`); fixing only the `finally` fails it on `deleted: 10` (the throw still propagates), fixing only the counters fails it on `h.changed`. The integration spec strengthens the existing mid-delete case (not weakens it): the returned report AND the persisted `readState` both must show `memoriesDeleted: 100` with `lastOutcome: 'failed'` on real SQLite (`memory-retention.integration.spec.ts:678-692`), then the next run finishes the remaining 150 (`:699-703`).

### Moderate 3 / reclassified Serious (11.3) degraded-boot recorder — CLOSED as scoped

- `NullMemoryUsageRecorder` is a frozen no-op that cannot throw (`memory-contracts/src/lib/null-implementations.ts:27-30`), exported from the barrel (`src/index.ts:43`) and named in `CLAUDE.md`.
- Injection still REQUIRED: `mem-rpc.handlers.ts:51-52` uses plain `@inject(MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER)` — no `{ isOptional: true }` anywhere in the class.
- Both installers idempotent behind `isRegistered` guards: CLI `register-thoth-libraries.ts:208-213` (warning pushes `'MEMORY_USAGE_RECORDER'` at `:212`, asserted by the spec at `register-thoth-libraries.spec.ts:222-226`); RPC `register-rpc-surface.ts:221-225`, still gated on `capabilities.memory` off (`:209`).
- Non-overwrite proven at both installers: the RPC spec registers a real recorder first and keeps it (`resolve-handler-plan.spec.ts:146-160`); the CLI non-degraded spec resolves the recorder after real Track 1 registration and asserts it is not a plain object (`register-thoth-libraries.spec.ts:105-109`).
- Spec quality: it fails on the original code for the right reason (`isRegistered(MEMORY_USAGE_RECORDER)` false pre-fix), and the degraded container is built by the real `registerThothLibraries` with Track 1 mocked to throw — not a hand-built container. Resolving the real `MemRpcHandlers` class with its real decorators is what proves the required injection is satisfiable.

### Minor 5 (11.4) recordUse truncation — CLOSED

- `memory.store.ts:528-535`: dedupe first, one `debug` log only when the DISTINCT count exceeds 200, payload `{ received, recorded: 200 }`, then the unchanged `slice(0, 200)`. Cap and port contract unchanged; the pre-existing try/warn-around-SQL behavior is untouched.
- Spec asserts both directions: 200 distinct ids log nothing; 201 distinct ids record exactly 200 rows AND exactly one debug call with the expected payload (`memory.store.spec.ts:1451-1470`). Pre-fix failure (`debug calls: 0`) is the defect itself.

## XB2 — marker placement

The marker is the leading comment of the catch block (`memory-lifecycle.service.ts:202-203`), before any statement — inside the scanner's leading-comment zone. My own `degradation-audit:lint` run exits 0 with `TOTAL 303` and no orphaned-suppression, so the reported move is confirmed on disk. The annotation text is accurate for what the catch does: category `reported` is correct (nothing is swallowed — the error is re-thrown at `memory-retention.service.ts:385` and classified by the outer catch), and the described flow (retention receives the attached error, persists committed counters, reports outcome) matches the code.

## Numbered findings

### 1. Moderate — the degraded-boot spec hand-supplies `MEMORY_SEARCH`, hiding that a total Track-1 failure still crashes on a sibling token

- File: `libs/backend/cli-engine/src/lib/thoth/lib/../../thoth/register-thoth-libraries.spec.ts:199-204` (the `c.registerInstance(MEMORY_TOKENS.MEMORY_SEARCH, ...)` block), with `register-thoth-libraries.spec.ts:166-168` (Track 1 mocked to throw on entry).
- Scenario: the spec mocks `registerMemoryCuratorServices` to throw before ANY registration. In that state `MEMORY_TOKENS.MEMORY_SEARCH` — which `MemRpcHandlers` also injects (`mem-rpc.handlers.ts:49-50`) — is unregistered, because only Track 1 registers it (`memory-curator/src/lib/di/register.ts:96-100`). The spec then registers a hand-built search mock so `MemRpcHandlers` can resolve. A real CLI boot that degrades the same way (Track 1 throws before line 100) still crashes in `registerHandlers` → `container.resolve(MemRpcHandlers)` (`register-rpc-surface.ts:185`), with the tsyringe error now naming `MEMORY_SEARCH` instead of `MEMORY_USAGE_RECORDER`. `MemoryRpcHandlers` would fail the same way on `MEMORY_STORE`.
- Why this is not a batch defect: the `MEMORY_SEARCH` injection predates the branch (`origin/main` `mem-rpc.handlers.ts` already injected it), so the residual crash is pre-existing and outside the Gate 3 finding, which named only the token Batch 9 made newly required. The fix restores the pre-branch degradation behavior exactly; it does not make it worse.
- Why it still matters: the spec title ("keeps MemRpcHandlers resolvable ... when Track 1 throws") and the batch acceptance ("a container built the CLI degraded way ... resolves MemRpcHandlers without throwing") read broader than what is proven — resolution holds only when `MEMORY_SEARCH` is separately present, which a total Track-1 failure would not provide.
- Fix: file a follow-up (either a no-op `MEMORY_SEARCH`-shaped fallback in `ensureMemoryContractFallbacks`, or a scoping comment in the spec stating the fallback path covers the four contract tokens only and assumes the search service when Track 1 fails midway). Do not weaken the current spec.

### 2. Minor — dead `stop` assignment in the lifecycle catch

- File: `memory-lifecycle.service.ts:207` (`if (error.reason === 'database-busy') result.stop = 'database-busy';`).
- Scenario: the only production caller re-throws the attached error before reading `lifecycleResult.stop` (`memory-retention.service.ts:385-388`), and the outer catch re-derives `stop = 'database-busy'` itself (`:421-422`). So the assignment is unreachable-in-effect, and its branch has no spec (the unit and integration specs both use `sql-error`). Harmless today, but a future second caller of `runStep` could wrongly treat `result.stop` as authoritative on the error path, and the untested branch can drift.
- Fix: either drop the line and document that the retention service owns stop mapping on errors, or add a lifecycle-level spec pinning the `database-busy` branch.

### 3. Minor — a governor stop during the ledger prune can now overwrite a `memory-row-budget` reason

- File: `memory-retention.service.ts:397-399` (`if (pruneStop) { stop = pruneStop; }` — unconditional, unlike the reclaim's null-only guard at `:413`).
- Scenario: post-fix, a run that stops on `memory-row-budget` now enters the ledger prune. If the governor aborts during `waitForGovernor` there, the recorded reason becomes the governor stop (e.g. `aborted`) instead of `memory-row-budget`. Status is `partial` either way, and the line is pre-existing (the same overwrite was already reachable for `row-budget`), but this token makes it newly reachable on the memory-cap path. Note only — the batch's stated precedence rule (reclaim fills only a null stop) is honored.

### 4. Minor — two public-surface statements in the report are imprecise

- `MemoryLifecycleStepResult` is exported from the public barrel (`memory-curator/src/index.ts:141`) and gained an optional `error` field (`memory-lifecycle.service.ts:46`) — additive and non-breaking, but the report's "no public memory contract changed" is not exact. Likewise `installNullImplementations` gained a module-level `export` (`register-rpc-surface.ts:205`); it is correctly absent from the `host-profile` barrel (`host-profile/index.ts` exports only `deriveRpcSurface, registerRpcSurface, resolveRpcHandlerPlan`), so the declared deviation holds. Documentation precision only.

## Five logic questions (diff-relative)

1. **Silent failure?** The null recorder silently drops usage records in a degraded boot — by design, and the boot warning names the token. The pre-fix silent paths (reclaim skipped with `pagesReclaimed: 0`; zero counters recorded for committed deletes) are the paths this batch closes.
2. **User action with unexpected behaviour?** Submitting more than 200 distinct ids to `recordUse` still truncates, but now emits one debug line — the contract ("ids past the cap are ignored") is unchanged and now observable.
3. **Input producing a wrong answer?** None new. The returned lifecycle counters are accumulated only from batches whose store call returned (post-commit), so they cannot overstate.
4. **Dependency failure?** `database-busy` mid-run now yields `partial` with committed counters recorded and the search cache bumped; `sql-error` yields `failed` with committed counters recorded; a non-`RetentionStepError` still propagates unchanged and still bumps the cache via the `finally`.
5. **Missing?** The sibling-token gap in finding 1 — the degraded path covers the four memory-contract tokens, not the memory-curator tokens the `mem` handlers also need.

## Edge cases

| Case | Handled | Evidence |
| ---- | ------- | -------- |
| Reclaim after a memory-cap stop against the 60 s budget | YES | `reclaimPages` checks `budget.hardStop()` every step, caps per-run pages, and its governor wait is bounded by `msLeft()` (`memory-retention.service.ts:460-489`) |
| Returned counters feeding next-due / backlog decisions | YES | `backlogRemaining = status !== 'completed'` and `nextDueAt` read outcome/completion, not the memory counters (`:546`, `:523`) |
| `markWorkspacesChanged` throwing in the `finally` | YES | plain `Map.set` loop, cannot throw (`memory.store.ts:161-169`) |
| Empty root set on the error path | YES | `roots.size > 0` guard preserved (`memory-lifecycle.service.ts:210`) |
| Disabled lifecycle on the error path | YES | early return before the `try`; no writes, no invalidation call, unchanged |
| Real recorder present, fallback installer runs | YES | `isRegistered` guards at both installers; proven by `resolve-handler-plan.spec.ts:146-160` and `register-thoth-libraries.spec.ts:105-109` |
| Truncation with exactly 200 distinct ids | YES | no log (`memory.store.spec.ts:1456-1458`) |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: a reader believing the degraded CLI boot is now crash-proof, when a total Track-1 failure still cannot resolve `MemRpcHandlers` on the pre-existing `MEMORY_SEARCH` token (finding 1).
- What a robust follow-up would add: a scoped decision on the `MEMORY_SEARCH`/`MEMORY_STORE` fallbacks (or an explicit non-goal note), removal or spec coverage of the dead `stop` assignment (finding 2), and a retention-level spec for a `database-busy` error arriving from the lifecycle with committed counters.

All four Gate 3 fixes are correctly implemented, each acceptance spec fails on the pre-fix code for the right reason and survives the single-guard / single-half mutations, the asserted behavior was strengthened where it changed, and my own runs of the focused specs and the degradation audit reproduce the report's results.