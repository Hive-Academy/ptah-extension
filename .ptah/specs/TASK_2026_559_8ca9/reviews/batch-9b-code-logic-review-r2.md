# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Requested verdict   | REVISE         |
| Blocking issues     | 1              |
| Serious issues      | 0              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

Independent Batch 9b round r2 review, 2026-09-26. Scoped test/lint/typecheck, degradation audit and Electron dependency validation pass. Actual-code probes reproduce a complete-looking empty answer during refresh, an obsolete failure delivered to a waiting caller, and an edge-linking response-bound violation.

The generation fence and per-file yields resolve the principal r1 discovery-publication and chunk-starvation mechanisms. This places the implementation above the 3–4 band. Returning an authoritative empty answer while the replacement is unresolved prevents a 7–8 assessment. The two moderate findings require an overlapping failure or unusually large import list; they are not ordinary-path outages.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. `CE/` means `libs/backend/vscode-lm-tools/src/lib/code-execution/`; `DG` means `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`. Findings apply to the Batch 9b implementation and r1 corrections, not the older general graph-freshness limitations.

## r1 findings status

| Finding                                 | Status  | Evidence and limits                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — discovery outside generation fence | FIXED   | CE/mcp-core/protocol-dispatcher.ts:2537 reserves before discovery; :2595 checks after discovery; DG:213 and :231 fence publication. Eviction removes the same generation at DG:642. Discovery-held regressions are at dispatcher.spec.ts:4906 and :4932.                                                                              |
| F2 — permanent empty graph              | PARTIAL | CE/mcp-core/protocol-dispatcher.ts:2505 and :2546 enable rediscovery; fast empty-to-source regression at dispatcher.spec.ts:4985. Permanent caching is fixed, but pending rediscovery and an explicit replacement can still answer the old empty snapshot without a retry indication: R2-B1.                                          |
| F3 — synchronous work defeats timer     | PARTIAL | CE/mcp-core/protocol-dispatcher.ts:2542 starts on a macrotask; DG:306 yields before each file. CPU regression at dispatcher.spec.ts:4685. The accepted single-file synchronous-parse residual is recorded below without counting it as a defect. The separate new edge-slicing implementation still lacks an intra-file yield: R2-M1. |
| F4 — unopened worktree refusal          | FIXED   | CE/mcp-core/protocol-dispatcher.ts:2415 uses caller-aware getInfo; core-namespace.builders.ts:114 delegates with the per-call root; worktree regression at dispatcher.spec.ts:4542. No host-folder equality gate remains in readiness.                                                                                                |
| F5 — eviction retains obsolete latch    | PARTIAL | CE/mcp-core/protocol-dispatcher.ts:2441 drops a generation-mismatched job, allowing replacement despite pending old I/O; regression at dispatcher.spec.ts:4964. The latch-replacement failure mechanism is fixed. A caller already awaiting the old job still receives its obsolete error: R2-M2.                                     |

Fixed r1 mechanisms are not counted again. R2-B1 and R2-M2 concern uncovered paths in their corrections; R2-M1 concerns the newly introduced edge-slicing implementation.

## Five logic questions

### 1. How does this fail silently?

After an empty graph has been cached, a refresh with pending discovery returns `ready` because undiscovered file count is treated as zero (CE/mcp-core/protocol-dispatcher.ts:2465). A current explicit build also returns `ready` solely because an old empty snapshot exists (:2451). The three ready branches then return ordinary graph data (:1963, :1997, :2156). Coverage 0/0 adds no incomplete marker (:2681). An agent sees no symbols/dependents instead of a build-in-progress indication. R2-B1.

### 2. What user action produces unexpected behaviour?

Create the first source file after an empty result, then query while rediscovery takes longer than 1.5 seconds: the answer still looks completely empty (R2-B1). Start an explicit replacement while an earlier tool call is waiting, then let the old discovery reject: that waiting call reports failure even though the replacement is built (CE/mcp-core/protocol-dispatcher.ts:2456; R2-M2).

### 3. What input data produces a wrong answer?

An empty-to-nonempty workspace transition produces the stale empty answer above. An unusually large import list concentrated in one file causes a late answer, rather than wrong graph values: DG:384 only tests its time slice before each node, not within the import loop at :390. R2-M1. No new wrong edge-resolution algorithm was established.

### 4. What happens when a dependency fails?

Current discovery/build rejection is caught, produces a fixed failed status and releases the job (CE/mcp-core/protocol-dispatcher.ts:2549, :2565, :2660). The catch also marks an obsolete job failed, and the waiting continuation does not recheck generation (:2456), giving R2-M2. Later-call generation filtering works (:2436).

Governor AbortError propagates and the running generation is removed in finally (DG:712, :247); other whenClear rejection warns once and proceeds (DG:713). Existing per-file failures are skipped at DG:339 and :358; that older policy is not counted as a new defect. No unhandled rejection was observed in the probes. The ordinary catch/finally chain is handled, and log observer exceptions are contained by CE/mcp-core/protocol-dispatcher.ts:3064.

### 5. What is missing that the requirements never mentioned?

The state model needs to distinguish “last confirmed empty” from “refresh in progress”; neither unknown discovery nor a running explicit replacement proves current emptiness (CE/mcp-core/protocol-dispatcher.ts:2451, :2466). Generation validation must apply to a waiting response as well as publication (:2456). A time slice must be checked inside the work unit whose input size is unbounded (DG:390).

Empty rediscovery deliberately scans on every sequential call (CE/mcp-core/protocol-dispatcher.ts:2453, :2587). It shares concurrent calls, but has no cooldown or source-change invalidation. This restores the former retry policy and is a declared deviation; it is recorded as a scaling limitation, not another defect.

## Failure modes

### R2-B1 — Pending empty-graph replacement is returned as an authoritative empty answer (Blocking)

- Trigger: build a zero-file graph; create a first source file; start another query whose discovery remains pending beyond the bounded wait. Alternatively, start an explicit build for the new source while the old empty graph exists, then query.
- Symptom: `ready` routes to ordinary zero-count data without `building`, `retryAfterMs`, or stale/incomplete disclosure.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:2451 explicitly returns ready during someone else's running build; :2466 treats missing discovery count as zero; :2467 accepts the cached graph. Ready output branches are :1973 and :2160; 0/0 coverage adds no marker at :2681.
- Current handling: the background refresh continues, so eventual success can repair later calls, but the caller is not told to wait or retry. This is not the fixed permanent-cache defect.
- Reproduction: the actual readiness helpers and actual graph service first published 0/0. A second discovery was held unresolved: readiness was `{"state":"ready"}` after 1,508 ms with 0/0 coverage. Releasing discovery with `new.ts` then produced that file in the symbol index. A separate probe started a gated explicit build after empty publication: readiness was `ready` while service state was `{"generation":2,"building":true}`.
- Recommendation: return building whenever an empty graph's refresh/replacement is pending, including discovery with unknown file count. Return empty normally only after current discovery/build confirms it. Add both delayed-discovery and gated-explicit-build regressions.

### R2-M1 — Edge time slicing does not bound work within one file (Moderate)

- Trigger: a file supplies a very large import list whose resolution takes longer than the response budget.
- Symptom: the tool's 1.5-second timer cannot run until that entire file's imports have been linked; the call exceeds two seconds.
- Evidence: DG:383–:390 checks the elapsed slice only at the outer node loop; :391–:409 performs all import resolution and logging without a yield. The waiting timer is CE/mcp-core/protocol-dispatcher.ts:2625.
- Current handling: per-file parsing yields correctly, and edge linking yields between nodes. A single import-heavy node still blocks the host. This is separate from the explicitly accepted uninterruptible parser residual.
- Reproduction: actual service and readiness helpers, instant injected parser and file read, no-op logger, one node containing 800,000 relative imports with 20 directory segments. The call returned ready after 3,722 ms. No artificial per-import sleep or busy loop was injected; production path resolution performed the work.
- Recommendation: check elapsed time and yield inside the import loop, retaining iterator state; check generation there as well so superseded linking can stop. Add a clock-controlled edge-slicing regression and a heartbeat check.
- Severity rationale: the mechanism violates the hard bound, but the demonstrated input is unusually large and is not evidence that ordinary workspace files fail. Moderate under the unlikely-edge-case definition.

### R2-M2 — A waiting caller reports an obsolete job's failure (Moderate)

- Trigger: a tool call waits on background discovery; a newer explicit build publishes successfully; the earlier discovery rejects before the original caller's wait expires.
- Symptom: the original caller receives failed even though the current workspace graph is built successfully.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:2554 unconditionally sets `job.failed`; :2456 reads it after awaiting without checking the current generation. The generation check at :2436 only protects callers that arrive after a failure was recorded.
- Current handling: late outcomes cannot delete a replacement latch, and later callers can use the new graph. The original caller's failure is still misleading.
- Reproduction: actual readiness helpers and graph service; held discovery, completed a newer explicit one-file graph, rejected held discovery. Result: readiness `{"state":"failed"}`, service `isBuilt === true`, coverage 1/1.
- Recommendation: revalidate the job generation after the wait before interpreting failure or progress. Obsolete outcomes should select the current ready/building state, without starting a second full wait. Guard catch outcome recording by generation as well as latch identity. Add a regression keeping the original caller pending during replacement.
- Severity rationale: a narrow overlap produces a visible, retryable false error; no replacement graph corruption was observed. Existing tests at dispatcher.spec.ts:4642 and :4670 test later callers after the original wait, so they miss this path.

## Blocking issues

### Stale empty results during refresh

- File: CE/mcp-core/protocol-dispatcher.ts:2451, :2466.
- Scenario: R2-B1.
- Impact: agents may infer a file has no dependents or no exports while the current graph is unknown.
- Fix: keep the building status until the current empty-graph refresh/replacement confirms its result.

## Serious issues

None established in the reviewed scope.

## Moderate and minor issues

- R2-M1: incomplete intra-file edge slicing, DG:390.
- R2-M2: obsolete error reaches the waiting caller, CE/mcp-core/protocol-dispatcher.ts:2456.
- No separate minor findings. The accepted single-file synchronous-parser overrun remains a declared follow-up (DG:333); it is excluded from counts.

## Data flow

1. Validate tool arguments — OK for the reviewed graph entry paths (CE/mcp-core/protocol-dispatcher.ts:1960, :1994, :2152).
2. Resolve caller-aware root — worktree refusal removed (:2415); resolve/read namespace contract remains caller-aware (core-namespace.builders.ts:114, :156).
3. Inspect cache and generation — nonempty cache fast path and obsolete-latch replacement work (:2425, :2441); empty snapshot readiness has R2-B1.
4. Reserve generation before detached discovery — OK (:2537, :2542, :2595).
5. Discover, cap to 5,000 and pass uncapped coverage — OK (:2587, :2599, :2605).
6. Governor admission and per-file yield — OK for bounded per-file CPU cost (DG:305); accepted single-file parse residual at :333.
7. Link edges — R2-M1 (DG:390).
8. Publish only current generation and clear running state — OK (DG:231, :238, :247).
9. Record detached outcome and clear latch — normal settlement works (CE/mcp-core/protocol-dispatcher.ts:2549, :2565); waiting response lacks generation recheck, R2-M2.
10. Format status or existing page/cap result — bounded status fields remain first (:2648, :2662); ready routes bypass them in R2-B1.

## Requirements fulfilment

| Requirement                                                   | Status                                 | Gap                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1 discovery fence                                            | COMPLETE                               | Reservation covers discovery and publication; F1 regressions inspected                                            |
| Empty-to-first-source freshness                               | PARTIAL                                | Eventually refreshes; pending refresh returns unqualified old empty data, R2-B1                                   |
| Cold build response within two seconds                        | PARTIAL                                | Per-file yields fix the demonstrated chunk stall; R2-M1 and accepted single-file parse residual                   |
| One background build per workspace for concurrent calls       | COMPLETE within one PtahAPI/root       | Synchronous latch registration at dispatcher:2569; concurrent regression :4460                                    |
| Building status first, valid JSON and within budget           | COMPLETE for status branch             | Fixed fields at dispatcher:2648; status regression :4407. R2-B1 bypasses this branch                              |
| Honest failure, retry and no unhandled detached rejection     | PARTIAL                                | Current failure handled; obsolete waiting failure R2-M2                                                           |
| Eviction clears stale latch and prevents obsolete publication | COMPLETE for tested transitions        | dispatcher:2441; DG:642; real stuck-read regression dispatcher.spec.ts:4964                                       |
| Explicit rebuild interoperation                               | PARTIAL                                | Awaited summary preserved at analysis-namespace.builders.ts:443, :467; empty snapshot response during it is R2-B1 |
| Governor integration                                          | COMPLETE for inspected admission paths | DG:305, :704; scoped governor specs pass                                                                          |
| Caller worktrees supported                                    | COMPLETE for restored routing          | dispatcher:2415; worktree regression :4542                                                                        |
| Batch 9 paging and cap disclosure preserved when ready        | COMPLETE in inspected paths            | dispatcher:1983, :2016, :2166, :2743; project specs pass                                                          |
| Nothing moved into tools/list; shared constants unchanged     | COMPLETE by initial diff inspection    | Dispatcher diff adds readiness only to graph calls/helpers; initial full diff stat lists no shared-prompt file    |
| New failure logs fixed text                                   | COMPLETE in inspected paths            | dispatcher:2559; DG:716. Older parse/edge debug logs retain path/error text and are not new findings              |
| Degradation baseline and Electron validation                  | COMPLETE                               | Commands below passed; TOTAL 300                                                                                  |

Implicit requirements still needing explicit treatment: empty-refresh freshness semantics, ownership of responses after a generation change, and an actual bound on a single node's edge work.

## Edge cases

| Case                                              | Handled                 | How                                                        | Concern                                                           |
| ------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Concurrent cold calls                             | YES                     | Shared synchronous job; spec dispatcher:4460               | Scope is same API/root                                            |
| Root spelling changes in slash/trailing slash     | YES                     | graphRootKey at dispatcher:2491 matches DG:722; spec :4624 | Case/symlink canonicalization is older behavior, not claimed here |
| Eviction during discovery                         | YES                     | Generation check before service call                       | Spec :4906                                                        |
| Explicit replacement during discovery             | YES for publication     | Newer generation wins                                      | Waiting failure is R2-M2                                          |
| Eviction with permanently pending old read        | YES for recovery        | Next caller drops old job                                  | Old underlying I/O itself is not cancelled                        |
| Empty remains empty                               | YES for eventual answer | Rediscovery and empty publication                          | Repeated sequential calls rescan without cooldown                 |
| First source added, fast discovery                | YES                     | Regression :4985                                           | Delayed discovery is R2-B1                                        |
| Empty snapshot plus running explicit build        | NO                      | Returns ready immediately                                  | R2-B1                                                             |
| Many moderately expensive parses                  | YES within tested cost  | Per-file macrotask; spec :4685                             | Single uninterruptible parse remains accepted follow-up           |
| One unusually import-heavy file                   | NO                      | Outer-node slicing only                                    | R2-M1                                                             |
| Failed old discovery after successful replacement | NO for original waiter  | Unconditional job.failed                                   | R2-M2                                                             |
| Ordinary discovery/build failure                  | YES                     | Failed envelope then retry                                 | Specs :4487, :4512, :4530                                         |
| Governor disposed or wait rejects                 | YES for inspected path  | Abort propagates; other wait failure warns once            | Service finally removes running entry                             |

## Verification performed

Commands executed from the requested worktree; output tailed with PowerShell `Select-Object -Last`:

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: PASS. Tail: “Successfully ran targets test, lint, typecheck for 2 projects”; all six targets passed; duration 1m 20s.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: PASS. Tail: “degradation-audit: TOTAL 300 unsuppressed site(s)” and successful lint target.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: PASS. Tail: “Successfully ran target validate-deps for project ptah-electron and 1 task it depends on.”
- Scoped `ptah_get_diagnostics` for the dispatcher and graph service: unavailable after the provider's 45-second deadline. No diagnostic success claimed; the independent scoped Nx typechecks passed.
- `node C:/Users/abdal/AppData/Local/Temp/ptah-559-r2-probe.cjs`: PASS as a reproduction script, exit 0. Four outputs reproduced the scenarios documented above, including both R2-B1 variants.

The temporary probe transpiles the entire actual graph service and AST-extracts the actual readiness/job/wait helpers. It stubs DI, parser, reads and logger, and provides a thin namespace adapter to the real service. It does not run a live MCP transport, the real parser, or a production-size corpus. The tool-output consequence is traced through the actual ready/status dispatcher branches. The edge probe uses a deliberately extreme injected import list; its runtime is not a claim about typical Tree-sitter workloads.

Read the context decisions, requested Batch 9b section, r1 review and executor revision report; read the graph service, governor and analysis namespace implementations, graph-service specs and complete new dispatcher regression section; inspected graph call/readiness/status/paging paths, type/help/description changes, root routing and relevant adjacent implementations. Unrelated handlers and unrelated sections of the large shared files were not exhaustively reviewed, and no approval of those files is implied. No task-description.md, implementation-plan.md, applicable AGENTS.md/CLAUDE.md, or task-specific style review was discovered. No direct Ptah file-read tool was listed, so native reads were used.

Initial read-only diff stat and targeted dispatcher/service diffs were obtained. No source changes or git mutations were made. Only the canonical review deliverable in the worktree and the temporary probe outside it were written.

Additional uncertainty, not counted as a newly introduced defect: readiness awaits workspace.getInfo before arming its graph timer (dispatcher:2415). That pre-existing workspace-info path may compute project/framework data (workspace-analyzer.service.ts:401). The probes supply a resolved root and do not establish a total end-to-end bound for slow workspace-info providers.

Deliverable-path limitation: the reviewer role's higher-priority output contract requires `.ptah/specs/TASK_2026_559_8ca9/code-logic-review.md` and forbids writing an alternate review name. Therefore the requested `reviews/batch-9b-code-logic-review-r2.md` was not written; this canonical document contains the r2 review.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the reproduced state transitions and edge-yield mechanism; MEDIUM for typical-workspace performance because the edge probe is deliberately extreme.
- Top risk: the tools silently report an empty graph while the refresh or explicit replacement that could invalidate that answer is still pending.
- What a robust implementation would add: building status throughout empty refresh/replacement; generation revalidation before a waiting response consumes job outcomes; intra-file edge yields and cancellation checks; regressions covering those three paths.
