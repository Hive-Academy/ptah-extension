# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Final r5 under User Decision 22: Batch 20.2 harness, 20.2p lossless tables, and 20.2q export extraction. Source remained read-only. This review recommends REVISE; Decision 22 separately authorizes the team-leader to commit with remaining defects recorded and carried into Batch 24d. It does not turn those defects into an approval.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 0              |
| Moderate issues     | 1              |
| Failure modes found | 3              |

The original comment/string-name probes and TS assignment/import-alias probes now pass. Detected unsupported syntax is honestly qualified by ast_analyze. However, the mandated symbol index drops that disclosure, and bracket-form CommonJS exports evade detection altogether. The repairs and working fixture guard justify 6 rather than 4–5; silent incomplete answers prevent the 7–8 band.

Path abbreviations: `WI` = `libs/backend/workspace-intelligence/src`; `LM` = `libs/backend/vscode-lm-tools/src/lib`; `PC` = `libs/backend/platform-core/src`.

## r4 findings status

| Finding                                         | Status                                                 | Evidence                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4-01 text-split specifiers                     | Original cases fixed; escaped string-name edge remains | `WI/ast/export-extraction.ts:245` reads child nodes. Real probes return b/d/x-y for aliases with comments and a quoted x-y name. R5-03 covers escape decoding, not the old whitespace split.                                                                         |
| R4-02 export assignment / exported import alias | Original examples fixed; end-to-end honesty incomplete | `WI/ast/tree-sitter.config.ts:315` captures assignment/alias forms; `WI/ast/export-extraction.ts:178` decodes them. `export = value` returns export= with localName=value; `export import Alias = Other` returns Alias with localName=Other. R5-01 and R5-02 remain. |
| 20.2 harness and 20.2p tables                   | No regression observed in independent probe            | Fixture still has 43 exports; 2184 source tokens versus 1174 table tokens (46.25% reduction). Parsed table round-trips to the real namespace result, including disclosure fields.                                                                                    |
| Pending 24r guard                               | Still the sole executable pending marker               | `WI/testing/mcp-contract/mcp-contract.bench.spec.ts:416`. Merge and activate the above-budget metadata test before treating that contract as verified.                                                                                                               |

## Independent probe evidence

Probes used real tree-sitter WASM, AstAnalysisService, the real AST namespace and a real dependency graph over mkdtemp files. Platform file access/logger/loading were the only adapters. No reviewed source was modified.

| Input                                                       | AST result / disclosure                                                                        | queryExports / graph                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `export {a /* c */ as b, a as /* public */ d, a as "x-y"}`  | b, d, x-y; localName=a                                                                         | Same names                                                            |
| `const value=1; export = value;`                            | export=, unknown, localName=value                                                              | Same record                                                           |
| `export import Alias = Other;`                              | Alias, unknown, localName=Other                                                                | Same record                                                           |
| `exports.a=1; Object.defineProperty(exports,"b",{value:2})` | a variable, b unknown                                                                          | Same records                                                          |
| `const key="actual"; exports[key]=1;`                       | exports=[]; unextractedExports=["line 1: exports"]; analyzed=0, failed=1, unsupported-syntax=1 | queryExports=[]; graph index empty, graph reports analyzed=1/failed=0 |
| `module["exports"].actual=1;`                               | exports=[]; no unextractedExports; analyzed=1, failed=0, parseStatus=ok                        | queryExports=[]                                                       |
| `export {a as "x\u002dy"}`                                  | Literal name x\u002dy, rather than semantic x-y; no warning                                    | Same wrong name                                                       |

All probed AST results round-tripped exactly through the table formatter. Lossless serialization preserves the data it receives; it cannot correct missing or misnamed extraction records.

## New defects / failure modes

### R5-01 — Blocking: symbol-index and queryExports paths discard known extraction gaps

- Files: `WI/ast/dependency-graph.service.ts:599–609,439–443,842`; `LM/code-execution/namespace-builders/ast-namespace.builder.ts:208`; `LM/code-execution/namespace-builders/analysis-namespace.builders.ts:339–350`; `LM/code-execution/mcp-core/protocol-dispatcher.ts:2219–2242,2842`.
- Trigger: index a file containing `const key="actual"; exports[key]=1;`.
- Symptom: the analyzer explicitly reports unextractedExports, but graph node construction copies only imports/exports/language. Coverage counts the node as successfully analyzed. The graph's symbol index omits nodes with zero extracted exports, so this file disappears entirely. queryExports independently discards the unextracted field by returning `.exports` alone.
- Measured graph: symbols=[], graphedFiles=discoveredFiles=1; languages census=complete, analyzed=1, failed=0, unresolvedInternal=0, context=complete. This qualifies as clean under the current `PC/interfaces/language-coverage.interface.ts:211` predicate (excluded=null is explicitly permitted there).
- MCP implication: the current dispatcher takes that empty symbol page and adds only graph file-cap completeness. With equal discovered/graphed counts it supplies no warning; the resulting data text is `{ "count":0, "total":0, "offset":0, "files":[] }` (compact JSON in production). This response shape is traced from the real graph result through the inspected dispatcher/renderer; a full MCP transport invocation was not run.
- Impact: a mandated replacement for native symbol discovery tells callers there are no symbols when extraction explicitly knows it was incomplete. The executor report correctly admits the gap, but report-only disclosure does not protect tool users.
- Smallest correction: retain extraction-partial state/reasons when publishing graph nodes/coverage; propagate them into symbol-index responses, including empty pages. Preserve usable edges/known symbols and avoid counting one file as both fully analyzed and failed. Use the same unsupported-syntax reason as ast_analyze. For queryExports, either add a compatible explicit completeness channel or reject partial extraction with a descriptive error directing callers to analyze; do not silently return an unqualified array.
- Ownership/handoff: the queryExports change is local to this batch; graph publication plus MCP qualification crosses Lane H contracts. Under Decision 22, carry the complete end-to-end fix into Batch 24d and test both empty and mixed complete/partial files after 24r merges. Changing only the graph counter will not fix the current dispatcher, which reads only file-cap completeness.

### R5-02 — Blocking: bracket access evades the CommonJS gap detector

- Files: `WI/ast/tree-sitter.config.ts:218–269`; `WI/ast/export-extraction.ts:275–287`; `LM/code-execution/namespace-builders/ast-namespace.builder.ts:228–254`.
- Trigger: valid JS/TS `module["exports"].actual = 1;`.
- Symptom: the query recognizes an identifier named exports and the dot-member expression module.exports, but not the equivalent subscript expression. No decoded record or unextracted reference is emitted. The real namespace returns parseStatus=ok, exports=[], no unextractedExports, census=complete, analyzed=1 and failed=0.
- Impact: even the newly qualified ast_analyze path silently loses a real CommonJS export. Bracket property access is ordinary JavaScript syntax; this is not a requirement to evaluate arbitrary runtime expressions.
- Recommendation: recognize constant-string bracket access to module's exports property, including supported member assignments, or at minimum capture it as an unsupported CommonJS reference. Add real TS and JS tests asserting that module["exports"] cannot yield clean-empty output. Pass its disclosure through the R5-01 repair.
- Ownership/handoff: query/extractor fix is local and small; record for Batch 24d under Decision 22 rather than opening another revision round here.

### R5-03 — Moderate: quoted export names retain escape syntax

- File: `WI/ast/export-extraction.ts:301–310` (`nameOf`).
- Trigger: valid quoted alias `export {a as "x\u002dy"}`.
- Symptom: nameOf joins named child text, including escape_sequence source text, so it returns the characters x\u002dy rather than the exported name x-y. This reproduces through analyze and queryExports with parseStatus=ok.
- Impact: exact-name lookup fails for escaped quoted public names. This is less common than ordinary aliases, hence Moderate rather than Blocking/Serious.
- Recommendation: decode string-literal escape sequences to their semantic value through a syntax-aware utility, or explicitly qualify unsupported name forms. Add escaped aliases and Object.defineProperty name cases. Carry to 24d with R5-01/R5-02.

## Platform-core contract and merge interaction

The additive `unsupported-syntax` reason at `PC/interfaces/language-coverage.interface.ts:71–83` fits Batch 22's existing vocabulary: the language/grammar is supported, parsing may succeed, but extraction is incomplete. The AST namespace correctly keeps parseStatus=ok while setting analyzed=0, failed=1 and failedByReason for a detected extraction gap (`ast-namespace.builder.ts:228–254`). It does not falsely classify TypeScript itself as an unsupported language. `isCleanAnswer` already treats nonzero failed as unclean. The vocabulary pin includes the new reason (`language-coverage.interface.spec.ts:59`); the worst-case old-shape coverage pin is now 994 characters, still below 1000 (`WI/ast/language-registry.spec.ts:153`).

**Team-leader merge note:** Lane H's approved 24r clean/reasons contract is not present in this tree. Preserve unsupported-syntax when reconciling enums/types, AST qualification and compact coverage/reason formatting. A syntactically clean parse with unextractedExports must map to clean=false plus the reason, not lose it because a new renderer reads only parseStatus. Reconcile the 994-character old-shape pin with the merged compact-shape contract rather than choosing either side mechanically. Preserve unextractedExports and clean/reasons through output reduction, activate the pending guard, and rerun the dependent/symbol-index SIZE guards with the actual merged envelopes. No claim of 24r integration validation is made here.

## Five logic questions

1. **How does this fail silently?** R5-01 throws away known extraction gaps; R5-02 never detects equivalent bracket syntax. Both reach successful empty answers.
2. **What user action produces unexpected behaviour?** Asking get_symbol_index for a workspace containing a computed CommonJS export returns no entry for that file (`dependency-graph.service.ts:842`), without the AST's unsupported-syntax warning.
3. **What input produces a wrong answer rather than an error?** The dynamic/bracket cases above produce empty results; escaped public names produce wrong semantic names (`export-extraction.ts:301`).
4. **What happens when a dependency fails?** Namespace query errors still throw before decoding (`ast-namespace.builder.ts:204`); service failure handling is unchanged. These findings occur with successfully parsed input, so dependency-error paths do not mitigate them. No additional timeout/failure-injection run was performed.
5. **What is missing that requirements never mentioned?** Syntactic equivalence of dot/bracket property access and semantic decoding of string names need explicit regressions; partial extraction must survive every consuming API, not only the AST envelope.

## Data flow

1. Real WASM captures -> shared extractor: original fixes verified; bracket references and escaped names remain gaps.
2. Extractor -> CodeInsights: exports and nonempty unextractedExports retained (`WI/ast/ast-analysis.service.ts:124–135`).
3. CodeInsights -> ast_analyze: detected gaps qualified and serialized ahead of tables; verified.
4. CodeInsights -> graph -> symbol page: disclosure lost at graph node creation, then empty records omitted; R5-01.
5. Raw query -> queryExports: `.exports` strips disclosure; R5-01.
6. AST result -> table formatter: exact round-trip on all probes; no new table defect.

## Requirements fulfilment and edge cases

| Requirement/case                           | Status                    | Evidence / remaining gap             |
| ------------------------------------------ | ------------------------- | ------------------------------------ |
| Original commented/quoted aliases          | COMPLETE                  | b/d/x-y exact results                |
| TS export assignment/import alias          | COMPLETE                  | export=/Alias records with localName |
| Basic CommonJS assignments/defineProperty  | COMPLETE for probed forms | a/b records extracted                |
| Detected gaps in ast_analyze               | COMPLETE                  | failed=1 with unsupported-syntax     |
| Detected gaps in symbol index/queryExports | MISSING                   | R5-01                                |
| Bracket CommonJS honesty                   | MISSING                   | R5-02                                |
| Escaped string-name semantics              | PARTIAL                   | R5-03                                |
| >=40% fixture AST SIZE with 43 exports     | COMPLETE                  | 46.25%, real tokens                  |
| Table serialization retains fields         | COMPLETE below budget     | All probe round-trips equal          |
| Above-budget metadata                      | PENDING 24r integration   | Sole todo at bench:416               |

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/platform-core --skip-nx-cache`: **FAIL**, 3m32s. Eight targets succeeded (including both workspace-intelligence and vscode-lm-tools tests and all three typechecks/lints); platform-core:test failed and Nx flagged it as flaky. The retained tail does not identify the failing assertion. No saved terminal output was found in the local Nx cache locations inspected; the suite was not rerun merely to recover output. The specific failure remains untriaged and must be checked before the Decision 22 commit; this report does not call it an unrelated or proven flaky failure.
- `nx run degradation-audit:lint --skip-nx-cache`: PASS, **TOTAL 300**.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: PASS, all external imports covered.
- Scoped ptah_get_diagnostics: provider returned **Unavailable — TypeScript check still running after 45s**; no clean-diagnostics claim and no retry loop. Nx typecheck is the independent verification above.
- Real-WASM/namespace/graph probes completed successfully, exposing the semantic failures listed above. Native CLI reads were used because no direct ptah file-read tool was listed. All probe roots were mkdtemp roots; no source edits, staging or git operations.
- Author's fails-before evidence (19 extraction runs plus four namespace tests) was inspected, not repeated with source mutations during this read-only review.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: mandated symbol discovery still silently reports a complete empty answer for known partial extraction.
- Decision 22 disposition: team-leader may commit with R5-01, R5-02 and R5-03 recorded as known issues and carried into Batch 24d; this reviewer neither commits nor changes task status.
- Robust completion: preserve extraction qualification end-to-end, cover bracket CommonJS syntax and escaped names, and verify the merged 24r reduction/coverage contract.
