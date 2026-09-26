# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 19, r1, Lane C. Source was read only; no git operations were performed.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 1 |

The lane split and scope-specific result keys are coherent. One reproduced shutdown admission race prevents the unconditional “dispose leaves no thread” acceptance criterion from holding. This is an inherited lifecycle gap, not a claim that the lane key introduced it. The score is below 7 because shutdown can return while a referenced worker remains alive; it is above 5 because the lane isolation, normal disposal, cache retention and compiler checks work and the scoped project checks passed apart from an unrelated benchmark.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-c/`. For readability:

- **worker** = `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.ts`
- **provider** = `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts`
- **worker spec** = `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.spec.ts`
- **provider spec** = `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts`
- **contract** = `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts`

## Five logic questions

### 1. How does this fail silently?

`dispose()` can resolve with a live replacement worker. Its worker snapshot and termination set exclude new work admitted while it is awaiting termination (worker:244, worker:259). A caller can therefore believe shutdown completed while a thread is still referenced (worker:228). See S1.

Ordinary worker errors do not produce clean diagnostics: provider:400 returns unavailable and provider:340 caches only available results. A late message from a lane rejected by disposal finds no pending ID and is ignored (worker:297, worker:342), so that message cannot repopulate the provider cache.

### 2. What user action produces unexpected behaviour?

Start diagnostics and initiate shutdown while discovery is still pending, or allow a concurrent diagnostics request during worker disposal. The compiler can start after disposal has completed or escape its snapshot. Provider:363 and provider:364 await filesystem discovery; provider:322 delegates disposal without cancelling or fencing that pending computation. See S1.

Posting a scoped check while an unscoped check is running does use a separate lane (provider:398; worker:259). Existing same-lane runs continue to share a worker (worker:260; worker spec:378 and :399).

### 3. What input data produces a wrong answer?

No cross-lane cache collision was found for supported path inputs. The same normalized scope determines both the key at provider:220 and the lane at provider:356/:398. Unscoped keys end at the root separator; a nonempty scoped key contains absolute file paths. Sorting and deduplication at provider:608 prevent permutations from creating different logical scopes. Out-of-root-only scopes are rejected at provider:212.

The second-checkout guard compares root-relative diagnostics and marks foreign paths OUTSIDE (contract:95). It requires the broken source path to occur in the primary answer (contract:238). No wrong-answer defect in the changed lane routing was substantiated.

### 4. What happens when a dependency fails?

A worker error or exit affects only its entry's pending map (worker:279, :282, :336). The entry identity check at worker:330 prevents a dying old worker from removing its replacement. A run exceeding five minutes terminates only that lane and rejects its queued siblings explicitly (worker:205). These paths are covered by worker spec:214, :224, :255, and :418.

Missing compilers/configs return unavailable (provider:351, :380); discovery rejection propagates, and the in-flight slot clears in finally (provider:230). Malformed wire responses are trusted at worker:277; the producer is the internal fixed worker program, not an external input boundary. Arbitrary wire corruption was not demonstrated and is not counted as a defect in this batch.

### 5. What is missing that the requirements never mentioned?

The shutdown contract needs an admission/generation rule for requests already discovering configs and requests arriving during disposal. The current test covers two already-posted runs and awaited termination, but no new admission (worker spec:458). See S1.

The required ten-second second-checkout budget is an absolute wall-clock assertion (contract:225, :242). It passed during this review's loaded parallel project run. That is evidence for this run, not proof against every scheduler or I/O delay. No realistic load reproduction of a failure in that new case was obtained, so none is invented as a CI defect.

## Failure modes

### 1. S1 — Shutdown admits work outside the set it awaits — Serious

- Trigger: Both lanes are running; start disposal and post a new scoped run before disposal finishes. Alternatively, start a provider call, dispose while its filesystem discovery is pending, then let discovery complete.
- Symptom: Disposal resolves, but a worker remains alive and can keep the host open while compiling. A pending discovery can even create the thread after disposal has resolved.
- Evidence: worker:194, :244, :247, :251, :259; provider:322, :363, :364, :390.
- Current handling: `failWorker` removes old entries immediately; `dispose` awaits only the snapshot and tracked terminations. `run` has no disposing guard. Provider disposal neither fences pending `compute` continuations nor drains them.
- Recommendation: Add an explicit shutdown admission rule. Prevent new worker admission during disposal and invalidate/cancel pre-disposal discovery continuations before they can post. If the process-wide pool must be reusable afterward, use a disposal generation rather than permanently disabling it. Drain all work belonging to the disposed generation before reporting completion. Add deterministic regressions for both interleavings.

## Blocking issues

None substantiated.

## Serious issues

### S1 — Disposal can finish with a live, referenced thread

- File: `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.ts:244`; `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:322`.
- Scenario: Concurrent run admission during termination, or a pre-existing diagnostics call completing config discovery after disposal.
- Impact: Hosts using the documented explicit shutdown path can finish teardown while a compiler thread remains active. That thread is referenced at worker:228 and may remain busy until completion or the 300-second timeout at worker:170. This violates Batch 19.1's “leaves no thread” requirement.
- Fix: Fence admission and pending discovery by disposal generation, join all terminations for that generation, and pin both races. Preserve the separately required retain-and-cache behaviour for ordinary 45-second result-budget expiry.
- Provenance: The snapshot lifecycle was retained by this batch. This review reports it because lifecycle preservation and no surviving thread are explicit acceptance criteria; it is not attributed to the new lane separator.

Reproduction evidence, using source loaded from this worktree and real Node worker threads:

1. `%TEMP%/batch19-review-dispose.cjs`: start scoped and unscoped runs; call `pool.dispose()`; immediately post another scoped run; await disposal. Output: `afterDisposeLiveEntries: 1`, `threadIds: [3]`. Both original runs rejected as disposed. The replacement still completed afterward. A second disposal cleaned it up.
2. `%TEMP%/batch19-review-discovery-dispose.cjs`: call the real provider with a deferred `findFiles`; await provider disposal; resolve discovery to a temp config; yield one event-loop turn. Output: `liveWorkersAfterDispose: 1`, `threadIds: [1]`. The probe uses the repository containment helper and stubs only the filesystem discovery/exclude plumbing. A second disposal cleaned up the thread and the temp fixture was removed.

The probes transpile source in memory, live only under the OS temp directory, and do not change reviewed source.

## Moderate and minor issues

None counted. Suggested test hardening, not additional defects: explicitly deliver an old exit after a replacement is registered (worker:330), and deliver a result after disposal rejects its pending ID (worker:297). Current code handles these orderings by inspection, but the new lane tests do not pin them directly.

## Data flow

1. **OK:** Entry validates root and normalizes scope, refusing outside-only input (provider:192, :206, :212).
2. **OK:** Root plus sorted scope drives both cache and in-flight lookup, in one synchronous block (provider:220, :228, :235).
3. **OK:** Result budget races the retained promise; it does not cancel the compilation or remove its key (provider:265, :284). Successful completion caches for five seconds (provider:96, :340, :564).
4. **S1:** Discovery awaits filesystem work with no disposal generation check before posting (provider:363, :390).
5. **OK:** Scoped/unscoped selection is derived from the same normalized scope. Compiler path plus lane selects the worker; pending IDs belong to that entry (provider:398; worker:259, :272).
6. **OK:** Each pending run refs its thread, clears its idle timer and posts a correlated request (worker:226). Idle termination removes its own entry before starting termination; a replacement is protected from the old exit event (worker:330, :369).
7. **OK:** Errors reject only that lane's pending runs, while successful outcomes are filtered/grouped by the provider (worker:322; provider:454). A disposed lane's late reply is ignored (worker:297).
8. **S1:** Disposal joins existing lanes and tracked terminations, but does not close admission or include provider computations still in discovery (worker:244; provider:322).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 19.1 compiler plus scoped/unscoped worker keys | COMPLETE | worker:259 |
| Scoped work does not queue behind unscoped work | COMPLETE | provider:398; provider spec:1225 passed; executor report also records real compiler before/after timings |
| Same-lane sharing | COMPLETE | worker:260; worker spec:378, :399 |
| Retain-and-cache, in-flight deduplication, five-second TTL | COMPLETE | provider:220, :244, :340, :564; provider spec:1315 passed |
| Error/exit isolation and per-lane ref/unref/idle cleanup | COMPLETE | worker:279, :330, :363; worker spec:418, :431 |
| Disposal awaits every lane and leaves no thread | PARTIAL | Normal posted-run case passes; S1 escapes shutdown |
| Containment test remains green | COMPLETE | workspace-intelligence:test passed; containment source is outside the declared six-file change list |
| Memory tradeoff stated | COMPLETE | worker:25 describes two active lane programs/compiler; executor report documents two compiler loads and idle reclamation. This is an active-lane bound, not a strict heap-byte or transient terminating-thread bound |
| 19.2 hermetic second checkout, own config chain, factory, ten-second budget | COMPLETE | contract:47, :218, :242; provider spec:150 wires the real compiler case |
| Requested verification all green | PARTIAL | Existing platform-core settings benchmark timed out; other requested targets passed |

Implicit requirement not addressed: consistent shutdown admission across the provider's asynchronous discovery and the shared worker pool.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| No root / no owning config | YES | provider:192, :380 report unavailable | None identified in the lane change |
| Empty scope | YES | provider:606 treats it as unscoped | Same key and lane decision |
| All requested files outside root | YES | provider:212 refuses it | No accidental full compile |
| Repeated requests / reversed scope ordering | YES | provider:220, :608 normalize and share | Cache remains instance-local by design |
| Scoped and unscoped finish in either order | YES | Distinct scope keys at provider:220 | No cross-lane clobber found |
| One lane crashes or times out | YES | Entry-local pending map and removal, worker:322 | Other lane remains registered |
| Idle timeout races a new post | YES | Synchronous map removal plus identity guard, worker:330, :373 | Temporary old/new thread overlap while terminate resolves |
| Both already-posted lanes busy at disposal | YES | worker spec:458 holds both terminations | Does not cover S1 |
| Late result from disposed lane | YES | pending IDs cleared, worker:342/:297 | Ignored rather than cached |
| Discovery resumes after disposal / new run during disposal | NO | No generation or admission guard | S1: surviving thread |
| Loaded machine during second-checkout compile | YES, observed | Real case passed in requested parallel run | Fixed wall-clock budget remains environment-sensitive; failure not reproduced |

## Verification performed

- Read all six scoped source/spec files, the worker program and containment spec, DI registration, Batch 19, context decisions 2 and 17, requested research sections and executor report. No task-description, implementation-plan or existing code-style-review existed in this task folder. `ptah_search_files` returned no AGENTS.md. The root copilot review instructions were read; their issue quota was not used to manufacture findings.
- No Ptah file-content reader or native `Write` tool was listed. Native PowerShell was used for full source reads and for writing this deliverable. Source was not edited.
- `ptah_get_diagnostics` with the three relevant implementation/contract paths returned **unavailable: still running after 45s**, not a clean result. No clean-diagnostics claim is based on that call.
- Ran once: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache`. Result: five targets passed, only platform-core:test failed. Workspace-intelligence:test passed, so the new real compiler contract, lane regression, budget/cache test and containment suite passed. Nx's compact output suppressed successful suite counts.
- platform-core:test: **42 suites passed, 1 failed; 820 tests passed, 1 failed, 4 todo**. Failure was `libs/backend/platform-core/src/file-settings-manager.bench.spec.ts:86`, the existing 1,000-write performance smoke exceeding its 30,000 ms timeout. Subsequent fixture cleanup produced ENOENT/log-after-test errors and Jest's forced-worker-exit warning. Those logs are not evidence of a diagnostics worker leak. The new contract self-spec was not the failing suite. This establishes the cause in this review run, not the executor's earlier truncated run.
- No `project-detector.service.spec.ts` failure in this run; workspace-intelligence:test passed. Nx marked both test targets flaky based on its history; that label alone does not attribute a failure to the new contract.
- `nx run degradation-audit:lint --skip-nx-cache`: passed, **TOTAL 300**.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: passed.
- No plugin-worker startup failure; `NX_ISOLATE_PLUGINS=false` retry was unnecessary. Failed suites were not rerun.
- Full command logs: `%TEMP%/batch19-review-checks.log`, `%TEMP%/batch19-review-audit.log`, `%TEMP%/batch19-review-deps.log`. Two temporary real-thread probes reproduced S1, as described above.
- Limitations: no git diff/base comparison was performed under the role's no-git rule. The six-file scope and unchanged-containment claim use the supplied file list/executor evidence. No sustained CPU-saturation benchmark was added; the required ten-second case passed under the load present during the requested checks.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for S1 reproduction and lane/key analysis; MEDIUM for performance across other machines.
- Top risk: Shutdown can report completion while pending discovery or concurrent admission leaves a referenced compiler worker alive.
- What a robust implementation would add: disposal-generation fencing across discovery and worker admission; regression tests for both reproduced interleavings; retained assertions for normal two-lane disposal and 45-second retain-and-cache behaviour.
