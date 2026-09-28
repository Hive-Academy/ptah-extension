# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Requested verdict   | REVISE         |
| Blocking issues     | 2              |
| Serious issues      | 3              |
| Moderate issues     | 0              |
| Failure modes found | 5              |

Independent Batch 9b review, 2026-09-26. The requested test/lint/typecheck, degradation audit and Electron dependency checks pass. Controlled actual-code probes nevertheless reproduce lifecycle races, a response-bound violation, permanent negative caching, and the requested worktree regression.

The score reflects significant problems in the central guarantees, rather than missing cosmetic improvements. The bounded status, failure observation and service-level generation check work in their tested cases, placing this above the foundational 1–2 band. The uncovered discovery phase and event-loop blocking prevent a 5–6 assessment.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. `CE/` means `libs/backend/vscode-lm-tools/src/lib/code-execution/`; `DG` means `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`. Findings concern Batch 9b; earlier paging defects are not recounted as new findings.

## Five logic questions

### 1. How does this fail silently?

A background request still discovering files can overwrite a graph explicitly rebuilt after that request began: generation ownership starts only inside the service, after discovery (CE/mcp-core/protocol-dispatcher.ts:2503, :2514; DG:176). The result looks ready and gives the older request's graph. F1.

An initially empty workspace now stays successfully empty after source files appear: an empty graph is published, and subsequent calls bypass discovery indefinitely (CE/mcp-core/protocol-dispatcher.ts:2404, :2514; DG:291). F2.

### 2. What user action produces unexpected behaviour?

Calling a cold tool during expensive parsing can take over two seconds despite the timer (DG:239; CE/mcp-core/protocol-dispatcher.ts:2533). F3. Calling from an unopened worktree returns unavailable (CE/mcp-core/protocol-dispatcher.ts:2443, :2583). F4. Evicting and reopening a root while its old read remains pending does not release the dispatcher latch (CE/mcp-core/protocol-dispatcher.ts:2412, :2485; DG:508). F5.

### 3. What input data produces a wrong answer?

A workspace that changes from zero matching files to one exported source file remains a complete-looking zero-file graph (F2). A delayed discovery list published after an explicit replacement can replace the requested graph contents (F1). Neither scenario requires malformed input.

### 4. What happens when a dependency fails?

Discovery rejection and a rejected/error-envelope build are observed by the detached chain, recorded as failed, and cleared for retry (CE/mcp-core/protocol-dispatcher.ts:2469, :2485, :2520). Existing scoped specs cover waiting callers and failure between calls (CE/mcp-core/protocol-dispatcher.spec.ts:4441, :4471, :4485). The normal catch/finally path introduces no unhandled rejection found in this review.

An indefinitely pending read remains attached even after eviction (F5). A busy real governor does allow progress through its one-second ceiling, but synchronous parsing delays both the response timer and other host work (F3). Governor AbortError propagates; other wait errors warn once and proceed (DG:577). Existing per-file read/analysis failures still get skipped inside the service (DG:209, :230); this pre-existing limitation means the new failed status is not a guarantee that every file failure becomes a failed build. It is not counted as a new reproduced Batch 9b defect.

### 5. What is missing that the requirements never mentioned?

Empty-result freshness needs an explicit invalidation/retry policy (F2). The batch's host-owned-root sentence incorrectly imports a write-destination rule into read capability selection (F4). A generation must cover discovery as well as parsing, and invalidation must reach both the service and dispatcher job (F1/F5). A timer deadline requires host-thread scheduling that lets its timer run (F3).

## Failure modes

### F1 — Discovery is outside the generation fence (Blocking)

- Trigger: start a background graph request; hold its discovery promise; evict the root or finish a newer explicit graph build; then let discovery finish.
- Symptom: the evicted root is published again, or the older background request replaces the newer explicit graph without any stale-result indication.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:2503 awaits discovery before :2514 calls the service; DG:176 allocates its generation only then. The check at DG:284 therefore accepts this old request as the newest generation. Electron uses retainOnly on folder changes at apps/ptah-electron/src/activation/wire-runtime.ts:425.
- Current handling: fences only overlapping service buildGraph calls, not the complete background operation. Existing integration specs gate file reads after the service has acquired its generation (CE/mcp-core/protocol-dispatcher.spec.ts:4564, :4630, :4650).
- Reproduction: in-memory TypeScript transpilation of the actual dispatcher functions and entire graph service, with deferred discovery and deterministic file/parser dependencies. Evict during discovery, then release: readiness ready, isBuilt true, coverage 2/2. In a separate run, finish an explicit one-file graph during discovery, then release the original two-file list: final coverage 2/2, replacing the explicit 1/1 graph. No source edits or filesystem mutations were needed.
- Recommendation: acquire a root generation/job token before discovery; carry and validate it through publication. Explicit builds and evictions must invalidate that same token. Add tests that pause discovery, rather than only file reads.

### F2 — Empty graph caching permanently hides subsequently added source (Blocking)

- Trigger: first call while the open workspace has no matching sources; create a source file; call again.
- Symptom: ready with an empty symbol/dependency result and no incomplete/stale indicator; discovery never runs again.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:2495 explicitly introduces empty graph caching; :2514 builds even for zero files; DG:291 publishes it; CE/mcp-core/protocol-dispatcher.ts:2404 returns ready solely on cache presence. DG:463 checks presence, not freshness. DG:419 only removes existing nodes and does not refresh an empty graph.
- Current handling: zero-file coverage is 0/0, so graphCompleteness also reports no incompleteness (CE/mcp-core/protocol-dispatcher.ts:2601). No source-addition invalidation of this graph was found in apps or backend libraries; the production retainOnly hook handles workspace folders, not source creation.
- Reproduction: actual dispatcher ensure/build functions and actual service; discovery first returns [], then the fixture is changed to ['new.ts'], whose parser would export NewExport. Second ensure returns ready; discovery count remains 1; coverage remains 0/0; symbol index remains []. The user-visible read uses this same cached index (CE/mcp-core/protocol-dispatcher.ts:2160; CE/namespace-builders/analysis-namespace.builders.ts:383).
- Recommendation: retain the former retry behaviour for empty results, or give the negative cache bounded expiry/source-change invalidation. Test empty → first source creation → successful symbol/dependency query. Caching a genuinely empty snapshot is valid; treating that snapshot as permanent is the regression. General freshness of non-empty graphs predates this batch and is not a separate finding here.

### F3 — Governor admission does not bound host-thread parsing (Serious)

- Trigger: a chunk contains sufficiently expensive synchronous AST work, under either clear or busy governor state.
- Symptom: cold response exceeds two seconds and the host event loop stalls for seconds.
- Evidence: DG:239 awaits admission once per 20 files, then :244 starts their parsing. DG:571 returns immediately when clear; this is a resolved promise, not an event-loop yield. The production parser synchronously parses and matches queries at libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:611 and :624. Edge construction is also synchronous and ungoverned at DG:247. The response bound is a same-thread setTimeout at CE/mcp-core/protocol-dispatcher.ts:2536.
- Current handling: the real governor's busy ceiling yields before a chunk and permits eventual progress; it cannot interrupt that chunk. Clear admission supplies no deliberate macrotask yield. Asynchronous filesystem reads provide incidental yields, not a CPU-time bound.
- Reproduction: actual graph service, actual BackgroundWorkGovernor and extracted actual ensure/start/build/wait dispatcher functions. Forty virtual .ts paths, real fs.promises.readFile of tsconfig.base.json for each read, and an injected deterministic 130 ms synchronous parser per file. Clear governor: readiness building after 2,175 ms; maximum observed 10 ms heartbeat gap 2,232 ms. Busy governor: building after 3,358 ms; maximum gap 2,348 ms; all 40 files eventually parsed. With fulfilled in-memory reads, clear governor returned ready only after 5,220 ms, heartbeat gap 5,221 ms. These are controlled scheduling probes, not a new production Tree-sitter benchmark or a repeat of the executor's 225-second measurement.
- Recommendation: move uninterruptible parser work off the host thread, or introduce genuinely bounded work slices and macrotask yields, including edge construction. Merely adding setImmediate between 20-file chunks still permits a single slow chunk/file to exceed the response deadline. Test with CPU-consuming dependencies and an independent heartbeat, not only a never-resolving promise (CE/mcp-core/protocol-dispatcher.spec.ts:4514).

### F4 — Read graph tools reject legitimate unopened worktrees (Serious)

- Trigger: an agent declares its git-worktree root while the host has opened only the parent repository.
- Symptom: all three tools return isError with status unavailable and perform no discovery, even if an explicit build has already cached that root.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:2443 requires equality with host-opened folders before checking isBuilt at :2404; :2583 returns unavailable. The behaviour is pinned for each tool at CE/mcp-core/protocol-dispatcher.spec.ts:4494.
- Current handling: copies the spool-root eligibility rule into graph-read selection.
- Reproduction: execute the actual extracted root resolver, ensure function and response builder with distinct declared worktree and host roots: state not-host-root and isError unavailable; no graph build. The passing project suite also exercises this refusal for all three tools.
- Recommendation: restore the established caller/session root for graph reads and keep spool writes separately restricted. See the separate item (3) judgment below.

### F5 — Eviction does not clear the dispatcher latch (Serious)

- Trigger: an in-flight file read remains pending; evict the root; call again for that root.
- Symptom: the new call joins the obsolete job and returns building; it cannot start a replacement until the obsolete dependency settles, possibly never.
- Evidence: DG:508 only removes service state. The separate WeakMap at CE/mcp-core/protocol-dispatcher.ts:2366 is not notified. Calls reuse the job at :2412; only settlement removes it at :2485.
- Current handling: generation checks prevent publication after a service-phase eviction, but do not cancel/detach the obsolete work. The existing eviction spec releases the old read before making the next call (CE/mcp-core/protocol-dispatcher.spec.ts:4637), hiding this gap.
- Reproduction: actual service with a deferred read and actual dispatcher latch. First call building; evict; second call building; discoveries stays 1 and latchStillSet is true. The probe releases the read afterward to clean up. A never-settling read keeps this state indefinitely by the same mechanism.
- Recommendation: share invalidation ownership or expose an eviction/rebuild signal to the job coordinator; remove obsolete jobs immediately, abort where supported, and prevent their later completion/failure from mutating the replacement job's state.

## Blocking issues

### B1 — Older discovery can silently replace newer state

- File: CE/mcp-core/protocol-dispatcher.ts:2503; DG:176.
- Scenario: explicit rebuild or eviction during pending discovery (F1).
- Impact: later authoritative graph state is silently overwritten or a closed workspace reappears.
- Fix: lifecycle token spanning discovery through publication, invalidated by rebuild and eviction.

### B2 — Permanent empty negative cache

- File: CE/mcp-core/protocol-dispatcher.ts:2514, :2404.
- Scenario: source files appear after the first zero-file build (F2).
- Impact: graph tools confidently report absence indefinitely, losing information they previously rediscovered.
- Fix: empty-cache retry/expiry or source-addition invalidation with regression coverage.

## Serious issues

### S1 — Same-thread work breaks the response bound

- File: DG:244; CE/mcp-core/protocol-dispatcher.ts:2536.
- Scenario: CPU-heavy file parsing (F3).
- Impact: delayed MCP response and frozen extension/Electron host work.
- Fix: isolate or bound CPU work; verify wall-clock response and heartbeat under load.

### S2 — Worktree read capability removed

- File: CE/mcp-core/protocol-dispatcher.ts:2443.
- Scenario: valid declared root is not an opened host folder (F4).
- Impact: ordinary worktree agents lose all three graph tools.
- Fix: caller-root read routing independent from write-destination validation.

### S3 — Obsolete job remains latched after eviction

- File: CE/mcp-core/protocol-dispatcher.ts:2412, :2485; DG:508.
- Scenario: old I/O has not settled when the workspace is evicted/reopened (F5).
- Impact: no replacement build or recovery while that old I/O is stuck.
- Fix: coordinate job invalidation and graph invalidation.

## Moderate and minor issues

No additional defect is counted. Symbol-index help names building but omits the failed/retry detail included in the other two descriptions (CE/mcp-core/tool-description.builder.ts:1863); its failed response supplies the instruction, so this is optional help consistency rather than another runtime finding.

## Separate judgment of item (3): caller-declared worktree roots

**REVISE the restriction.** It follows the literal Batch 9b host-owned-root sentence, but that sentence conflicts with the task's overriding no-quality-loss intent for this read path. This is a plan-level regression implemented faithfully, not an executor secretly ignoring the plan.

The response is honest about refusal; it is not a silent successful empty array. Nevertheless, returning unavailable does not preserve the lost capability. Batch 2f's write-destination issue does not justify denying reads: resolveSpoolRoot already independently chooses host-owned write locations (CE/mcp-core/protocol-dispatcher.ts:2859). A worktree graph can be read while any oversized output is spooled under a trusted host/temp location.

Other read paths preserve declared-root precedence: workspace-root-resolver.ts:50 returns the declaration; ptah-api-builder.service.ts:959 supplies that resolver; core-namespace.builders.ts:99 uses it for workspace analysis and :149 for file discovery. The LSP namespace validates file/position and delegates without this opened-folder equality check (namespace-builders/ide-namespace.builder.ts:225, :235); its actual language-server/index capabilities remain runtime-dependent, so this review does not promise full unopened-project LSP support. It does establish that this new graph-only blanket refusal is not a uniform read-boundary policy.

Recommendation: use the same caller-aware read root, normalize it consistently for discovery, graph keys and relative queries, and retain the separate spool-write rule. If a stronger read policy is required later, define it explicitly and include host-created/session worktrees; do not infer it from spooling. Keep an unopened-worktree success regression for all three tools.

## Data flow

1. Validate file/query arguments, then enter graph readiness: OK for reviewed valid inputs (CE/mcp-core/protocol-dispatcher.ts:1960, :2152).
2. Resolve root: F4; rejection precedes even warm-cache reuse (:2394).
3. Cache check: fast for a valid warm snapshot; F2 for empty snapshots (:2404).
4. Share detached job synchronously before it starts: OK for concurrent calls against the same PtahAPI/root (:2463, :2488); F5 on invalidation.
5. Discover, cap and resolve paths: existing cap disclosure preserved, but F1 leaves this phase outside the generation fence (:2503–:2518).
6. Admit chunks and parse: busy governor permits progress; F3 prevents a hard response/host-latency bound (DG:239).
7. Publish: generation check works for overlap after service entry, but not F1; empty publication introduces F2 (DG:284, :291).
8. Observe outcome, release completed latch, return bounded status or real data: OK for ordinary settlement; pending obsolete jobs remain F5 (CE/mcp-core/protocol-dispatcher.ts:2469, :2485, :2555).

## Requirements fulfilment

| Requirement                                                  | Status                                      | Gap                                                                                |
| ------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cold response at most 2 s with building/retry                | PARTIAL                                     | Timer works for pending promises; CPU probe violates wall-clock bound, F3          |
| Later calls return real graph; warm reads immediately        | PARTIAL                                     | Works for settled valid snapshots; F2/F4/F5 exceptions                             |
| Concurrent calls start one build per workspace               | COMPLETE within one PtahAPI                 | Synchronous per-root job installation; scoped concurrency specs pass               |
| Clear latch on success/failure/eviction/rebuild              | PARTIAL                                     | Settlement clears; invalidation is disconnected, F5                                |
| Outdated build never overwrites newer graph                  | PARTIAL                                     | Service-phase guard works; discovery excluded, F1                                  |
| Honest build failure once then retry; no unhandled rejection | COMPLETE for rejected/error-envelope builds | Existing per-file skipping remains an older limitation                             |
| Governor per chunk; progress while busy                      | PARTIAL                                     | Real busy probe completes; no CPU isolation, F3                                    |
| Preserve quality for worktree reads                          | MISSING                                     | F4; literal batch restriction needs correction                                     |
| Explicit execute_code build remains awaited                  | COMPLETE                                    | Acceptable compatibility decision; see below                                       |
| Status first, valid JSON, within budget                      | COMPLETE for normal status production       | Fixed-size envelopes at dispatcher :2559/:2573/:2582; scoped tests pass            |
| Truthful descriptions and fixed new log messages             | PARTIAL                                     | Building/retry text is present; advertised availability/bound affected by findings |
| Degradation baseline / Electron dependency validation        | COMPLETE                                    | Both requested checks pass                                                         |
| Empty workspace caches empty graph safely                    | PARTIAL                                     | Static empty result works; subsequent additions remain invisible, F2               |

Keeping execute_code's explicitly requested build awaited is acceptable: the existing summary return contract is preserved (CE/types.ts:794; CE/namespace-builders/analysis-namespace.builders.ts:443), and it does not use the direct-tool auto-build path. Skipping foreground admission for this awaited operation avoids delaying it behind its own generating turn. This decision does not excuse same-thread CPU starvation; scheduling improvements can preserve the awaited public result. The race with explicit builds is F1, not a reason to change execute_code's return shape.

Implicit requirements not addressed: refresh of negative results; job identity across discovery and invalidation; a deadline independent of synchronous work.

## Edge cases

| Case                                        | Handled | How                                                            | Concern                        |
| ------------------------------------------- | ------- | -------------------------------------------------------------- | ------------------------------ |
| Five simultaneous cold calls, same API/root | YES     | One synchronous latch; passing spec at dispatcher.spec.ts:4413 | No duplicate build found       |
| Small build completes within wait           | YES     | Returns real answer; spec :4400                                | Subject to host scheduling     |
| Failure during/between calls                | YES     | Recorded failed state, then retry; specs :4441/:4471           | Applies to propagated failures |
| Busy governor never clears                  | YES     | Real one-second ceilings allowed all 40 files to finish        | Parsing still stalls host, F3  |
| Governor shutdown/defect                    | YES     | Abort propagates; other wait errors warn once                  | Service specs pass             |
| Eviction after service generation acquired  | PARTIAL | Publication suppressed                                         | Old latch survives, F5         |
| Eviction or newer build during discovery    | NO      | Discovery later acquires fresh generation                      | F1                             |
| Empty workspace stays empty                 | YES     | Cached 0/0 graph                                               | Becomes F2 when files appear   |
| New source after empty build                | NO      | Warm-cache shortcut                                            | F2                             |
| Unopened caller worktree                    | NO      | Explicit unavailable                                           | F4                             |
| CPU-heavy chunk / fulfilled reads           | NO      | Promise waits do not preempt CPU work                          | F3                             |

## Structure and verification

The namespace retains its facade and adds an optional fourth argument; existing execute_code callers remain compatible (CE/types.ts:794; CE/namespace-builders/analysis-namespace.builders.ts:436). Optional governor injection follows the existing admission interface (DG:148). The material structural problem is split lifecycle ownership: dispatcher jobs and service generations cannot invalidate one another (F1/F5). Consolidating that ownership is more useful than a size-only file split. No naming/formatting finding is included.

Verification performed from the requested worktree:

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: PASS, all six targets; Nx duration 1m 54s.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: PASS, TOTAL 300, within baseline.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: PASS, all external imports covered. No scanner failure from message-string import lookalikes.
- `ptah_get_diagnostics`: unavailable after its 45-second internal timeout, including a scoped request. No diagnostic success is claimed; the requested project typechecks passed independently.
- Independent in-memory probes described in F1–F5 executed the actual extracted dispatcher functions and actual transpiled graph service; F3 additionally used the actual governor and real filesystem reads. DI decorators/logger/language map and selected external dependencies were stubbed. These probes were not live MCP transport or real Tree-sitter performance runs. The injected CPU cost is stated explicitly.

Read the requested context, Batch 9/9b and later-batch notes, executor report and earlier F2 review; inspected the complete graph service and analysis namespace, their relevant specs, dispatcher entry/build/status/root/budget paths, descriptions/types, root routing, governor, parser and Electron eviction wiring. Unrelated implementations in the large shared files are outside this verdict. No task-description.md, implementation-plan.md or code-style-review.md was present in the discovered task folder; no applicable AGENTS.md was found. No direct Ptah file-read tool was listed, so native reads were used. No source was edited and no raw .jsonl/.sqlite logs were read.

Git operations were not run because the reviewer role forbids them. Consequently, uncommitted-file enumeration and frozen-constant unchanged claims were not independently diff-verified; those remain executor-report evidence. Only this requested review deliverable was overwritten. Source-history non-mutation claims are not inferred from passing tests.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for reproduced state transitions/root refusal; HIGH for the controlled scheduling failure mechanism, with production parser timing not remeasured.
- Top risk: older or permanently empty graphs can look authoritative while the promised cold-call bound still fails under synchronous parsing.
- What a robust implementation would add: shared lifecycle generation covering discovery; invalidation-aware job cancellation/detachment; empty-cache refresh; restored caller-root read support with independent spool restrictions; CPU-safe scheduling and regressions for all five scenarios.
