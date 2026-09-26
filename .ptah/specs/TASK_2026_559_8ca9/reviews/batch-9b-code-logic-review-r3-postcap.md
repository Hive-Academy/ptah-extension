# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Requested verdict   | REVISE         |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 0              |
| Failure modes found | 1              |

Independent Batch 9b post-cap review r3, 2026-09-26. The three specific r2 failure mechanisms are corrected. All requested verification commands pass. An actual-code probe establishes a new completion regression: successful empty discovery slower than the bounded wait causes every sequential query to return building, including queries made after the preceding graph finished successfully.

The working cold-call deadline, generation fencing, failure handling and per-import scheduling place this above the significant-broad-failures 3–4 band. The inability to deliver a completed empty result on a supported slow-discovery path prevents a sound 7–8 assessment. This is a completion defect, not a finding about the accepted cost of scanning empty workspaces repeatedly.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. `CE/` = `libs/backend/vscode-lm-tools/src/lib/code-execution/`; `PD` = `CE/mcp-core/protocol-dispatcher.ts`; `PS` = its `.spec.ts`; `DG` = `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`; `DS` = its `.spec.ts`.

## r2 findings status

| Finding                                                                   | Status | Code and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R2-B1 — unresolved empty refresh or foreign explicit build answered ready | FIXED  | PD:2451–2455 returns building for a foreign running build. PD:2476 distinguishes an unknown discovery count from confirmed zero. PS:5021 holds discovery past the deadline and checks building, then releases a nonempty result and checks recovery. PS:5047 holds an explicit replacement over the empty graph, checks building and no extra discovery, then checks its published file. Both reproduce the original triggers. The related slow-empty completion regression is separately R3-S1. |
| R2-M2 — obsolete failure reaches a waiting caller                         | FIXED  | PD:2460–2465 revalidates generation after waiting; PD:2494 selects current readiness without a second wait. PD:2593–2598 records failure only for the current generation. PS:5084 keeps the original caller waiting, publishes an explicit replacement, rejects old discovery and asserts both the waiter and a later caller succeed. Current failure cases remain covered at PS:4487, :4512 and :4530.                                                                                          |
| R2-M1 — no yield inside one import-heavy node                             | FIXED  | DG:407 invokes the slice check for each import; DG:390 yields a macrotask and :392 checks generation. DG:231 prevents publication after supersession. DS:681 asserts a heartbeat between the first and last imports of a single node; DS:704 evicts mid-node and asserts early termination and no publication. These pin intra-node scheduling, rather than merely yielding between files. An independent 800,000-import probe returned building in 1,503 ms with 148 timer ticks.               |

## Five logic questions

### 1. How does this fail silently?

No new authoritative false-empty result was established in the corrected r2 scenarios: PD:2455 and :2476 now keep their status as building. The new failure is visible non-completion: PD:2457 starts a fresh job on every later empty query, and PD:2476 prevents that query from consuming the previously completed empty graph while the new discovery is unknown. R3-S1.

### 2. What user action produces unexpected behaviour?

Follow the retry instruction after an empty build has completed. If discovery consistently takes longer than 1,500 ms, the next call starts another discovery and returns building again (PD:2337, :2457, :2476). Waiting longer between calls does not help: the next scan starts only when that call arrives. The three tools share this helper at PD:1963, :1997 and :2156.

### 3. What input data produces a wrong answer?

A valid workspace with zero matching ts/tsx/js/jsx files and a finite but slow discovery produces repeated progress responses instead of its known empty answer (PD:2631, :2635; R3-S1). No new incorrect dependency edge or symbol value was established. Existing coverage and paging branches remain at PD:1983, :2016 and :2166.

### 4. What happens when a dependency fails?

Current discovery failure is recorded and reported, then the next call can rebuild (PD:2593, :2467, :2611). A probe returned failed followed by ready after recovery. The obsolete failure test at PS:5084 exercises the post-wait generation correction. A separate overlapping-job probe confirmed a current failure remained available to the next caller, rather than being erased by the old job. No unhandled rejection was observed in these probes.

A service build releases its running entry in finally (DG:247). Governor AbortError propagates; other admission failures warn once and proceed (DG:721–726). Existing per-file failures remain skipped at DG:339 and :358; that older policy is outside this correction and is not counted again. A finite successful dependency can still fail to deliver an empty answer through R3-S1.

### 5. What is missing that the requirements never mentioned?

The completed empty result needs a delivery state separate from “a new freshness scan is needed.” PD:2583 remembers emptiness, but PD:2611 discards the completed job; PD:2457 therefore has no terminal outcome to deliver before starting another blocking refresh. Preserve a generation-bound completion for a later waiting/retrying caller to consume. This need not turn into a permanent empty cache or weaken the building response while an actual replacement is pending.

## Failure modes / new defects

### R3-S1 — Successful slow empty builds never deliver their result on sequential retries (Serious)

- File: `CE/mcp-core/protocol-dispatcher.ts:2457`, `:2476`, `:2583`, `:2611`.
- Trigger: discovery returns an empty array successfully, but takes longer than `GRAPH_BUILD_WAIT_MS` (1,500 ms). The caller retries after the completed build has left the latch, as the tool's retry hint encourages.
- Symptom: every call reports building. In between calls the graph is already built, coverage is 0/0, and the service reports building=false. Each retry immediately reserves another generation and restarts discovery, whose unknown count prevents the cached empty graph from answering.
- Current handling: the success callback only adds the root to `latch.empty` (PD:2583); finally removes the job (PD:2611). A later call excludes that graph from the warm fast path (PD:2426–2428), starts a new job (PD:2457), and the corrected predicate (PD:2476) returns building until that particular scan confirms zero. When every scan exceeds the wait, every such call times out before confirmation.
- Impact: all three dependency tools can indefinitely withhold a valid empty answer on large non-JavaScript workspaces or slow filesystems. The dependency is succeeding and every call is within the latency bound, yet retries never reach the promised normal result.
- Reproduction: actual readiness helpers extracted without logic changes from PD, and the actual transpiled DependencyGraphService, with immediate workspace lookup and discovery resolving `[]` after 1,650 ms. Three sequential calls returned building in 1,516 / 1,507 / 1,507 ms. After each call, the probe allowed the scan to finish before issuing the next: service state was respectively generation 1 / 2 / 3, building=false, with coverage 0/0 each time. Discovery ran three times. A control using immediate empty discovery returned ready twice.
- Why this is new: r2's predicate accepted the old empty snapshot while an unknown refresh was pending. The correction properly prevents that false-ready case, but now makes the existing eager rediscovery cycle prevent delivery of any terminal result on this schedule. The finding is **not** the accepted lack of cooldown or the repeated scan cost; it is the new infinite sequence of building responses despite successful completion.
- Recommendation: retain an unconsumed successful empty completion, tied to its generation, so a retry can receive that terminal result before requesting another refresh. Supersession/eviction must invalidate it, and an already pending replacement must still answer building. Add a regression where empty discovery exceeds the wait, completes between calls, and a subsequent call receives normal empty data. Keep the existing delayed-empty-to-nonempty and foreign-build regressions.
- Coverage gap: PS:4985 and the helper at :5009 establish emptiness with immediate discovery. PS:5021 releases the slow refresh with a nonempty list, which then uses the warm fast path. Neither covers slow zero-file discovery followed by a retry after completion.

## Blocking issues

None established in this review.

## Serious issues

R3-S1 above: valid successful empty builds cannot be consumed on ordinary sequential retries when discovery exceeds the wait. Fix the completion handoff and test that schedule.

## Moderate and minor issues

None counted. Single-file synchronous parsing, repeated empty rediscovery without cooldown, and workspace.getInfo before the timer remain the r2 accepted residuals; they are not reclassified or added to the count.

## Data flow

1. Validate arguments and enter shared readiness — OK (PD:1960, :1994, :2152).
2. Resolve caller-aware root — OK (PD:2418; CE/namespace-builders/core-namespace.builders.ts:114). F4's unopened-worktree path remains covered at PS:4542.
3. Return a warm nonempty graph without waiting — OK (PD:2428–2431; PS:4476).
4. Reject obsolete latch ownership and respect a foreign running build — OK (PD:2444–2455). F5's stuck-read replacement remains covered at PS:4964.
5. Reserve before discovery and latch synchronously — OK (PD:2574, :2613). F1 discovery/eviction and explicit replacement tests remain at PS:4906 and :4932.
6. Discover, cap to 5,000, carry uncapped coverage — OK (PD:2631–2650).
7. Governor admission, per-file parsing, per-import linking — OK for reviewed bounds (DG:305, :306, :407); accepted single-parse limitation remains.
8. Fence publication and release service running state — OK (DG:231, :238, :247).
9. Record detached outcome, clear latch, revalidate waiter generation — OK for the r2 failure paths (PD:2581–2611, :2460). Successful slow-empty completion handoff is R3-S1.
10. Return status-first bounded JSON or existing page/cap result — OK in inspected branches (PD:2692, :2706, :2166); R3-S1 repeatedly takes the progress branch.

## Requirements fulfilment

| Requirement                                                       | Status                                  | Evidence / gap                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R2-B1 pending-empty disclosure                                    | COMPLETE                                | PD:2455, :2476; PS:5021, :5047                                                                                                                                                                                                                         |
| R2-M2 waiter generation validation                                | COMPLETE                                | PD:2460, :2593; PS:5084                                                                                                                                                                                                                                |
| R2-M1 intra-node host yielding                                    | COMPLETE                                | DG:407; DS:681, :704; actual-code heavy-node probe                                                                                                                                                                                                     |
| Empty workspace eventually returns its empty result               | PARTIAL                                 | Fast empty returns ready; slow empty sequential retry is R3-S1                                                                                                                                                                                         |
| Cold call within two seconds                                      | COMPLETE for exercised scheduling paths | PD:2337; PS:4575, :4685; probe 1,503 ms. Accepted getInfo/single-parse residuals remain                                                                                                                                                                |
| One build per root for concurrent calls                           | COMPLETE within the same API/root       | PD:2613; PS:4460 and :4624                                                                                                                                                                                                                             |
| Warm nonempty graph stays immediate                               | COMPLETE                                | PD:2428 precedes wait and foreign-build check; PS:4476                                                                                                                                                                                                 |
| Current failure is reported and retry works                       | COMPLETE for exercised paths            | PD:2436, :2467, :2593; PS:4487, :4512, :4530; probe failed then ready                                                                                                                                                                                  |
| F1/F4/F5 remain fixed                                             | COMPLETE for covered scenarios          | PS:4906, :4932, :4542, :4964; reservation and latch checks retained                                                                                                                                                                                    |
| Awaited execute_code buildGraph still returns summary             | COMPLETE                                | CE/namespace-builders/analysis-namespace.builders.ts:443 awaits service and :468 returns counts; DG:224 takes parseAwaited and :388 skips macrotask scheduling when no background callback is supplied. Namespace specs :632 and :652 cover forwarding |
| Status-first JSON within budget                                   | COMPLETE for status branches            | PD:2692 and :2706; PS:4407 tests all three tools                                                                                                                                                                                                       |
| Fixed-text new failure logs                                       | COMPLETE in inspected paths             | PD:2603; DG:725; ordinary older parse/debug logs excluded                                                                                                                                                                                              |
| No graph work in tools/list                                       | COMPLETE by current-code inspection     | PD:390 invokes definition composition, metadata and response construction only                                                                                                                                                                         |
| Shared prompt constants unchanged from HEAD / complete diff scope | NOT INDEPENDENTLY VERIFIED              | The governing reviewer role prohibits all git operations; no git diff was run. Executor and archived r2 review report them unchanged. No source was edited by this review                                                                              |
| Degradation audit TOTAL 300                                       | COMPLETE                                | Fresh requested command passed with exactly TOTAL 300                                                                                                                                                                                                  |
| Scoped test/lint/typecheck and Electron dependency validation     | COMPLETE                                | Fresh commands passed, details below                                                                                                                                                                                                                   |

Implicit requirement needing treatment: terminal empty completion must be observable even when discovery is slower than one call's wait budget.

## Edge cases

| Case                                                     | Handled                      | Evidence / concern                                                     |
| -------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Fast empty discovery, repeated call                      | YES                          | Actual-code control returned ready twice; PS:5009                      |
| Slow empty discovery, retry after successful completion  | NO                           | R3-S1                                                                  |
| Empty refresh still discovering                          | YES                          | PS:5021                                                                |
| Explicit replacement over empty graph                    | YES                          | PS:5047                                                                |
| Superseded discovery rejects while original caller waits | YES                          | PS:5084                                                                |
| Current discovery fails, then succeeds on retry          | YES                          | Probe failed then ready; PD:2467                                       |
| Old permanently pending I/O after eviction               | YES for replacement progress | PS:4964; underlying old I/O is not cancelled                           |
| Import-heavy single node                                 | YES for tested scheduling    | DS:681; 800,000-import probe returned building within bound            |
| Supersession during linking                              | YES                          | DS:704; DG:392 and :231                                                |
| Awaited explicit build                                   | YES for inspected contract   | Namespace awaits and returns summary; no governor admission by default |

## Verification performed

All commands ran from the requested worktree. PowerShell `Select-Object -Last` supplied the requested tail behavior. Each long-running command was launched once; running commands received one completion read.

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: PASS, all six targets, 56.2 seconds.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: PASS, `TOTAL 300 unsuppressed site(s)`, 7.9 seconds.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: PASS, target plus its one dependency, 5.6 seconds.
- Scoped `ptah_get_diagnostics` on PD and DG: typescript-compiler, 0 errors and 0 warnings.
- Read both primary production files in full, the dependency namespace, relevant regression specs and fixture wiring, r1/r2 reviews, executor revision report, context and Batch 9b requirements. Read adjacent code-index background lifecycle and governor contract. No task-description.md, implementation-plan.md or code-style-review.md was present in the task folder. Neither direct nor native search found AGENTS.md/CLAUDE.md in this worktree; `.github/copilot-instructions.md` was read. Its issue quota does not override the review contract's prohibition on invented findings.
- Native read tools were used because no direct ptah file-read tool was listed. `ptah_search_files` returned zero instruction files; native discovery was used as fallback.
- Probe scripts exist only in OS temp: `C:/Users/abdal/AppData/Local/Temp/ptah-559-r3-probe.cjs` and `C:/Users/abdal/AppData/Local/Temp/ptah-559-r3-edge-probe.cjs`. They transpile the actual source and inject parser/filesystem/discovery dependencies; they are focused helper/service probes, not complete MCP transport or real filesystem performance measurements. The full scoped specs exercise the dispatcher wiring.
- No source edits, git operations or added repository test files. The complete uncommitted-vs-HEAD comparison and independent frozen-prompt comparison could not be performed under the governing no-git rule. This limitation is not represented as a code defect or a passed check.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the reproduced completion defect and r2 corrections; MEDIUM for whole-batch change isolation because HEAD comparison was prohibited.
- Top risk: successful empty builds can leave every sequential retry reporting building indefinitely.
- What a robust implementation would add: a generation-bound handoff of completed empty outcomes, plus a slow-empty multi-call regression preserving the existing pending-refresh and supersession guarantees.
