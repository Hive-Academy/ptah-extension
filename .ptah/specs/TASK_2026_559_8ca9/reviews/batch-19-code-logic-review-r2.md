# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 19, Lane C, r2 after revision round 1. Reviewed source remained read-only.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 1 |

Both exact r1 reproductions are fixed. One related admission interleaving remains: a provider request started DURING disposal captures the new generation and can spawn a worker after disposal completes. A real-thread, real-compiler probe reproduced this. All requested verification targets passed. The score remains below 7 because the explicit shutdown invariant still has a reproducible thread-survival path; it is above 5 because the original races are fixed and lane isolation, ordinary disposal and result handling work.

All paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-c/`. Evidence abbreviations:

- **worker**: `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.ts`
- **provider**: `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts`
- **worker spec**: `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.spec.ts`
- **provider spec**: `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts`
- **contract**: `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts`

## r1 findings status

| r1 finding / reproduction | Status | Evidence |
| --- | --- | --- |
| S1(a): direct worker run posted during disposal escapes snapshot | FIXED | worker:215 rejects before creating a worker; rerun reports zero live entries and a disposed rejection |
| S1(b): provider discovery started before disposal resumes afterward | FIXED | provider:358 captures generation and :394 rejects mismatch; original probe now reports zero live entries |
| S1 overall: disposal admission and no surviving compiler thread | PARTIAL | A provider call beginning during disposal captures the already-incremented generation; R2-S1 below |

## Five logic questions

### 1. How does this fail silently?

The disposal operation can complete successfully while a provider computation started during that disposal remains eligible to spawn a worker afterward. Its generation matches, and the admission counter is zero by the time it posts (provider:358, :394; worker:215, :281). This is R2-S1. The completed diagnostic result in the reproduction is real, not fabricated; the false assurance is shutdown completion covering the outstanding request.

For the two rejected r1 paths, unavailable is preserved and not cached (provider:394, :412, :340). No false-clean result was found in those paths.

### 2. What user action produces unexpected behaviour?

A diagnostics request arrives after disposal begins but before it finishes; its filesystem discovery finishes only after shutdown returns. The request starts a fresh compiler thread (provider:365/:366, :402). This is distinct from an intentional NEW request initiated after completed disposal, which is explicitly supported by worker:196 and worker spec:517.

### 3. What input data produces a wrong answer?

No additional wrong-diagnostic input was substantiated in the changed logic. Scope keys still use the same normalized file list as lane selection (provider:206, :220, :356, :410). Empty scope selects unscoped; outside-only scope is rejected (provider:212). The new shutdown failure reproduces with one ordinary TypeScript file containing TS2322; malformed input is unnecessary.

### 4. What happens when a dependency fails?

A rejected worker run becomes unavailable at provider:412. A changed generation becomes unavailable at provider:394. The MCP namespace preserves that status and reason at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts:225`; its empty diagnostics array is paired with unavailable, not success. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:494` renders the unavailable reason before considering the zero-diagnostic success branch.

Worker error/exit handling is entry-local (worker:310, :313, :353); a late old exit cannot remove a replacement because worker:361 checks identity. A late disposed-worker message has no pending ID and is ignored at worker:328. Concurrent disposal was exercised with real threads and completed with zero live entries and `disposing: 0`.

### 5. What is missing that the requirements never mentioned?

The implementation distinguishes generations but not whether a provider call STARTED while admission was closed. It needs a start-of-discovery admission token or equivalent closed-state check, as well as the post-discovery generation comparison. That allows deliberate reuse after completed disposal while rejecting calls begun during it. See R2-S1.

## Failure modes / numbered new defects

### 1. R2-S1 — Discovery begun during disposal escapes its admission gate — Serious

- **File:** `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:358`; `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.ts:270`.
- **Trigger:** Start disposal with a worker active. Before awaiting it, invoke `getDiagnostics` with deferred filesystem discovery. Await disposal, then resolve discovery.
- **Symptom:** A new referenced compiler worker appears after disposal has completed. The provider finishes a compile from a request already outstanding during disposal.
- **Evidence:** Disposal increments the generation only on entry (worker:270). The provider captures that new value even while disposal is active (provider:358). It checks equality only after discovery (provider:394). By then disposal has decremented its admission counter (worker:281), so `run` passes worker:215 and creates the thread at worker:294.
- **Current handling:** The generation guard covers calls started before disposal; the worker admission guard covers posts made during disposal. Neither covers calls started during disposal whose posts occur afterward. The new provider regression starts the request BEFORE disposal (provider spec:1331), so it misses this ordering.
- **Impact:** The promised disposal boundary does not cover all diagnostics calls begun before it returns. A host using this explicit release/shutdown API can retain a newly referenced compiler worker after cleanup. It can keep the host alive for the compilation or the five-minute worker timeout (worker:170, :252). This is an acceptance/lifecycle defect; no actual production shutdown incident is claimed.
- **Recommendation:** At discovery entry, capture an admission token only when the pool is not disposing; otherwise return unavailable. Revalidate the token immediately before posting. Keep deliberate requests begun after completed disposal reusable. An alternative must invalidate requests begun during the disposal interval as well as those begun before it. Add this exact regression alongside the two r1 cases and concurrent-disposal coverage.

**Independent reproduction:** `%TEMP%/batch19-r2-discovery-during-dispose.cjs` loads the current worker/provider source through in-memory TypeScript transpilation. It uses the repository containment helper, real worker threads, a real compiler and a temporary one-file TS2322 fixture; only filesystem discovery is deferred and unused exclude plumbing is stubbed.

Sequence:

1. Start a real unscoped worker run.
2. `const closing = provider.dispose()` — generation increments and admission closes.
3. `const pending = provider.getDiagnostics(fixture)` — discovery starts during disposal and is held.
4. Await `closing` and the original run's disposal rejection.
5. Resolve discovery and yield one event-loop turn.
6. Observe `liveWorkersAfterDispose: 1`, `threadIds: [2]`.
7. Await `pending`: `status: available`, one genuine TS2322 diagnostic. Dispose again and remove the fixture.

The probe first reproduced with a reference-only config, then with a real broken source file to confirm an actual post-disposal compile. Both variants left a new live worker; all probe threads were subsequently disposed. Source was not modified.

## Blocking issues

None substantiated.

## Serious issues

R2-S1 above: a provider request started during disposal can create a referenced worker after it returns. Fix the discovery admission boundary, not just the worker post boundary.

## Moderate and minor issues

None counted. No load-related failure in the new ten-second contract case was reproduced. Its absolute wall-clock assertion remains environment-dependent, but the case passed in both review rounds and is explicitly required by Batch 19.2 (contract:36, :242).

## Disposal ownership and intended reuse

Reuse after completed disposal is intentional: worker:190 documents disposal as ending a generation rather than permanently closing the pool, worker spec:517 verifies a later run, and provider spec:1342 verifies a later provider call. This is consistent with a process-wide pool (worker:430). Permanent shutdown rejection was not inferred as a new requirement.

A search of production imports, registrations and shutdown code found no direct call to this TypeScript compiler pool's disposal beyond the provider delegate at provider:322. The public `IDiagnosticsProvider` interface has no dispose member (`libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts:55`). Registration supplies a concrete provider as a value (`libs/backend/workspace-intelligence/src/di/register.ts:85`).

The similarly named production handles are different: `libs/backend/cli-engine/src/lib/container.ts:258` describes its armed monitoring/background-work-governor handle, and :302 disposes that handle. Electron assigns its handle using `armDiagnostics` at `apps/ptah-electron/src/activation/wire-runtime.ts:305`, and disposes it at `apps/ptah-electron/src/activation/shutdown.ts:246`. These are not evidence that the compiler pool is explicitly disposed on production quit. No permanent-reuse defect or missing-host-wiring defect is added on that basis. R2-S1 concerns the explicit provider/pool lifecycle contract under review and is directly reproducible without a host.

## Data flow and await audit

1. **OK:** `getDiagnostics` synchronously normalizes root/scope, rejects outside-only input and reads scope-specific cache/in-flight state (provider:200, :212, :220, :228).
2. **R2-S1:** `compute` reads a numeric generation but does not check whether admission is already closed (provider:358).
3. **OK for pre-disposal calls:** Both unscoped discovery and the entire scoped upward walk are awaited before the generation comparison (provider:365, :366, :394). Internal awaits at provider:529 and :551 cannot post a worker themselves. A comparison after the whole walk is sufficient to prevent their pre-disposal generation from posting; comparing at every inner await is unnecessary for that thread invariant.
4. **OK:** Between the final generation comparison and the synchronous call to `run` there is no await (provider:394, :402). No event-loop interleaving can open another gap there.
5. **OK, limited boundary:** `run` checks admission before constructing/refing/posting; the operation is synchronous through message post (worker:215, :221, :252). It does not know when the provider's discovery began, which is the R2-S1 gap.
6. **OK:** Worker completion is awaited; disposal rejects still-pending IDs and ignores late replies (provider:402; worker:353, :373, :328). A successful reply already received before disposal is a completed measurement, not a newly spawned post-disposal thread.
7. **OK:** `runOnce` caches only available measurements; in-flight finally releases its key (provider:340, :230). Budget expiry still retains the run and its cache path (provider:244, :284).
8. **OK for admitted workers:** Concurrent disposals synchronously increment a counter; all join tracked terminations and decrement in finally (worker:269). Real-thread concurrent probe found no hang or premature admission. R2-S1 arises outside this worker snapshot, at discovery entry.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Two lanes keyed by compiler and scope class | COMPLETE | worker:290; provider:410 |
| Scoped work avoids an unscoped queue; same-lane work shares | COMPLETE | worker:291; provider spec:1225 and worker spec:378/:399 passed |
| Cache/in-flight keys consistent across lanes | COMPLETE | provider:220, :228; lane from same normalized scope at :356 |
| Retain-and-cache and five-second cache unchanged | COMPLETE | provider:96, :244, :340, :576; provider spec:1363 passed |
| Per-lane ref/unref, idle termination and crash isolation | COMPLETE | worker:252, :353, :361, :394; full worker suite passed |
| Await disposal of both busy lanes and leave no escaped thread | PARTIAL | Both exact r1 probes fixed; R2-S1 remains |
| Repeat/concurrent dispose and intended subsequent reuse | COMPLETE for worker API | Real-thread concurrent probe; worker spec:517; worker:269 |
| Honest unavailable through MCP | COMPLETE for refused calls | provider:394/:412; namespace builder:225; formatter:494 |
| Containment invariant | COMPLETE | workspace-intelligence tests passed; no containment edit reported |
| Memory tradeoff stated | COMPLETE | worker:25 documents two active lane programs/compiler; does not imply a strict heap-byte or transient terminating-thread bound |
| Hermetic second checkout with own config chain and ten-second budget | COMPLETE | contract:47, :218, :242; real provider integration passed |
| Requested verification | COMPLETE | All six scoped targets, audit and dependency validation passed |

Implicit requirement still missing: discovery-level admission must distinguish a request begun during disposal from a fresh request begun after disposal has completed.

## Edge cases

| Case | Handled | How / concern |
| --- | --- | --- |
| Direct worker post during disposal | YES | worker:215 rejects; zero threads in rerun |
| Discovery starts before disposal and resumes afterward | YES | provider:394 rejects old generation; zero threads in original probe |
| Discovery starts during disposal and resumes afterward | NO | R2-S1: generation already current |
| New request initiated after completed disposal | YES | Intentional reuse, worker:196; provider spec:1342 |
| Two disposal calls concurrently | YES, observed | Probe returned zero live entries, generation 2, disposing 0 |
| Late disposed-worker result or old worker exit | YES by trace | worker:328 and :361 prevent resurrection/cache write or replacement deletion |
| Empty/no config after a generation change | YES for safety | provider:382 returns unavailable without posting; reason may describe missing config rather than disposal |
| Filesystem discovery rejects | YES | Rejection propagates and in-flight finally clears; no worker post (provider:230, :366) |
| Slow/never-resolving discovery | Existing budget applies | provider:284 answers at 45 seconds; cancellation of filesystem promises is not added by this revision |
| Scoped/unscoped completion order differs | YES | Distinct provider keys (provider:220), entry-local worker maps |
| Ten-second contract on loaded machine | Passed in this run | No demonstrated CI defect; no universal timing guarantee claimed |

## Verification performed

- Continued the full-file r1 review, reread the revised worker/provider and added regression blocks, both contract files, executor revision report, relevant DI/host shutdown and MCP result paths. Original task/context/research/instruction evidence remains applicable. No source, task state or git operations were changed/performed.
- Re-ran `%TEMP%/batch19-review-discovery-dispose.cjs`: **0 live entries** after delayed pre-disposal discovery.
- Re-ran the original two-busy-lanes/direct-admission probe as `%TEMP%/batch19-r2-dispose.cjs`, adding a rejection handler for the now-correct refusal: **0 live entries**, late call rejected with `TypeScript diagnostics worker was disposed.`
- Added `%TEMP%/batch19-r2-concurrent-dispose.cjs`: two overlapping disposals, two busy lanes, late direct post. **0 live entries**, both originals rejected as disposed, late call rejected, `generation: 2`, `disposing: 0`; no hang.
- Added `%TEMP%/batch19-r2-discovery-during-dispose.cjs`: reproduced **R2-S1** with real threads and a real TS2322 result, then cleaned up the new thread and fixture.
- Scoped `ptah_get_diagnostics` on the worker and provider returned **typescript-compiler: 0 errors, 0 warnings**.
- Ran once: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache`. **All six targets passed**, 1m 11s overall. This includes both new regression specs, lane/budget/cache cases, real second-checkout contract and containment suite. Successful suite counts were suppressed by Nx compact output; no count is invented.
- platform-core:test passed this time. The r1 settings-benchmark timeout did not recur; no project-detector failure or new contract failure occurred. Nx marked platform-core:test historically flaky, which is not a failure in this run.
- `nx run degradation-audit:lint --skip-nx-cache`: **passed, TOTAL 300**.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: **passed**.
- No plugin worker startup failure; no `NX_ISOLATE_PLUGINS=false` retry and no suite rerun were needed. Each background command was collected with one completion check.
- Logs: `%TEMP%/batch19-r2-checks.log`, `%TEMP%/batch19-r2-audit.log`, `%TEMP%/batch19-r2-deps.log`.
- Limitations: no git/base comparison under the role's no-git rule; unchanged-file claims use the continuing review and supplied change inventory. No permanent shutdown caller of the compiler pool was found in the production paths searched. No sustained machine-saturation benchmark was run. No native Write/file-content tool was listed, so native PowerShell wrote only this review in the task folder.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the reproduced admission gap and original-fix verification; MEDIUM for runtime-wide ownership completeness and timing on other machines.
- Top risk: A diagnostics request begun during disposal can still create a referenced compiler thread after disposal returns.
- What a robust implementation would add: discovery-start admission/token validation, the during-disposal discovery regression, and retained tests for pre-disposal discovery, direct worker admission, concurrent disposal and deliberate reuse after completed disposal.
