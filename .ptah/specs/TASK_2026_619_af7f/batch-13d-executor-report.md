# Batch 13d executor report

## Outcome

Completed the unknown-coverage lifecycle acceptance change in the assigned worktree. The prior lane's partial implementation was functionally complete on review; I retained its behavior and tests, then applied Prettier's required mechanical formatting to the two affected files. No files outside the four permitted lifecycle source/spec files and this report were written.

## Partial edits reviewed

- Kept `lifecycle-probe.ts`'s `underUnknownCoverage` probe flag and its error boundary: `unknown-coverage` parses symbol hits, while all other result error classes return before parsing.
- Kept the scenario detail suffix and its use only when the accepted positive hit determined the pass.
- Kept the new focused probe spec and the copy-scenario regression coverage.
- Changed only formatting in `lifecycle-probe.ts` and `lifecycle-scenarios.spec.ts` after Prettier reported style drift; no semantic correction was required.

## Changes by file

- `tools/mcp-bench/src/lifecycle/lifecycle-probe.ts:27-95`: `SymbolProbe` exposes `underUnknownCoverage`; `searchSymbol` permits `parseSymbolHits(outcome.text, root, [], true)` only for `unknown-coverage`, retains `errored: true`, preserves the classified state, counts parsed hits, and accepts only a matching file. Parse failures still return an errored non-hit. `building`, `tool-error`, `unavailable`, transport, and RPC failure paths remain non-parsing non-hits.
- `tools/mcp-bench/src/lifecycle/lifecycle-probe.ts:198-205`: index-age still requires a clean accepted hit; an unknown-coverage hit cannot make that independent scenario pass.
- `tools/mcp-bench/src/lifecycle/lifecycle-probe.spec.ts:46-143`: covers matching and missing unknown-coverage hits, a clean hit, `building` and `tool-error` non-parsing behavior, and unknown-coverage parse failure.
- `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts:210-214, 244-359`: adds the exact ` (found under unknown coverage)` suffix to cold start, edit at 5 s, edit at 60 s, add-then-query, and 3,900-line large-file results only when the positive unknown-coverage hit decided the pass.
- `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts:318-335, 360-366, 607-624`: delete remains `!probe.errored && !probe.found`; 1.5 MiB, index-age, and two-workspace scope retain their prior clean-result requirements.
- `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.spec.ts:271-326`: verifies an edit passes with the suffix and delete remains a failure under unknown coverage; also checks the other permitted positive-hit cases.

## `searchSymbol` caller audit

| Caller | Meaning after change |
| --- | --- |
| `runCopyScenarios` search closure (`lifecycle-scenarios.ts:231-359`) | Changed only for cold-start, edit 5 s/60 s, add-then-query, and large-file-3900: a matching unknown-coverage hit may pass and gets the suffix. |
| Delete predicate (`lifecycle-scenarios.ts:318-335`) | Unchanged: `errored: true` means an unknown-coverage result cannot prove deletion. |
| 1.5 MiB probe (`lifecycle-scenarios.ts:360-381`) | Unchanged pass meaning: unknown-coverage hit is excluded from `bigIndexed`. |
| `indexAgeScenario` settle/refresh (`lifecycle-probe.ts:161-205`) | Unchanged pass meaning: settle still reads index state text; final pass explicitly rejects `underUnknownCoverage`. |
| `symbolScopeScenario` (`lifecycle-scenarios.ts:607-624`) | Unchanged pass meaning: it still requires `!result.errored` and zero hits. |

No other `searchSymbol` or `SymbolProbe` callers exist in `tools/mcp-bench/src`. `classifyToolResult`, call-recorder scoring, and symbol/memory suite scoring were not changed.

## Tests and verification

- Lifecycle probe tests: matching unknown-coverage hit; unknown-coverage miss; clean hit; building/tool-error non-parsing; malformed unknown-coverage result.
- Lifecycle scenario regression: positive unknown-coverage edit suffix and non-passing delete, plus cold-start/add/3,900-line acceptance and clean-only guards for the unrelated cases.
- `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/lifecycle --coverage=false --maxWorkers=2` — PASS: 2 suites, 17 tests, 0 snapshots. PowerShell emitted a native-command wrapper diagnostic despite Jest's passing summary.
- `npx nx typecheck mcp-bench --parallel=1` — PASS: Nx successfully ran `mcp-bench:typecheck`. Nx Cloud reported its disabled organization after the successful target.
- `npx nx lint mcp-bench --parallel=1` — PASS: Nx successfully ran lint with 0 errors. It reported 2 existing warnings in `src/ground-truth/scip-cross-check.ts` and `src/transport/bench-host-process.spec.ts`, both outside this batch's allowed files.
- `npx prettier --check tools/mcp-bench/src/lifecycle/lifecycle-probe.ts tools/mcp-bench/src/lifecycle/lifecycle-probe.spec.ts tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts tools/mcp-bench/src/lifecycle/lifecycle-scenarios.spec.ts` — PASS: all matched files use Prettier code style.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Accept a positive file hit during unknown coverage only in the named positive-hit lifecycle cases | Treat all unknown coverage as failure; accept a verified matching hit | User decision and `parseSymbolHits` file-level normalization (`tools/mcp-bench/src/suites/tool-results.ts:76-102`) | Yes; remove the narrow unknown branch and suffix uses. |
| Keep unknown coverage errored | Clear `errored` on a positive hit; preserve coverage uncertainty | Objective explicitly requires `errored: true`; delete and scope use that signal to avoid false passes | Yes; localized to `searchSymbol`. |
| Preserve independent scenario semantics | Let all found hits pass; guard delete, 1.5 MiB, index-age, and scope | Their success conditions require absence, clean index state, over-cap honesty, or clean zero-hit scope | Yes; guards are localized at each caller. |

## Delivery

`ptah_agent_report` was not available in this session's tool catalog, so no orchestrator message could be sent. This report is the produced deliverable; no verification step was unavailable.
