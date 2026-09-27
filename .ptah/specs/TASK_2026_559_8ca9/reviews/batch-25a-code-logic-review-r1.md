# Code Logic Review — TASK_2026_559_8ca9, Batch 25a r1

## Summary

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`. Reviewed the named uncommitted Batch 25a implementation and its executor report, the Batch 25a requirements and diagnostics plan, and the carried Batch 23b r5 findings. Source and specs remained read-only. No git operations, staging, commits or status changes were performed.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 |

The carried root-validation defects are fixed in independent probes. The diagnostics contract, syntax qualification, normal limits and registration are implemented, and the four-project check passed 11 of 12 targets. Two new lifecycle defects remain: a mixed request can expose an unhandled inner-provider rejection even when its caller catches the outer promise, and pending census work can be duplicated after its cache TTL. Both were reproduced against the actual wrapper. These failure paths, rather than the known Electron stress prerequisite, prevent approval.

The score is below the sound 7–8 band because one dependency failure can terminate the caller process and slow discovery loses its promised single-flight behavior. The normal-path coverage and carried fixes keep this above the significant-problems 3–4 band.

Paths below are relative to the worktree. `LAD` denotes `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`; `PC` denotes `libs/backend/platform-core/src/`.

## Five logic questions

### 1. How does this fail silently?

No new success-looking empty graph was reproduced: both carried missing-root and root-rename cases now report failure/unknown coverage. The census cost can nevertheless grow without disclosure because TTL replacement starts a second walk while the first is still pending (`LAD:837-845`); the answer's unknown census does not limit that background work. See finding 2.

### 2. What user action produces unexpected behavior?

Request diagnostics for a TypeScript file together with a Python/Go/C# file while the inner TypeScript provider rejects. The wrapper awaits syntax processing before attaching an awaiter to the already-running type-check promise (`LAD:495-504`). A caller catching the wrapper's promise is insufficient to prevent an unhandled rejection. See finding 1.

### 3. What input data produces a wrong answer rather than an error?

The exercised syntax-only and mixed fixtures keep check kind and coverage separate from the number of diagnostics (`LAD:541-569,594-609`). In this contract, clean coverage does not mean zero syntax errors. Unsupported, omitted and unreadable files qualify the answer. No additional reproducible wrong-answer case was established. The planned graph-census reuse is not implemented; the alternative census and its cost are discussed below rather than presented as meeting that literal requirement.

### 4. What happens when a dependency fails, times out, or returns a wrong shape?

File read/stat failures become `failedByReason.read` (`LAD:741`), excessive size becomes too-large, parser Result errors become parse/grammar-unavailable, and discovery failures become unknown census (`LAD:877`). A resolved TypeScript unavailable result is handled, but a rejected TypeScript promise is not observed promptly (finding 1). The census wait has a ten-second answer budget (`LAD:819`), but it does not cancel work; TTL replacement must therefore preserve a separate in-flight identity (finding 2). The probes inject boundary failures deliberately; they do not claim the real compiler failed during the normal scoped suite.

### 5. What is missing that the requirements never mentioned?

A promise cache needs different rules for pending work and completed values. Starting a TTL when discovery starts and evicting pending entries as ordinary cached values allows duplicate work (`LAD:844,858`). Concurrent independent suboperations also need immediate rejection observers, not only eventual awaits (`LAD:503-504`). The existing tests exercise resolved unavailable answers and one budget timeout, but do not cover either of these lifecycle transitions.

## Numbered findings / failure modes

### 1. B25A-R1-S1 — Serious: mixed-scope TypeScript rejection can escape the outer error handler

- **File:line:** `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts:495`, especially :503-504.
- **Trigger:** A scoped request includes at least one TS/JS file and one syntax-capable file. The inner provider's promise rejects before syntaxCheck completes. Even the normal syntax path yields a macrotask before checking a file (`:709`).
- **Symptom:** The inner promise has no rejection handler during that interval. Node emits an unhandledRejection; under the tested default Node process behavior it exits with code 1, despite `try { await provider.getDiagnostics(...) } catch (...)` around the public call. In hosts with a global rejection listener, the failure is still spuriously reported globally before the outer request receives it.
- **Current handling:** The type check starts at :497, syntax processing is awaited at :503, and the first handler for the type-check rejection is the later await at :504. The existing unavailable-result test at `language-aware-diagnostics-provider.spec.ts:458` resolves an unavailable object and does not exercise a rejected promise.
- **Independent proof:** `%TEMP%/task559-25a-provider-public-probe.cjs` loads the real wrapper, creates actual temporary `.ts`/`.py` files, uses normal successful syntax-parser results, and injects an inner provider whose async getDiagnostics rejects. It records both the eventual caught error and `unhandledRejections:["inner check failed"]`, plus PromiseRejectionHandledWarning. `%TEMP%/task559-25a-provider-crash-probe.cjs` is the same case without the monitoring listener; it exits 1 before reaching the outer catch's result output. This is an injected dependency-failure reproduction, not a claim that the compiler normally rejects every mixed request.
- **Recommendation:** Attach observers to both suboperations immediately, for example by awaiting an appropriately typed Promise.all of the started type check and syntaxCheck. Preserve the existing handling of a resolved unavailable result and ensure syntax failure cannot leave type-check rejection orphaned either. Add a regression that catches the public call and asserts no unhandledRejection or process termination.

### 2. B25A-R1-M1 — Moderate: pending census expires as cached data and starts duplicate walks

- **File:line:** `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts:837-845`; pending entries also share the LRU eviction at :858-863.
- **Trigger:** A filesystem census takes longer than 60 seconds, or stalls. The caller retries after the cache TTL while the earlier walk remains active. A slow network/remote tree is the relevant failure case; the ten-second response budget explicitly permits discovery to outlive the answer.
- **Symptom:** A new findFiles traversal starts for the same root. Repeated retries can start another walk every minute without canceling or sharing the old work. The eight-entry cache limit bounds map entries, not the operations still running after replacement/eviction.
- **Current handling:** CensusEntry stores only its creation time and promise. At :837 age alone decides reuse; :844 timestamps the new promise before it resolves. Expired entries are replaced regardless of whether their work has completed. `censusWithinBudget` only races the answer and clears its timer; it intentionally does not cancel discovery.
- **Independent proof:** The public-provider probe leaves each fs.findFiles promise pending, makes three actual unscoped getDiagnostics calls at simulated times 0, 60,001 and 120,002 ms, and observes three walks for the same root before resolving any. It then resolves all walks and awaits all public requests. No private method is called in this version of the probe.
- **Recommendation:** Separate in-flight census work from completed cached values. Apply freshness TTL after completion, retain/share pending work until it settles, and make LRU eviction and invalidation semantics explicit so they cannot silently multiply long-running scans. If restarting pending work is required, provide an actual cancellation/concurrency policy. Pin the >TTL pending case with fake time. Moderate because the trigger is unusually slow/stalled discovery; no ordinary fast-walk wrong answer is alleged.

## Blocking issues

None established.

## Serious issues

Finding 1 above. Immediate observation of concurrent failures is required before acceptance.

## Moderate and minor issues

Finding 2 above. No naming, formatting or speculative findings are included.

## R5-B1 / R5-M1 probe results

Commands run from the reviewed worktree using existing temporary probes or a narrow adaptation to continue after the now-expected rejection:

```powershell
node "$env:TEMP/task559-25a-carried-probe.cjs"
node "$env:TEMP/task559-23b-r5-race.cjs"
```

`task559-25a-carried-probe.cjs` is the previous r5 callers probe with a catch around the real indexWorkspace invocation, solely so Electron and later cases still execute after the now-correct rejection. It retains `respectIgnoreFiles:false` and uses the actual adapter and indexer implementations. No reviewed source or spec was changed.

| Carried case | CLI result | Electron result |
| --- | --- | --- |
| Missing root, limited findFiles | IncompleteFileSearchError, ENOENT 1 | Same |
| Missing root, unlimited findFiles | IncompleteFileSearchError, ENOENT 1 | Same |
| Actual indexWorkspace over missing root | Rejects IncompleteFileSearchError; no successful zero-file index | Same |
| Root opendir ENOENT after stat succeeds | Discovery unreadable ENOENT 1; graph census unknown, clean false, census? | Same |
| Real temporary root rename immediately after native stat | renamed true, rootExists false; unknown/non-clean graph with census? | Same |

**R5-B1: FIXED.** Shared root checks now run before and after unlimited fast-glob (`platform-cli/src/implementations/cli-file-system-provider.ts:161,170`; Electron equivalent :159,169). `PC/utils/bounded-glob-walk.ts:138,160` implements the shared root failure/error conversion.

**R5-M1: FIXED in the reproduced cases.** Root ENOENT is distinguished from a descendant race at `PC/utils/bounded-glob-walk.ts:205-217`; opening/reading the root reports through it (:292,331), and static-prefix/literal ENOENT rechecks cwd (:245). The independently rerun real rename fixture no longer publishes clean coverage.

Fails-before protection exists at:

- CLI adapter spec :230 (unlimited missing/non-directory root) and :261 (lost root after search); Electron file-system spec :218 and :249 mirror these cases.
- `PC/utils/bounded-glob-walk.spec.ts:296` covers a real rename after stat for root, static-prefix and literal patterns; :343 covers root opendir ENOENT after a successful stat. These scenarios match the failures independently observed in the preceding r5 review, so their failure on that implementation is supported without modifying source to rerun it.
- `WI/file-indexing/workspace-indexer.service.spec.ts:502` pins propagation from the adapter. As the report correctly says, this indexer pin alone passes before the fix; the adapter/walker regressions are the fails-before tests. The real indexer + actual adapters probe supplies the end-to-end evidence.

## Data flow

1. **OK:** Registration function name is unchanged. `WI/di/register.ts:86-100` installs one language-aware wrapper around a newly constructed TypeScript provider and resolves the registered parser.
2. **OK:** Scoped paths are contained/deduplicated (`LAD:426-439`) and split into type-check, syntax, unsupported/unrecognized/non-source buckets (:449-491). Syntax is capped at 50 files (:500); omitted files are disclosed.
3. **GAP:** Type checking starts concurrently, but rejection observation is delayed behind syntax (:495-504; finding 1).
4. **OK for reported parser/read results:** Each syntax file is size-gated before/after read (:737-751), queried without spawning a subprocess (:754), and emits at most 20 errors plus an informational omission marker (:779-803). Parse/start failures do not become clean files.
5. **OK:** Coverage and notChecked are assembled on both result arms; type-checked counts use analyzed:null, syntax checks carry their language approximations (:541-609).
6. **PARTIAL:** Unscoped calls do no syntax parsing and disclose unchecked/unsupported counts (:612-681). Discovery is bounded, but its promise/cache lifecycle duplicates pending work (finding 2).
7. **OK for carried cases:** Both filesystem adapters now propagate root unavailability; the graph-discovery qualification paths remain intact.

## Requirements fulfilment

| Requirement | Status | Evidence / limitation |
| --- | --- | --- |
| coverage on both contract arms | COMPLETE | `PC/interfaces/diagnostics-provider.interface.ts:60-81`; optional for providers that cannot know their census, as the batch allows. |
| Floor rule limited to type-check claims; syntax checks named | COMPLETE | Interface :102-109; shared contract helper :61 and syntax-only fixture case :347; wrapper :568-569. |
| Existing providers remain contract-compatible | COMPLETE in scoped checks | Optional fields and optional syntax fixture leave legacy providers' shape intact; core/CLI/Electron/WI contract suites ran. VS Code's project was not independently tested in this four-project run. |
| Scoped TS/JS delegate, analyzed:null | COMPLETE on normal/result-unavailable paths | LAD :495,546; rejection lifecycle defect recorded separately. |
| Syntax caps: 50 files, 1 MiB/file, 20 errors | COMPLETE for specified output bounds | LAD :500,738,750,779; real grammar and scripted cap tests pass. The 20 limit bounds emitted diagnostics, not the parser's internal query-match allocation. |
| Unscoped no syntax scan; unchecked hint; unsupported languages | COMPLETE | LAD :612-681; covered by unscoped Python/mixed-language specs. |
| Census from graph if present, otherwise bounded discovery | PARTIAL / documented deviation | LAD :32-39 and :867 always perform independent discovery; constructor has no graph census input. See assessment below. |
| Cached per root, invalidate drops census | PARTIAL | Invalidate :404 deletes the root/all cached entries and forwards invalidation. Pending work outliving TTL violates single-flight (finding 2). |
| No tsconfig → unavailable with coverage | COMPLETE in normal scoped/unscoped paths | LAD :572-588,669-676; specs use an unavailable inner result. |
| No new process spawning; Batch 19 lanes/budget untouched | COMPLETE for syntax path | Only in-process parser calls in LAD; TypeScript provider implementation/worker lanes not changed by this batch. Mixed rejection observation still needs correction. |
| Registration name retained | COMPLETE | register.ts:86. |
| Carried R5-B1 / R5-M1 | COMPLETE for acceptance probes | Both independent probes and corresponding regression tests pass. |

### Census deviation assessment

The executor openly substitutes an independent bounded census for graph reuse. Its reason is substantive: the graph report aggregates by language and folds language buckets, while this provider distinguishes syntax-capable `.py` from unsupported `.pyi`. Inventing that distinction from a lossy graph summary would be dishonest. The implementation therefore preserves answer correctness, but does not literally meet the graph-first acceptance criterion (`implementation-plan-languages.md:359`, `batches.md:3270`). The plan/handoff should explicitly accept the independent census or provide sufficient extension-level graph census data. This discrepancy is recorded as PARTIAL, not inflated into a third reproduced failure mode. The independent scan's lifecycle must be fixed regardless of which census source is chosen.

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| 51 syntax files | YES | 50 checked, remainder omittedByCap/notChecked; scoped test passes. |
| Oversized/unreadable syntax file | YES for Result/read paths | failedByReason; never counted analyzed. |
| Inner provider resolves unavailable | YES | Whole mixed answer unavailable; checked syntax count/errors described. |
| Inner provider rejects while syntax runs | NO | Finding 1; monitoring probe and default-Node process exit reproduced. |
| Failed/timed-out census | YES for answer honesty | Unknown coverage; failure is not certified clean. |
| Census remains pending beyond TTL | NO | Finding 2; three concurrent walks for one root in public-call probe. |
| Invalidation after cached result | YES in normal case | Existing test verifies rediscovery and inner invalidate forwarding. |
| Missing root / root renamed after stat | YES in carried probes | Both adapters and graph qualification pass. |
| Missing literal file under an existing root | YES | Adapter/walker control specs preserve ordinary empty result. |

## Verification

- Ran once: `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/platform-cli @ptah-extension/platform-electron @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2`, with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Header explicitly says **4 projects**.
- **11/12 targets passed.** Only platform-electron:test failed. Electron: 35 suites passed, 1 failed, 2 skipped; 651 tests passed, 3 failed, 4 skipped, 3 todo. All three failures are the known missing `dist/apps/ptah-electron/workspace-watch-host.mjs` prerequisite (`workspace-watch-host.stress.harness.ts:81`). No perf-smoke or new diagnostics/walker test failure occurred. Full log retained at `%TEMP%/task559-25a-review-checks.log`; no suite rerun merely to reread output.
- `ptah_get_diagnostics`, scoped to the new provider and diagnostics interface: TypeScript compiler source available, **0 errors, 0 warnings**.
- Independent carried probes and public-wrapper failure probes described above. `%TEMP%/task559-25a-provider-public-probe.cjs` observes unhandled rejection and duplicated pending census; `%TEMP%/task559-25a-provider-crash-probe.cjs` intentionally reproduces exit 1 with an injected rejecting inner provider. These are verification artifacts, not production child processes spawned by the provider.
- Read the new provider, diagnostics interface/contract/self-tests, walker and changed adapter paths, DI/barrel wiring, provider specs and carried pins, plus relevant parser/TypeScript-provider/caller behavior. The requested review is based on the supplied changed-file inventory and current contents; no git command or source substitution was used.
- No cross-platform runtime was available for this review. The normal grammar cases are covered by the scoped Jest run; the independent failure probes use a successful scripted parser to isolate wrapper lifecycle behavior. The author-reported audit/dependency checks were not rerun as part of the specifically requested four-project verification.

## Integration note for Batch 25b

The executor correctly identifies that current namespace/rendering code still drops the new fields until 25b. That forwarding work is explicitly allocated to 25b in the plan, so it is not counted as a new 25a source defect. The two batches need to reach users together; this review does not certify current end-to-end rendering of syntax-only coverage or the compact-coverage serializer as complete.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a rejected inner diagnostics promise can terminate a mixed-language caller despite its outer error handler.
- What a robust implementation would add: immediate observation of concurrent type/syntax operations; a separate pending-census registry or explicit pending state with completion-based TTL; regression cases for both. Preserve the passing carried root-validation fixes.
