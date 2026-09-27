# Code Logic Review - TASK_2026_559_8ca9

## Summary

Batch 23b review r2, after revision round 1. Original uppercase-discovery and junction-query repros now pass, including the carried r4 probes. The stream cancellation reaches the real directory walker. Two gaps remain: a real-path symbol prefix above an indexed alias root still yields a clean empty page, and a flat directory can buffer arbitrarily more matches than the requested stream limit.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 2 |

Below 7 because a reproduced alias query still gives a false clean negative; above the structural-failure band because original failures, ordinary discovery, publication fencing and cancellation propagation work. Source remained read-only. No git operation was performed.

Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h:

- DG: libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts
- GC: libs/backend/workspace-intelligence/src/ast/graph-coverage.ts
- AN: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts
- SI: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/symbol-index-query.ts
- PD: libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- BC: libs/backend/platform-core/src/utils/bounded-collect.ts
- CLI: libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts
- EP: libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts
- LR: libs/backend/workspace-intelligence/src/ast/language-registry.ts

Inputs: authoritative Batch 23b and Decision 20 reviewed in r1; archived r1 findings; batch-23b-executor-report.md Revision round 1; supplied project guidance. Reviewed the revised functions and their callers, new helper in full, both adapters, installed fast-glob cancellation chain, tests and failing-suite setup. Retained prior full graph/coverage/namespace analysis rather than treating unchanged code as a new audit. No ptah file-read API is listed, so native reads were used.

## r1 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| R1-B1 uppercase recognized extensions vanish | FIXED in original probes | AN:425/440 emits bracket classes. Actual CLI/EP over APP.TS + analysis.R now discover both; analyzed=1, unsupported.r=1, clean=false. |
| R1-B2 real-target symbol prefix and sibling-root dependency query | Original repros FIXED; broader prefix contract PARTIAL | Original root-prefix fixture returns both exports for alias and target; dependency query still works after sibling build. DG:1282/1325, AN:551, SI:141. Ancestor prefix remains R2-B1. |
| R1-M1 whole-tree collection before slicing | Cancellation FIXED; memory bound PARTIAL | Actual fast-glob walker destroy invoked and deeper traversal stopped, but 2,000 matches buffered/emitted for limit 5: R2-M1. |
| Carried R4-B1 | RETAINED | Actual namespace relative/absolute Windows case probe returns stored A.ts/B.ts spellings for all six calls. DG:790/818/840. |
| Carried R4-M1 | RETAINED | Actual junction fixture with injected EIO returns parentClean=false, childClean=false, reasons=["unchecked?"]. DG:217/476; GC:354. |

## Five logic questions

### 1. How does this fail silently?

DG:1325 expands a prefix only when that prefix lies inside a cached root. It does not translate a prefix that contains a root. SI:141 then filters against only the untranslated target ancestor, finds no stored alias paths, and PD:2256 attaches the clean graph coverage (R2-B1).

### 2. What user action produces unexpected behaviour?

Open/index alias/pkg, then broaden a symbol query from real/pkg to real. The narrower query returns two files; the broader query returns none with clean=true. The matching alias ancestor returns both. These are equivalent filesystem spellings of the same indexed subtree, not unrelated directories (R2-B1).

### 3. What input data produces a wrong answer rather than an error?

A real junction alias -> real, a graph rooted at alias/pkg, and exported A.ts/B.ts under pkg. task559-23b-r2-route.cjs reproduces the incorrect clean page. Uppercase extensions no longer cause wrong counts: APP.TS is TypeScript and analysis.R is unsupported R under the existing registry policy (LR:204/320).

### 4. What happens when a dependency fails or returns unexpectedly?

Root EIO remains qualified; discovery/stream errors reject rather than publish a success-looking empty list, and the unchanged dispatcher background failure path converts rejection to failed (PD:2708/2836). At the result limit, asynchronous-iterator close destroys the merged stream, which propagates close through fast-glob to fs.walk. This stops queued work but cannot undo a synchronous directory's already-buffered entries (R2-M1). Scoped diagnostics were unavailable after 45 seconds; independent typechecks passed.

### 5. What is missing from the stated requirements?

Prefix identity must cover both directions of containment: a query inside a graph root and a query above it (DG:1253/1325). A resource bound must specify whether it bounds collected output, producer buffering or directory enumeration; they are not equivalent for this installed fast-glob pipeline (BC:23; node_modules/fast-glob/out/providers/stream.js:18).

## New defects / failure modes

### R2-B1 - Broader real-target prefixes omit indexed alias subtrees with clean coverage

- Severity: Blocking (silent misleading negative).
- File: DG:1325-1341 and DG:1253-1266; SI:141-149; AN:551; PD:2248/2256.
- Trigger: create real/pkg/A.ts and B.ts, a junction alias -> real, and build only the graph rooted at alias/pkg, which is also the session workspace root (so dispatcher readiness uses that already-built graph). Query the symbol index with pathPrefix real/pkg, then its parent real.
- Symptom: real/pkg returns two entries; real returns files:[], count:0, total:0. Both use clean:true coverage. The alias parent prefix also returns two entries. Widening the filter therefore loses known symbols solely because of alias spelling.
- Evidence: task559-23b-r2-route.cjs loads the real graph service, namespace and symbol paginator with deterministic mocked analysis. Fixture: C:/Users/abdal/AppData/Local/Temp/task559-r2-route-MfWXXq. Controls and failing result are retained in the probe output. PD forwards that page and unqualified merged coverage, so no later status fixes it.
- Current handling: graphSpellingsOf delegates to identitiesUnderRoot, which requires isUnderIdentity(fileIdentity, rootIdentity). A prefix above realRoot fails this direction check, yielding no alias spelling. The raw lexical prefix cannot match stored alias nodes. The new root-equality test does not exercise ancestor prefixes.
- Recommendation: match symbol entries using canonical identity or return root-scoped prefix matches that also include graphs whose real roots lie beneath the requested prefix. Preserve segment boundaries, trailing-slash behaviour, stored output paths and de-duplication. Add ancestor/equal/descendant prefix controls for alias and target spellings, including nested and sibling graphs. Do not solve this by returning a global alias-parent prefix that accidentally includes unrelated cached graphs.

### R2-M1 - Early close cancels traversal, but producer buffering still exceeds the result bound without a fixed limit

- Severity: Moderate (remaining resource-bound gap; no OOM claim).
- File: BC:23-25; CLI:140-143; EP:139-142. Installed dependency evidence: node_modules/@nodelib/fs.walk/out/readers/async.js:64 processes every entry in one callback; node_modules/fast-glob/out/providers/stream.js:18 emits data without backpressure; node_modules/fast-glob/out/utils/stream.js:12 propagates close.
- Trigger: the actual fast-glob stream over a real flat directory of 2,000 matching files, plus a 70-level directory chain; collectBounded(source, 5).
- Symptom: the helper returns five paths, but the producer has emitted 2,000 matches and the merged stream still has readableLength=1995. Two directory reads were started. After settlement the walker has been destroyed once and no more entries are emitted. Thus cancellation is real, but limit plus high-water-mark is not a bound on memory/work before cancellation.
- Evidence: task559-23b-r2-walk-buffer.cjs runs installed fast-glob 3.3.3 and actual BC, instrumenting only walker emit/destroy and filesystem read counts. Fixture: C:/Users/abdal/AppData/Local/Temp/task559-r2-walk-9lhN9B. Returned=5, emitted=2000, readBuffer=1995, reads=2, destroy count after settle=1. It does not replace fast-glob with a cooperative Readable.
- Current handling: new specs mock fast-glob.stream with an endless Readable obeying backpressure; that proves iterator close but not this dependency's buffering. In a one-directory workspace, the whole matching directory can still be buffered before the limit is observed.
- Recommendation: add a real-walker regression and use a producer with incremental directory iteration/backpressure if a strict memory bound is required. Otherwise explicitly document a result-count bound plus potentially unbounded per-directory read/buffer size and carry that limitation rather than certifying R1-M1 fully fixed. The queued deep-tree cancellation improvement should be retained.

## Blocking issues

R2-B1. The original junction tests pass but do not cover a prefix above the indexed root.

## Serious issues

None independently established.

## Moderate and minor issues

R2-M1. The incorrect broad explanation of Electron test failures is corrected in verification below, not counted as a separate source defect.

## Case and determinism assessment

- AN:425 changes matching of extension letters only, not directory/file identity. Every result is still classified by LR's pre-existing case-insensitive extension registry (LR:320 and classification's lower-casing). APP.TS counts as TypeScript; analysis.R and analysis.r count as R. R is recognized but unsupported, so neither is claimed analyzed.
- Filesystems distinguish filenames, not language semantics. The batch does not introduce a new .R/.r language collision: the registry already defines those spellings equivalently. On a case-sensitive host, differently named files still remain separate entries. A file using a conventional source extension for unrelated content remains a limitation of extension-based recognition, not a reason to silently omit it from the census. Native Linux/macOS were not exercised.
- DG:1305 chooses maximum matched-root length and a stable key tie-break; build order no longer decides equal-length ties. A separate nested alias probe returned different stored display roots for different spellings but the same physical dependency; no additional wrong-edge finding is asserted from that observation.
- Stream order follows asynchronous filesystem traversal; no cross-run or cross-platform guarantee of the same truncated subset is established. Coverage explicitly marks truncation. This does not overturn stable fair selection among the files actually discovered.
- VS Code adapter is unchanged: vscode-file-system-provider.ts findFiles forwards the pattern, exclusions and maxResults using RelativePattern. Existing shared exclusion patterns already use per-letter brackets. No live VS Code host was available; no new provider option or path transformation was added.

## Data flow and requirements

1. AN:440 builds the case-aware recognized-extension glob; AN:612 onward validates discovery limit and requests limit+1 with vendor exclusions. Actual adapters return both uppercase fixture files; with limit=1 both publish census:truncated, censusLimit:1, clean:false.
2. CLI:140 / EP:139 collect the stream through BC. Queued traversal cancellation is verified; buffering has R2-M1's limitation.
3. The graph still applies the fair 5,000 parse cap and 250,000 edge cap (GC:38/41), publishes graph/coverage after the generation check (DG:447/470), and applies pending invalidation without yielding. Revised discovery/routing does not alter those paths.
4. Multi-root selection now checks lexical and real identities before node resolution (DG:1282); original sibling-root query is fixed. Symbol paging receives graphSpellingsOf through AN:551; its one-way containment leaves R2-B1.
5. Dispatcher statuses, slow-empty-build latch, coverage-first headers, preserveKeys budget handling and the unpaged namespace overload remain as reviewed in r1. The scoped vscode-lm-tools suite passes; no new source changes to those budget/lifecycle paths were claimed in this round.

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Original R1-B1 uppercase census | COMPLETE in actual adapters | Both files discovered, unsupported R disclosed |
| Original R1-B2 root prefix + sibling graph queries | COMPLETE in original probes | Alias/target pages equal; dependency query remains valid |
| General alias pathPrefix behaviour | PARTIAL | R2-B1 ancestor prefix |
| R1-M1 stop queued traversal | COMPLETE in actual walker probe | destroy propagated, 70-level chain not fully walked |
| Strict walk/memory bound | PARTIAL | R2-M1 producer buffer |
| Truncation disclosed | COMPLETE | Actual CLI/EP limit=1 probe |
| Extension classification on case-sensitive hosts | CONSISTENT by contract/trace | Registry already case-insensitive; no native-host test |
| Deterministic root ties | COMPLETE by implementation and suite | DG:1305; stable key tie-break |
| VS Code adapter compatibility | INTACT by trace | Pattern/excludes/maxResults forwarding unchanged; no live-host test |
| R4-B1/R4-M1 | COMPLETE in carried repros | Namespace case and EIO probes pass |
| Batch 9/9b and 24r invariants | INTACT in scoped regression suite and trace | No relevant lifecycle/budget change; existing tests pass |
| Claimed three dist-dependent Electron suites | NOT CONFIRMED; explanation partly false | Only stress has that precondition; details below |

## Edge cases

| Case | Result |
| --- | --- |
| Uppercase/mixed-case recognized extension | Included under the registry's existing language policy |
| More discovered files than requested | Returned list bounded, census explicitly truncated |
| Stream shorter than limit | Full result, no fabricated truncation |
| Root-level junction prefix with sibling graph | Original failure fixed |
| Target ancestor of nested alias graph | Clean false negative, R2-B1 |
| Root identity EIO | Unknown unchecked count, unclean |
| Large flat directory | Buffers beyond limit/high-water mark, R2-M1 |
| Deep remaining tree after limit | Cancellation reaches walker and stops queued work |
| macOS case variants / network shares | Existing limitations retained; not independently tested |

## Verification

- Scoped Nx run once, --skip-nx-cache --parallel=2, for test/lint/typecheck on @ptah-extension/{vscode-lm-tools,workspace-intelligence,platform-core,platform-cli,platform-electron}. All ten lint/typecheck targets and three core/service/tool test targets passed: 13 successful tasks. CLI and Electron test targets failed as detailed below; not reported as green.
- ptah-cli and ptah-electron typecheck passed. ptah-electron:validate-deps passed. degradation-audit:lint passed, TOTAL 300. NX_ISOLATE_PLUGINS=false, NX_DAEMON=false.
- Scoped ptah_get_diagnostics returned unavailable after 45 seconds; it was not cancelled. Independent target typechecks are the completed compiler evidence; no diagnostic retry claimed.
- Original r1 namespace/junction probe and actual CLI/EP uppercase probe rerun; all original assertions now hold. Temporary actual-adapter loader was updated only to expose the new real collectBounded export. Carried case and EIO scripts rerun successfully.
- New ancestor-prefix and actual-walker probes are described under the findings. Probes and fixtures are under OS temp, use mkdtemp and do not edit reviewed source. Analysis/parser ports are mocked in graph fixtures; namespace, graph, registry and paginator are real. Walk probe uses the installed real glob/walker. These new fixtures are not a full transport integration run; existing dispatcher suite supplies budget/lifecycle coverage.

### Electron dist claim and observed failures

The author's statement that all three named suites need unbuilt dist apps is not supported:

| Suite | Source evidence | Independent result / interpretation |
| --- | --- | --- |
| workspace-watch-host.stress | workspace-watch-host.stress.harness.ts:72-85 checks dist/apps/ptah-electron/workspace-watch-host.mjs; stress.spec.ts:86 calls it before all tests | File is absent. Three tests fail at the explicit missing-bundle guard. This precondition is independent of findFiles/collectBounded. |
| workspace-watch-host.entry | entry.spec.ts:58-69 builds its own temporary bundle with esbuild from the source entry; :138 calls buildHostBundle | Full run failed waiting 5 seconds for the first burst batch (contract line 333), not because dist is absent. |
| electron-state-storage-worker-host | spec.ts:35 defines InProcessWorker; test setup repeatedly supplies workerFactory, e.g. :362-364 | Passed in the full run (not in its failing-suite list). The claimed missing-dist cause is not reproduced. |

The full Electron run instead had three failing suites: stress (3 failures), entry (1 watcher timeout), and electron-state-storage-legacy-scanner (1 test timeout at spec.ts:182). Totals: 3 failed / 33 passed / 2 skipped suites; 5 failed / 618 passed / 4 skipped / 3 todo tests. The CLI run had one failure in cli-workspace-watcher.spec.ts waiting for delivery after overflow (run-workspace-watcher-contract.ts:420); 14 suites and 224 tests passed, 3 todo. These timeout failures are outside the changed discovery call path. That is evidence of separation, not proof of their exact HEAD behaviour.

Isolated investigation: CLI cli-workspace-watcher passed 13/13. Electron electron-state-storage-worker-host and electron-state-storage-legacy-scanner both passed; workspace-watch-host.entry still failed, this time waiting for the kept file (entry.spec.ts:243, timeout at :117). Electron isolated totals: 2 passed / 1 failed suites, 78 passed / 1 failed tests. This supports a timing-sensitive native watcher problem but does not prove its cause or identical HEAD behaviour. No further reruns were made.

No HEAD checkout/revert/comparison was performed under the role's no-git restriction. Read-only reasoning establishes that the stress missing-bundle precondition would fail without discovery changes too; exact identical HEAD outcomes for timing-sensitive entry/storage/watcher tests are not claimed. Narrow isolated runs were launched to investigate the explanation and load sensitivity, not to erase the initial failures or re-read logs. No build was run to manufacture the missing dist artifact.

Logs: C:/Users/abdal/AppData/Local/Temp/task559-23b-r2-review-{workspace,runtimes,audit,deps}.log; isolated logs use task559-23b-r2-{electron-isolated,cli-isolated}.log. Author's fails-before counts remain reported evidence, not independently reproduced by modifying source.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for original-probe closure, ancestor-prefix failure and real-walker buffering/cancellation evidence; MEDIUM for attributing unrelated timing failures without a clean HEAD run.
- Top risk: widening an equivalent real-path symbol prefix can return a clean empty page despite known exports.
- What a robust implementation would add: canonical ancestor-prefix handling with nested-root regressions, a real producer-buffer bound or explicit limitation, and corrected test-failure attribution.
