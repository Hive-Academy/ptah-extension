# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 23b, FINAL review r5 under User Decision 23. Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-h`. Source remained read-only; probes and fixtures were confined to the OS temp directory. No git operations or commits were performed.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 2 |

The exact r4 missing-root graph and escaped-pattern probes now pass. The bounded walker correctly rejects a root already missing at its stat check, and escaped bracket/parenthesis patterns agree with unlimited searches. The requested audit of other callers exposes an existing root-honesty gap outside that bounded branch: unlimited searches and the actual workspace indexer still return an undisclosed empty success for a missing root. A narrower stat/open race also remains in the bounded path. These are recorded for the Decision 23 carry-forward, not as a request to start another review round.

The score reflects functional graph qualification, matching, caps and query identity, but remains below 7–8 because a real consumer still receives a success-looking empty index for an unavailable workspace. The unlimited defect is explicitly pre-existing behavior left outside the narrow fix; it is not attributed to a regression introduced by that fix.

All file references are relative to the worktree unless stated otherwise. `NS` abbreviates `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`; `MCP` is the adjacent `mcp-core/` directory; `WI` is `libs/backend/workspace-intelligence/src/`.

## r4 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| R4-B1 — nonexistent root yields clean empty graph | Exact reproduction FIXED; broader root invariant PARTIAL | `platform-core/src/utils/bounded-glob-walk.ts:157` now stats cwd, reports every stat error and rejects non-directories. Both real adapters now return ENOENT unreadable metadata from discovery; the graph reports `clean:false`, `census:'unknown'`, reason `census?`. Dispatcher specs at `MCP/protocol-dispatcher.spec.ts:1317` cover count 0 / fileInGraph false for both graph tools. Remaining paths are R5-B1 and R5-M1 below. |
| R4-S1 — escaped path components fail only with limit | FIXED in the reported cases | Walker :174 decodes only the static filesystem path; matcher keeps escaped syntax. Independent probes for `src/\[id\]/page.ts`, `src/\[id\]/**/*.ts`, and `src/\(group\)/*.ts` now match unlimited fast-glob in both real adapters. The expanded relative/absolute parity table is in the walker spec :101 and onward. |

## Five logic questions

### 1. How does this fail silently?

Unlimited adapter calls bypass root validation (`platform-cli/src/implementations/cli-file-system-provider.ts:155-156`, Electron equivalent :153-154). A missing root still yields `[]`, which `WI/file-indexing/workspace-indexer.service.ts:385` returns as a successful zero-file index. R5-B1 includes the independent reproduction.

### 2. What user action produces unexpected behavior?

A session retains the path of a removed or renamed worktree and requests indexing. Limited search now errors honestly, but indexing uses an unlimited search (`workspace-indexer.service.ts:646`) and succeeds empty. A root renamed between stat and opening it can also produce clean graph coverage (R5-M1).

### 3. What input data produces a wrong answer?

A missing cwd with no maxResults follows the unvalidated fast-glob branch and produces an undisclosed empty answer (R5-B1). The previously problematic escaped route folder names now return the same files with and without limits; ordinary literal, dotfile, case, brace and extglob controls continue to agree in the independent parity probe.

### 4. What happens when a dependency fails?

A root stat error is now always reported (`bounded-glob-walk.ts:162`); root/subtree EIO, EACCES and EPERM continue to produce typed failures and unknown graph coverage. ENOENT after the initial root stat is still unconditionally dropped by :150, including when the failing directory is cwd itself (:223-231), which is R5-M1. Existing dispatcher/execute_code handlers receive search rejections rather than crashing.

### 5. What is missing that the requirements never mentioned?

The root-availability rule must be shared across limited and unlimited searches, and remain true through the actual root-open operation. An upfront stat in one branch does neither universally. The user now explicitly requires root honesty for other findFiles callers, so this is a contract-completeness issue, not a proposal to redesign indexing or add new partial-result APIs.

## New defects / failure modes

### R5-B1 — Blocking: unlimited searches still certify a missing workspace as an empty index

- **Trigger:** A caller omits maxResults and supplies a root that no longer exists, for example a stale session worktree path. The workspace indexer does exactly this; context template calls also omit the limit.
- **Symptom:** Both adapters resolve to `[]` instead of failing or disclosing that the workspace was unavailable. `indexWorkspace` returns `{files:[], ignoredPatterns:[], totalFiles:0, totalSize:0}` with no error or qualification. The consumer cannot distinguish the result from a successfully examined empty workspace.
- **Evidence:** `libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts:134-156` and `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:132-154`: root validation exists only inside walkGlobMatches, which these methods use only for positive maxResults; the unlimited fast-glob branch bypasses it. `WI/file-indexing/workspace-indexer.service.ts:646` explicitly passes undefined for the limit and :385 returns the resulting empty index normally. Its initial check at :287 only checks that a path string was supplied. `ignore-pattern-resolver.service.ts:202` checks individual ignore files, not root availability, so it is not a root-validation substitute.
- **Independent proof:** `%TEMP%/task559-23b-r5-callers.cjs` creates a mkdtemp parent and never creates its `gone` child. For each actual CLI/Electron adapter, `findFiles('**/*', undefined, 20, missing)` rejects with `IncompleteFileSearchError (... ENOENT 1)`, while the same call with undefined maxResults resolves `[]`. Calling the actual WorkspaceIndexerService.indexWorkspace with that adapter, `workspaceFolder:missing` and `respectIgnoreFiles:false`, returns the zero-file index above. That last option removes any dependency on the probe's ignore-parser stub. Unused parsing/classification collaborators are stubbed; the search and index-return implementations are real.
- **Current handling:** None on the unlimited path. This behavior predates the narrow correction, but remains a demonstrated violation of this review's requested root-honesty criterion for other callers.
- **Recommendation / Batch 25a carry-forward:** Apply a common root-availability policy before both bounded and unlimited searches, or ensure every unlimited caller validates the root and propagates its failure. Preserve ordinary empty results for a missing literal file under an existing root. Pin an indexer-level missing-root regression alongside bounded/unbounded adapter tests. Do not silently replace an unavailable index with a successfully empty one.

### R5-M1 — Moderate: root disappearance after stat still publishes clean coverage

- **Trigger:** The root passes the new stat check and is renamed/removed before the walker resolves or opens it. This requires a timing-dependent transition during an active scan.
- **Symptom:** Discovery returns `files:[], truncated:false` with no unreadable metadata; building that result yields `census:'complete', clean:true, reasons:[]`, although the root could not be walked.
- **Evidence:** `libs/backend/platform-core/src/utils/bounded-glob-walk.ts:157` checks first, then :223 resolves the root in a later await. Its catch calls failed at :231, whose unconditional ENOENT exemption is at :150. There is no distinction between cwd failing here and a descendant vanishing. `WI/ast/dependency-graph.service.ts:214,239` also treats an absent root as having no alias, so it does not qualify this result through root-identity uncertainty.
- **Independent proof:** `%TEMP%/task559-23b-r5-race.cjs` wraps stat only to schedule a real rename of its temporary cwd immediately after the successful native stat result. The move stays within the probe's mkdtemp parent; the subsequent filesystem operations are real. Both adapters report `renamed:true, rootExists:false`, followed by the clean complete graph above. The second fault-injection variant in r5-callers.cjs produces the same result by making root opendir return ENOENT after stat.
- **Current handling:** The comment says ENOENT is exempt only below the root, but the actual failure helper has no path/scope parameter. The initial check closes the persistent-missing-root case, not this race.
- **Recommendation / Batch 25a carry-forward:** When the directory that failed is cwd itself, report ENOENT as an incomplete root census even after an earlier stat succeeded. Keep descendant ENOENT benign. Add a root-removal-between-stat-and-open test. Moderate rather than release-blocking on its own because it needs the narrow filesystem timing window; the deterministic unlimited-path finding already decides the verdict.

## Blocking issues

R5-B1 above: the requested other-caller audit reveals a real, success-looking empty index for an unavailable root.

## Serious issues

None separately established.

## Moderate and minor issues

R5-M1 above. No style or speculative findings are included.

## Root-failure caller audit

| Caller | Result under the narrow fix | Evidence |
| --- | --- | --- |
| Graph discovery and both graph query tools | Already-missing/file/unreadable root is qualified; root-open race remains. | `NS/analysis-namespace.builders.ts:638`, `MCP/protocol-dispatcher.ts:2783`, walker :157; R5-M1. |
| ptah_search_files | Uses limit + 1, therefore already-missing root rejects honestly; outer handler returns isError true. | `MCP/protocol-dispatcher.ts:939,2325,2346`; `NS/core-namespace.builders.ts:151`. |
| execute_code ptah.search.findFiles | Defaults to 20, so missing-root rejection propagates; sandbox may catch it. | `NS/core-namespace.builders.ts:149`; `MCP/code-execution.engine.ts:249,409`. |
| Whole-workspace diagnostics | Uses maxConfigs; a root search failure rejects rather than becoming “no issues.” Retained run is observed and not cached as available. | `WI/diagnostics/type-script-diagnostics-provider.ts:265,332,374`; `NS/core-namespace.builders.ts:220`. |
| Generated citation validator | Limited best-effort probe catches failure and treats citation as unknown; existing behavior, no process crash. | `libs/backend/agent-generation/src/lib/services/generated-section-validator.ts:408,418`. |
| Workspace indexer and path discovery | Unlimited; missing root still succeeds empty. | `WI/file-indexing/workspace-indexer.service.ts:385,552,646`; R5-B1. |
| Context templates | Unlimited calls bypass the fix; no new root check at these call sites. | `WI/context/context.service.ts:395,407`; same adapter gap as R5-B1, not counted twice. |
| workspace_analyze | Uses WorkspaceAnalyzerService/readDirectory rather than the new limited walker; not changed by this narrow correction. | `NS/core-namespace.builders.ts:102`; `WI/workspace/workspace.service.ts:807,902,936`. |
| VS Code adapter | Still delegates to native workspace.findFiles; the narrow fix does not change this family. | `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts:170`. |

## Data flow

1. **PARTIAL:** Adapter chooses bounded versus unlimited search. Root guard applies only to the bounded branch (R5-B1).
2. **OK for stable roots:** Walker validates cwd and decodes static glob syntax for filesystem operations; matching keeps escaped pattern semantics (:157,174).
3. **PARTIAL:** Failure tally carries non-benign errors to IncompleteFileSearchError, but root ENOENT after stat is lost (:150,231; R5-M1).
4. **OK for reported failures:** Namespace preserves partial matches/unreadable counts; dispatcher passes censusUnknown; graph coverage prioritizes unknown (`NS/analysis-namespace.builders.ts:638`, `MCP/protocol-dispatcher.ts:2783`, `WI/ast/graph-coverage.ts:262`).
5. **OK in rerun paths:** Generation fencing, graph/coverage publication, case-normalized queries, alias-prefix selection, symbol paging and result-budget qualification remain intact (`dependency-graph.service.ts:452-497,1333`; `NS/symbol-index-query.ts:141`).

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Exact R4-B1 missing-root graph probe | COMPLETE | Both adapters now disclose ENOENT; census unknown, clean false, reason census?. |
| Exact R4-S1 escaped patterns | COMPLETE | All independent bounded/unlimited escaped comparisons agree; scoped parity tests include relative/absolute cases. |
| Root failure honest for all findFiles callers | PARTIAL | R5-B1 unlimited indexer/context path; R5-M1 root-open race. |
| Original EIO and literal fixes | COMPLETE in rerun cases | Root EIO and subtree EIO/EACCES/EPERM stay non-clean; ordinary literal parity retained. |
| Earlier fair/census/edge bounds and unsupported/resolver disclosure | COMPLETE in reviewed successful-discovery paths | Existing scoped graph/namespace/dispatcher checks retained; new source change is confined to walker. |
| R2 ancestor-prefix and bounded consumption | COMPLETE in rerun cases | Both ancestor spellings return expected symbols; unrelated roots excluded; limit 5 consumes 5 entries and closes handle. |
| Carried 23a R4 Windows case and root-realpath EIO | COMPLETE | Relative/absolute/separator variants return stored paths; realpath EIO retains unchecked? qualification. |
| Real token-budget layer | COMPLETE in rerun cases | Dependency answer 1,978 tokens; dependent answer 1,979; coverage, fileInGraph and cap fields retained, full output spooled. |

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Root already absent with a limit | YES | Typed ENOENT failure, graph census unknown. |
| Root is a file / stat EACCES/EPERM/EIO | YES in scoped specs | Reported before matching; non-directory reason ENOTDIR. |
| Root absent without a limit | NO | R5-B1. |
| Root disappears after initial stat | NO | R5-M1. |
| Missing descendant or literal file in a valid root | YES by intended policy | Remains an ordinary absence; do not break this when fixing root scope. |
| Escaped bracket/parenthesis static paths | YES in reported cases | Bounded/unlimited parity restored. |
| Large flat directory with small limit | YES in rerun fixture | Five entries consumed; one handle opened/closed; buffer bounded at 128. |
| Per-volume macOS case semantics / non-Windows execution | NOT independently exercised | Existing platform limitation; no new finding inferred. |

## Verification

- **Scoped Nx, run once:** test/lint/typecheck for workspace-intelligence, vscode-lm-tools, platform-core, platform-cli and platform-electron; skip-nx-cache, parallel=2, NX_ISOLATE_PLUGINS=false, NX_DAEMON=false. **14 of 15 targets passed.** Only platform-electron:test failed: 33 suites passed, 3 failed, 2 skipped; 643 tests passed, 5 failed, 4 skipped, 3 todo. The failures were the missing stress-host bundle (3 tests), electron-state-storage-worker-host (1), and workspace-watch-host.entry (1). The latter suites exhibit the timing failures recorded in preceding rounds; no new walker/adapter parity failure occurred. These failures are not claimed as a green full test run. Log: %TEMP%/task559-23b-r5-review-workspace.log.
- **Runtime typechecks:** ptah-cli and ptah-electron passed. **validate-deps:** passed. **Degradation audit:** passed, TOTAL 300. Logs: %TEMP%/task559-23b-r5-review-{runtimes,deps,audit}.log.
- **Scoped diagnostics:** ptah_get_diagnostics on bounded-glob-walk.ts returned TypeScript compiler diagnostics available, 0 errors and 0 warnings.
- **Independent behavior:** exact r4 parity/missing-root probe; root/subtree EIO/EACCES/EPERM; actual limited/unlimited adapters and indexWorkspace; root rename after stat; carried query-case and graph-root-realpath EIO; real/alias ancestor prefix; two-root/sibling exclusion; 2,000-file limit-5 consumption/handle close; actual token-budget reduction. The reported escaped comparisons have no mismatches in either adapter.
- Probe artifacts: %TEMP%/task559-23b-r4-probe.cjs, task559-23b-r4-root-eio.cjs, task559-23b-r5-callers.cjs, task559-23b-r5-race.cjs, plus the retained earlier identity/ancestor/bounds/budget probes. All use temporary roots. The race probe performs a real rename only inside its own temporary fixture, at an injected scheduling point after native stat. Source files were never renamed or edited.
- The walker and its expanded specs were read in full across the review and its inherited rounds; the narrow change and downstream root-failure paths were inspected directly. Graph parsing is stubbed in filesystem/identity/accounting probes; the real namespace, graph service, adapters and budget implementations are used. The indexer probe uses the actual indexWorkspace method with respectIgnoreFiles:false so its result does not depend on a stubbed ignore parser.
- Limitations: no Linux/macOS runtime or cross-volume benchmark was performed; Electron's full test run remains failed as described. No commits, source edits, status changes or builds to manufacture the missing stress artifact were performed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: an unlimited caller can still treat a missing workspace as a successfully examined empty index.
- What a robust implementation would add: one root-availability policy covering both adapter branches and actual root-open failures, pinned by indexer-level and root-disappearance regressions.
- Decision 23 disposition: record R5-B1 and R5-M1 as known issues carried into Batch 25a if committing this batch under the user's instruction. This review does not perform the commit or alter batch status.
