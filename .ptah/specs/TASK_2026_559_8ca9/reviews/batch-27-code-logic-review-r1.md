# Code Logic Review — TASK_2026_559_8ca9 — Batch 27 r1

## Summary

| Metric                        | Value                                                        |
| ----------------------------- | ------------------------------------------------------------ |
| Part 1: rolled-forward fixes  | VERIFIED for the replayed findings                           |
| Part 2: Batch 27              | NEEDS_REVISION — 4/10                                        |
| Blocking / Serious / Moderate | 1 / 3 / 1                                                    |
| Failure modes                 | 5                                                            |
| Scoped verification           | All six requested test/lint/typecheck targets passed; 1m 14s |

The production fixes replay correctly. Batch 27 does not yet provide the promised guard against future silent degradation: a newly activated language can pass without behavioral proof, the supposedly fixed key set can change undetected, and the entire new workspace-intelligence honesty suite survives removal of the export-indexing loop. These are demonstrated false greens, not predictions from test names. Existing tests elsewhere still catch several of the mutations; this review does not claim the whole repository accepts them.

Score rationale: 4 rather than 5–6 because the central activation/recall gate accepts an unproved capability and several required integration contracts are absent. It is above the foundational-failure band because fixture construction, registry consistency checks, and formatter assertions do useful work, and the rolled-forward product fixes remain sound in the tested cases.

Paths below are relative to the worktree. Abbreviations: `WIT` = `libs/backend/workspace-intelligence/src/testing/mcp-contract`; `WI` = `libs/backend/workspace-intelligence/src`; `MCP` = `libs/backend/vscode-lm-tools/src/lib/code-execution`; `ELECTRON` = `apps/ptah-electron/src/services`.

## Part 1 — rolled-forward findings

| Finding / interaction                      | Status   | Evidence and independent replay                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R24d-01: whole decoded CommonJS module key | VERIFIED | `WI/ast/export-extraction.ts:326,332` classifies the whole key. Real-parser/dispatcher replay: `module["\u0065xports"].actual=1` yields `actual`; computed `module[k].actual` produces failed unsupported-syntax, remains in the symbol index with `unextractedExports`, and queryExports throws; `module["exports\x78"].actual` is correctly not an export.                     |
| R24d-02: colon-containing names            | VERIFIED | `WI/services/code-symbol-indexer.service.ts:1102` supplies explicit kind/name; `libs/backend/memory-curator/src/lib/symbol-sink.adapter.ts:43` consumes those fields before delimiter parsing. Real-indexer replay retains one `export` row named `x:y`. Sink preservation was checked by source trace; this replay did not boot a SQLite store.                                 |
| R24d-03: kind/name deduplication           | VERIFIED | `WI/services/code-symbol-indexer.service.ts:1102` preserves the export kind alongside existing declaration kinds. Replay retains both class A and interface A on one line, method/function f and exported variable f, and nested function f plus module export f. No duplicate export row appeared in these cases.                                                               |
| R24d-04: legacy string escapes             | VERIFIED | `WI/ast/export-extraction.ts:501` decodes legacy escapes. Real-parser replay of `exports["\141"]=1` yields semantic name `a`, also in queryExports and the served symbol index.                                                                                                                                                                                                  |
| R24d-05: returned setup mutation           | VERIFIED | `MCP/mcp-core/mcp-mandate-manifest.spec.ts:567,673` fails closed on mutation of the resolved setup. Evaluating the actual AST helpers rejects `setup.createSecondCheckout = undefined; return setup` and accepts the corresponding intact returned setup.                                                                                                                        |
| Carried benchmark timing concern           | VERIFIED | `WIT/mcp-contract.bench.spec.ts:305,329` measures CPU usage and enforces <30,000 ms CPU plus <120,000 ms wall time. The requested project test run passed these guards. This is a bounded CI guard, not a cross-machine latency guarantee.                                                                                                                                       |
| Lane J 24c descriptions versus 24d kinds   | VERIFIED | `MCP/mcp-core/mcp-contract.sweep.spec.ts:2097,2110` records the 699/702 and 524/536 measured/budget pairs; current cap tests passed. The code-search description includes interfaces, types, enums, variables, namespaces and export-clause names, consistent with the export loop and replayed kind behavior. No weakening of the size assertion was found in these pins.       |
| Lane H 26b saturation/truncation follow-up | VERIFIED | `ELECTRON/electron-ide-capabilities.ts:536,585,1314` carries page saturation through local/imported selection and into the report. Replayed match-cap, saturated-local and saturated-imported tests all pass. Removing only the final truncation field makes all three fail with expected true / received undefined. Guards: `electron-ide-capabilities.spec.ts:1515,2331,2348`. |

No replayed Part 1 finding remains open. This is verification of the named fixes and interactions, not a new approval of all historical source.

## Part 2 — Batch 27 findings

### R27-01 — Blocking — activation is accepted without an executable honesty contract

- **Anchor:** `WIT/language-honesty.contract.spec.ts:128`; `WIT/matrix/activations/activation-fragment.ts:7`; unsupported check at `language-honesty.contract.spec.ts:174`.
- **Trigger:** a future batch grants `parse:java` in the registry and adds a fragment containing that key, but implements no Java fixture assertion or honesty test.
- **Symptom:** the harness accepts the activation. The “100% recall” loop makes no assertion for keys without an approximation; a nonempty approximation label also requires no runtime evidence. The nonactivated check only consults the registry, not the tool's unsupported response.
- **Break proof:** in TEMP-only copies, grant Java parse and add a fragment declaring `parse:java`, with no Java behavioral test. All nine structure/registry tests pass. The supposed negative test at :141 only checks that its locally constructed empty array has length zero; it never runs a rejecting validator or an empty tool result.
- **Impact:** a required future capability can return a silently empty/incorrect answer while its activation and recall gate are green. The three baseline syntaxDiagnostics keys likewise have declarations rather than executable syntax-diagnostic checks in this harness.
- **Recommendation:** require every activated key to resolve to an executable fixture contract (or an exact verified test mapping) and run it. Measure expected names/edges/diagnostics and explicitly disclosed approximations; invoke nonactivated capabilities and assert their actual unsupported contract. Make the empty-answer negative exercise the same validator as real results.
- **Disposition:** **fix-now**, verified by the next Lane A review under Decision 24.

### R27-02 — Serious — the 58-key “snapshot” allows the required scope to change

- **Anchor:** `WIT/language-honesty.contract.spec.ts:80,158`; `WIT/matrix/required-keys.ts:116`.
- **Trigger:** replace the required `typeCheck:go` row with `typeCheck:kotlin`, keeping the count at 58.
- **Symptom:** all nine structure/registry checks still pass. Comparing a sorted result with its own sorted copy is not a snapshot. Honesty keys are checked against their own imported constant. The capability-key regex excludes typeCheck entirely, silently treating it like a non-registry key.
- **Break proof:** the one-row substitution above passed the submitted checks in a TEMP copy.
- **Current data:** the on-disk set is correct: 21 parse/outline/codeIndex keys, one enrichSummary key, nine syntaxDiagnostics keys, 16 publicSymbols/graphEdges keys, one Go typeCheck key and ten honesty keys = 58. Neither graphEdges:kotlin nor publicSymbols:kotlin is present. SELECTED_OPTIONS matches the decision. The defect is failure to pin this exact set and enforce all its categories.
- **Recommendation:** use an independent literal sorted expected set or committed snapshot, and handle typeCheck explicitly through its actual checker contract; fail on any unhandled key category.
- **Disposition:** **fix-now**.

### R27-03 — Serious — three symbol honesty keys do not guard the claimed tools or 24d kinds

- **Anchor:** `WIT/language-honesty.contract.spec.ts:387,454,484,491`; production mutation point `WI/services/code-symbol-indexer.service.ts:1102`.
- **Trigger:** remove export-row indexing while leaving function/class indexing intact.
- **Symptom:** the complete new workspace-intelligence honesty suite remains green. The shared test for code_search_symbols, get_symbol_index and code_reindex only checks that one Python class was inserted and that aggregate coverage is not clean. It does not call the graph-backed symbol-index surface or a symbol search, and contains no TS export-kind expectation.
- **Break proof:** change only the production copy's export iteration to an empty iteration; all **14/14** submitted honesty tests pass. Existing 24d tests outside this new suite can still catch this mutation.
- **Additional weakness:** the non-clean assertion does not establish the comment's promise that the no-grammar file appears as failed/unrecognised. Other unknown coverage fields can already make the run non-clean. There is no precise failure/census count or clean contrast for this scenario.
- **Recommendation:** give each named tool its actual entry path and output oracle. For 24d, query exact exported kinds/names after real indexing, including partial extraction through the graph symbol-index path. Assert the unsupported file's specific count/reason and a supported-only contrast. The new key's break proof must go red when the relevant production behavior is removed.
- **Disposition:** **fix-now**.

### R27-04 — Serious — dispatcher/recovery contract is deferred, and 26b is mapped to unrelated host tests

- **Anchor:** `MCP/mcp-core/mcp-language-coverage.spec.ts:28,40`; `MCP/mcp-core/mcp-mandate-manifest.spec.ts:146,820`.
- **Trigger:** a building/failed/partial response loses its disclosure during dispatch/reduction, or the Electron producer stops attaching truncation while the formatter still respects a supplied flag.
- **Symptom:** the new coverage spec cannot detect the dispatcher/reducer regression: it imports formatter functions and constructs reports directly. It never invokes the dispatcher, budget reducer or raw spool. Its comment defers the work despite `batches.md:3659` explicitly requiring those shapes, ordering and byte-equal recovery in this batch.
- **26b evidence:** the manifest entries point to `returns word-boundary matches across scanned files` and `finds an imported class through the import when the index returns no hits`, not the truncation guards. The added manifest assertion merely requires an Electron spec filename. Removing/skipping the actual 26b guard would not invalidate these mappings.
- **Break proof:** removing the Electron report's final truncation field fails the three existing host guards, while both new formatter truncation cases remain green because their input is already marked truncated. Separately, removing formatter handling of truncated does fail both new cases, so those cases are useful but cover only the downstream formatter.
- **Recommendation:** drive representative building/failed/partial reports through real dispatch and budget/spool, asserting order and raw equality, and extend the sweep as required. Map the mandate to exact host truncation/unsupported guard titles rather than generic location-lookup tests; retain the formatter tests as complementary coverage.
- **Disposition:** **fix-now**.

### R27-05 — Moderate — help promises a CLI scan fallback that is not wired

- **Anchor:** `MCP/namespace-builders/system-namespace.builders.ts:56,245`; actual no-host behavior `MCP/namespace-builders/ide-namespace.builder.ts:228,403,457`.
- **Trigger:** a headless CLI agent follows help's statement that the CLI falls back to name-based/graph-scoped scans and calls an IDE location operation.
- **Symptom:** without IIDECapabilities, the namespace returns the no-host report (`mechanism: 'none'`, `languageSupported: false`) and searches nothing. CLI/platform-cli contains no IDE capability registration. Electron does register its adapter at `apps/ptah-electron/src/di/phase-3-storage.ts:189`; that wiring does not apply to CLI.
- **Recommendation:** describe Electron's fallback separately and state CLI's current no-host behavior, or condition help on actual registered capabilities. Add a no-capabilities help/behavior consistency check.
- **Disposition:** **fix-now**; this is in the help text changed by Batch 27, not a request to implement CLI LSP.

## Five logic questions

1. **How does this fail silently?** A declared activation is certified without executing its behavior (R27-01, `language-honesty.contract.spec.ts:128`); removal of export rows is missed by the named symbol guards (R27-03, :484).
2. **What user action produces unexpected behavior?** Following CLI IDE help requests a scan that does not exist (R27-05, `system-namespace.builders.ts:245`). Adding a language fragment without a proof also succeeds unexpectedly for maintainers.
3. **What input produces a wrong answer rather than an error?** A same-cardinality but wrong required-key table passes as the decision's snapshot (R27-02, `language-honesty.contract.spec.ts:80`). Empty unsupported results are not submitted to a real honesty validator (:141).
4. **What happens when a dependency fails or returns an unexpected shape?** Replayed partial export extraction is honestly failed and recoverable through the symbol-index response. The new formatter tests preserve supplied qualifications, but do not establish that dependency-produced failure/partial states survive dispatch and reduction (R27-04).
5. **What is missing that the requirements never mentioned?** No new unstated product requirement is needed for these findings. Most gaps are explicit Task 27.2/27.3 requirements. Matching help to the actual host adapter is the implicit user-facing consistency requirement.

## Data flow

1. Polyglot fixture construction and cleanup: reviewed; deterministic source fixtures and scoped roots are available.
2. Required table to fragment discovery: subset/duplicate/registry checks work; exact scope pin and proof binding are missing (R27-01/02).
3. Fixture to service result: selected AST/enrichment/graph checks execute real behavior; symbol-tool coverage is not equivalent to its three named contracts (R27-03).
4. Host report to formatter: supplied bare-clean/truncation mutations are caught; producer and dispatcher/budget paths are separate and incompletely connected here (R27-04).
5. Help to host capability: Electron support is real; CLI support is overstated (R27-05).

## Requirements fulfilment and edge cases

| Requirement / case                                                        | Status                           | Evidence / gap                                                                           |
| ------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| Exact current Decision 18/19 data, 58 keys, no Kotlin graph/publicSymbols | COMPLETE as data                 | `required-keys.ts:66–116`; independent snapshot guard missing                            |
| Fragment discovery, subset, unique ownership                              | COMPLETE                         | `language-honesty.contract.spec.ts:65,101,112`                                           |
| Every activation forces honesty/recall proof                              | MISSING                          | R27-01                                                                                   |
| Nonactivated tools honestly report unsupported                            | PARTIAL                          | Registry queried; actual tool contract not exercised                                     |
| 25b bare-clean break proof                                                | COMPLETE at formatter layer      | TEMP production mutation: 1 failure / 7 passes                                           |
| 26b truncation break proof                                                | PARTIAL for new harness          | Formatter mutation: 2 failures / 6 passes; existing host guards detect producer mutation |
| 24d kinds break proof in new honesty suite                                | MISSING                          | Export-loop mutation: 14/14 pass                                                         |
| Building/failed/partial through dispatcher, reducer and raw spool         | MISSING in the new coverage spec | R27-04; existing Batch 21 guards are not evidence that these requested shapes were added |
| Same-line kinds, colon names, computed/escaped exports                    | VERIFIED rolled-forward          | Real parser/indexer/dispatcher replays above                                             |
| Saturated local/imported symbol page                                      | VERIFIED rolled-forward          | Three host tests pass before and fail after field-removal mutation                       |
| Runtime and test isolation                                                | Acceptable for current scope     | Requested six targets finish in 74 s; probes only under TEMP; no source mutations        |

## Verification and limits

- Ran the requested `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: all six targets passed, 1m 14s. No workspace-wide verification was run.
- Scoped diagnostics returned zero errors and warnings.
- Independent TEMP replays: two real-WASM replay tests passed; three existing Electron truncation guards passed. AST mutation probe rejected the invalid returned setup and accepted the valid one.
- Mutation outcomes: unproved Java activation **9 pass**; changed required typeCheck key **9 pass**; removed export indexing **14 pass**; forced bare-clean formatter **1 fail**; lost formatter truncation **2 fail**; lost producer truncation **3 existing host failures**, with **2 new formatter controls passing**.
- Production mutations were made only in TEMP copies, with import paths redirected to those copies. Initial TEMP real-WASM runs encountered duplicate module resolution; those results were discarded. Pinning one physical web-tree-sitter module made the controls pass; the reported mutation results use that corrected setup. No source/spec was edited, and no git command was used.
- Probe scripts, compact results and logs remain in `C:/Users/abdal/AppData/Local/Temp/ptah-review27-GRz1ui`. Full-project successful logs did not expose an individual-test count; none is inferred here. No additional audit/validate-deps run is claimed.

## Verdict

- **Part 1: VERIFIED** for all named replayed fixes and merge interactions.
- **Part 2 Recommendation: REVISE — 4/10.**
- Confidence: HIGH for the demonstrated false greens; MEDIUM for unexercised runtime/host combinations.
- Top risk: later language batches can declare completion while this harness never executes their promised honesty contract.
- Required correction: bind keys to executable proofs, pin the literal decision set, exercise each named symbol surface and required dispatcher shapes, map actual host guards, and make help match host capabilities. Under Decision 24, corrections should be verified by the next Lane A review rather than a separate review round for this batch.
