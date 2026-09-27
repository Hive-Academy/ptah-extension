# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 25a, revision review r2. Reviewed the revised provider in full and the new rejection/census regression cases, against the batch contract and the r1 report. Source and specs were not edited. No git operations were run.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 |

Both original defects are fixed, but the new pending-invalidation policy permits a known-stale census to be returned as complete and clean. That is a user-visible language-honesty failure, not merely delayed cache refresh. The score reflects working rejection handling and bounded reuse with a reproducible correctness gap; 7–8 would require preventing the stale-clean answer.

All source anchors below are relative to `libs/backend/workspace-intelligence/src/diagnostics/` unless a full repository-relative path is shown.

## r1 finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| B25A-R1-S1: orphaned type-check rejection while syntax runs | RESOLVED | `language-aware-diagnostics-provider.ts:529` observes both operations through Promise.all. Both original public probes exit 0, report the expected caught inner error, and report no unhandled rejection. |
| B25A-R1-M1: TTL/LRU duplicate pending walks | RESOLVED for the reported duplication | Separate pending and completed maps at `:383` / `:390`; pending lookup precedes TTL at `:868`; completion timestamp at `:884`; LRU applies only to settled values at `:899`. Original two-minute probe now starts one walk, previously three. Invalidation introduces the distinct finding below. |

### Are the regression assertions valid?

The two rejection cases (`language-aware-diagnostics-provider.spec.ts:542`, `:580`) are valid guards against the original sequential-await regression: the watched promise must be observed before the held parse finishes or before the late rejection. The original code would have `watched === false` at those points. The census tests at `:889` and `:928` likewise pin one pending walk across TTL periods and completed-cache eviction; r1 would start three and ten walks respectively instead of one and nine.

The `WatchedPromise.then` flag (`.spec.ts:512–520`) is a targeted observation, not a general proof of safe rejection handling: a fulfillment-only `.then()` can mark it watched while creating an unhandled rejected child. For the actual implementation, Promise.all supplies rejection handlers and observes both inputs. Independent Node probes below additionally test the real event/default-process behavior, avoiding dependence on Jest's process sandbox. Thus the replacement assertion is acceptable for this regression, with that limit; it is not a new defect.

The pending-invalidation test (`.spec.ts:954`) verifies no parallel walk and no later caching, but never asserts the coverage returned to `joined` at `:969`. It therefore pins reuse while missing the stale-answer consequence.

## Five logic questions

### 1. How does this fail silently?

A pending discovery marked stale by invalidate still resolves to its old result (`language-aware-diagnostics-provider.ts:883–886`), and later callers join it at `:869`. Unscoped formatting at `:669–694` treats that result as complete. An empty pre-edit snapshot becomes `clean:true`, `unchecked:0`, with no warning about the newly added Python file. See R2-B1.

### 2. What user action produces unexpected behaviour?

Adding a syntax-capable file, invalidating diagnostics, and checking diagnostics while an earlier census is still running can omit that file from the unchecked disclosure (`:427–437`, `:869`). This is the normal edit/invalidate/read sequence described by `libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts:138–151`; overlap makes the result wrong.

### 3. What input data produces a wrong answer?

An old empty or TS-only discovery result followed by a newly created `.py` file yields a clean unscoped answer even though that file was never checked (`:675–685`). The probe's next call correctly returns `unchecked:1`, proving the earlier answer was stale rather than the new file being deliberately unsupported or excluded.

### 4. What happens when a dependency fails?

Mixed scoped rejection now reaches the caller without an unhandled inner promise (`:529`); the default Node process stays alive in the independent probe. Discovery exceptions still return UNKNOWN_CENSUS (`:919–925`), and the ten-second budget returns unknown without cancelling the single pending walk (`:847–858`). Unknown results are not cached (`:883`). A resolved unavailable TS result still carries coverage via `:594–607` or `:696–702`.

### 5. What is missing that the requirements never mentioned?

The batch says the census is dropped by invalidate but does not specify a pending-walk generation policy. The revision explicitly chooses to share that walk. Sharing work is acceptable; certifying an invalidated snapshot is not. Return unknown to affected callers, or queue one fresh discovery after settlement, without creating parallel walks (`:866–895`). A process-level assertion remains useful alongside the deliberately narrower watched-promise test.

## New findings

### 1. R2-B1 — Blocking: invalidated pending census can still certify a clean answer

- **File:** `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts:886` (also `:437`, `:869`, `:883`, and `:669–694`).
- **Trigger:** An unscoped census has already enumerated an empty/TS-only directory and is waiting to finish. Add `new.py`, call `invalidate(root)`, then request diagnostics before that walk settles. Its eventual file list still reflects the earlier snapshot.
- **Current handling:** Invalidate marks `pending.stale = true`. New callers nevertheless receive `pending.census`. The stale flag gates cache insertion only; the promise returns `result` unchanged. The original and post-invalidation callers can both receive the known-stale census as complete.
- **Symptom:** The post-invalidation caller receives available diagnostics with `coverage.clean:true`, `census:'complete'`, `unchecked:0`, no reasons, and no `notChecked` group. The Python file exists but no syntax scan ran. The next call starts a new walk and correctly reports `clean:false`, `unchecked:1`.
- **Evidence:** Independent public-API probe below reproduces this for both `invalidate(root)` and `invalidate()`; a real mkdtemp root/file is used, with a held discovery result to deterministically simulate a walk snapshot predating the edit.
- **Impact:** An agent can treat the workspace as fully accounted for after its edit when newly added files have not been checked. This is a realistic silent wrong answer, meeting Blocking severity under the review rubric. It does not require TTL expiry, a permanently hung dependency, or malformed inputs.
- **Recommendation:** Preserve the single-flight registry, but return UNKNOWN_CENSUS when the entry was invalidated (at minimum in the settlement path instead of returning the stale result), and do not cache it. Alternatively, have post-invalidation callers join one queued fresh census after the old walk drains. Cover both root-specific and global invalidation with output assertions: never complete/clean from the invalidated snapshot. Keep the no-duplicate-walk and completion-based TTL assertions.

## Blocking issues

R2-B1 above. No additional blocking findings.

## Serious issues

None remaining from r1; no new serious finding established.

## Moderate and minor issues

None newly established. The test-observation limitation and previously documented graph-census deviation are notes, not additional counted failure modes.

## Data flow

1. Scoped requests classify/deduplicate paths and split TS versus syntax (`:445–525`) — unchanged from r1.
2. Both suboperations are observed by Promise.all (`:529`) — fixed; failures propagate safely.
3. Coverage, cap omissions and syntax-only labels are assembled (`:565–631`) — unchanged.
4. Unscoped requests concurrently obtain the TS answer and bounded census (`:635–639`) — unchanged.
5. Census reuses one pending walk, then a completion-timed settled cache (`:866–895`) — fixes TTL/LRU duplication.
6. Invalidation drops settled cache and marks pending stale (`:427–437`) — cache behavior correct, result behavior incomplete.
7. Settlement skips stale caching but returns the stale result (`:883–886`) — R2-B1.
8. Unscoped coverage trusts that census (`:669–694`) — exposes the false-clean answer.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Observe both mixed-request failures | COMPLETE | Promise.all plus independent process probes. |
| Pending discovery shared across TTL/LRU pressure | COMPLETE | Single in-flight entry; TTL starts on completion. |
| Invalidate removes stale census from subsequent answers | PARTIAL | No stale caching, but stale result is still delivered to post-invalidation callers. |
| Existing syntax caps, unavailable coverage, no unscoped scan | COMPLETE in reviewed paths | `:525`, `:565`, `:635`, `:758–838`; scoped suite rerun. |
| Graph census reuse when present | PARTIAL, unchanged documented deviation | Provider header `:32–39` explains independent discovery because graph language buckets lack extension detail. No new conclusion beyond r1. |
| Carried R5-B1/R5-M1 root handling | Previously accepted, unaffected by this revision | Revision changes only diagnostics provider/spec; adapter/walker acceptance evidence remains in r1. Not independently rerun this round. |
| Registration function preserved | COMPLETE | `libs/backend/workspace-intelligence/src/di/register.ts:86–103`. |

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| TS rejection during parsing | YES | Original process probes now exit 0. |
| Parse rejection followed by TS rejection | YES | Promise.all retains observation; spec `:580`. |
| Discovery outlives multiple TTL periods | YES | Original probe starts one walk. |
| Completed-cache pressure during pending discovery | YES | Separate registry, spec `:928`. |
| Invalidation while discovery is pending | NO | R2-B1, both root and global variants. |
| Unavailable inner TS result | YES | Resolved unavailable handling unchanged, `:594`, `:696`. |
| Discovery error or budget expiry | YES | Unknown coverage; `:851`, `:925`. |

## Verification

Independent probes run from this worktree, using the actual provider transpiled from current disk source (scripted inner provider/parser and held file search where noted):

```powershell
node "$env:TEMP/task559-25a-provider-public-probe.cjs"
node "$env:TEMP/task559-25a-provider-crash-probe.cjs"
node "$env:TEMP/task559-25a-r2-invalidation-probe.cjs"
```

- Public and crash probes: exit 0; caught outcome `inner check failed`; `unhandledRejections:[]`; pending TTL `walksStarted:1`. In r1 these demonstrated an unhandled rejection/default process exit 1 and three walks.
- New invalidation probe: both root-specific and global invalidation give joined answer `{clean:true,census:'complete',unchecked:0}`, no notChecked; the next answer gives `{clean:false,census:'complete',unchecked:1}`. Two walks total, sequential; the defect does not depend on duplicate work.
- The new probe is at `%TEMP%/task559-25a-r2-invalidation-probe.cjs`; source and test files were not modified. No mutation test was performed in the working tree. Regression sensitivity is established from the assertions/code and r1 probe outcomes, not a claim of a fresh base checkout run.
- `ptah_get_diagnostics` scoped to the revised production file: TypeScript compiler, 0 errors, 0 warnings.

Scoped Nx verification: `node_modules/.bin/nx run-many '-t=test,lint,typecheck' -p @ptah-extension/workspace-intelligence --skip-nx-cache` with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Header confirms only workspace-intelligence; all three targets passed in 1m14s. Log: `%TEMP%/task559-25a-r2-checks.log`. No workspace-wide checks were requested or run. A first PowerShell invocation failed argument parsing before Nx started; the corrected invocation quotes `-t=test,lint,typecheck`.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Score: 6/10
- Top risk: an invalidated census is still delivered as complete/clean to a caller checking after an edit.
- What a robust implementation would add: a stale-result fence returning unknown (or one sequential refresh), with assertions on the post-invalidation coverage for both invalidate variants. Keep the fixed Promise.all and single-flight/settlement-TTL behavior.

