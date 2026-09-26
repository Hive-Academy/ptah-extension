# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value                                                       |
| ------------------- | ----------------------------------------------------------- |
| Overall score       | 5/10                                                        |
| Assessment          | NEEDS_REVISION                                              |
| Requested verdict   | REVISE                                                      |
| Blocking issues     | 1 (pre-existing completeness defect, escalated)             |
| Serious issues      | 2 (one Batch 9 defect, one pre-existing latency escalation) |
| Moderate issues     | 0                                                           |
| Failure modes found | 3                                                           |

Independent Batch 9 review, 2026-09-26. The paging implementation works for entries that individually fit. It does not fulfil the valid-JSON requirement for an oversized entry. The measurement also invalidates the previous assumption that cold dependency tools merely have tolerable first-call latency. Counts above include explicitly requested judgments of existing defects; they are not claims that Batch 9 introduced them.

Score rationale: deterministic paging, validation, overload compatibility and scoped checks provide evidence above the 3–4 band. The broken oversized-entry contract and unresolved runtime completeness/latency gaps prevent the 7–8 band. This is a revision verdict, not approval of unrelated code in the large shared files.

Evidence paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. For compactness, `CE/` means `libs/backend/vscode-lm-tools/src/lib/code-execution/`, and `TASK/` means `.ptah/specs/TASK_2026_559_8ca9/`.

## Five logic questions

### 1. How does this fail silently?

The initial graph enumerates only 5,000 files (`CE/mcp-core/protocol-dispatcher.ts:2301`), but the page exposes no graph-completeness indicator (`CE/namespace-builders/symbol-index-query.ts:148`). The executor measured 5,354 candidates and 5,000 graph nodes (`TASK/batch-9-executor-report.md:116`). A prefix matching only an excluded file produces a successful empty page. `total` correctly counts the filtered _available index_; it cannot establish workspace completeness. See B1.

### 2. What user action produces unexpected behaviour?

Calling the symbol tool on a barrel exporting 1,500 symbols returns truncated, unparsable text while advertising the page shape and continuation protocol (`CE/mcp-core/protocol-dispatcher.ts:2341`, `CE/mcp-core/tool-description.builder.ts:1851`). The existing test explicitly accepts that cut (`CE/mcp-core/protocol-dispatcher.spec.ts:3539`). See S1.

The first valid call to any of the three dependency tools waits for the full cold graph build (`CE/mcp-core/protocol-dispatcher.ts:1960`, `:1983`, `:2134`). On the measured worktree, a client with a 60-second timeout cannot receive the result in time. See S2.

### 3. What input data produces a wrong answer?

Files beyond the graph's 5,000-file selection are invisible to both symbol discovery and dependency traversal (B1). An oversized symbol list breaks response parsing (S1).

For a fixed, complete input index, no paging skip/duplicate defect was reproduced. An independent in-memory run using the actual parser, pager, extracted renderer and actual budget predicate visited 3,000 unique files in exact sorted order across 397 early-ended pages. `offset + kept` is used consistently (`CE/mcp-core/protocol-dispatcher.ts:2331`), and the final page omits `nextOffset` (`:2336`).

### 4. What happens when a dependency fails?

An unresolved graph-build promise leaves `ensureDependencyGraphBuilt` unresolved; an in-memory controlled-promise reproduction confirmed this (`CE/mcp-core/protocol-dispatcher.ts:2309`). The HTTP handler awaits the tool before writing a response (`CE/mcp-http/http-server.handler.ts:383`). There is no graph-specific deadline, progress response or cancellation parameter on this path. The slow warning is emitted only after dispatch finishes (`CE/mcp-core/protocol-dispatcher.ts:701`, `:712`).

For the oversized-entry reproduction, forcing the spool destination to an unavailable drive still produced a bounded trailer and text, but not valid JSON. This exercises the actual `applyToolResultBudget`; spool failure does not repair S1 (`CE/mcp-core/tool-result-budget.ts:215`).

### 5. What is missing that the requirements never mentioned?

The page needs a defined oversized-file representation that is both bounded and lossless through a retrievable reference or subcursor. Keeping one full entry and then cutting its serialized JSON cannot meet both limits (`CE/mcp-core/protocol-dispatcher.ts:2322`).

The graph needs completeness metadata (B1) and a client-visible build state (S2). Snapshot/version semantics across mutations are unspecified: offset paging is stable for a fixed index, but the implementation recomputes the filtered sorted set on each call (`CE/namespace-builders/analysis-namespace.builders.ts:423`). No mutation-based defect is claimed from this observation.

## Failure modes

### F1 — Oversized entry breaks the page envelope (Serious, introduced in the new paging contract)

- Trigger: one indexed file exports enough symbols to exceed 2,000 tokens or 8,000 characters by itself.
- Symptom: the tool returns a cut JSON prefix plus a text trailer; parsing fails and no complete file entry is available inline.
- Evidence: `CE/mcp-core/protocol-dispatcher.ts:2341`, `:2355`, `:2400`; `CE/mcp-core/tool-result-budget.ts:89`; `CE/mcp-core/protocol-dispatcher.spec.ts:3539`.
- Current handling: retains at least one entry, puts continuation fields first, then invokes generic cut/spool handling.
- Reproduction: extracted the actual `renderSymbolIndexPage` function using the TypeScript AST, supplied a two-file page whose first file has `HugeExport0` through `HugeExport1499`, and passed its text through the actual budget module. Raw page: 24,485 characters. Returned text: 7,665 characters; `truncated: true`; `JSON.parse` failed. The continuation prefix survived. This was an in-memory harness, not a live MCP client call; it used no source edits.
- Recommendation: serialize a bounded valid JSON page, keeping one file record with explicit overflow metadata and a recoverable reference/subcursor for its symbols. Handle spool failure explicitly inside that envelope. Add a regression asserting JSON parsing and recoverability, including an oversized final entry.

### F2 — Cold graph blocks the MCP response past the client deadline (Serious, existing; separate escalation below)

- Trigger: valid first dependency/symbol call when this workspace graph is not built.
- Symptom: no tool result before a 60-second client deadline on the reported 225-second workload.
- Evidence: `CE/mcp-core/protocol-dispatcher.ts:1960`, `:1983`, `:2134`, `:2309`; `CE/mcp-http/http-server.handler.ts:383`; `TASK/batch-9-executor-report.md:123`.
- Current handling: await the complete build; publish graph only after parsing/edge construction. `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts:164` awaits each chunk and `:207` publishes the final graph.
- Reproduction/evidence distinction: independently confirmed the pending-promise blocking mechanism. The 225,040 ms measurement is executor evidence from this worktree, not a timing run repeated by this reviewer. Its Jest/shared-machine caveats remain applicable. No live timeout was induced here.
- Recommendation: escalate for a bounded response and governed asynchronous/off-thread build with per-workspace in-flight state; return explicit building/unavailable status and a retry path. Do not move the same synchronous parsing workload into `tools/list`.

### F3 — File cap makes incomplete graph results look complete (Blocking, existing; requested out-of-scope judgment)

- Trigger: more than 5,000 matching source files.
- Symptom: excluded files cannot be found by any page or prefix, and missing dependency relations look like genuine absence.
- Evidence: `CE/mcp-core/protocol-dispatcher.ts:2301`; `CE/namespace-builders/core-namespace.builders.ts:151`; `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:134`; `CE/namespace-builders/symbol-index-query.ts:151`; `TASK/batch-9-executor-report.md:116`.
- Current handling: provider slices the glob results; the dispatcher receives no omitted-count signal. Paging then operates only on that truncated graph.
- Reproduction/evidence distinction: the executor's real cold run measured 354 omitted candidate files. Source inspection confirms the exact cap mechanism. This does not establish that all 354 contain exports, nor that a particular omitted file has import edges; no such claim is made.
- Recommendation: enumerate the full graph input or disclose the cap and incomplete status in all three tool results. Narrowing the output prefix cannot recover files that were never graphed.

## Blocking issues

### B1 — Undisclosed graph incompleteness

- File: `CE/mcp-core/protocol-dispatcher.ts:2301`.
- Scenario: the measured 5,354-file workspace is capped at 5,000 before graph construction.
- Impact: callers can mistake incomplete symbol/dependency searches for exhaustive absence. Blocking severity follows the review rubric's silent misleading result definition; this is a pre-existing escalation, not a new paging regression.
- Fix: expose incompleteness and avoid treating capped negative answers as authoritative; separately plan full graph coverage.

## Serious issues

### S1 — Oversized file defeats valid JSON and complete entry delivery

- File: `CE/mcp-core/protocol-dispatcher.ts:2341`.
- Scenario: one entry alone exceeds the budget.
- Impact: a page consumer cannot parse the advertised result. Reading an intact `nextOffset` from a broken prefix skips inline access to the rest of that file's symbols unless the consumer separately recovers the spool.
- Fix: a bounded JSON overflow envelope with a recoverable full entry; replace the prefix-only assertion at `CE/mcp-core/protocol-dispatcher.spec.ts:3548` with parsing, complete-envelope and recovery assertions.

### S2 — Unbounded awaited cold build

- File: `CE/mcp-core/protocol-dispatcher.ts:2309`.
- Scenario: any first `ptah_get_symbol_index`, `ptah_get_dependents` or `ptah_get_dependencies` call on the measured cold workspace.
- Impact: client timeout rather than a usable result; a truthful description saying “minutes” cannot extend the client deadline.
- Fix: the bounded build-state response described in F2. Scope approval belongs to the orchestrator; measurement-only Task 9.2 was followed correctly.

## Moderate and minor issues

No additional moderate defect established.

- Minor documentation drift: `CE/ptah-system-prompt.constant.ts:76` says “no parameters”. The new schema contradicts that (`CE/mcp-core/tool-description.builder.ts:1857`), although a no-argument call remains supported. Respect the frozen-constant instruction and record a follow-up; do not silently edit it in this batch.
- Minor discoverability omission: `CE/namespace-builders/system-namespace.builders.ts:328` lists only `getSymbolIndex()`. That invocation is still valid, so this is incomplete help rather than a broken API. Document the second argument when the help surface is next updated.

## Data flow

1. MCP arguments → fixed-message parser before graph work: OK. Bounds, safe offsets, traversal segments and drive-relative prefixes are rejected (`CE/namespace-builders/symbol-index-query.ts:50`, `:62`, `:78`, `:84`; dispatcher `:2130`). Independent invalid-input probes passed.
2. Ensure graph → await capped discovery/build: B1/S2 (`CE/mcp-core/protocol-dispatcher.ts:2301`, `:2309`).
3. Namespace → flatten cached graph: unchanged old-array branch retained (`CE/namespace-builders/analysis-namespace.builders.ts:383`, `:412`).
4. Filter → case-aware prefix → path sort → slice: OK for a fixed set (`CE/namespace-builders/symbol-index-query.ts:134`, `:138`, `:145`). Prefix semantics are string-prefix semantics as advertised, not directory-boundary semantics.
5. Renderer → recompute count/continuation: OK for individually fitting entries (`CE/mcp-core/protocol-dispatcher.ts:2331`).
6. Global preformatted budget → unchanged fitting JSON, otherwise generic cut: S1 (`CE/mcp-core/tool-result-budget.ts:89`; dispatcher `:2440`).
7. HTTP response follows completion: S2 (`CE/mcp-http/http-server.handler.ts:383`).

## Requirements fulfilment

| Requirement                                                            | Status                          | Gap                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Stable ordering, filtered total, continuation and final page           | COMPLETE for a fixed index      | 3,000-file / 397-page independent coverage passed; graph completeness is separately limited                                              |
| Budget-shortened pages recompute count/nextOffset                      | COMPLETE                        | Actual renderer traversal found no skip or duplicate                                                                                     |
| At least one complete entry and valid JSON when one entry is oversized | PARTIAL                         | Retained before budget processing, cut afterward: S1                                                                                     |
| Input types/bounds, traversal and path handling                        | COMPLETE for specified cases    | Parser/source and suite cover Windows/UNC folding and POSIX exact matching; null means omitted by explicit implementation policy         |
| Old execute_code root-only array contract                              | COMPLETE                        | Runtime branch `analysis-namespace.builders.ts:412`; overloads `types.ts:824`; regression spec `analysis-namespace.builders.spec.ts:682` |
| Default limit 30 and truthful concise description                      | PARTIAL                         | Defaults and budget are accurate; unconditional page-shape claim fails S1                                                                |
| Batch 2e/2f fit test and preformatted hint                             | COMPLETE mechanically           | The oversized-entry escape branch still reaches generic cut                                                                              |
| Batch 4 server instructions                                            | COMPLETE for routing            | `server-instructions.ts:6` derives tool substitutions; paging does not change the symbol-discovery tool name                             |
| Task 9.2 measurement with no pre-warm changes                          | COMPLETE as scoped              | Measured result requires escalation, not a “works” runtime conclusion                                                                    |
| Frozen constants / LSP and enrich blocks unchanged                     | NOT independently diff-verified | Executor reports no changes; reviewer performed no git operations under role restriction                                                 |

Implicit requirements not addressed: bounded build-state handling and honest graph completeness, as escalated above. No snapshot-consistency promise is inferred.

## Edge cases

| Case                                                 | Handled | How                                      | Concern                                            |
| ---------------------------------------------------- | ------- | ---------------------------------------- | -------------------------------------------------- |
| Empty/missing prefix, no matches                     | YES     | Empty page, total 0, no next offset      | Graph omission can mimic no matches                |
| Offset at/past end                                   | YES     | Empty page, no next offset               | None on a fixed set                                |
| Negative/fractional/string/out-of-range inputs       | YES     | Fixed errors before graph build          | No input echo found                                |
| Windows separators, absolute, UNC, relative prefixes | YES     | Normalize and fold Windows case          | Tested by scoped suite                             |
| POSIX case distinction                               | YES     | Exact comparison                         | Tested by scoped suite                             |
| Budget early end                                     | YES     | Recompute continuation from kept entries | Independent full traversal passed                  |
| One oversized file, including last file              | NO      | Generic cut/spool                        | S1; final page has no recovery offset for the file |
| Cold or unresolved graph build                       | NO      | Awaited without bounded state response   | S2                                                 |
| More than 5,000 candidates                           | NO      | Provider cap                             | B1                                                 |

## Deviations and structure

The new `symbol-index-query.ts` is a coherent parser/pager with only Node path and type imports (`:9`), avoiding the runtime service barrel in `analysis-namespace.builders.ts:9`. The `types.ts:824` overload is necessary to preserve the public contract. Neither change creates a cross-library deep import or a replacement public facade.

Lowering 200 to 30 is explicitly permitted by `TASK/batches.md:1870`; measurements at `TASK/batch-9-executor-report.md:45` justify it. Shared constants feed the parser and description. Early budget-aware page termination is justified by the shared-budget risk at `TASK/batches.md:86`, but its single-entry exception is not an acceptable substitute for valid JSON.

Retaining the merged-index behavior with an omitted root is consistent with the stated compatibility decision (`CE/types.ts:819`; dispatcher `:2135`). No workspace-isolation change was required here.

No `task-description.md`, `implementation-plan.md` or existing `code-style-review.md` was present in the task folder; this task is explicitly plan-free (`TASK/batches.md:13`). No applicable AGENTS.md was discovered in the worktree search. No direct Ptah file-read tool was listed, so native reads were used. No reviewed source or frozen constant was edited. Git status/diff verification was not performed because this review role forbids git operations; untouched-file claims therefore remain executor evidence, not independently verified history.

## Separate escalation note — Task 9.2 cold latency

The measurement is **serious tool degradation**, not just token-cost overhead: 225,040 ms is 3.75 times the stated client timeout (`TASK/batch-9-executor-report.md:123`). The actual call chain waits for the graph before replying, and the HTTP path offers no interim result. The independent controlled-promise probe confirms that waiting mechanism. This establishes the impact conditional on the measured build time; it does not claim every machine or client takes exactly 225 seconds.

Task 9.2 explicitly says “no pre-warm code” (`TASK/batches.md:1880`), so the executor correctly did not invent a runtime scheduling change. However, the plan risk says pre-warm stays out of scope **unless the measurement shows the client times out** (`TASK/batches.md:96`). That threshold has been crossed for a 60-second client. Escalate a governed background/off-thread build and bounded response contract for all three tools; do not mark their first-call behavior healthy merely because measurement-only work is complete. B1 should accompany that follow-up so faster answers do not remain silently incomplete.

## Verification and limits

- Requested `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`: PASS, all three targets; run duration 25.7 s.
- Requested `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: PASS; run duration 9.7 s.
- `ptah_get_diagnostics` scoped to the new query file: TypeScript compiler reports 0 errors / 0 warnings.
- In-memory actual-code probes: exact 3,000-file coverage across 397 pages; invalid-input rejection; oversized JSON failure; unresolved build blocks completion.
- Inspected complete parser/pager and namespace implementation, associated paging/spec/type contracts, dispatcher call/render/budget/transport paths, service graph-build path, requested task evidence and server-instructions builder. Large shared files were reviewed at the relevant paths; unrelated implementations are not approved by this report.
- The cold measurement and file count are attributed to executor evidence; no new 225-second run, live client timeout, or raw session-log inspection was performed. No raw `.jsonl` or `.sqlite` logs were read.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for S1 and fixed-index paging; MEDIUM for exact production cold duration (executor measurement, runtime caveats).
- Top risk: callers receive either unparsable pages or authoritative-looking answers from an incomplete graph.
- What a robust implementation would add: bounded valid-JSON oversized-file recovery; parse/recovery regression coverage; explicit graph completeness; bounded build status with governed background/off-thread construction and in-flight coordination.
