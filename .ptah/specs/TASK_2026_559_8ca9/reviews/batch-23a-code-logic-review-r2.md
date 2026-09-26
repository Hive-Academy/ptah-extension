# Code Logic Review � TASK_2026_559_8ca9

## Summary

Batch 23a review r2, after revision round 1. The original single-root invalidation, supplied-paths and node-builtin repros are fixed. The invalidation correction remains incomplete for overlapping cached roots: evicting a nested root can expose stale parent data with clean coverage.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 1 |

The score improves from r1 because its direct repros are fixed, ordinary publication/invalidation is synchronous, and resolver uncertainty has a reason code. It remains below the 7�8 band because a supported multi-root lifecycle still produces a false-clean answer. Severity is Blocking under the review contract's silent misleading-success definition, even though this trigger requires overlapping roots.

Scope: complete current contents of dependency-graph.service.ts, graph-coverage.ts and their two specs; revision report; task context and referenced Batch 23a/9/9b and language-plan requirements carried from r1; targeted consumer checks. No source edits or git operations. No additional task-description.md, code-style-review.md or repository AGENTS.md/CLAUDE.md was available in the r1 discovery.

Abbreviations, relative to this worktree:
- DG: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts
- GC: libs/backend/workspace-intelligence/src/ast/graph-coverage.ts
- DS: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.spec.ts
- PD: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts

## r1 findings status

| Finding | Status | Evidence and result |
| --- | --- | --- |
| B1: invalidateFile leaves clean coverage | PARTIAL | DG:755 replaces coverage and removes the node synchronously; GC:323 moves analyzed to unchecked and sets partial. Original repro now returns clean=false. All relevant running builds record invalidation at DG:742, but only one published graph is updated at DG:747. R2-B1 below covers the remaining case. |
| B2: any paths object certifies completeness | FIXED for the reported cases | DG:583 classifies unresolved imports; GC:305 marks # imports internal; GC:313 treats other bare names as context-dependent regardless of paths presence. {} plus #b now gives unresolvedInternal=1 and clean=false. An unrelated paths map plus a bare name remains partial. |
| M1: known-external-only graphs unnecessarily partial | FIXED; accepted interim semantics | GC:310 treats node: imports as external; DG:591 only context-dependent imports set partial. node:fs-only probe is clean. Bare lodash remains partial, as explicitly accepted until 32b. |

### M1 disclosure decision

Adequate for this batch: GC:250 adds approximations:['resolver-context-partial'] when linking reports partial; GC:280 includes it in the report. The actual lodash + {} probe includes that reason code as well as resolution.context:'partial' and external:1. DG:544 and GC:291 explain that unread paths/baseUrl/package context may turn bare specifiers into workspace imports. This is not merely an unexplained boolean.

Batch 32b should remove this qualifier only after proving the applicable context complete, not by changing the global default. Batch 23b must preserve the reason code in its bounded tool response. These are planned integrations, not additional defects. An invalidated graph uses unchecked/context to revoke clean status (GC:333, GC:342); that operation does not newly add the resolver approximation, which is reasonable because its cause is cache invalidation rather than unresolved bare-package classification.

## Five logic questions

### 1. How does this fail silently?

R2-B1: invalidateFile changes only the longest-prefix published graph (DG:747; DG:989). A cached parent remains clean; after nested-root eviction, the parent can return a stale empty dependency answer (DG:882, DG:995).

### 2. What user action produces unexpected behaviour?

A caller maintains parent and nested workspace graphs, changes a nested file, invalidates it, and closes/evicts the nested workspace. The invalidation's qualification disappears when routing falls back to the untouched parent (DG:751, DG:886). There remains no demonstrated production editor-event caller for invalidateFile; this is a public-service contract defect and should not be represented as an observed UI incident.

### 3. What input data produces a wrong answer?

Both cached roots contain pkg/a.ts and pkg/b.ts. Initially a.ts has no imports; it later gains ./b. After invalidating a.ts and evicting the nested root, getDependents(b.ts) returns [] with analyzed=2, unchecked=0 and context=complete. The new contents have never been analyzed by the parent (DG:747). See the executable probe below.

### 4. What happens when a dependency fails?

Read and analysis failures still increment their respective buckets (DG:434, DG:449, DG:468). Governor AbortError propagates (DG:955); finally removes both running and in-flight invalidation records (DG:344). Dispatcher failure status and latch cleanup remain at PD:2520, PD:2653 and PD:2666. A permanently pending read/parse still has no service timeout and retains its per-build state until settlement (DG:436, DG:451, DG:344); this is residual uncertainty, not a new demonstrated failure mode. Malformed successful analysis results are still outside validation after the await (DG:468, DG:476); no real producer of that malformed shape was established.

### 5. What is missing that the requirements never mentioned?

Invalidation is a cache-wide mutation, whereas query routing chooses one graph. Those sets are different when roots overlap. Every cached graph whose scope includes the changed file must cease claiming completeness, including when the path is new and absent from its nodes (DG:742 versus DG:747). Existing nested-root coverage tests at DS:332 test routing/eviction, but do not combine them with invalidation.

## Failure modes / new defects

### R2-B1 � Invalidation misses cached ancestor graphs, which become clean again after child eviction

- Severity: Blocking.
- File: DG:747; DG:751; DG:989.
- Trigger: build root D:/ws and nested root D:/ws/pkg, both containing pkg/a.ts and pkg/b.ts. Add an import of ./b to a.ts, call invalidateFile(a.ts), then evict D:/ws/pkg (or retain only D:/ws).
- Symptom: before eviction, parent coverage remains clean while child coverage is partial. After eviction, getDependents(b.ts) returns [] with clean coverage from the stale parent. Root-scoped parent queries can already read the stale cache before eviction.
- Evidence: DG:742 correctly records the path in every matching running build, but DG:747 calls findGraphEntryForFile and DG:751 mutates only that one published entry. DG:1003 chooses the longest prefix; DG:995 routes to the remaining sole graph after eviction. DG:839 returns the parent's unchanged coverage.
- Current handling: per-entry updates are atomic, but the parent entry receives no update. This routing limitation existed in the older invalidation implementation; the r1 B1 correction adds honest coverage only to the selected entry and therefore leaves B1 incompletely resolved. It is not a regression in generation fencing.
- Impact: a consumer can trust a complete negative dependency result after an explicit invalidation, potentially missing the file that now imports the target. The new coverage contract is what makes this a Batch 23a acceptance issue.
- Recommendation: in one synchronous operation, invalidate/qualify every published graph whose root contains the path, plus any graph actually containing that node if explicit out-of-root file lists remain supported. Keep query routing separate. Preserve the conservative handling of newly added paths and the existing record-for-all-running-builds behaviour. Ensure each graph's analyzed count moves only when it held the node.
- Required regression: overlapping parent/child graphs, invalidation, assert both reports unclean, then evict child and assert the parent's answer remains qualified. Repeat using retainOnly([parent]); cover a newly added nested file absent from both graphs. A later successful rebuild may legitimately restore clean coverage.
- Probe evidence: actual local service/helper code with mocked file/analysis ports returned parentClean=true, childClean=false; after child eviction returned dependents=[], analyzed=2, unchecked=0, context=complete, clean=true. Probe path: C:/Users/abdal/AppData/Local/Temp/task559-r2-probe.cjs.

## Blocking issues

R2-B1 above: one remaining false-clean lifecycle case, independently reproduced.

## Serious issues

None established.

## Moderate and minor issues

None requiring another numbered finding. The accepted bare-package qualification is not reopened as a defect.

## Atomicity, data flow and lifecycle

1. **OK:** reserveBuild/getBuildState semantics remain at DG:356 and DG:361. Running builds register invalidation tracking before the first await (DG:269).
2. **OK:** GC:159 selects eligible files fairly; DG:397 yields between background parses and checks generation. Read/parse failures are counted rather than confused with successful nodes.
3. **OK:** DG:504 links with timed macrotask yielding; DG:568 caps distinct edges at 250,000 and discloses the stop. GC:298 separates internal, proven external and context-dependent imports.
4. **OK:** DG:301 tests generation before publication. DG:314 publishes graph/report, then DG:333 applies recorded invalidations without an intervening await. For normal event-loop callers, there is no opportunity to observe the just-published graph before those invalidations are applied.
5. **OK per entry:** DG:763 replaces coverage, then DG:769 removes edges/node, synchronously. No reader interleaves between those operations; repeat invalidation does not move the same analyzed count twice (GC:327; DS:957). Previously returned objects do not provide a cross-call transactional guarantee.
6. **GAP across entries:** DG:747 updates only one cached graph. R2-B1 concerns which graphs are mutated, not a timing window inside a single mutation.
7. **OK:** superseded builds return before publication (DG:301). Evict/retainOnly/clear revoke generations and remove published graph/coverage pairs (DG:882, DG:901, DG:921). Temporary probes combined in-flight invalidation with all three eviction forms: no graph/report was published, and inFlightInvalidations was empty after settlement. The no-eviction control published unchecked=1 and clean=false.
8. **OK with integration boundary:** getCoverageReport returns one record's file/language coverage (DG:839). A query and coverage read separated by an await can still straddle rebuilds; the r1 requirement that 23b capture them in the same synchronous turn or use a versioned snapshot remains.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Original B1 single-root behaviour | COMPLETE | DG:755; original r1 probe now unclean |
| Invalidation during a running build | COMPLETE for containing roots | DG:271/742/333; probe verified publication and all three eviction paths |
| Invalidation across overlapping cached roots | PARTIAL | R2-B1 |
| B2 supplied paths does not prove context complete | COMPLETE for the r1 cases | DG:583; GC:298 |
| M1 node-only clean; bare packages qualified with reason | COMPLETE | GC:310/250; runtime probes |
| Atomic generation-guarded publication | COMPLETE | DG:301/314/333/620 |
| Fair eligible-only cap and file-count meanings | COMPLETE in service | GC:159; DG:308; dispatcher still pre-slices at PD:2700 until 23b |
| Edge cap and multi-root accounting | COMPLETE for specified inputs | DG:568; GC:392/431 |
| Batch 9b governor, statuses and empty-result delivery | COMPLETE by reviewed trace and scoped service checks | DG:397/943; PD:2370/2476/2512/2653/2666 |
| Bounded discovery and full resolver context | DEFERRED as agreed | censusLimit is reporting metadata at DG:325; discovery remains 23b, resolver context 32b |

## Edge cases

| Case | Handled | How / remaining concern |
| --- | --- | --- |
| Repeat invalidation | YES | No node => no second analyzed decrement, GC:327 |
| New path under one graph | YES | Partial context even without moving buckets, GC:342 |
| Nested cached roots | NO | R2-B1 |
| Invalidation during cold build | YES | Recorded before publication, DG:742/333; probe passed |
| Invalidation then evict/retainOnly/clear during build | YES | No publish, tracking cleared on settlement; probe passed |
| Superseded generation | YES | DG:301 rejects publication; DS:425 covers graph/report supersession |
| {} plus # import | YES | unresolvedInternal>0; original probe now unclean |
| lodash plus {} | YES | Partial plus resolver-context-partial reason |
| node:fs only | YES | Proven external; original probe now clean |
| Empty graph / slow empty build | YES by trace | R3-S1 unconsumed generation still delivered at PD:2476 |
| Very large sources/import arrays | PARTIAL, unchanged | File/edge counts do not bound bytes or all resolution attempts, DG:481/556; discovery bounds are deferred |

## Verification

- Scoped ptah_get_diagnostics on both production files: typescript-compiler, 0 errors, 0 warnings. Native reads used because no ptah file-read tool is listed.
- Re-ran the original temporary service probe against the corrected code: invalidation clean=false; #b with undefined or {} paths clean=false; node:fs-only clean=true.
- New temporary probe exercised nested-root invalidation/eviction (reproduced R2-B1), in-flight invalidation with evict/retainOnly/clear and without eviction (all lifecycle assertions passed), and the bare-package reason code (passed). It transpiles actual local TypeScript using the installed compiler and mocks only decorators and file/analysis/logger ports. It is not a real-parser or editor integration test.
- Scoped Nx run-many test/lint/typecheck for @ptah-extension/workspace-intelligence with --skip-nx-cache: PASS, exit 0, all three targets; duration 1m 46s. Successful-task details were suppressed by Nx, so no independent exact test count is asserted.
- degradation-audit:lint --skip-nx-cache: PASS, exit 0, TOTAL 300.
- ptah-electron:validate-deps --skip-nx-cache: PASS, exit 0.
- Checks ran once through the installed nx/dist/bin/nx.js with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Logs: C:/Users/abdal/AppData/Local/Temp/task559-review-workspace.log, task559-review-audit.log and task559-review-deps.log. One completion check collected the background runner results.
- The author's 89-spec and 7/13 fails-before counts remain author-reported; no source was reverted to repeat fails-before evidence. HEAD comparison was not performed because this reviewer role prohibits git operations. Batch 9b dispatcher empty-result/failure integration was traced, not independently rerun as a separate vscode-lm-tools test project in r2.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for R2-B1 and the direct fixes; MEDIUM for unexecuted editor/dispatcher integration.
- Top risk: closing a nested workspace exposes an invalidated file's stale ancestor graph with clean coverage.
- What a robust implementation would add: synchronous invalidation of every affected cached graph and overlapping-root invalidation/eviction regressions. Keep the accepted reason-coded bare-package uncertainty until 32b supplies verified resolver context.
