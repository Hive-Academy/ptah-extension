# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Requested verdict   | REVISE         |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 1              |
| Failure modes found | 1              |

Post-cap independent review r3, Batch 9, 2026-09-26. The bounded correction fixes all three original r2 reproductions. One related, reproduced edge remains: an exceptionally long dependency query path can consume the inline budget before the cap fields. Cold-build blocking is excluded by User Decision 14 and does not influence this verdict.

Score rationale: correct ordinary paging, repaired cross-root routing, valid oversized-symbol envelopes and six passing project targets support the sound 7–8 band. The remaining mandatory-disclosure edge prevents 8; it does not justify the broad functional-gap 5–6 band. This review is scoped to Batch 9 paths and contracts, not approval of unrelated implementations in shared files.

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. `CE/` means `libs/backend/vscode-lm-tools/src/lib/code-execution/`; `DG` means `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`; `TASK/` means `.ptah/specs/TASK_2026_559_8ca9/`.

## Prior findings: r1 and r2

| Finding                                                           | Status                                 | Evidence and reproduction result                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1 F1: oversized entry produces invalid JSON                      | fixed                                  | CE/mcp-core/protocol-dispatcher.ts:2433, :2449, :2472. Independent 1,500-symbol lone/middle/final probes parsed, fit both budgets, saved all 1,500 symbols to the supplied spool sink, and advanced correctly. Long-metadata fallback also parsed.                                            |
| r1 F2: cold graph blocks MCP response                             | moved-to-9b                            | TASK/context.md:49 explicitly separates background construction. No latency revision requested here.                                                                                                                                                                                          |
| r1 F3: silent graph cap                                           | not fixed in every accepted-input case | Normal and empty symbol pages disclose the cap; both dependency tools now disclose it for ordinary paths. R3-M1 below leaves a long-path exception.                                                                                                                                           |
| r2 B1: coverage comes from session root instead of answering root | fixed                                  | DG:432 and :497; CE/namespace-builders/analysis-namespace.builders.ts:522; dispatcher:1970 and :1998. Independent real-service probes passed both complete/capped directions and nested-root routing.                                                                                         |
| r2 S1: long dependency list cuts away cap fields                  | fixed for the original reproduction    | dispatcher:1978 and :2006 now put counts/coverage before the list. Actual budget probes with 1,500 paths and injected EACCES retained the cap fields for both tools. A different trigger remains: the preceding query path itself, R3-M1.                                                     |
| r2 M1: token-heavy metadata breaks symbol-page JSON               | fixed                                  | dispatcher:2449 checks the zero-symbol envelope; :2472 selects the bounded fallback. The exact 810-component deepabc path returned valid 265-char/76-token JSON with spool failure, and 287-char/85-token JSON with a short supplied recovery locator; both kept nextOffset=1 and cap fields. |
| r1 help-text observations                                         | fixed                                  | CE/ptah-system-prompt.constant.ts:76 lists paging parameters; CE/namespace-builders/system-namespace.builders.ts:328 documents both overloads and :332 the new coverage method.                                                                                                               |

## Five logic questions

### 1. How does this fail silently?

The graph-specific warning can disappear behind a very long query path at dispatcher:1978/:2006. The generic trailer still honestly reports output truncation; it does not disclose that the underlying graph omitted source files. This is R3-M1, an unusual-input disclosure gap, not a claim that ordinary results now look silently complete.

### 2. What user action produces unexpected behaviour?

Passing a token-heavy absolute path to either dependency tool loses the required coverage fields even with an empty dependency list. Both schema file arguments accept a string without a length restriction (CE/mcp-core/tool-description.builder.ts:1682 and :1706); the dispatcher checks only nonempty string input (:1960 and :1988). See R3-M1.

### 3. What input data produces a wrong answer?

No incorrect fixed-index paging answer was reproduced: an independent run of the actual parser, pager, renderer and token predicate visited 3,000 distinct entries in sorted order across 397 budget-shortened pages. Cross-root and nested-root coverage now follows the service routing (DG:432/:497). The remaining wrong metadata delivery occurs for the 6,485-character path detailed below, not for the normal cross-root case.

### 4. What happens when a dependency fails?

Ordinary oversized-symbol spool failure is represented in valid JSON as symbolsFileError (dispatcher:2434); metadata-only failure returns the bounded error envelope (:2458). Actual budget probes injected EACCES at mkdir and observed the existing explicit save-failure trailer (CE/mcp-core/tool-result-budget.ts:265/:267). No real permission failure was classified as a code defect. Awaited cold construction at dispatcher:2338 remains assigned to 9b.

### 5. What is missing that the requirements never mentioned?

Mandatory metadata must precede every unbounded field, including the echoed query path, not only the returned list (dispatcher:1978/:2006). The current dependency pairing does not need a new snapshot API to prevent an event-loop race; its safety depends on the wrappers remaining synchronous before returning their promises (analysis-namespace.builders.ts:472/:488/:522).

## Failure modes

### R3-M1 — A long query path still removes graph-cap disclosure (Moderate)

- Trigger: a capped graph and `file = 'C:/' + Array(810).fill('deepabc').join('/') + '.ts'` passed to either dependency tool. This is the same 6,485-character token-heavy path used in r2 M1, now at the dependency boundary.
- Symptom: neither incomplete nor graphedFiles/discoveredFiles survives inline. With spool failure, the caller cannot recover those fields from the full output either.
- Evidence: CE/mcp-core/protocol-dispatcher.ts:1978 and :2006 serialize file before coverage; CE/mcp-core/tool-result-budget.ts:267 and :441 retain a budgeted prefix. The fixed cap note at CE/mcp-core/tool-description.builder.ts:1665 promises these fields.
- Current handling: moving the list last fixes large-list results for normal file paths, but leaves the unbounded file string before all mandatory disclosure.
- Reproduction: in-memory TypeScript transpilation of the actual two dispatcher case bodies, substituting API edges and the final response sink, produced an empty-list envelope of 6,583/6,585 characters and 2,464/2,463 tokens. The incomplete key starts at character 6,506; the preceding prefix alone is 2,440 tokens, already beyond the 2,000-token budget. Separately, the actual budget/reducer/token pipeline with this exact field order, 1,500 returned paths, and mkdir throwing EACCES returned 5,252 characters/1,961 tokens for each tool, with no cap fields and an explicit save-failure trailer. The same probes with a 13-character query path retained the fields. These are source-based, in-memory reproductions, not live MCP or long-path filesystem tests.
- Impact: a valid unusual input defeats Decision 14's graph-cap disclosure. Moderate because it requires extreme path metadata and the generic output-truncation warning remains visible; the common large-list and cross-root failures are repaired.
- Recommendation: serialize the bounded count and coverage fields before file as well as before the list. Add both-tool regressions using a token-heavy file argument with an empty list and with spool failure. No dependency paging redesign is needed.

## Blocking issues

None reproduced within this review's scope.

## Serious issues

None reproduced within this review's scope. r1 F2 is moved to 9b, not silently downgraded.

## Moderate and minor issues

- **R3-M1:** CE/mcp-core/protocol-dispatcher.ts:1978/:2006. Put required disclosure ahead of the unbounded query path. One failure mode affecting two tools; counted once.
- No additional minor defect is scored. The symbol description documents the usual oversized-file representation (:1861); the exceptional metadata-only error is explicit in the returned result (:2469).

## Paired-read concurrency judgment

For dependents/dependencies, no rebuild/eviction-between-reads defect was found. Array elements are evaluated synchronously before Promise.all yields (dispatcher:1970/:1998). Both namespace query wrappers invoke synchronous service reads without an internal await (analysis-namespace.builders.ts:472/:488); the coverage wrapper does the same (:522). Service query arrays and coverage objects are copied (DG:278/:297/:435). Publication of graph and coverage has no intervening await (DG:225/:228), and eviction removes both synchronously (DG:442).

An independent controlled probe called both real namespace methods, queued eviction in a microtask, then awaited the pair: it retained the original capped coverage. A queued rebuild completion is subject to the same event-loop ordering. This conclusion is about the current concrete wrappers, not a guarantee conferred by Promise.all on arbitrary async implementations. Severity: none. Cross-request offset paging still has no snapshot/version contract (symbol-index-query.ts:134); no new mutation finding is inferred from that limitation.

## Data flow

1. MCP paging arguments → parser: OK. Fixed errors and bounds precede graph work (symbol-index-query.ts:50; dispatcher:2140). Eight independent invalid-input probes rejected.
2. Discovery → first 5,000 paths and discovered count: OK for cap disclosure (dispatcher:2326/:2338). Background build is 9b.
3. Service graph → coverage storage/routing/lifecycle: OK (DG:225/:228/:410/:432/:442).
4. Namespace → old array overload or filtered/sorted page: OK (analysis-namespace.builders.ts:416; symbol-index-query.ts:129).
5. Symbol page → fitting prefix or spool envelope → metadata-only error: OK in reproduced cases (dispatcher:2422/:2449/:2472). Continuation always progressed in the independent traversal.
6. Dependency list + answering-graph coverage → JSON: correct paired reads; R3-M1 in serialization order (dispatcher:1970/:1978/:1998/:2006).
7. Response → shared budget: fitting symbol JSON passes unchanged; cap fields on long dependency paths can be cut (tool-result-budget.ts:233/:267).
8. Spool root → host-owned folder matching or temp: reviewed path remains host-owned (dispatcher:2161/:2609; tool-result-budget.ts:502). Successful-spool and trust regressions are included in the passing project suite.

## Requirements fulfilment

| Requirement                                              | Status                                         | Gap                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Stable paging, defaults, prefix, total and continuation  | COMPLETE for a fixed index                     | 3,000 entries/397 pages independently traversed; namespace compatibility specs pass            |
| Oversized symbol entry remains bounded valid JSON        | COMPLETE in reproduced cases                   | Lone/middle/final and exact r2 metadata case pass                                              |
| Explicit spool failure and continued paging              | COMPLETE                                       | Error envelope preserves progress and coverage                                                 |
| Coverage follows answering graph, including nested roots | COMPLETE                                       | Real-service probes and both-tool regression suite                                             |
| Cap disclosure on all three tools                        | PARTIAL                                        | R3-M1 long query path on the two dependency tools                                              |
| Backward-compatible root-only execute_code call          | COMPLETE                                       | Old array branch at analysis-namespace.builders.ts:416; types.ts:829 overload; namespace suite |
| Descriptions and help                                    | COMPLETE for ordinary paging/coverage behavior | Disclosure delivery exception is R3-M1                                                         |
| Host-owned spool routing                                 | COMPLETE for reviewed path                     | Same resolveSpoolRoot and exclusive-create spool implementation                                |
| Frozen constants / untouched LSP and enrich blocks       | Not independently diff-certified               | Executor reports unchanged; no git operations permitted by reviewer role                       |
| Cold-build latency remediation                           | Moved to 9b                                    | Decision 14; excluded from Batch 9 verdict                                                     |

Implicit requirement still unmet: mandatory disclosure survives all accepted variable-length fields, not only large lists.

## Edge cases

| Case                                                   | Handled                 | How                                         | Concern                             |
| ------------------------------------------------------ | ----------------------- | ------------------------------------------- | ----------------------------------- |
| No matches, empty page, past-end offset                | YES                     | Empty page and no continuation              | Scoped suite                        |
| Invalid limit/offset/prefix                            | YES                     | Fixed validation errors                     | Independent probes and suite        |
| Windows/UNC/POSIX prefix behavior                      | YES for specified cases | Normalize/fold Windows; preserve POSIX case | Namespace regression suite          |
| One oversized entry, middle/final/lone                 | YES                     | Spool plus bounded JSON                     | Independently reproduced            |
| Metadata exceeds token budget                          | YES for symbol page     | Bounded explicit error                      | Exact r2 reproduction passes        |
| Cross-root/nested-root dependency query                | YES                     | Common routing selector                     | Independent service probes          |
| Rebuild/eviction queued during dependency paired reads | YES                     | Synchronous reads before yielding           | Controlled eviction probe           |
| Large dependency list, ordinary path                   | YES for cap disclosure  | Coverage precedes list                      | Real budget probe with failed spool |
| Long dependency query path                             | NO for cap disclosure   | File precedes coverage                      | R3-M1                               |
| Coverage eviction/retainOnly/clear                     | YES                     | Co-located lifecycle                        | DG coverage suite                   |

## Verification and limits

- Ran the requested root command once: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`. All six targets succeeded, run duration 2m19s. No source changes or suite reruns.
- Ran `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` once. Passed, TOTAL 300 unsuppressed sites, 26.0s; baseline gate accepted the current code.
- Scoped ptah_get_diagnostics was unavailable because its compiler check was still running after 45s. The independently completed Nx typecheck targets provide compiler verification; no diagnostics success is claimed.
- Independent probes used current sources transpiled in memory. Parser/file-system/service dependencies were stubbed as described; the token and result-budget/reducer implementations were real. No live MCP transport or real 6,485-character file was exercised.
- Read r1/r2, context Decision 14, all executor-report sections, Batch 9 and the relevant changed contracts, source paths and regressions. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. No applicable AGENTS.md/CLAUDE.md was discovered in the worktree search.
- Direct Ptah file-read/Write tools were not listed; native reads and the native report write were used. The review role prohibits git operations, so git status/diff and unchanged-frozen-region claims were not independently verified. No raw .jsonl/.sqlite session logs were read. Only this deliverable was written; no reviewed source was edited.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH in the reproduced remaining disclosure edge; no historical diff certification.
- Top risk: an unusually long query path hides the graph-cap warning in both dependency tools.
- What a robust implementation would add: count/coverage ahead of every unbounded field and two long-query-path delivery regressions. Retain the current paired synchronous dependency reads. Keep cold-build orchestration in Batch 9b.
