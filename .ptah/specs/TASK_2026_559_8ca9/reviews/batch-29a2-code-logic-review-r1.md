# Code Logic Review — TASK_2026_559_8ca9 — Batch 29a2 r1

## Summary

| Metric                               | Value                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Part 1: rolled-forward harness fixes | Both VERIFIED                                                                                                  |
| Part 2: Batch 29a2                   | NEEDS_REVISION — 6/10                                                                                          |
| Blocking / Serious / Moderate        | 0 / 1 / 1                                                                                                      |
| Failure modes found                  | 2                                                                                                              |
| Main requested verification          | Combined run failed; all lint/typecheck and Electron tests passed; failing timing cases passed isolated checks |
| rpc-handlers                         | Six known mock-gap suites plus the named harness-selection failure; no new public-export gap found             |

Lazy loading, shared language latches, UTF-8 size refusal and the three edited coverage producers work in the exercised normal/error paths. The disposal generation guard starts too late: a pending runtime initialization can resurrect work after disposal, and an obsolete initialization failure can clear a newer latch. Enrichment also still collapses the new refusal reasons to `parse-failed`.

The score is 6 rather than 7–8 because disposal does not reliably end the service lifetime and consumer reason propagation is incomplete. It is above 5 because targeted failure isolation, concurrent rejection, size-boundary tests, real-WASM consumer coverage and packaged-path smoke checks substantiate most of the implementation.

Path abbreviations below are relative to the worktree: `WI` = `libs/backend/workspace-intelligence/src`; `WIT` = `WI/testing/mcp-contract`; `MCP` = `libs/backend/vscode-lm-tools/src/lib/code-execution`.

## Part 1 — rolled-forward verification

| Carried item                                               | Status   | Evidence and sabotage result                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R29a1-01 / R27-03: unsupported-file accounting             | VERIFIED | `WIT/language-honesty.contract.spec.ts:616` now requires unsupported=1 and unsupportedByLanguage.elixir=1 for the mixed run; :663 requires zero/no Elixir bucket in the supported-only contrast. Removing `this.countUnsupported(run, filePath)` from a TEMP production copy makes both owning checks fail with the exact missing count/bucket. Result: 2 failed / 8 executable checks passed.                                                                                     |
| R29a1-02 / R27-04: returned spool locator and raw equality | VERIFIED | `MCP/mcp-core/mcp-language-coverage.spec.ts:536` supplies independently captured 20,000-character raw content through handleMCPRequest, locates the returned recovery path and reads the file at :582; :585 compares the content against the pre-dispatch raw JSON. Replacing the actual production spool write with `CORRUPTED` makes precisely this new guard fail: 1 failed / 15 passed. The earlier small-response tests are now accurately described as serialization checks. |

Both mutations were confined to TEMP copies. The current unmutated guards passed in the requested project runs (their suite failures were elsewhere). No carried Blocking or Serious harness finding remains open in this review.

## Part 2 — numbered findings

### R29a2-01 — Serious — disposal does not invalidate runtime initialization or its waiting callers

- **File:** `WI/ast/tree-sitter-parser.service.ts:163,174,179,202,217`; disposal at :809.
- **Trigger:** start `parse()` while Parser.init is pending, call dispose(), then allow the runtime initialization to complete.
- **Observed symptom:** the pending parse succeeds; it starts one grammar load and retains a newly created parser after disposal. Independent replay recorded `{ "ok": true, "grammarLoads": 1, "parserDeletes": 0 }` before test cleanup. The assertion that the disposed operation must fail goes red.
- **Cause:** `_doInitialize()` writes `isInitialized` without checking which service generation owns the initialization. `loadLanguage()` awaits that initialization before `_loadLanguage()` captures the generation. The obsolete request therefore captures the _new_ generation and passes the grammar-load guard, even though it began before dispose().
- **Second schedule:** start initialization A; dispose; start initialization B; reject A; call initialize again before B finishes. A's catch unconditionally clears `initPromise`, so the follower starts C rather than joining B. Independent replay observes **3 Parser.init calls instead of 2**.
- **Impact:** shutdown/service replacement can be followed by unexpected parsing and retained WASM parser resources. Reinitialization can lose its single-flight guarantee. The existing test at `tree-sitter-parser.service.spec.ts:443` only disposes after grammar loading has started; it misses the earlier runtime-await window.
- **Provenance:** this extends an existing initialization pattern; the review does not claim every aspect of the race originated in this commit. The new disposal-generation protection does not cover the full load pipeline that this batch explicitly asks to make safe.
- **Recommendation:** capture the operation's generation before the first await; bind initialization success/failure and latch cleanup to both generation and promise identity. Reject obsolete waiters before creating/joining language loads, and check the generation before consuming a prepared parser. Add deterministic tests for both schedules, plus successful explicit reinitialization after disposal.
- **Disposition:** **fix-now**; verification rolls to the next Lane A review under Decision 24.

### R29a2-02 — Moderate — enrichment reports parser refusals as syntax/parse failures

- **File:** `WI/context-analysis/context-enrichment.service.ts:164,168`; reason contract at :45,63. New refusal source: `WI/ast/parser-refusal.ts:29,55`.
- **Trigger:** request a structural summary of valid TypeScript when its grammar cannot load, or of a nonempty source over 1 MiB.
- **Observed symptom:** both requests return `mode: 'full', reason: 'parse-failed'`. Real-service replay with a rejected TypeScript grammar returns the valid source unchanged but calls it parse-failed. A source over 1 MiB likewise returns its full content with parse-failed, even though the parser refused it before parsing.
- **Cause:** the consumer treats every Result.err from queryMulti as the same failure. The new parserFailureReason wiring covers graph, indexer and diagnostics, but does not cover this existing parser consumer.
- **Impact:** content is preserved and the answer is not falsely clean, so this is not data loss. The reported reason nevertheless misidentifies a host dependency/size refusal as a source parse failure, contrary to the requested distinction. An agent cannot tell whether to shorten the source, repair the host grammar, or investigate syntax.
- **Recommendation:** classify the error with parserFailureReason and carry `grammar-unavailable` / `too-large` through the full-content fallback's reason contract, preserving `parse-failed` for actual parse/recovery failures. Update any boundary reason unions and add both consumer-level regressions.
- **Disposition:** **fix-now** as the remaining refusal-propagation wiring; it is a small consumer correction, not a request to change the full-content fallback.

## Behavior examined

### Latches, concurrency and memory

`tree-sitter-parser.service.ts:202–209` checks/installs a per-language promise without an intervening await after the runtime is ready. Concurrent first users therefore share one grammar load and parser in the normal lifetime. The submitted five-call test pins this. An independent eight-caller rejected-Go probe returned grammar-unavailable to all eight, performed one load, and still parsed a TypeScript sibling successfully.

A failed grammar stays in languageLoads until disposal; the loadedLanguages map only owns successful parsers. This bounds service-owned language entries to the configured language set rather than file count (`:116,121`). Tree caching remains capped at 100 entries (`:124`); temporary parse/query trees and queries are deleted in finally blocks. That is bounded ownership, not a numerical WASM-memory ceiling.

Parser reuse does not itself make the normal parse/query paths re-entrant. Each public operation awaits preparation and then executes synchronous parse/query/conversion/cleanup without another await (`:328,380,533,616,699`). Concurrent Promise callers take sequential JavaScript turns through the non-reentrant parser. The new risk demonstrated here is lifetime invalidation around those awaits, not simultaneous native parse execution. Same-file incremental-cache ordering was not stress-tested exhaustively and is not certified by this observation.

### Size limits and refusal propagation

`parser-refusal.ts:55` uses safe UTF-16-length bounds and Buffer.byteLength for the ambiguous range; it measures UTF-8 bytes. The limit is 1,048,576 bytes and the comparison is strict greater-than. Submitted tests accept exactly 1 MiB, reject larger ASCII and multibyte input, and drop stale incremental cache entries on refusal. Independent probes also reject over-limit two-byte characters, surrogate pairs and unpaired-surrogate text before any runtime initialization or grammar load.

A real-WASM consumer probe rejected TypeScript and C# grammars while keeping their sibling languages available:

| Consumer                                       | Observed result                                                                           | Wiring                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Dependency graph, failed TS + successful JS    | analyzed=1, failed=1, failedByReason.grammar-unavailable=1, clean=false                   | `WI/ast/dependency-graph.service.ts:646`                    |
| Code index, same files                         | analyzed=1, failed=1, grammar-unavailable=1, clean=false                                  | `WI/services/code-symbol-indexer.service.ts:1011`           |
| Diagnostics, failed C# + successful Go         | C# explicitly not checked with grammar-unavailable; qualified coverage, sibling available | `WI/diagnostics/language-aware-diagnostics-provider.ts:859` |
| Graph, oversized TS                            | failedByReason.too-large=1, analyzed=0                                                    | Same graph mapping and parser preflight                     |
| Single-file code reindex, oversized TS         | too-large=1, errors=1, symbolsIndexed=0                                                   | Same indexer mapping                                        |
| Enrichment, broken grammar or oversized source | Full content preserved, but reason=parse-failed                                           | R29a2-02                                                    |

`WI/ast/ast-analysis.service.ts:103` retains the original error as cause on the normal Result.err path, allowing the helper to classify it. The real consumer probe exercised this chain rather than only constructing errors by hand. Direct AST namespace errors remain visible errors (`MCP/namespace-builders/ast-namespace.builder.ts:99,138,259`), not clean empty successes. The optional outline reducer may decline to outline and retain its ordinary cut/recovery behavior (`MCP/mcp-core/code-outliner.adapter.ts:181`); that is not a coverage claim.

The indexer's existing all-files-failed exception remains possible for a single-language workspace with a broken grammar. This review does not count that pre-existing visible failure as a new silent success; the mixed-language probe specifically establishes isolation and correct coverage reasons.

### Manifest and packaged lookup

`WI/ast/grammar-manifest.spec.ts:42,74` checks active **grammar** rows against registry grammar names and the grammar map. It does not independently pin the runtime row or inspect packaged directories; that broader assertion must not be attributed to this new spec alone. Its scope matches Task 29a2.2.

Independent packaged-path smoke evidence supplies the remaining check: the real copy-wasm script copied exactly the five active grammars plus `web-tree-sitter.wasm` under a TEMP bundle's wasm directory. ESM probes built with each app's tsconfig/Node20 settings and external web-tree-sitter loaded the runtime and all five grammars through the actual `wasm-bundle-dir.ts:34` resolver and `GRAMMAR_FILE_MAP`.

This exercises bundle-relative lookup. It is not a full Electron asar/CLI installation launch. The TEMP smoke harness initially omitted required ESM banner details; it was corrected to provide aliased filename/dirname helpers and the apps' external-library treatment before the reported passes. No product-source fix was needed for those harness mistakes.

## Public exports and dependent-project mocks

Compared the baseline commit `a01cc0d21119324dd21ffb79a454dd91141276b8` and current files by reading repository objects into TEMP, without any git command. `WI/index.ts` and `libs/backend/rpc-handlers/src/test-utils/heavy-module-mocks.ts` are unchanged. ParserRefusalError/parserFailureReason are internal relative imports, not new exports from the workspace-intelligence public barrel. Existing public parser method signatures remain intact.

The rpc-handlers run reported the supplied pre-existing mock gap: recognisedSourceExtensions is missing from the heavy mock. The six affected suites were:

- surface-rpc.handlers.submit.spec.ts
- surface-rpc.handlers.spec.ts
- surface-rpc.handlers.deadline.spec.ts
- output-style-rpc.handlers.spec.ts
- rpc-allowlist.spec.ts
- resolve-handler-plan.spec.ts

It also hit the named harness-skill-selection case, `never writes state.json — a derived decision is not a write`, at :113 (expected state file absent, found present). Totals: **7 failed / 105 passed suites; 1 failed / 4 skipped / 3,132 passed tests**. These are reported as verification limitations and Lane K work, not findings against 29a2. No evidence was found that this batch widens that public-export gap.

## Five logic questions

1. **How does this fail silently?** A disposed service can create a new parser and complete an old parse without signaling cancellation (R29a2-01, parser service :202). Coverage producers otherwise returned qualified failures in the real probes.
2. **What user action produces unexpected behavior?** Closing/replacing the service while its first runtime load is pending can be followed by successful parsing and retained resources. Requesting enrichment of a valid oversized file yields the wrong reason (R29a2-02).
3. **What input produces a wrong answer rather than an error?** Valid TS with an unavailable grammar, or more than 1 MiB of nonempty TS, produces a full-content result mislabeled parse-failed. The content itself remains correct.
4. **What happens when a dependency fails?** Grammar failure is correctly latched per language and shared by concurrent callers; siblings remain usable. Runtime failure normally retries, but an obsolete failure can clear the current retry latch. Graph/index/diagnostics carry refusal reasons through the normal error chain.
5. **What is missing that the requirements never mentioned?** No new feature requirement is needed. Full lifetime ownership of initialization is implicit in the requested disposal-race review. Enrichment is an additional existing consumer of the newly introduced refusal contract.

## Requirements fulfilment and edge cases

| Requirement / case                                | Status                                       | Evidence / gap                                                          |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Runtime-only initialize                           | COMPLETE on normal path                      | Parser init test, no grammar load until use                             |
| Per-language single-flight and parser reuse       | COMPLETE on normal lifetime                  | Five successful first users; independent eight rejected users           |
| Failed grammar isolated and not repeatedly loaded | COMPLETE                                     | Sibling-language probes and submitted latch test                        |
| Runtime failure retries                           | PARTIAL                                      | Ordinary retry passes; obsolete failure corrupts newer latch (R29a2-01) |
| Dispose while grammar load pending                | COMPLETE for the tested window               | Submitted :443 test deletes late parser                                 |
| Dispose while runtime initialization pending      | MISSING                                      | Old request succeeds after disposal                                     |
| Non-reentrant native parser                       | HANDLED on inspected synchronous parse paths | No await after preparation until native use/cleanup finishes            |
| UTF-8 >1 MiB refusal before loading               | COMPLETE                                     | ASCII, multibyte, surrogate probes; boundary test                       |
| Stale tree removed on size refusal                | COMPLETE                                     | Submitted incremental refusal test                                      |
| Refusal reason in graph/index/diagnostics         | COMPLETE on normal Result path               | Independent real-WASM consumer probe                                    |
| Refusal reason in enrichment                      | PARTIAL                                      | R29a2-02                                                                |
| Registry/manifest grammar agreement               | COMPLETE                                     | New four-test spec; actual packaged-path smoke                          |
| Public mocks kept compatible with this change     | NO NEW GAP                                   | Public barrel unchanged; known 24c mock failures remain external        |

## Verification

- Requested main Nx run over workspace-intelligence, vscode-lm-tools and ptah-electron completed **with failures** in **6m 43s**. All requested lint/typecheck targets and Electron tests passed. Nx reported 13 successful tasks including dependencies.
- Workspace-intelligence: **54 passed / 1 failed suites; 1,696 passed / 4 failed / 1 skipped tests**. All four failures were 5-second timeouts in the graph contract benchmark.
- vscode-lm-tools: **76 passed / 1 failed suites; 2,331 passed / 1 failed tests**. Failure: slow-empty-build background graph assertion at protocol-dispatcher.spec.ts:6650. A worker-exit warning was also printed. The original run is not represented as green.
- To investigate these unresolved timing failures, ran only the affected scopes again, sequentially with runInBand and no cache: the graph benchmark subgroup passed **6 tests** in 21.0s; the slow-empty-build case passed **1 test** in 18.2s. This supports a timing-sensitive outcome under the original concurrent load, not a claim that the complete projects were rerun successfully. An initial TEMP runner used the wrong Nx binary path and executed no tests; it was corrected before these results.
- Requested rpc-handlers run failed as detailed above, in **3m 57s**. No repeat of that suite was run.
- Scoped ptah_get_diagnostics: TypeScript compiler, **0 errors / 0 warnings** for parser service and refusal helper.
- Independent deterministic parser probes: **2 failures** exposing the two disposal/initialization schedules; **2 passes** for concurrent rejection/isolation and UTF-8 preflight. Real-WASM consumer probe: **1 pass** with the recorded outputs above.
- Harness sabotages: unsupported-count removal now fails **2 checks**; corrupt raw spool now fails **1 check**. These expected failures verify the carried fixes.
- Packaged-path smoke: both CLI/Electron configurations load five grammars; copied asset set is exactly five grammars plus runtime. Full packaging/startup, validate-deps and degradation audit were not independently rerun.
- Scripts, source copies, observations and logs are under `C:/Users/abdal/AppData/Local/Temp/ptah-review29a2-B74IkG`. No reviewed source/spec was edited; no git command or state mutation was performed. Only this requested review and the role-required task-root review were written in the worktree.

## Verdict

- **Part 1: VERIFIED — both rolled-forward harness gaps closed.**
- **Part 2 Recommendation: REVISE — 6/10.**
- Confidence: HIGH for the deterministic lifecycle defect and measured consumer output; MEDIUM for full packaged-host behavior and load-sensitive suite reliability.
- Top risk: an old runtime initialization can outlive disposal and create resources in the new service generation.
- Required correction: bind runtime/load continuations to the owning generation and latch identity; preserve refusal reasons in enrichment; add regression tests for those schedules and consumer cases. Verify fixes in the next Lane A review under Decision 24.
