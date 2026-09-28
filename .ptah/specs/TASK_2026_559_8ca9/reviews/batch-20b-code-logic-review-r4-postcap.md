# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Post-cap r4: Batch 20.2 harness, 20.2p lossless AST table, and 20.2q shared export extraction. Source was not edited. Findings are limited to realistic recall loss or misleading completeness, as requested.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 1              |
| Moderate issues     | 0              |
| Failure modes found | 2              |

The original declaration omissions are fixed: independent real-WASM probes recall all 57 fixture-known symbols, including all 43 exports of the 300-line file; the three real files return 3, 11 and 101 records without duplicates. Size comparisons and the ranking guard now satisfy the agreed scope. However, valid export aliases can be misnamed, and unsupported TS export assignments still return an apparently complete empty result. These concrete failures separate this implementation from the sound 7–8 band; the repaired guard and broad verified extraction separate it from the previous 3–4 band.

Paths below are relative to the worktree. `WI` means `libs/backend/workspace-intelligence/src`; `LM` means `libs/backend/vscode-lm-tools/src/lib`.

## r3 findings status

| Finding                                         | Status                                                        | Evidence and assessment                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-B1: missing TS declarations and export forms | Original examples fixed; two additional gaps remain           | `WI/ast/tree-sitter.config.ts:161,224`; shared decoder `WI/ast/export-extraction.ts:53`; see R4-01/R4-02. Interfaces, aliases, enums and re-export records now reach both analysis and symbol-index consumers.                                                                                                              |
| R3-B2: pending recall guards                    | Fixed                                                         | `WI/testing/mcp-contract/mcp-contract.bench.spec.ts:375` pins 43 names/kinds; `:657` checks every fixture-known symbol per file. Interface loss now fails executable assertions.                                                                                                                                            |
| R3-S1: unfair SIZE projections/baselines        | Fixed for the requested service-level scope                   | Bench `:626` uses unaltered absolute dependent paths and the current MCP envelope; `:693` reproduces symbol-page fields; `:787,796` uses relative paths on both ranking sides. Both sides use real token counts.                                                                                                            |
| R3-S2: ranking recall tests another result      | Fixed                                                         | Bench `:766` obtains one `getTopFiles` result; `:767` requires its length and subsequent score/size checks use that same result. An empty result cannot pass.                                                                                                                                                               |
| Earlier R2-03: above-budget metadata            | Explicit pending prerequisite, not a new blocker in this lane | Bench `:416` is the only executable todo in this harness; no executable skip found in the reviewed new specs. It is acceptable only under the stated agreement that approved Lane H 24r merges before commit and this marker becomes an executable guard. A todo does not activate automatically when another batch merges. |

## 20.2q findings and export-kind table

Measured using real tree-sitter WASM and `AstAnalysisService`, with platform logger/loading shims only. The three real-file inventories were independently checked with the TypeScript syntax tree, rather than the decoder or its regex census. Synthetic inputs were also exercised through the JavaScript grammar where applicable.

| Export kind                          | Native source/grep finds    | Tool finds                                          | Query/decoder evidence                    |
| ------------------------------------ | --------------------------- | --------------------------------------------------- | ----------------------------------------- |
| Interface / type alias               | I / T                       | I / T, correct kinds                                | `WI/ast/tree-sitter.config.ts:225`        |
| Enum / const enum                    | E                           | E, enum                                             | Same TS suffix `:225`                     |
| const / let / var                    | a, b, c                     | All three, variable                                 | Shared query `:173`                       |
| Object destructuring with alias      | a, c                        | a, c                                                | `:180,189`                                |
| Named default function               | Named, default export       | Named + isDefault=true                              | `:163`; `WI/ast/export-extraction.ts:113` |
| Ordinary alias                       | a as b                      | b, localName=a                                      | Query `:204`; decoder `:168`              |
| Named re-export                      | a as b from ./other         | One b record with source/localName                  | Same                                      |
| Wildcard re-export                   | * from ./other              | One wildcard record with source                     | Query `:213`                              |
| Namespace re-export                  | * as ns from ./other        | One namespace record, source kept                   | Query `:208`                              |
| export declare / overload signatures | a / repeated f signatures   | a / one f                                           | TS suffix `:225,235`; decoder dedup `:72` |
| Alias with intervening comment       | a as /* public name */ b    | Incorrect name `/* public name */ b`                | Decoder `:173–185`; R4-01                 |
| String-literal export name           | a as "x-y"                  | Incorrect name containing quote characters, `"x-y"` | Decoder `:177–185`; R4-01                 |
| TS export assignment                 | export = value              | Empty exports, parseStatus=ok                       | No capture in `:161–247`; R4-02           |
| TS exported import alias             | export import Alias = Other | Empty exports, parseStatus=ok                       | Same omission; R4-02                      |

JavaScript query compilation and extraction succeeded for named defaults, aliases, named/star/namespace re-exports and destructuring. Both alias failures also reproduce in JavaScript. Named defaults retain their declaration name with isDefault; expression defaults are represented as default, consistent with the documented contract. Wildcard records retain their module source; this does not claim transitive wildcard-name resolution.

| Real source under WI     | Independent native export records | Tool records | Missing / duplicates |
| ------------------------ | --------------------------------- | ------------ | -------------------- |
| ast/ast.types.ts         | 3                                 | 3            | 0 / 0                |
| types/workspace.types.ts | 11                                | 11           | 0 / 0                |
| index.ts                 | 101 (94 named, 7 wildcard)        | 101          | 0 / 0                |

A line-only grep sees 39 export-start lines in index.ts; multiline clauses contain the 101 records. Counting lines as symbols would be an invalid oracle. All 57 fixture-known symbols were recalled across tracked files; the data-processor file contributes 43.

The common query feeds parser queryExports, service analysis and namespace queryExports (`WI/ast/tree-sitter-parser.service.ts:562`, `WI/ast/ast-analysis.service.ts:124`, `LM/code-execution/namespace-builders/ast-namespace.builder.ts:201`). The dependency graph consumes analysis exports; the MCP symbol projection calls the shared exportSymbolNames (`analysis-namespace.builders.ts:347`). This does not establish full code-index coverage: its separate functions/classes consumer remains separately tracked, and the outliner has its own query path.

## New defects / failure modes

### R4-01 — Serious: textual alias decoding corrupts valid public names

- File: `WI/ast/export-extraction.ts:168`, especially `:173–185`; query captures the whole specifier at `WI/ast/tree-sitter.config.ts:204`.
- Trigger: valid TS or JS `const a=1; export {a as /* public name */ b};`.
- Symptom: analysis returns `{name:"/* public name */ b",kind:"unknown",localName:"a"}` with parseStatus=ok. Public symbol b is absent. A comment before `as` corrupts localName instead. `export {a as "x-y"}` returns a name containing the string-delimiter quotes rather than x-y.
- Impact: ast_analyze, queryExports and graph symbol listings propagate incorrect names. Exact-name lookup/recall loses a real export even though parsing succeeds.
- Current handling: split raw source text on whitespace/as and trim; comments and string syntax remain in semantic names. The real-file census spec repeats this split (`WI/ast/export-extraction.integration.spec.ts:458`), so those selected files do not independently validate this edge.
- Recommendation: capture the specifier's name and alias syntax fields separately, ignoring comment nodes; decode string-literal names to their semantic value. Add TS and JS exact-record tests for comments on either side of as, quoted aliases, and inline type modifiers. Do not fix this by stripping arbitrary comments with a source regex.

### R4-02 — Blocking: unsupported export syntax is silently presented as analyzed and complete

- Files: `WI/ast/tree-sitter.config.ts:161–247`; `WI/ast/ast-analysis.service.ts:124–135`; `LM/code-execution/namespace-builders/ast-namespace.builder.ts:95–105,218–233`.
- Trigger: analyze `const value=1; export = value;`, a normal TS export-assignment form used by CommonJS-facing modules/declarations. `export import Alias = Other;` reproduces the same class of omission.
- Symptom: the real namespace returns `parseStatus:"ok"`, `errorNodeCount:0`, `coverage:{census:"complete",analyzed:1,unchecked:0,failed:0,unsupported:0,...}`, and `exports:[]`. The tool offers no indication that its public-export extraction cannot represent the file's export.
- Impact: a caller mistakes extraction incompleteness for “no exports.” This is the same success-looking recall loss the task's honesty contract forbids. Documenting exclusions in batch-20q-executor-report.md is not disclosure in the tool response.
- Current handling: no capture/decoder for these forms; empty matches become undefined service exports and then an empty namespace list. Coverage derives from grammar eligibility and parse success alone.
- Recommendation: either represent TS export assignment/import-alias semantics, or detect these unsupported forms and carry explicit extraction-partial/unsupported reasons to analysis and graph/symbol consumers. Preserve truthful parseStatus (syntax parsing did succeed); distinguish extraction coverage. Add executable tests asserting the result cannot be an unqualified empty success. This does not require implementing all CommonJS/UMD forms in this correction.

## 20.2 / 20.2p validation

| Check                | Independently observed                                                    | Guard / assessment                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 300-line AST SIZE    | 2184 source tokens, 1173 MCP-table tokens: 46.29% reduction               | Bench `:363` requires >=40%; passes with all 43 exports, rather than buying reduction by dropping interfaces. Temp-root token variation is expected.                                                  |
| Table losslessness   | Actual namespace result round-tripped exactly on the fixture              | `WI/ast/ast-result-format.ts:28–70` uses JSON arrays, not delimiter-separated rows; pipes/newlines are escaped by JSON. Real null-valued records fall back to objects. No new formatter defect found. |
| Hub SIZE             | 12 dependents; 451 answer tokens versus 639 grep tokens: 29.42% reduction | Bench `:606–645`; real paths unchanged. The >=10 fan-in scope is explicitly authorized by Decision 21, not an undisclosed threshold relaxation.                                                       |
| Symbol-page envelope | 19 entries, 4482 characters / 1196 tokens                                 | Fits the default page limit of 30 (`symbol-index-query.ts:23`) and the normal result budget. The bench's whole-page representation matches the current renderer for this input.                       |
| RECALL               | 57 tracked symbols, no missing names; all 16 known edges asserted         | Fixture census and independent on-disk import-resolution checks remain executable.                                                                                                                    |
| Ranking              | Same getTopFiles result used for length, scores and size                  | Original empty-result false green removed.                                                                                                                                                            |
| Runtime              | Scoped suites passed, including the whole-bench <30 s assertion           | Bench `:309–315`; overall two-project verification takes longer than the bench and is not that acceptance metric.                                                                                     |

The current production dependent envelope uses graphCompleteness, which adds only file-cap fields (`LM/code-execution/mcp-core/protocol-dispatcher.ts:2050,2842`); the benchmark matches that current shape. It is not evidence for the future Lane H compact-coverage envelope. Re-run the guard after that merge.

Break proofs are meaningful for the documented paths: the bench calls exported language inference through the namespace object (`:442`), the formatter import transpiles to module-property access, and production imports those exported helpers. The new interface-drop proof acts on the shared decoder consumed by both recall checks. Dropping a hub dependent fails membership checks. Author-reported temporary mutation runs were examined; I did not repeat source mutations in this read-only review. No claim is made that these helper-level checks detect every possible future dispatcher wiring error.

## Five logic questions

1. **How does this fail silently?** R4-02 returns complete-looking empty exports on valid unsupported syntax (`ast-namespace.builder.ts:95,218`).
2. **What user action produces unexpected behaviour?** Asking for the public symbols of a commented export barrel loses the exported alias (R4-01, `export-extraction.ts:177`).
3. **What input produces a wrong answer rather than an error?** Comments and string-literal aliases produce malformed semantic names; TS export assignment produces empty exports. All reproduced with parseStatus=ok.
4. **What happens when a dependency fails?** Namespace parse/query errors are thrown (`ast-namespace.builder.ts:85,197`), and the harness asserts both complete and forced resolver-partial cases (`bench:534,555`). The new export failures are not dependency failures and bypass those paths. No additional failure-injection claim is made.
5. **What is missing that requirements never mentioned?** Export-specifier lexical trivia needs syntax-aware decoding. Unsupported export forms also require extraction-level disclosure, independently of successful parsing. Full wildcard target expansion remains expressly outside this representation.

## Data flow

1. Source -> language-specific real WASM query: ordinary TS/JS patterns verified; unsupported export forms have no capture (R4-02).
2. Captures -> shared decoder: declaration/default/re-export records verified; raw specifier splitting corrupts aliases (R4-01).
3. Decoder -> service/namespace/graph -> symbol-name projection: shared wiring verified; wrong or missing records propagate unchanged.
4. AST envelope -> JSON table: fixture field equality verified; ordering retained. Above-budget preservation awaits 24r.
5. Service result -> benchmark native comparison: real-token units and current envelope/path parity verified within Decision 21's scope.

## Requirements fulfilment / edge cases

| Requirement or case                            | Status                             | Remaining gap                                          |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| >=40% AST and enrichment, real tokens          | COMPLETE                           | Scoped tests pass; independent AST measurement above   |
| All fixture-known symbols/edges                | COMPLETE                           | Executable guards restored                             |
| Complete ordinary TS/JS extraction             | PARTIAL                            | R4-01 names; R4-02 unsupported forms                   |
| JS query compiles, overload duplicates removed | COMPLETE                           | Synthetic JS cases and real-file duplicate probes pass |
| Named/default/re-export metadata               | COMPLETE for tested ordinary forms | Alias trivia/string handling remains defective         |
| Fair hub/native SIZE and ranking recall        | COMPLETE                           | Future coverage merge requires rerun                   |
| Honest partial resolver state                  | COMPLETE                           | Forced-partial and complete tests both pass            |
| Above-budget metadata preservation             | PENDING approved dependency        | Sole 24r marker must become executable before commit   |
| Nx fixture never classified react              | COMPLETE                           | Active detector assertions pass                        |

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: PASS, six targets; 2m17s overall. Executed once, one completion check.
- `nx run degradation-audit:lint --skip-nx-cache`: PASS, **TOTAL 300** unsuppressed sites.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: PASS; all external imports covered.
- Scoped ptah_get_diagnostics: zero errors/warnings (TypeScript compiler).
- Independent mkdtemp-root Node probes: real WASM export kinds in TS/JS, fixture recall, three real-file TypeScript-AST censuses, namespace disclosure, actual formatter round-trip/token count, hub tokens and symbol-page budget. Final probes passed execution; the two semantic failures above were observed outputs, not exceptions.
- Native read/search fallback was used because direct ptah file-read tools were not listed. No source writes or git operations performed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: complete-looking symbol answers still lose valid public exports.
- What a robust implementation would add: syntax-field alias decoding and explicit handling/disclosure of unsupported export forms, with active recall/honesty regressions for both; activate the 24r guard after integration.
