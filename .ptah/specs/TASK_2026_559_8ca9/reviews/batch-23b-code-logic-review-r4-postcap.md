# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 23b, post-cap review r4, after the bounded correction. Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`. Source was read-only. Temporary probes used real mkdtemp fixtures and the actual CLI/Electron adapters; no git operations were performed.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 2 |

The exact r3 EIO and ordinary literal-file failures are fixed. Limited-search rejection is compatible with the existing callers' error contracts; I found no new unhandled crash or required partial-success contract lost there. Two independently reproduced gaps remain: a missing workspace root publishes clean, complete empty coverage, and glob-escaped literal path components cause limited searches to miss existing files. The score remains below the sound 7–8 band because both gaps reach user-facing answers, despite passing scoped checks and the corrected main failure paths.

References below are relative to this worktree. Scope includes the complete replacement walker and its tests, adapter routing, namespace/discovery/coverage changes, graph publication, query/paging paths, the reported correction, and every production `findFiles` call site found under apps/libs. Existing task context and authoritative Batch 23b/carried criteria remain the review contract. This review does not request or perform another implementation round.

## r3 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| R3-B1 — opendir EIO produces a clean empty census | FIXED for the reported root/subtree non-ENOENT errors | Walker reports failures; adapters reject with matches and counts; discovery catches the typed error (`analysis-namespace.builders.ts:638`); dispatcher forwards `censusUnknown` (`protocol-dispatcher.ts:2783`); coverage becomes unknown (`graph-coverage.ts:262`). Independent real-adapter root EIO and subtree EIO/EACCES/EPERM probes all return non-clean `census?` coverage. |
| R3-S1 — limited `package.json` search returns no match | FIXED for the exact reported case | `bounded-glob-walk.ts:146` now stats literal files. Both adapters return the same existing file for limited and unlimited `package.json` searches; `.env` also matches. Escaped literal components are a remaining parity gap, R4-S1 below. |

The carried Windows relative/absolute case-variant query probe still returns the expected dependency/dependent edges with stored display spelling. The carried graph-root realpath EIO probe still returns non-clean coverage with `unchecked?`. The real/alias ancestor-prefix repro still returns both expected symbols. The two-root ancestor mapping excludes unrelated `realx` and boundary prefix `real/pk/`. These retain the fixes at `dependency-graph.service.ts:1333` and the symbol filter/paginator at `symbol-index-query.ts:141` (all namespace filenames below reside in the directory identified in the caller table).

## Caller table — limited findFiles rejection

A production search for `.findFiles(` under apps/libs found the following consumers. `NS` means `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`; `MCP` means the adjacent `mcp-core/` directory. `WI` means `libs/backend/workspace-intelligence/src/`.

| Caller / path | Limit and actual error behavior | Assessment |
| --- | --- | --- |
| Graph discovery — `NS/analysis-namespace.builders.ts:631` | Requests limit + 1. Catches only `IncompleteFileSearchError` at :638, keeps matches and returns unreadable counts. Dispatcher `MCP/protocol-dispatcher.ts:2783` passes censusUnknown. Other exceptions reach the existing failed-build path. | Correct for recorded failures. Missing-root ENOENT is never recorded: R4-B1. |
| `ptah_search_files` — `MCP/protocol-dispatcher.ts:939` via `NS/core-namespace.builders.ts:151` | Requests limit + 1. Namespace does not consume the rejection. Dispatcher catches at :2325 and responds `isError:true` at :2346 with the count/code-only error message. Partial matches are not returned. | Compatible with the existing search contract. Before this correction, fast-glob also rejected non-ENOENT failures; this API has no partial-result metadata return type. No evidence supports treating the error as a new caller defect. |
| `execute_code` → `ptah.search.findFiles` — `NS/core-namespace.builders.ts:149` | Defaults to 20. Rejection reaches the host bridge, which serializes `{ok:false,error}` at `MCP/code-execution.engine.ts:249`; sandbox code can catch the rejection. An uncaught execution failure propagates through the execution/tool error handler (:409). Error.matches does not cross this bridge. | Explicit failure, no process crash or clean empty result. Real namespace probe rejected with `IncompleteFileSearchError` and `File search incomplete: 1 path(s) could not be read (EIO 1).` |
| Whole-workspace TS diagnostics — `WI/diagnostics/type-script-diagnostics-provider.ts:374` | Uses maxConfigs. Discovery rejection exits compute/runOnce (:332), is observed by withBudget (:265), and reaches the real awaiter through Promise.race (:281); no available result is cached. `NS/core-namespace.builders.ts:220` propagates it to tool/execute_code error handling. Scoped diagnostics bypass findFiles. | Explicit error, not “no issues found”; no newly unhandled rejection. Discarding partial configs is conservative and consistent with prior fast-glob rejection. |
| Generated citation validation — `libs/backend/agent-generation/src/lib/services/generated-section-validator.ts:408` | Limit 1. Local catch at :418 returns false; the citation is treated as unknown rather than crashing validation. Partial matches in the typed error are not recovered. | Existing documented best-effort behavior; the old rejected glob also took this path. No new supported finding. |
| Workspace indexer — `WI/file-indexing/workspace-indexer.service.ts:646` | Explicitly passes undefined for maxResults, then applies nested-repository filtering. | Not a limited-walker caller. Retains unlimited fast-glob behavior. |
| Context templates — `WI/context/context.service.ts:395,407` | Both calls explicitly pass undefined for maxResults. | Not affected by the new limited rejection. |
| `workspace_analyze` / `ptah.workspace.analyze` — `NS/core-namespace.builders.ts:102` | Delegates to WorkspaceAnalyzerService. Its structure discovery uses readDirectory (`WI/workspace/workspace.service.ts:807,902,936`), not limited findFiles. Optional project-info enrichment is caught; required analysis promises retain their existing propagation. | No new limited-search caller or regression found. |
| VS Code adapter — `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts:170` | Delegates directly to vscode.workspace.findFiles with the supplied limit and RelativePattern. Does not use the new walker. | Unchanged. |

The port explicitly documents rejection on unreadable paths at `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:112`. A richer partial-success API for general search could be useful, but is not an established requirement and is not counted as a defect. Graph discovery is the caller that deliberately translates the typed error into qualified partial results.

## Five logic questions

### 1. How does this fail silently?

The walk suppresses ENOENT without distinguishing a vanished descendant from a missing workspace root (`bounded-glob-walk.ts:142`). Discovery returns a complete-looking empty list; root identity also exempts ENOENT (`dependency-graph.service.ts:214,239`), so graph coverage is clean. R4-B1 gives the complete reproduction.

### 2. What user action produces unexpected behaviour?

An agent searches a route folder with escaped glob metacharacters, such as `src/\[id\]/**/*.ts`. The default-limited search returns no files, while the unlimited adapter finds `src/[id]/page.ts`. This is a normal way to locate literal bracket/parenthesized route folders, not a malformed pattern. See R4-S1.

### 3. What input data produces a wrong answer?

A stale or unavailable workspace root is interpreted as a successfully scanned empty workspace (R4-B1). A valid escaped static pattern/base is interpreted as a filesystem path before unescaping (R4-S1, `bounded-glob-walk.ts:148,166`). Ordinary dotfile, case-sensitive, brace and extglob inputs tested in this review agree with unlimited fast-glob.

### 4. What happens when a dependency fails?

Root/subtree EIO, EACCES and EPERM now produce typed, counted failures (`bounded-glob-walk.ts:140`; CLI adapter :150 and Electron adapter :149), with qualified partial graph coverage. Other callers propagate or explicitly downgrade the error as listed above. Missing-root ENOENT is the outstanding exception. Graph-root realpath EIO qualification is retained independently of discovery.

### 5. What is missing that the requirements never mentioned?

A glob parser's static prefix remains glob syntax, not necessarily a filesystem spelling: escapes must be decoded when traversing or statting it. The new parity table (`bounded-glob-walk.spec.ts:75`) covers ordinary literals and metacharacters as operators, but not literal filenames containing those metacharacters. Root validity also needs a separate rule from benign descendant-deletion races.

## Failure modes / new defects

### R4-B1 — Blocking: nonexistent workspace root is certified as a complete, clean census

- **Trigger:** A session's worktree/root has been removed, renamed or is unavailable, and graph discovery runs against that stale root. This also reproduces with a real nonexistent child of a mkdtemp fixture; no I/O mock is needed.
- **Symptom:** Discovery succeeds with zero files and no unreadable disclosure. The graph publishes `coverage.clean:true`, `census:'complete'`, `reasons:[]`, `unchecked:0`. The result cannot distinguish an unavailable workspace from an empty workspace that was actually examined.
- **Evidence:** `libs/backend/platform-core/src/utils/bounded-glob-walk.ts:142` drops all ENOENT, including initial-root resolution at :193. `NS/analysis-namespace.builders.ts:638` only qualifies a typed rejection, which is never created here. `MCP/protocol-dispatcher.ts:2783` therefore does not set censusUnknown. `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts:214,239` separately considers ENOENT harmless for root identity. Coverage defaults to complete at `graph-coverage.ts:261`.
- **Independent probe:** `%TEMP%/task559-23b-r4-probe.cjs`, fixture `C:/Users/abdal/AppData/Local/Temp/task559-r4-kYcAV8/nonexistent`. Through each real adapter → actual discovery namespace → actual graph service, result is `files:[], truncated:false, limit:50000`, followed by the clean complete coverage above. The probe passes censusUnknown exactly when discovery reports unreadable, matching dispatcher :2783; it is not omitting metadata that the production caller supplies.
- **Current handling:** ENOENT is treated uniformly as a benign race. The graph's existing “absent root has no alias” identity policy does not establish that a census occurred. This is a remaining acceptance gap exposed by the requested root check; it is not claimed to originate solely in the final correction.
- **Recommendation:** Validate the workspace census root separately. An absent/unreadable root should fail discovery/build or publish unknown coverage with an explicit root-unavailable reason. Continue permitting an individual descendant to disappear during an otherwise valid walk, and preserve normal empty answers for a missing literal filename. Do not globally turn every missing static pattern directory into a workspace error. Add end-to-end missing-root and existing-empty-root tests so only the latter is clean.

### R4-S1 — Serious: escaped path components break limited glob searches

- **Trigger:** Search with valid fast-glob patterns such as `src/\[id\]/page.ts`, `src/\[id\]/**/*.ts`, or `src/\(group\)/*.ts`, with a positive result limit. The public search namespace always supplies a limit by default.
- **Symptom:** Both CLI and Electron return `[]` for files that exist. The same adapter without a limit returns the expected file. An agent searching literal route directories receives a false negative.
- **Evidence:** `libs/backend/platform-core/src/utils/bounded-glob-walk.ts:148` resolves the still-escaped literal pattern, and :166 resolves the still-escaped scan.base for dynamic patterns. On Windows backslash escapes become path separators; they are not part of the actual directory name on POSIX either. The resulting nonexistent spelling is swallowed as ENOENT at :142. Entry path: `NS/core-namespace.builders.ts:149-154`; CLI adapter :135 and Electron adapter :133 select the bounded implementation.
- **Independent probe:** The same mkdtemp fixture contains `src/[id]/page.ts` and `src/(group)/page.ts`. `%TEMP%/task559-23b-r4-probe.cjs` compares limited 100 with unlimited for both real providers: each of the three escaped patterns yields limited `[]` and unlimited one correct absolute file. Ordinary package.json, .env, upper-case extension, braces, numeric range, positive/negative extglob and recursive-glob controls agree.
- **Current handling:** picomatch matching is used, but its static pattern/base is passed to filesystem APIs without the unescape step required for literal path components.
- **Recommendation:** Decode glob escapes for the filesystem traversal/stat path while preserving the original escaped matcher semantics. Use the same static-path normalization semantics as the established glob implementation; do not simply remove every backslash. Add escaped literal and escaped static-directory parity cases for brackets and parentheses, relative and absolute patterns, in both adapters and the public search path.

## Blocking issues

R4-B1 above. No additional blocking findings.

## Serious issues

R4-S1 above. No additional serious findings.

## Moderate and minor issues

None newly established. Caller partial-match loss on explicit rejection is recorded in the table, not inflated into a requirement the API never promised.

## Data flow

1. **PARTIAL:** Limited file search selects the new bounded walker (`cli-file-system-provider.ts:135`, `electron-file-system-provider.ts:133`). Ordinary literal parity is fixed, escaped static paths are not (R4-S1).
2. **PARTIAL:** Walker tallies non-ENOENT failures and retains matches; adapters reject with typed metadata. Missing-root ENOENT is still hidden (R4-B1).
3. **OK for recorded failures:** Discovery captures matches/unreadable counts (`analysis-namespace.builders.ts:638`); dispatcher forwards censusUnknown (:2783).
4. **OK:** Service passes censusUnknown into coverage (`dependency-graph.service.ts:475`); coverage prioritizes unknown over truncated/complete (`graph-coverage.ts:262`). Publication and invalidation stay inside the existing generation-fenced synchronous publication section (:452-497).
5. **OK in rerun cases:** Canonical query identity and ancestor-prefix paging still return matching stored paths. Cap and qualification fields survive actual result-budget processing.
6. **OK for caller errors:** Ordinary search/diagnostics rejections reach their existing explicit error handlers; neither a fabricated success nor an unhandled process rejection was identified in the reviewed paths.

## Requirements fulfilment

| Requirement | Status | Evidence / remaining gap |
| --- | --- | --- |
| R3 root/subtree EIO honesty | COMPLETE | Independent root EIO plus subtree EIO/EACCES/EPERM: unknown census, clean false, census? reason. |
| R3 ordinary literal-file search | COMPLETE | package.json and .env limited/unlimited agree on both adapters. |
| Audit all limited-search callers | COMPLETE | Caller table above; no new required-partial-result contract lost. |
| ENOENT at workspace root | MISSING | R4-B1: real missing-root probe still publishes clean complete coverage. |
| Dot/case/brace/extglob parity | PARTIAL | Ordinary classes pass independent comparisons and scoped tests; escaped static components fail (R4-S1). |
| R2 bounded consumption / prefix mapping | COMPLETE in rerun cases | Limit 5 consumes 5 entries and closes its handle; ancestor/two-root/sibling probes pass. Buffer is now bounded at 128 entries per open directory. |
| Carried R4 query case and realpath EIO | COMPLETE | Both carried probes pass. |
| Earlier caps, unsupported-language, resolver qualification, background/generation and paging | COMPLETE in reviewed successful-discovery paths | Scoped graph/namespace/dispatcher suites pass; no new regression found. Missing-root census exception is recorded separately. |
| Budget layer retains qualification | COMPLETE in rerun cases | Dependencies 1,980 tokens; dependents 1,977 tokens; coverage, fileInGraph, cap fields retained and full output spooled. |

## Edge cases

| Case | Handled | Evidence / concern |
| --- | --- | --- |
| Existing root, opendir EIO | YES | Typed error; discovery unreadable count 1; unknown census. |
| Subtree EIO/EACCES/EPERM | YES | Good matches retained; byCode tally survives discovery; graph never clean. |
| Vanished descendant ENOENT | YES by intended policy | Existing regression spec keeps remaining matches without treating the race as a root failure. |
| Missing workspace root | NO | R4-B1. |
| Plain literal relative/absolute path | YES in covered cases | Original literal repro and parity suite pass. |
| Literal bracket/parenthesis path | NO | R4-S1. |
| Case-sensitive extension / dotfile / ordinary braces and extglob | YES in covered cases | Both adapters match their own unlimited behavior. |
| Small cap in a large flat directory | YES | Actual adapter probe consumes 5 entries for 5 results and closes its one handle. |
| Cross-platform filesystem semantics | NOT independently exercised | Runtime probes ran on Windows; no macOS/Linux runtime was used. |

## Verification

- **Scoped Nx**, run once with `NX_ISOLATE_PLUGINS=false`, `NX_DAEMON=false`, skip-nx-cache and parallel=2: test/lint/typecheck for workspace-intelligence, vscode-lm-tools, platform-core, platform-cli and platform-electron. **14 of 15 targets passed.** Only platform-electron:test failed: 35 suites passed, 1 failed, 2 skipped; 638 tests passed, 3 failed, 4 skipped, 3 todo. All three failures are the pre-existing missing stress-host bundle (`platform-electron/src/workspace-watch/workspace-watch-host.stress.harness.ts:81`). No entry/storage timeout occurred in this review run. Log: `%TEMP%/task559-23b-r4-review-workspace.log`.
- **Runtime typechecks:** ptah-cli and ptah-electron passed. **validate-deps:** passed. **Degradation audit:** passed, TOTAL 300. Logs: `%TEMP%/task559-23b-r4-review-{runtimes,deps,audit}.log`.
- **ptah_get_diagnostics:** scoped to walker and analysis namespace; returned unavailable after its 45-second budget, with the compiler continuing. It was not repeatedly polled. The independent scoped Nx typecheck targets passed; the unavailable diagnostics response is not represented as a clean diagnostics result.
- **Independent probes:** `%TEMP%/task559-23b-r4-probe.cjs` (parity, subtree failures, missing root); `%TEMP%/task559-23b-r4-root-eio.cjs` (original root EIO and actual public search rejection); carried r4 case/EIO and namespace probes; r2 ancestor-prefix repro; r3 bounded-consumption/multiple-root probe; real result-budget probe. Fixtures were real temporary directories, with junctions for alias checks. Graph parsing was stubbed only where the behavior under test was discovery/identity/accounting. A syntax error in the initial temporary root-probe assembly was corrected before its successful run; it affected no source file or conclusion.
- The author's expanded parity tables ran as part of the scoped checks. Independent tests added escaped-path cases absent from those tables and reproduced the new defect. No suite was rerun merely to recover its output, and no source edits or artifact builds were made to hide the missing stress-test prerequisite.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: an unavailable workspace can still be presented as a successfully examined, clean empty graph.
- What a robust implementation would add: a workspace-root availability rule separate from descendant ENOENT races, correct filesystem decoding of escaped glob components, and regression tests covering both without undoing the corrected failure tally, bounded walk and ordinary literal support.
