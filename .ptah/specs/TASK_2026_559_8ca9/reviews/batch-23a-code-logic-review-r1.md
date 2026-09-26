# Code Logic Review � TASK_2026_559_8ca9

## Summary

Batch 23a, r1. Reviewed the complete four scoped source/spec files, the executor reports, Batch 23a and Batch 9/9b invariants, the referenced language-plan sections, and the graph consumers. Source was not edited.

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 3 |

The build-time publication fence, fair file selection and edge storage cap are implemented. Two reproducible false-clean cases prevent approval. This is above the 3�4 band because the core build lifecycle is coherent, and below 7�8 because the new honesty contract can certify a graph with missing edges. Severity follows the review contract: a success-looking negative answer that hides missing dependencies is Blocking. The coverage is not yet forwarded by MCP; the immediate defects are in the service contract that Batch 23b will consume.

Path abbreviations: **DG** = libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts; **GC** = libs/backend/workspace-intelligence/src/ast/graph-coverage.ts; **PD** = libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts; **AN** = libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts; **LC** = libs/backend/platform-core/src/interfaces/language-coverage.interface.ts. All paths are relative to this worktree.

## Five logic questions

### 1. How does this fail silently?

Invalidating a file removes edges without qualifying coverage (DG:712, DG:743). A supplied paths object also certifies resolver completeness without knowing package import maps or baseUrl (DG:522). Both yield isCleanAnswer=true with missing dependencies; see defects 1�2.

### 2. What user action produces unexpected behaviour?

A caller invalidates a previously graphed file and queries its former target: getDependents returns [] while coverage still reports both files analyzed (DG:648, DG:712, DG:790). There is currently no production invalidateFile caller found under libs/apps; this is a public-service contract defect, not a claim that ordinary editor edits currently invoke it. An otherwise fully resolved graph with only a node:fs external import is unnecessarily qualified (DG:522), which becomes visible when 23b forwards coverage.

### 3. What input data produces a wrong answer?

A package-local #b import targeting b.ts, with tsconfigPaths={}, produces no edge, external=1, unresolvedInternal=0 and context=complete (DG:1000, DG:577, DG:522). A paths object does not encode package.json imports, exports, workspace package resolution or baseUrl. Disjoint file selection itself is consistent for normalized duplicate paths and mixed supported/unsupported files (GC:163, GC:212).

### 4. What happens when a dependency fails?

Read rejection increments read; analysis rejection or Result.err increments parse (DG:410, DG:425, DG:444). Governor AbortError propagates and the running-generation marker clears in finally (DG:321, DG:894). The dispatcher records failed and clears the job latch (PD:2642, PD:2665). A permanently pending file read/analysis can keep that build pending: foreground MCP waits remain bounded, but the service has no per-file timeout (DG:412, DG:427; PD:2512). This is a pre-existing residual limitation, not a new cap guarantee. Malformed successful analysis results are not validated after the await; the awaited path's allSettled can discard a later exception (DG:357, DG:444�460). No real producer returning that malformed shape was found, so this is uncertainty rather than an additional defect.

### 5. What is missing that the requirements never mentioned?

Coverage needs a lifecycle after publication, not only an atomic initial publish: invalidation must revoke clean status (defect 1). Resolver completeness needs explicit provenance, not merely presence of a paths object (defect 2). The edge cap bounds stored distinct edges, not bytes of source/import arrays or total resolution attempts (DG:457, DG:530, DG:541); censusLimit is disclosure, not a discovery limiter (DG:308; GC:252). These distinctions must remain explicit in 23b/32b integration.

## Failure modes � numbered defects

### 1. Invalidating a node leaves clean coverage describing the old graph � Blocking

- Trigger: build a.ts -> b.ts with complete coverage, then call invalidateFile(a.ts).
- Symptom: getDependents(b.ts) returns [], analyzed remains 2, failed/unchecked/omittedByCap remain 0, and isCleanAnswer returns true.
- Evidence: DG:720 removes forward/reverse edges; DG:743 deletes the node and DG:744 only invalidates the symbol index. DG:790 returns the unchanged report. LC:206 accepts this report as clean. Executor report:88 acknowledges the mismatch.
- Current handling: none. The old file-count behaviour predates this batch, but this batch adds a new affirmative clean-answer contract to that stale snapshot.
- Impact: consumers of the new report can treat an incomplete dependency search as a complete negative result. Initial publish atomicity does not protect later mutation.
- Recommendation: invalidate the complete graph/report together and force a rebuild, or publish an updated explicitly incomplete report atomically with node removal, conservatively qualifying resolution as well. Fence in-flight builds on invalidation if they could republish pre-invalidation data. Add a regression for a.ts -> b.ts plus invalidation and for invalidation during an active replacement build.
- Probe: actual service code, mocked file/analysis ports; dependents=[], analyzed=2, context=complete, clean=true after invalidation.

### 2. Any supplied paths object incorrectly proves resolver completeness � Blocking

- Trigger: pass {} (or unrelated valid mappings) while an import uses a package-local #b mapping to b.ts, a baseUrl-relative local module, or a workspace package mapping not represented by paths.
- Symptom: missing internal edge is counted external and the graph can be certified clean.
- Evidence: DG:522 makes every defined tsconfigPaths complete; DG:581 recognizes only relative/absolute-prefix imports or patterns in that object as internal; DG:1007�1025 only resolves relative paths and the supplied mappings. LC:223 accepts external>0 provided unresolvedInternal=0 and context=complete.
- Current handling: the conservative fallback only applies when tsconfigPaths is undefined. No supplied-object contract proves other resolver context absent.
- Impact: a supposedly clean graph can omit workspace dependents, undermining the new coverage gate. The current namespace passes undefined (AN:453), so this trigger applies to direct service callers now and must not be introduced by future manifest plumbing.
- Recommendation: separate known context completeness from the mappings themselves. Until context inspection exists, retain partial for unresolved potentially local bare/# specifiers even when a paths object is provided; # imports should be treated as potentially internal. Do not implement the deferred resolver merely to fix reporting. Add a {} plus #b regression and one with an unrelated paths mapping plus an unresolved baseUrl import.
- Probe: same two-file service input and #b import: undefined paths gives partial/clean=false; {} gives complete/clean=true; neither resolves the edge. The probe supplies the extracted import, not a real manifest parser, because this service never reads manifests.

### 3. Known-external-only graphs get an unnecessary partial qualifier � Moderate

- Trigger: a fully resolved TS/JS graph whose only non-relative import is node:fs, with no paths parameter.
- Symptom: external=1, unresolvedInternal=0, context=partial, clean=false.
- Evidence: DG:519�522 does not distinguish proven external specifiers from context-dependent ones; AN:453 supplies undefined on today's namespace route.
- Current handling: intentionally conservative. This is honest about absent context but overstates uncertainty for imports whose resolution cannot become a workspace edge.
- Impact: needless user-visible qualification after 23b; reduced usefulness of the clean signal. This alone would not block approval. It is not true that ALL TS graphs are qualified: zero-external graphs remain complete (DG:522).
- Recommendation / precise rule: complete when every unresolved specifier is proven external, or when bounded, successfully read effective tsconfig/jsconfig chains and relevant package manifests establish that no applicable unresolved local mapping can affect those specifiers. Preserve partial when a context read/extends chain is missing, fails, escapes scope or exceeds bounds; or applicable paths/baseUrl, package imports/exports or workspace/self-package mappings exist and are not resolved. Presence of some paths alone is insufficient. An alias-free chain is only proof after it was inspected; do not assume absence from undefined. Recognize node: builtins as external without tsconfig work.
- Ptah decision: tsconfig.base.json:18 declares paths, and AN:453 currently withholds them. Qualifying Ptah's graph is appropriate until resolver context is wired; removing the qualifier to preserve old clean output would hide a real gap. Ordinary alias-free repos should eventually avoid it. The service does not currently have enough inputs to prove all such repos alias-free.
- Probe: node:fs-only external import returns partial and clean=false.

## Blocking issues

Defects 1 and 2 above. Both have concrete service-level repros and file:line evidence. They affect newly introduced coverage semantics even though related graph limitations predate this batch.

## Serious issues

None established.

## Moderate and minor issues

- Moderate: defect 3.
- Minor documentation correction, not a fourth failure mode: executor report:24 calls the former Python/Go/C# nodes import-less. tree-sitter.config.ts:398/404/410 supplies import queries and ast-analysis.service.ts:331 consumes import.source. Those languages lack export queries, which is the relevant symbol-index distinction.

## Data flow

1. **OK:** reserveBuild bumps a root generation; getBuildState reflects running work (DG:332, DG:337).
2. **OK within 23a:** selection classifies once per slash-normalized path, sorts per-language candidates and chooses round-robin; selected membership is discovery-order independent, while parse order preserves input order (GC:163, GC:199, GC:212). With the fixed 5,000 cap and the closed language set, an eligible language cannot be starved. No guarantee is made for an arbitrary caller-supplied cap smaller than the language count.
3. **OK:** selected files alone are parsed; read/parse failures become reasons; background chunks use governor admission and per-file macrotask yields (DG:373, DG:394).
4. **GAP:** linking classifies missing imports using incomplete context (defect 2). The distinct-edge counter stops before insertion 250,001 and sets edgeCapHit (DG:540�547).
5. **OK:** after linking, the final generation check precedes report construction and publish with no intervening await (DG:284�312); publish updates both maps synchronously (DG:600). No event-loop observer can see one map updated while the other is old.
6. **OK with scope caveat:** getCoverageReport returns file/language accounting from one published record (DG:790). It is not a combined graph-query/result snapshot: separate calls with an await between them can straddle a rebuild. Current APIs expose no joint graph-plus-report accessor. 23b must capture related query output/coverage synchronously or use a versioned snapshot; this is an integration caveat, not a proven current consumer regression.
7. **GAP:** invalidateFile mutates the graph without replacing the report (defect 1).
8. **OK:** evict, retainOnly and clear remove coverage and graph together and revoke generations (DG:833, DG:852, DG:872).

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Eligible-only 5,000 cap, fair deterministic selection | COMPLETE | GC:163�224; selection membership stable, parsing counts selected nodes/failures |
| Failure buckets | COMPLETE for ordinary read/analysis failures | DG:410�448; grammar-unavailable guard is unreachable until registry/parser mappings diverge |
| External vs unresolved-internal accounting | PARTIAL | Defect 2; unresolved context is not safely inferred |
| Aggregate 250,000 edge bound and disclosure | COMPLETE | DG:540�547; cap applies to distinct stored edges |
| Atomic publish / supersession | COMPLETE at publication | DG:284, DG:600; later invalidation violates ongoing consistency |
| Multi-root merge | COMPLETE for specified inputs | GC:108, GC:329, GC:368; saturation/null poison, worst status, unions, OR/partial |
| Batch 9 file-count meanings | COMPLETE for existing caller contract | DG:291�307 keeps list/discovered semantics; these are not successful-node counts |
| Batch 9b governor, reservation, failed status, R3-S1 | COMPLETE by trace; runtime checks recorded below | DG:332/373/894; PD:2476 delivers the unconsumed empty generation; PD:2642 records failure |
| Bounded discovery / censusLimit | PARTIAL overall, intentionally 23b | DG:308 only forwards metadata; PD:2687 still discovers unbounded and pre-slices at :2700 |
| No lost Python symbol-index capability | Supported by current source, baseline comparison limited | Empty exportQuery at tree-sitter.config.ts:399/405/411; ast-analysis.service.ts:123 yields no exports; DG:695 indexes only nonempty exports |

Implicit requirements not addressed: lifecycle invalidation of coverage; provenance of resolver completeness. Discovery deferral is consistent with the 23a/23b split and is not counted as a defect.

## Edge cases

| Case | Handled | How / concern |
| --- | --- | --- |
| Empty file list | YES | Empty graph/report publishes; dispatcher R3-S1 delivery remains at PD:2476 |
| Duplicate slash variants | YES | GC:163 seen set, GC:216 delete-on-selection |
| Mixed language census | YES | Unsupported/non-source/unrecognised buckets separated; only eligible consumes parse cap |
| Parse/read rejection | YES | Reason count and absent node (DG:410�448) |
| Newer build or root eviction | YES | Final generation guard and cache removal (DG:284, DG:833) |
| Invalidation after publish | NO | Defect 1 |
| {} context plus package alias | NO | Defect 2 |
| Only proven external imports | NO | Unnecessary qualification, defect 3 |
| Huge file / huge import list | PARTIAL | 5,000 files and 250,000 distinct edges do not bound source bytes or extracted import arrays; parsing retains imports before linking (DG:457), duplicates/unresolved imports do not consume edge budget (DG:541/555) |
| Very large discovery list | PARTIAL | GC:163 retains O(N) identities/candidates and sorts eligible paths before yielding; censusLimit does not trim input. 23b's bounded 50,001 discovery is required for that guarantee |
| Stuck read/parse | PARTIAL | MCP bounded wait survives; build itself can remain pending (DG:412/427; PD:2512) |

## Verification

- ptah_get_diagnostics, scoped to the two production files: typescript-compiler, 0 errors / 0 warnings. No listed ptah file-read API was available; native reads were used. No source changes or git operations were performed.
- Temporary Node probe: C:/Users/abdal/AppData/Local/Temp/task559-review-probe.cjs. Transpiles the actual local service, coverage helpers, registry and coverage contract with installed TypeScript; stubs decorators and file/analysis/logger ports. Reproduced all three findings. This is a service-logic probe, not a real tree-sitter or manifest integration test.
- Scoped Nx checks launched through the installed nx/dist/bin/nx.js, with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. An initial runner used the older nx/bin/nx.js path and failed before running any checks; that invocation mistake was corrected, without source edits.
- ptah-electron:validate-deps: PASS, exit 0.
- degradation-audit:lint: PASS, exit 0, TOTAL 300.
- Workspace-intelligence test/lint/typecheck: PASS, exit 0, all three scoped targets successful; cache skipped; duration 1m 41s. Nx suppressed successful task details, so no independent exact test count is asserted. Logs: C:/Users/abdal/AppData/Local/Temp/task559-review-workspace.log, task559-review-audit.log and task559-review-deps.log.
- Executor's 70/70 and base 9-failed/40-passed results are reported evidence, not independently reproduced baseline evidence. The requested git show HEAD comparison was not run because the reviewer role prohibits git operations. Current extractor/export-index source supports no lost Python public-symbol entries; exact HEAD parity remains unverified. No task-description.md or existing code-style-review.md was present in this task directory; no repository AGENTS.md/CLAUDE.md was found in this worktree.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the two service-level false-clean repros; MEDIUM for full integration/HEAD parity.
- Top risk: Batch 23b can expose a clean no-dependents result for a graph whose edges were removed or never resolved.
- What a robust implementation would add: invalidation-aware coverage/rebuild semantics; explicit resolver-context completeness; regressions for both false-clean cases; a known-external fast path; bounded discovery wiring and snapshot-consistent query/coverage capture in 23b.
