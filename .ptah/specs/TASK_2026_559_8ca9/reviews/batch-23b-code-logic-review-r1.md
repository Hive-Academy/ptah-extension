# Code Logic Review - TASK_2026_559_8ca9

## Summary

Batch 23b, review r1, 2026-09-27. The original carried r4 probes pass. The new coverage plumbing survives the real budget layer, and all requested scoped checks pass. However, discovery can certify a clean complete census while omitting recognized source files, and canonical path handling remains incomplete for symbol prefixes and multi-root alias queries.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 3 |

The score is below 7 because reproduced inputs still produce misleading clean negative results. It is above the structural-failure band because the carried fixes, lifecycle fencing, accounting for discovered files, budget preservation and ordinary queries work. No source was edited and no git operation was performed.

Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h:

- DG: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts
- GC: libs/backend/workspace-intelligence/src/ast/graph-coverage.ts
- LR: libs/backend/workspace-intelligence/src/ast/language-registry.ts
- AN: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts
- SI: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/symbol-index-query.ts
- PD: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- TB: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts
- CLI: libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts
- EP: libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts

Authority: Batch 23b at lines 3201-3243 of the task-559-mcp-tool-contract worktree's batches.md, including User Decision 20; implementation-plan-languages.md coverage placement, graph inventory and bounds; context.md; batch-23b-executor-report.md. Reviewed the graph service and coverage helper, namespace implementation, changed namespace types/wiring/barrel, dispatcher graph/pagination/budget paths, associated regression specs and runtime discovery adapters. Existing large dispatcher/type files were examined at relevant paths rather than claimed as an unrelated whole-file audit. No new project instruction file was found in the targeted paths; supplied project guidance applies.

## Carried criteria status

| Criterion | Status | Independent evidence |
| --- | --- | --- |
| R4-B1: Windows relative/absolute case variants | FIXED in the original probes | DG:790/818 now call findNode (DG:840); original service probe and adapted actual-namespace probe return stored B.ts/A.ts for matching-case, lowercase absolute and relative-joined spellings. Outputs preserve stored case. Depth-2 assertions in DG spec:1411 pass in the scoped suite. |
| R4-B1: symbol-index Windows case variants | RETAINED | SI:138 folds Windows prefixes; namespace regression is covered by the passing suite. Broader use of the shared canonical identity is incomplete: R1-B2. |
| R4-M1: injected EIO on alias-root realpath | FIXED | DG:217 reports unavailable, DG:476 applies GC:354 atomically at publication. Original real-junction parent/child probe after target-path invalidation: both clean=false; reasons=["unchecked?"]. |
| Earlier B1/B2/M1/R2-B1/R3-B1 | RETAINED in original repros | Reran prior scripts: invalidation qualifies parent and nested roots; evict/retainOnly/clear supersede in-flight builds; case/junction invalidation works; # imports stay unresolved even with {}; bare package carries resolver-context-partial; node: builtin-only control stays clean. DG:447/470/483, GC:252/323. |

The namespace probe's old WI mock initially lacked the new recognisedSourceExtensions export. The temporary loader was updated to load the actual registry and symbol paginator; the first loader failure is not a production defect.

## Five logic questions

### 1. How does this fail silently?

AN:422 discovers only lower-case extension patterns while LR:320 recognizes extensions without case sensitivity. Both real CLI and Electron providers omit analysis.R and APP.TS; the namespace then publishes complete, clean coverage with zero analyzed/unsupported/omitted files (GC:256). Separately, SI:138 only compares lexical prefixes, so a real-path prefix of an indexed junction returns an empty page and PD:2248 attaches the unchanged clean graph coverage. See R1-B1 and R1-B2.

### 2. What user action produces unexpected behaviour?

Querying exported symbols under the real target of an opened junction yields zero instead of the two stored entries. Opening/building one unrelated second root makes a previously successful real-path dependency query return []: DG:842 selects a graph before its realpath fallback, and DG:1281 selects multi-root graphs lexically. The namespace truthfully returns unknown coverage in that second case, but the query still stops working (R1-B2).

### 3. What input data produces a wrong answer rather than an error?

A real temporary directory containing analysis.R and APP.TS is enough for R1-B1; renaming only their extensions to analysis.r and APP.ts discovers both, with analyzed=1, unsupported=1 and clean=false. A real junction containing A.ts -> B.ts, both with exports, is enough for R1-B2. These are filesystem fixtures, not hypothetical paths only.

### 4. What happens when a dependency fails?

Root realpath EIO now produces unchecked:null and reason unchecked? (DG:217/476, GC:354); invalidation preserves that uncertainty. Discovery rejection propagates to the background-job catch and failed status (PD:2708/2836), rather than a clean empty graph. Read/parse failures remain counted (DG:573 onward). ENOENT/ENOTDIR and intentionally skipped UNC resolution remain the documented exceptions; no new UNC/platform guarantee is claimed. The diagnostics tool itself returned unavailable after its 45-second bound; independent scoped Nx typechecks passed.

### 5. What is missing that the requirements never mentioned?

The census contract needs equivalence between extension recognition and actual adapter matching, not just a list of lower-case recognized extensions (AN:422, LR:320). A query identity must be applied before graph selection and before symbol-prefix filtering, not only at node lookup (DG:842, SI:138). Passing maxResults to the current CLI/Electron adapters does not make their walk bounded (R1-M1).

## Numbered defects / failure modes

### R1-B1 - Recognized uppercase extensions disappear from a clean complete census

- Severity: Blocking (silent misleading success).
- File: AN:422 and AN:601; LR:289/320; CLI:128 and EP:126; resulting claim at GC:256.
- Trigger: discovery/build over a root containing analysis.R and APP.TS. Neither path is in an excluded vendor/generated directory.
- Symptom: discovery returns files=[], truncated=false, limit=50000. Graph coverage says clean:true, census:complete, analyzed:0, unsupported:0, unrecognised:0, omittedByCap:0. A symbol-index response therefore claims a clean empty graph. Direct unsupportedGraphLanguage('analysis.R') correctly recognizes r, demonstrating disagreement inside the new census API.
- Evidence: task559-23b-adapters.cjs loads the actual CliFileSystemProvider and ElectronFileSystemProvider, actual dependency namespace, registry and graph service. Both reproduce the result on a real mkdtemp tree. task559-23b-probe.cjs includes the extension-only rename control: analysis.r + APP.ts gives two discovered files and non-clean unsupported-r coverage.
- Current handling: no case-insensitive pattern/options or coverage qualifier. The executor acknowledges the fast-glob limitation as pre-existing. The adapter limitation predates 23b, but claiming complete language coverage from its incomplete output is in this batch's explicit honesty/discovery scope.
- Impact: recognized unsupported code is absent from the disclosure; graph-capable uppercase-extension code is omitted too. The graph can authorize a false negative or an unjustified clean coverage decision.
- Recommendation: make discovery implement the registry's extension case semantics across adapters, for example portable per-letter bracket classes in the extension glob, while retaining vendor pruning and the limit. If a provider cannot guarantee discovery completeness, qualify its census instead of certifying complete. Add actual-adapter fixtures with analysis.R, uppercase TS and mixed-case extensions, plus lower-case controls.

### R1-B2 - Canonical alias identity is applied too late, and never to symbol prefixes

- Severity: Blocking for the symbol-index false-clean result; the multi-root dependency variant is a broken query with an honest unknown qualifier.
- File: AN:527; SI:138-146; DG:842/866 and DG:1281-1303; PD:2239/2248/2256.
- Trigger A: build a graph through a real junction alias, then request getSymbolIndex(undefined, {pathPrefix: realTarget}). Matching alias prefix returns two exported-file entries.
- Symptom A: real-target prefix returns files:[], count:0, total:0, while getGraphCoverage returns clean:true. PD attaches that coverage to the empty page. No error or qualification identifies the unmatched identity.
- Trigger B: with that same graph, the real-target getDependencies(A.ts) initially returns stored alias/B.ts. Build an unrelated second root and repeat exactly the same query.
- Symptom B: [] instead of alias/B.ts; alias-spelled control still succeeds. Coverage becomes unknown because no lexical root was selected. This is not reported as a clean negative, but it is a regression in behaviour caused merely by another root being cached.
- Evidence: task559-23b-probe.cjs uses the actual namespace, symbol paginator and graph service over a mkdtemp junction fixture. A: alias prefix count=2, target prefix count=0 with clean=true. B: target query succeeds before sibling build and fails after. findNode cannot run its root-alias fallback when findGraphEntryForFile has already returned undefined. The symbol paginator independently uses startsWith with case folding, not the Batch 23a canonical identity.
- Current handling: tests cover the single-root alias dependency query and lexical Windows prefix casing. They do not cover realpath symbol prefixes or a second cached root.
- Impact: agents can incorrectly conclude there are no exports under a real directory already indexed through an alias. Multi-root hosts lose working dependency answers for that spelling.
- Recommendation: resolve query/root identity consistently before selecting the answering graph, and use the same identity/re-rooting for symbol-prefix filtering. Preserve stored output paths, exact-match priority and ambiguity refusal. Add real junction/symlink fixtures for all three tools with single and multiple roots, and assert identical page membership, edges and coverage for equivalent spellings. The original narrow Windows case criterion is fixed; this finding concerns the remaining canonical-identity contract, not a claim that the old case probe still fails.

### R1-M1 - Discovery limits the returned list, not the CLI/Electron walk or its allocation

- Severity: Moderate (resource-bound contract gap; no exhaustion event was induced).
- File: AN:601-610; CLI:128-135; EP:126-134.
- Trigger: a root with more than 50,001 non-excluded recognized files.
- Symptom: both providers await a complete fast-glob result array and only then slice to maxResults. The new namespace truncates that result again. Census truncation is honest, but discovery still enumerates/allocates the entire matching tree, so the advertised discovery bound does not bound work or peak list memory.
- Evidence: direct adapter code; the actual-adapter probe confirms these are the runtime implementations used. No large-workspace latency/OOM benchmark was run. The executor correctly acknowledges this limitation; it remains a requirement gap rather than a newly introduced adapter regression.
- Recommendation: implement a bounded, cancellable discovery iterator/stream at the owning adapter boundary and stop after limit+1 matches, with vendor excludes applied before collection. Pin stopping behaviour with an instrumented producer, not merely an assertion that the returned array is short. Until then describe this as a result-count cap, not a bounded walk.

## Blocking issues

R1-B1 and R1-B2. Each has a successful control and a reproduced false-clean negative. The known adapter/paginator provenance does not remove the explicitly requested honesty and canonical-query acceptance gaps.

## Serious issues

None additional established.

## Moderate and minor issues

R1-M1. No separate finding is added for documented macOS case policy, recognition-only discovery excluding unrecognized languages, or the intentional unknown-coverage API change. Native macOS and slow/network storage were not tested.

## Data flow and compatibility

1. **PARTIAL:** ptah-api-builder.service.ts:541 supplies fileSystemProvider to the session-aware analysis namespace. AN:591 validates limit, requests one extra result and applies the nine vendor excludes. Case coverage and physical walk bounds have the gaps above.
2. **OK for returned discovery:** PD:2765 passes all at-most-50,000 files onward and censusLimit only when truncated; no dispatcher 5,000 slice remains. GC:162 applies the fair eligible-language parse cap; GC:38/41 retain 5,000/250,000 bounds. GC:252 reports resolver-context-partial for context-dependent bare imports until 32b.
3. **OK:** DG:507 reservation, DG:419 root identity, DG:548 governor/macrotask parsing and DG:447 final generation fence remain. DG:470 publication, root-identity cache update and pending invalidations run without an intervening await. Prior evict/retainOnly/clear probes pass.
4. **OK for ordinary/case queries; PARTIAL for aliases:** DG:790/818 return stored spellings via findNode; namespace dependency and coverage wrappers read synchronously before resolving their promises. PD:2051/2091 invokes both together. R1-B2 identifies earlier routing/filtering gaps.
5. **OK:** unsupported-language dispatch occurs before building (PD:2031/2072), is successful, status-first and has no count:0. File answers place count/cap fields, fileInGraph and coverage ahead of file/list (PD:2877). Symbol headers include coverage before files (PD:2930 onward).
6. **OK:** budget layer preserves coverage verbatim, including null and clean:false (TB:100/274). The symbol paginator measures both token and character budgets, moves nextOffset past oversized entries and keeps the coverage header. Passing dispatcher tests cover ordinary, skipped, empty and cap-disclosed pages (protocol-dispatcher.spec.ts:5118 onward).
7. **Compatibility assessed:** getGraphCoverage/ForFile always return objects now (AN:665/676; types.ts:941/947). Existing in-repository production callers are PD's file answers, symbol header and empty-snapshot detection. Optional absent counts are handled by graphCompleteness (PD:2852) and do not satisfy discoveredFiles===0 at PD:2675. An old execute_code script using truthiness/undefined as an existence test must instead use isBuilt or coverage.census; this intentional contract change is documented in types, and is not asserted to be behaviour-compatible with every external script. The unpaged getSymbolIndex overload remains intact (AN:510 onward). The help-text refresh belongs to the agreed 24c documentation batch.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| R4 case-variant dependency/dependent probes | COMPLETE | Original and adapted namespace probes pass, stored spelling retained |
| R4 EIO junction disclosure | COMPLETE | Both roots unclean, unchecked? reason; DG:476/GC:354 |
| Canonical identity across all graph queries | PARTIAL | R1-B2: symbol aliases and multi-root selection |
| Recognized unsupported files counted | PARTIAL | Lower-case fixture passes; R1-B1 uppercase omissions |
| Nine vendor excludes inside discovery call | COMPLETE | AN:402/603; passing actual fast-glob vendor fixture |
| 50,000 result limit and truncated census | COMPLETE | AN:591/607; PD:2782; GC:256 |
| Bounded discovery walk/allocation | PARTIAL | R1-M1 |
| Fair 5,000 parse cap and disclosure | COMPLETE by trace and suite | GC:162; PD:2773 passes all discovered files |
| Governor, generation fence, building/failed | INTACT | DG:447/548; PD:2530/2708/2813; lifecycle specs pass |
| Slow empty build delivered once (9b R3-S1) | INTACT | PD:2542 onward; protocol-dispatcher.spec.ts:6128 passes |
| Unsupported-language / fileInGraph | COMPLETE for checked cases | PD:2031/2877; real namespace fixtures and suite |
| Coverage before lists; 24r preservation | COMPLETE | Actual budget probe + scoped dispatcher suite |
| Symbol paging and multi-root coverage merge | COMPLETE except identity filtering | DG:1089/GC merge; PD:2248/2930; R1-B2 |
| Unknown coverage API callers | COMPLETE for inspected in-repo callers | AN:665/676, PD:2675/2852; external script migration noted |
| Resolver context honesty until 32b | INTACT in probes | Bare package non-clean; # import unresolved with {} |

## Edge cases

| Case | Result | Evidence / concern |
| --- | --- | --- |
| Empty successful discovery after slow build | Handled | Existing R3-S1 regression passes |
| Discovery rejects / build fails | Explicit failed, retryable | PD:2708/2836; passing suite |
| File read/parse fails | Counted, non-clean | DG parse path and scoped service suite |
| Cap reached / unsupported lower-case code | Qualified | Census/omitted/unsupported retained through budget |
| No graph / no relative-query workspace | Unknown, not clean | AN:427/665/682 |
| Uppercase recognized extensions | Incorrect clean census | R1-B1 |
| Realpath symbol prefix | Incorrect clean empty page | R1-B2 |
| Additional unrelated cached root | Alias dependency query breaks | R1-B2; unknown coverage prevents a clean claim here |
| EIO during root lookup | Qualified atomically | Original carried probe passes |
| Very long file and 1,500 paths | Under budget, status retained | Independent real budget probe |
| Very large discovery tree | Output bounded, walk unbounded | R1-M1 |

## Verification

- Ran once: Nx test/lint/typecheck for @ptah-extension/workspace-intelligence and @ptah-extension/vscode-lm-tools, --skip-nx-cache --parallel=2. All six targets passed (about 2m03s).
- Ran once: typecheck for ptah-cli and ptah-electron; both passed. ptah-electron:validate-deps passed. degradation-audit:lint passed with TOTAL 300 unsuppressed sites. NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Neither named flaky suite caused a failed target.
- Scoped ptah_get_diagnostics returned unavailable: compiler still running after 45s, not cancelled. No clean diagnostics result is claimed or redundant poll performed; independent typecheck targets succeeded.
- Original r4 service probe rerun unchanged: all six case-spelling forward/reverse calls now return the expected stored paths; actual junction EIO case returns both roots unclean. A second output-only adaptation confirms reasons=["unchecked?"]. Original namespace probe adapted only for new runtime imports and rerun successfully.
- Earlier r1/r2/r3 probes rerun against current source: invalidation, overlapping roots, in-flight lifecycle, Windows spelling and real-junction cases remain fixed.
- New task559-23b-probe.cjs: actual namespace/service/registry/paginator over mkdtemp fixtures; reproduces R1-B1 and R1-B2 with controls. File analysis uses deterministic mocked insights; this is not a native tree-sitter or complete JSON-RPC integration run.
- New task559-23b-adapters.cjs additionally invokes actual CLI and Electron findFiles implementations over an on-disk uppercase fixture. Both return [] and clean complete zero coverage. Fixture: C:/Users/abdal/AppData/Local/Temp/task559-23b-adapters-rVGph7. Alias/control fixture: C:/Users/abdal/AppData/Local/Temp/task559-23b-probe-qH529W.
- New task559-23b-budget.cjs invokes actual applyToolResultBudget, reducers and token counter with truncated census, unchecked:null, partial resolution, long file path and 1,500 list entries. Dependencies: 1,978 tokens / 5,988 chars; dependents: 1,978 tokens / 5,984 chars. Both preserve the entire coverage object, fileInGraph:false and incomplete:true, and spool raw output under mkdtemp. The scoped dispatcher suite additionally executes the real createToolSuccessResponse and paginator budget tests.
- Scripts/logs are under C:/Users/abdal/AppData/Local/Temp; check logs use task559-23b-review-{workspace,runtimes,audit,deps}.log. No suite was rerun merely to inspect its output. Author's fails-before counts were reviewed as reported evidence, not independently reproduced by reverting source. No source/stage/commit/reset/restore/checkout changes.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for carried-fix closure and the two new filesystem/query reproductions; MEDIUM for runtime cost impact, which is established structurally but not benchmarked.
- Top risk: an incomplete recognized-language census or an equivalent alias query is presented as a clean empty answer.
- What a robust implementation would add: adapter-consistent case-aware discovery, canonical identity before root selection and symbol-prefix filtering, and a genuinely bounded discovery producer, each with a failing regression fixture before the fix.
