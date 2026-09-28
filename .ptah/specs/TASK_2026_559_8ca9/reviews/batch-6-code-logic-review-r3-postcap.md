# Code Logic Review — TASK_2026_559_8ca9

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

**Batch 6 post-cap independent review r3: APPROVE.** The bounded correction fixes r2 F1, and both r1 fixes still hold in independent reproductions. No additional Batch 6 defect was reproduced. The score is 8 rather than 7 because the three demonstrated alternate-path/failure-path defects are resolved; it is below 9 because verification uses boundary doubles and leaves the historical diff/frozen-constant check unverified.

Paths are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. CE = `libs/backend/vscode-lm-tools/src/lib/code-execution`; NS = CE/namespace-builders; MCP = CE/mcp-core. These abbreviations expand the file:line references below.

## Prior findings: r1 and r2

| Review | Finding                                                                                  | Status | Current evidence and independent result                                                                                                                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| r1     | M1: execute_code definitions bypass freshness                                            | fixed  | NS/ide-namespace.builder.ts:226 invokes the hook; CE/ptah-api-builder.service.ts:613 wires the shared code namespace. Actual executeCode + namespace builders returned `[]`, with definitions=1, freshness reads=1 and index runs=1, `userInitiated:false`.                                                                    |
| r1     | M2: explicit reindex loses its start acknowledgment on freshness rejection               | fixed  | NS/code-namespace.builder.ts:173 catches advisory failure separately; :403 admits and :412 reports actual latch state. With a rejecting reader from the outset, first/repeated calls returned started=true/false, null count/age and in-flight=true; exactly one pending run.                                                  |
| r2     | F1: search/ensureIndexFresh report inactive while a run is pending and freshness rejects | fixed  | NS/code-namespace.builder.ts:269 captures the root inside try, before the await; :283 reads that root's latch. Both searchSymbols and ensureIndexFresh returned null count/age, reindexStarted=false and reindexInFlight=true with one pending run. Regression specs at NS/code-namespace.builder.spec.ts:474 and :502 passed. |

## Verification and scope

- Ran from the requested worktree: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache`. All three targets passed; Nx reported 20.5 seconds. Successful task details were suppressed, so this review makes no independently observed test-count claim.
- Ran `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: passed. The initial tail omitted the requested library line; a filtered rerun to resolve that specific evidence gap reported `libs/backend/vscode-lm-tools: 2 ok (baseline 2)` and success.
- Scoped ptah_get_diagnostics to the code namespace: TypeScript compiler reported zero errors and warnings.
- Independent in-memory reproductions transpiled the actual code namespace, IDE namespace and execution engine with the installed TypeScript compiler. Reader, indexer, platform capabilities and logger were doubles. No real database or raw session log was read, and no reproduction file was written.
- Repeated the r2 pending-run/rejected-reader sequence through both entry points. Also changed the selected root while the freshness promise was pending: the failure still reported the originally captured root's active run, with exactly one root resolution during that ensureIndexFresh call. A subsequent check of another root reported inactive and started nothing. A throwing root resolver resolved to unknown/inactive rather than rejecting.
- Repeated r1 M1 through the actual executeCode membrane and M2 with a rejecting reader from the first admission. Three concurrent lazy calls independently produced one run. Secret-bearing error messages did not appear in the captured freshness warning logs.
- Read r1/r2, all executor-report sections including the bounded correction, Batch 6, Decisions 1/4 and the approved 24h mitigation. Read both namespace implementations and their relevant tests, composition/root resolution, full execution engine, tool registration/dispatch, descriptions, prompt and catalog paths. This is approval of Batch 6 behavior, not an audit of unrelated dispatcher handlers.
- No task-description.md, implementation-plan.md or code-style-review.md exists in the discovered task folder. ptah_search_files returned no AGENTS.md. No direct file-read tool was listed, so native reads were used.
- The reviewer role prohibits git operations. Consequently branch identity, independent uncommitted-diff inventory and historical byte identity of `ptah-core-prompt.ts` / `NATIVE_AGENT_TOOL_POLICY` were **not verified**. The executor's statement is not substituted for a historical comparison. Only this review deliverable was written by the reviewer; no reviewed source was edited.

## Five logic questions

### 1. How does this fail silently?

No new silent failure was reproduced. The former false inactive status now preserves independently known execution state at NS/code-namespace.builder.ts:283; search returns it at :317. Advisory failures log fixed text at :276. A start acknowledgment still does not guarantee eventual indexing success: background failures are observed by the catch at :221, not returned retrospectively to the caller.

### 2. What user action produces unexpected behaviour?

The reviewed sequences now behave consistently: start reindex, search during a failed freshness read, and request reindex again all report the same active latch (NS/code-namespace.builder.ts:283, :412). Switching from the direct definition tool to execute_code reaches the same hook (MCP/protocol-dispatcher.ts:945; NS/ide-namespace.builder.ts:226). No regression was reproduced.

### 3. What input data produces a wrong answer?

None reproduced within the Batch 6 freshness contract. Zero count is stale at NS/code-namespace.builder.ts:199; null timestamp yields null age at :191; nonempty data becomes stale strictly after 24h at :201. Unknown freshness plus a pending run now retains true in-flight state at :283. Arbitrary malformed payloads from a contract-violating internal reader were not exercised against a real store.

### 4. What happens when a dependency fails?

Freshness rejection becomes null metadata while preserving local state (NS/code-namespace.builder.ts:279); explicit admission survives it through :173. Background rejection clears the latch at :220 and is caught at :221; governor abort is treated as a clean stop at :225. Missing indexer returns an explicit error at :374. The definition hook defers access inside a caught promise chain at :437, isolating failed namespace proxies from lookup execution.

### 5. What is missing that the requirements never mentioned?

The local latch cannot coordinate other indexing entry points, and there is no durable completion/result history in this namespace (NS/code-namespace.builder.ts:145, :218). Those remain residual limits from r1/r2, not newly reproduced defects. The accepted 24h per-root start throttle also means a failed lazy run is not immediately retried (:259); this follows the approved risk mitigation in batches.md:90.

## Failure modes

No unresolved Batch 6 failure mode was reproduced. The reviewed paths cover lazy and explicit admission, freshness failure before/during a pending run, root capture/isolation, shared definition lookup, missing optional services, concurrency, tool registration and result handling. Evidence is the prior-findings table, independent reproductions and passing scoped checks above.

Residual uncertainty: real database latency/failure integration, live multi-host behavior, coordination with other indexer callers, and historical frozen-constant identity. In particular, explicit reindex still awaits the optional freshness read at NS/code-namespace.builder.ts:407, although it never awaits indexWorkspace. No probable production hang of that reader was established here; a hypothetical permanently pending double is not counted as a new defect.

## Blocking issues

None reproduced.

## Serious issues

None reproduced.

## Moderate and minor issues

None reproduced in Batch 6. Prior catalog drift and previously recorded contract refinements are not promoted into new findings.

## Data flow

1. **OK — discovery:** reindex follows search in the code group at MCP/protocol-dispatcher.ts:465. It remains outside the eager sets at :505. Gating/order and non-eager specs passed.
2. **OK — metadata:** telemetry derives registered names from tool definitions at MCP/protocol-dispatcher.ts:490; result budgets are declared for every applicable tool at :625. The new tool follows both paths automatically.
3. **OK — host root:** CE/ptah-api-builder.service.ts:976 obtains recorded session/provider roots without the caller-declared root tier. NS/code-namespace.builder.ts:154 requires exact membership, ensuring writes use the same root key as the search.
4. **OK — shared lookup entry:** CE/ptah-api-builder.service.ts:568 constructs code before wiring IDE at :613. NS/ide-namespace.builder.ts:226 triggers the same deferred freshness hook for direct and execute_code definitions. No-capability stubs do not consume the symbol index; direct IDE tools are capability-gated at MCP/protocol-dispatcher.ts:407.
5. **OK — freshness:** NS/code-namespace.builder.ts:269 captures the root once for ensureIndexFresh, then :236 reads metadata. Failed reads preserve that root's latch at :283 without admission or another root resolution.
6. **OK — admission:** NS/code-namespace.builder.ts:244 checks the latch and :216 sets it synchronously before scheduling, with no await in between. The start throttle is at :259. The latch clears on settlement at :220.
7. **OK — governor:** lazy admission uses false at NS/code-namespace.builder.ts:248; explicit full admission uses true at :405, as required by the batch. Both schedule through :218 and never await indexWorkspace. The real indexer checks governed work before each batch at libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:239 and :242.
8. **OK — output:** search carries index status at NS/code-namespace.builder.ts:317, including error variants at :319. Explicit full calls preserve admission via :407; single-file calls remain awaited at :388. MCP validates an optional absolute filePath at MCP/protocol-dispatcher.ts:2045 and maps namespace errors at :2057.
9. **OK — instructions:** the tool description documents admission/state at MCP/tool-description.builder.ts:1743; CE/ptah-system-prompt.constant.ts:338 documents the changed namespace result; internal-mcp.md:193 registers the catalog entry. Description-budget/schema and stable tools/list/instructions guards passed (MCP/tool-description.builder.spec.ts:35; MCP/protocol-dispatcher.spec.ts:3012, :3022; MCP/server-instructions.spec.ts:100).
10. **OK — failure observability:** fixed-text catches carry audit markers at NS/code-namespace.builder.ts:179, :222, :272 and :438. The audit remains 2 against baseline 2.

## Requirements fulfilment

| Requirement                                                   | Status   | Gap                                                                                    |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Decision 1 lazy empty/older-than-24h governed refresh         | COMPLETE | NS/code-namespace.builder.ts:199, :248; approved per-root throttle refinement retained |
| Shared direct/execute_code search and definitions             | COMPLETE | Search :292; IDE hook :226; builder wiring :613                                        |
| Host-owned writes and root-specific status                    | COMPLETE | NS/code-namespace.builder.ts:154, :269, :283                                           |
| Concurrent admission, latch cleanup, no awaited full indexing | COMPLETE | NS/code-namespace.builder.ts:216, :220, :244                                           |
| Explicit tool, honest admission, awaited single-file stats    | COMPLETE | NS/code-namespace.builder.ts:388, :403; MCP/protocol-dispatcher.ts:2035                |
| Registration, gating, telemetry, budget and instructions      | COMPLETE | Data-flow items 1, 2 and 9                                                             |
| Audit baseline and fixed-text failure logs                    | COMPLETE | Observed 2 ok (baseline 2); catches cited above                                        |
| Decision 4 frozen shared constants untouched                  | PARTIAL  | Historical comparison unavailable under no-git reviewer constraint; no defect asserted |

Implicit requirements not addressed: cross-entry-point indexing coordination and durable completion history. Neither is counted as a new defect. As accepted in r1/r2, a missing indexer can still return measured freshness without starting work (NS/code-namespace.builder.ts:242, :252).

## Edge cases

| Case                                                | Handled                  | How                                                     | Concern                                            |
| --------------------------------------------------- | ------------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| Empty / nonempty null timestamp / fresh / old index | YES                      | Count and age rules at NS/code-namespace.builder.ts:190 | No new defect reproduced                           |
| Three concurrent lazy calls                         | YES                      | Atomic latch admission at :244                          | Independent run count = 1                          |
| Run pending beyond 24h                              | YES                      | Latch still blocks at :244                              | Existing regression passed                         |
| Freshness rejects during pending run                | YES                      | Captured-root latch at :283                             | Both search and ensure independently verified      |
| Root changes while freshness rejects                | YES                      | No root re-resolution in catch at :279                  | Original root retained; other root inactive        |
| Root resolver throws                                | YES for ensureIndexFresh | Resolver inside try at :269                             | Unknown status returned                            |
| Explicit retry with failed reader                   | YES                      | Advisory catch :173, latch :412                         | One run, started=false on retry                    |
| Background rejection / governor abort               | YES                      | finally/catch at :220                                   | Existing regressions passed; lazy throttle remains |
| Missing reader/method/indexer                       | YES                      | Optional read at :164; admission gate :242              | No lazy run                                        |
| Unrecorded caller root                              | YES                      | Membership at :154                                      | Explicit error at :380                             |
| Relative/non-string direct filePath                 | YES                      | Boundary at MCP/protocol-dispatcher.ts:2045             | Does not invoke reindex                            |

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** for the three regression fixes; **MEDIUM** for broader host integration and historical identity.
- Top risk: the per-namespace latch does not coordinate independent indexing entry points (NS/code-namespace.builder.ts:145).
- What a robust implementation would add: real-store failure/latency integration coverage and an explicitly designed shared completion/coordination contract if cross-entry-point guarantees are required. No additional correction is requested for Batch 6.
