# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 24d: **REVISE, 5/10**. Ordinary declarations, constant bracket exports, escaped Unicode names and the original computed-`exports[key]` disclosure now work. However, valid exports can still disappear behind clean coverage, and the new deduplication can confuse distinct declarations. This is above the fundamentally broken band because the main extraction/disclosure paths work end to end; it is below 7 because the missing-export honesty contract is demonstrably violated.

| Metric              | Value                                                          |
| ------------------- | -------------------------------------------------------------- |
| Assessment          | NEEDS_REVISION                                                 |
| Blocking            | 2                                                              |
| Serious             | 2 (one rolled-forward test-guard limitation)                   |
| Moderate            | 1                                                              |
| Failure modes       | 5 numbered findings                                            |
| Scoped verification | FAILED: workspace-intelligence:test; other five targets passed |

Reviewed the on-disk implementation, reports, context Decisions 7/9/18/22/24, Batch 24d acceptance criteria and language-plan contracts. No source/spec was edited and no git operation was run. Commit attribution is taken from the supplied reports, not independently asserted from a git diff. Paths below use **WI** = `libs/backend/workspace-intelligence/src`, **MCP** = `libs/backend/vscode-lm-tools/src/lib/code-execution`, **PC** = `libs/backend/platform-core/src`.

## Part 1 — rolled-forward r4 fixes

| Finding / carried limit                           | Status                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4-01: undefined capability / unused setup object | VERIFIED for both original probes                  | `MCP/mcp-core/mcp-mandate-manifest.spec.ts:501,534,593` resolves the returned object and requires a function. Independent evaluation of those actual AST helpers returns **false** for `createSecondCheckout: undefined`, **false** for an unreturned object containing the method, and **true** for a returned working method. Negative regression tests are at :804 and :810.                                                                                                                                                 |
| R4-01: mutation before returning a const setup    | OPEN — R24d-05                                     | `setup.createSecondCheckout = undefined; return setup` still passes the AST proof. The original cases are fixed, but the broader claim that the contract receives the capability remains unproved.                                                                                                                                                                                                                                                                                                                              |
| R4-02: final structured size and long locators    | VERIFIED                                           | `MCP/mcp-stdio/bounded-structured-content.ts:90` measures every final candidate, including recovery-only objects; :176 reserves omission metadata before filling strings. The corrected real `AgentToolDispatcher.agent_spawn` replay succeeds and returns **2,409 chars / 2,000 tokens**, with `role` disclosed as omitted. A 1,200-segment root produces **2,238 chars / 2,000 tokens**, using a relative locator. Regression guards: `bounded-structured-content.spec.ts:46,97,131` and `agent-tool.dispatcher.spec.ts:904`. |
| R4-03: late heading lost by occupancy fallback    | VERIFIED                                           | `MCP/mcp-core/tool-result-budget.ts:301,357,391` composes outline plus labelled leading prefix instead of refusing a sparse outline. Independent real HTTP `ptah_web_search` replay retains **CRITICAL-LATE-HEADING** and **The answer is 42**, at **7,935 chars / 1,108 tokens**. Shared-layer replay also preserves both and spools byte-equal raw text. Guard: `tool-result-budget.spec.ts:215`.                                                                                                                             |
| R4-03: first body marker plus 60 sections         | VERIFIED                                           | Replayed the r4 long first paragraph and 60-section input: **MARK-BODY-DROPPED**, all **60 headings**, byte-equal raw spool, **7,935 chars / 1,911 tokens**. Dense outline is re-requested in the 80% window at `tool-result-budget.ts:363`. Guard: `tool-result-budget.spec.ts:231`; its literal fixture differs from the old review, so this independent replay is relevant.                                                                                                                                                  |
| Composed output reports `truncated:false`         | VERIFIED limitation; not a blocking product defect | `tool-result-budget.ts:333` records only the final `fitWithTrailer` cut. Composition already shortened the raw prefix. Both replayed composites report false, but also `reduced:true`, reducer `markdown-outline+prefix`, an explicit “cut to fit” label and a raw locator. The value feeds HTTP telemetry (`protocol-dispatcher.ts:806`); it does not suppress the model's disclosure or recovery path. Clarifying the field comment would help; no observed consumer relies on false to mean raw output is complete.          |

The rolled-forward **Blocking R4-03 is closed**. No claim is made that every possible document's answer fits inline: the outline still has a finite budget and refuses when it cannot represent its required structure. These two demonstrated regressions are now protected without the former occupancy test.

### Merge fallout and harness integrity

The current sweep retains independent 8,000-char / 2,000-token pins (`mcp-contract.sweep.spec.ts:1302`), all-text-block accounting and printed-locator/raw-byte checks (:1416 onward), known reducer validation (:1340), success-before-contract checks (:1839), and equality of executed names with the served set minus explicit controls (:1955). The five explicit HTTP cells plus the exact eleven-cell table still exercise the 2 IDE × 2 SQLite × 4 caller matrix (:2026 onward). Fake coverage and LSP shapes now satisfy the published APIs; they do not replace the output assertions with fixture-derived bounds.

The two enlarged description pins are limited to `code_search_symbols` **1,021** and `code_reindex` **997** (:2099,2110); the separate dated tools/list byte pin remains (:2185). This is a deliberate update for the extra coverage/index description, not removal of the guard.

The pending 24r sweep case is now a real dispatcher test (:2497): qualified null fields lead the raw and returned result verbatim, a control without preserveKeys loses those nulls, and the same universal budget contract is applied. The new bench test (`WI/testing/mcp-contract/mcp-contract.bench.spec.ts:422`) similarly asserts exact preserved coverage and parseStatus, with removal of an unpreserved field proving reduction ran. Its preserve-key list is restated locally, but the real-dispatcher sweep supplies the integration protection. **No weakened assertion was found in these reviewed changes.** The LM target passed; the WI target did not, so the bench's current runtime success is not certified here.

## Part 2 — Batch 24d

### Carried acceptance criteria

| Criterion                                                            | Status                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5-01 computed `exports[key]` disclosure                             | VERIFIED for the original syntax                                 | `WI/ast/dependency-graph.service.ts:654` retains the partial node and records unsupported-syntax; :479 subtracts it from analyzed; :953 retains an empty-symbol entry; :1051 avoids subtracting an already-failed node on invalidation. `MCP/namespace-builders/analysis-namespace.builders.ts:467` copies unextractedExports. Real-parser dispatcher guards cover empty and mixed pages (`mcp-core/export-disclosure.integration.spec.ts:175,192`). |
| queryExports cannot publish known partial extraction as a bare array | VERIFIED                                                         | `MCP/namespace-builders/ast-namespace.builder.ts:215` throws with compact coverage and directs the caller to `ptah.ast.analyze`. Its new real-parser tests cover refusal and complete success (:229,239 in export-disclosure.integration.spec.ts).                                                                                                                                                                                                   |
| R5-02 constant string bracket access                                 | PARTIAL                                                          | Ordinary `module["exports"]["actual"] = 1` produces `actual`, including through the real dispatcher. Escaped/computed module access can still be clean-empty; see R24d-01.                                                                                                                                                                                                                                                                           |
| R5-03 quoted-name escape decoding                                    | PARTIAL                                                          | Unicode, hex, quotes, slash and code-point examples are guarded at `WI/ast/export-extraction.integration.spec.ts:481–524`; independent `x\u002dy` probe returns `x-y`. Legal legacy JS escapes remain incorrect: R24d-04.                                                                                                                                                                                                                            |
| Every indexable exported name/kind, no accidental suppression        | PARTIAL                                                          | Ordinary kind census and independent fixture checks exist (`WI/services/code-symbol-indexer.exports.integration.spec.ts`). Colon-name filtering and declaration deduplication violate the general contract: R24d-02/03.                                                                                                                                                                                                                              |
| Outline does not hide exported interfaces/types                      | VERIFIED by implementation/test inspection and passing LM target | `MCP/mcp-core/code-outliner.adapter.spec.ts:378` checks 14 declarations and the real files: each export row is outside every omittable span and inside its focus span. No production outline change was needed.                                                                                                                                                                                                                                      |

### R24d-01 — Blocking — matching a string fragment is not matching the CommonJS export object

- **Files:** `WI/ast/tree-sitter.config.ts:226,256,266,300`; `WI/ast/export-extraction.ts:319`.
- **Trigger:** `module["\u0065xports"].actual = 1;` (the key evaluates to `exports`). Also `const k="exports"; module[k].actual=1;`.
- **Observed:** real WASM analysis reports `parseStatus:ok`, `exports:[]`, `coverage.clean:true`; namespace queryExports returns `[]`; the actual `ptah_get_symbol_index` dispatcher returns `count:0`, `total:0`, `coverage:{clean:true,analyzed:1}`, `files:[]`. The SQLite single-file probe likewise reports clean with zero symbols.
- **Root cause:** both recognition and the gap detector require one raw `string_fragment` to equal `exports`. Escapes split the string into nodes and dynamic indices match neither branch. There is also a false positive: `module["exports\x78"].actual=1` is incorrectly reported as exporting `actual`, because one fragment equals `exports` even though the whole key is `exportsx`.
- **Impact:** the previous clean-empty failure remains reachable; a non-export property can also become a fabricated export.
- **Recommendation:** classify the complete semantic key, not an individual fragment. Decode constant strings once. Disclose unresolved module-index access conservatively rather than certifying an empty extraction. Guard both false-negative examples and the false-positive example through analysis, graph/symbol-index and queryExports.
- **Disposition:** **fix-now** in the 24d correction; verify at the next Lane A review under Decision 24. The executor's known-limit note is not an acceptance waiver.

### R24d-02 — Blocking — the code index silently drops names containing a colon

- **Files:** `WI/services/code-symbol-indexer.service.ts:329–335,1124,1172`.
- **Trigger:** `const a=1; export { a as "x:y" };` in an ordinary indexed `.ts` file.
- **Observed:** the extractor and graph index correctly expose `x:y`; the real CodeSymbolIndexer writes **zero rows**. `reindexFile` reports **clean:true, analyzed:1, failed:0, symbolsIndexed:0, errors:0**.
- **Root cause:** `isIndexableExportName` explicitly discards `:` names because the sink's subject encoding uses the last colon as a separator, but `outcomeOfParse` only checks parser/extractor gaps. This new index-stage loss never reaches coverage.
- **Impact:** exact-name lookup cannot find a valid exported name although the file is declared fully analyzed. This exceeds the specified wildcard/default/export= exclusions.
- **Recommendation:** represent names without delimiter ambiguity across the producer/sink, or at minimum mark this index-stage omission unsupported-syntax. Add a real sink/exact-name regression; a parser-only test cannot catch it.
- **Disposition:** **fix-now**; next Lane A review verifies.

### R24d-03 — Serious — deduplication substitutes a different declaration for an export

- **Files:** `WI/services/code-symbol-indexer.service.ts:300–318,1128`; range precision at `WI/ast/export-extraction.ts:146`.
- **Trigger A:** `export class A {} export interface A {a:number}` on one line. These are distinct kinds in a valid declaration merge.
- **Observed A:** only the `class A` row is written; the `interface A` row is lost, with clean single-file coverage.
- **Trigger B:** `class C { f(){} } export const f=1;` on one line.
- **Observed B:** rows are only `function f` (the method) and `class C`; the exported variable `f` is missing. Moving the export to the next line restores the variable row. The result must not depend on this whitespace change.
- **Additional scope collision:** `function outer(){function f(){}}` followed by `const f=1; export {f};` suppresses the export row because :314 accepts any same-named function anywhere in the file.
- **Root cause:** same name plus overlapping row is treated as identical declaration, irrespective of kind, column range or scope. A bare local export relaxes even the row check.
- **Recommendation:** deduplicate by actual declaration identity/range and compatible kind; preserve distinct declaration-merge kinds. Resolve bare local clauses against module-scope declarations, or retain a separate export row when identity is uncertain. Add same-line and nested-scope guards.
- **Disposition:** **fix-now**; next Lane A review verifies. Existing subject-set deduplication correctly prevents repeated newly added export subjects; this finding concerns suppression of different symbols, not that set.

### R24d-04 — Moderate — legacy JavaScript string escapes are returned as the wrong export name

- **File:** `WI/ast/export-extraction.ts:378–393`.
- **Trigger:** non-strict CommonJS `exports["\141"] = 1;` exports the key `a`.
- **Observed:** real JavaScript WASM analysis/queryExports/graph index report the literal backslash form `\141`, with `parseStatus:ok` and clean coverage. A separate Node VM execution of the same non-strict assignment produces `Object.keys(exports) === ['a']`.
- **Root cause:** unsupported escapes are returned unchanged by the new decoder, without qualifying extraction.
- **Impact:** exact-name recall fails for this uncommon but legal CommonJS input, the same class of error as carried R5-03.
- **Recommendation:** decode valid legacy JS escapes, or record an unsupported-syntax gap rather than publishing the source spelling as the semantic name. Include the runtime key in the regression oracle.
- **Disposition:** **fix-now** with the export decoder correction; verification rolls forward. Moderate reflects the uncommon legacy syntax, consistent with R5-03's prior severity.

### R24d-05 — Serious — manifest capability proof ignores writes to the returned setup

- **Files:** `MCP/mcp-core/mcp-mandate-manifest.spec.ts:534–563`; `PC/testing/contracts/run-diagnostics-provider-contract.ts:292`.
- **Trigger:** `runDiagnosticsProviderContract('P',()=>{ const setup={provider,createSecondCheckout(){}}; setup.createSecondCheckout=undefined; return setup; });`.
- **Observed:** independent evaluation of the submitted `hasActiveContractInvocation` returns **true**. The real shared contract's second-checkout test immediately returns when the capability is absent.
- **Root cause:** the initializer is resolved, but mutations between initialization and return are ignored.
- **Impact:** a direct, local removal of the required behavior can leave the mandate guard green. This is a residual test-guard gap, not evidence that today's provider actually makes this assignment.
- **Recommendation:** fail closed on writes/deletes to the supported setup object before return, or use runtime capability registration. Add this negative example. Arbitrary whole-program JavaScript analysis is not required.
- **Disposition:** **fix-now** as a rolled-forward guard correction, with verification in the next Lane A review; no new standalone Batch 21 revise loop. The original undefined/unreturned probes are verified independently above.

## queryExports callers and compatibility

Searched every `queryExports` reference under `libs` and `apps`. The parser service method (`WI/ast/tree-sitter-parser.service.ts:557`) retains its Result-of-captures contract. Its only production caller is the namespace builder (:206); other direct callers are tests. The public namespace's consumers are sandboxed user/agent code; generated help is at `MCP/namespace-builders/system-namespace.builders.ts:387`, and the public promise contract documents refusal at `MCP/types.ts:1193`. There is no repository production array-consuming caller whose unchecked assumption is newly broken.

An uncaught namespace rejection becomes a visible `isError:true` response through `MCP/mcp-core/protocol-dispatcher.ts:3359–3382`. Refusal of known partial extraction is the requested behavior. The existing conservative detector also flags ordinary `exports` reads: the independent `exports.a=1; console.log(exports.a);` case now refuses queryExports and directs to analyze. That is a compatibility restriction, not a new clean-empty defect; callers needing partial data must use the disclosed analyze result. This review does not claim compatibility with arbitrary external scripts that assume queryExports never rejects.

## Five logic questions

1. **How does it fail silently?** Escaped CommonJS and colon-named index entries can disappear while coverage says clean (R24d-01/02). A removed test capability can remain certified (R24d-05).
2. **What user action is surprising?** Searching an exported variable after putting it on the same line as a same-named class method finds the method instead; the variable row vanishes (R24d-03).
3. **What data produces a wrong answer?** String-fragment matches can fabricate an export, and legacy escapes produce the wrong name (R24d-01/04).
4. **What if dependencies fail?** Graph read/analysis failures are counted (`dependency-graph.service.ts:609–643`); symbol sink failures report failed writes (`code-symbol-indexer.service.ts:1066,1158`). queryExports failures remain visible. Structured bounding now checks recovery-only fallbacks as well as normal payloads (`bounded-structured-content.ts:104–116`). No new dependency-failure defect was established.
5. **What implicit requirement was missed?** Honest extraction requires both recognizing syntax and honestly representing it in the downstream sink. A clean AST parse alone cannot certify the resulting index, and line overlap is not declaration identity.

## Data flow and edge cases

| Stage/case                                         | Result                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query captures → semantic export records           | Ordinary forms OK; full string-key semantics and legacy escapes incomplete                                                                           |
| Known unextracted forms → graph failure census     | OK for `exports[key]`; still dependent on a complete gap detector                                                                                    |
| Partial graph node → empty/mixed symbol-index page | Preserved with unextractedExports; current integration guards cover both                                                                             |
| Export records → SQLite symbol subjects            | New name filter silently drops valid data; dedup can remove distinct kinds                                                                           |
| Wildcard/default/export= exclusion                 | Matches the explicitly requested row exclusions; named default declarations still retain their declared name                                         |
| Repeated same export subject                       | Set prevents repeated newly added export rows; declaration-merging kinds should remain distinct                                                      |
| index.ts/public-api.ts skip rules                  | Existing deliberate exclusion, not changed here; tests rename the barrel to exercise decoding and do not prove actual skipped barrels are searchable |
| Oversized Markdown / structured results            | r4 replayed regressions now fit and preserve required markers/recovery                                                                               |
| Post-initialization setup mutation                 | Known test-guard limitation remains open                                                                                                             |

## Verification

- Ran the requested two-project Nx command **once**, with output tailed: `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`. **FAILED**, **3m 36s**. WI test summary: **1 failed suite, 52 passed; 1 skipped test, 1,650 passed, 1,651 total**. LM test/lint/typecheck and WI lint/typecheck passed. The retained tail did not contain the failing diagnostic; the suite was not rerun merely to recover output. The Jest performance cache identifies this worktree's `mcp-contract.bench.spec.ts` as failed, but does not establish the cause. Do not classify it as a flake without evidence.
- Scoped `ptah_get_diagnostics` for the changed export decoder and AST namespace returned **typescript-compiler: 0 errors, 0 warnings**. This is not a substitute for the failed test target.
- Temporary real-WASM/runtime probes: **3 tests passed** (78.1 s), recording the extraction and indexing counterexamples. A follow-up corrected the reviewer's invalid spawn arguments and added valid same-line declaration examples: **2 passed** (31.4 s). The initial spawn response was a validation error and is expressly not counted as a budget verification. Separate real HTTP late-heading replay: **1 passed** (9.1 s).
- Temporary-spec `--testNamePattern reviewer` deliberately excluded copied original tests; reported skipped counts in those isolated runs are filtering, not added skips in production. Probes exercised the actual decoder/indexer/budget/dispatcher implementations, with fake filesystem/discovery adapters and a temporary in-memory sink matching the subject format. No claim is made that the in-memory sink proves database migrations or storage behavior beyond the supplied rows.
- Temporary probes and spool roots used mkdtemp; no source file or reviewed spec was edited. No state-changing git operation, external agent spawn or live network request was needed. Audit/validate-deps were not rerun: this request specified the two-project Nx check.
- Cleanup limitation: automatic approval review rejected both native PowerShell cleanup attempts with only “blocked by policy.” The worktree-local `.review-24d-O5Scl5` probe directory remains; test-owned spool subdirectories were removed by their fixture cleanup. It is reviewer evidence, not part of the submitted batch.

## Verdict

- **Part 1:** original r4 product failures VERIFIED fixed; original R4-01 counterexamples VERIFIED fixed; mutation residual OPEN as R24d-05. The rolled-forward blocking finding is closed.
- **Part 2 — Batch 24d: Recommendation: REVISE; score 5/10; confidence HIGH** in the independently reproduced export/index defects. Confidence in the exact cause of the scoped suite failure is LOW because its diagnostic was outside the requested tail.
- Fix R24d-01 through R24d-05 and verify them in the next Lane A batch review under Decision 24. Do not launch another dedicated review cycle for this batch.
- Top risk: a clean-looking empty or incorrectly typed symbol result still tells an agent that a real public export does not exist.
