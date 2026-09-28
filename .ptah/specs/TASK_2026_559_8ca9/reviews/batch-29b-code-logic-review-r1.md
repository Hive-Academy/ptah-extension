# Code Logic Review — TASK_2026_559_8ca9 — Batch 29b r1

## Summary

| Metric                            | Value                 |
| --------------------------------- | --------------------- |
| Part 1: rolled-forward 29a2 fixes | VERIFIED              |
| Part 2: Batch 29b                 | NEEDS_REVISION — 5/10 |
| Blocking issues                   | 1                     |
| Serious issues                    | 1                     |
| Moderate issues                   | 1                     |
| Failure modes found               | 3                     |
| Recommendation                    | REVISE                |

The TSX grammar, shared queries, index activation and enrichment implementation work. The atomic change is incomplete at two consumer boundaries: Electron still parses TSX with the TypeScript grammar when filtering references, and the MCP budget path cannot invoke the code outliner. Enrichment discovery text also contradicts the new capability. These demonstrated integration failures separate this score from the sound 7–8 band; successful real-WASM and packaging checks separate it from a fundamentally broken implementation.

Reviewed the working files against the committed f5fbec072 tree using read-only object access, without git commands. Scope includes the new language module/activation, changed production wiring, regression tests, consumer paths and packaging gates. Relevant requirements: `batches.md:3831`, especially `:3855`, and `implementation-plan-languages.md:248`. Temporary probes and fixture archives are under `C:/Users/abdal/AppData/Local/Temp/ptah-review29b-iNvoQe`. No reviewed source or spec was edited.

Path abbreviations below: **WI** = `libs/backend/workspace-intelligence/src`; **MCP** = `libs/backend/vscode-lm-tools/src/lib/code-execution`; **Electron** = `apps/ptah-electron/src/services/electron-ide-capabilities.ts`. Anchors are relative to the reviewed worktree.

## Part 1 — Rolled-forward findings

| Item                                                      | Status   | Independent evidence and regression guard                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R29a2-01: dispose during runtime initialization           | VERIFIED | Re-ran the original delayed-init schedule: start parse, dispose, resolve runtime. Result is an error, with zero grammar loads and zero parsers retained/created by the load. `WI/ast/tree-sitter-parser.service.ts:185,221,225` rejects the obsolete generation; `:297` checks parser liveness after preparation. Submitted regression: `tree-sitter-parser.service.spec.ts:462`.                                                            |
| R29a2-01: stale failure clears newer initialization latch | VERIFIED | A / dispose / B / reject A / follower produces exactly **2** runtime initializations, not 3. The catch only clears state for its own generation (`tree-sitter-parser.service.ts:192`); disposal increments the generation at `:869`. Submitted guard at `tree-sitter-parser.service.spec.ts:483`, with normal reinitialization at `:511`.                                                                                                    |
| R29a2-02: enrichment loses refusal reason                 | VERIFIED | Real-WASM consumer probe rejects a grammar and separately supplies a nonempty source over 1 MiB. Enrichment returns full content with `grammar-unavailable` and `too-large`, respectively; oversized content is preserved byte-for-byte. Classification is at `WI/context-analysis/context-enrichment.service.ts:174`; regressions at its spec `:985,1003`. Graph/index/diagnostics refusal accounting also remains qualified in this probe. |
| Bench fixture rebuilding / timeout sensitivity            | VERIFIED | The five default-graph checks read one graph built by `beforeAll` at `WI/testing/mcp-contract/mcp-contract.bench.spec.ts:610`; the alias scenario retains its separate build at `:657`. The 30-second CPU assertion remains at `:331`. The required three-project run passed, including this suite.                                                                                                                                          |

The independent race file ran **4 passing probes**: both disposal schedules, eight concurrent rejected grammar calls sharing one load while a sibling succeeds, and UTF-8 size rejection before runtime/grammar loading. There is no open rolled-forward finding from 29a2.

## Part 2 — New findings

### R29b-01 — Blocking: Electron silently removes a real TSX reference

- **File:** `Electron:1271` (`.tsx` still returns `typescript` at `:1274`); filtering consumes that mapping at `:1126` and discards matches at `:1099`. The query table is at `:275`.
- **Trigger:** Call the public `getReferencesReport('/ws/App.tsx', 0, 14)` for this valid source:

```tsx
export const needle = 1;
export function App() {
  return <div>"{needle}"</div>;
}
```

- **Observed symptom:** The report contains only the declaration at line 0, column 13. It says `mechanism: 'text-scan'`, `language: 'tsx'`, `languageSupported: true`, and `approximations: ['text-scan']`; no truncation is disclosed. The actual JSX expression reference on line 1 is missing.
- **Cause:** The TypeScript grammar captures `"{needle}"` as a string, so the exclusion filter removes the reference. The real TSX grammar produces no string/comment capture there: the quote characters are JSX text around a real expression. Variants with JSX text `// {needle}` and `/* {needle} */` reproduce the wrong TypeScript captures too. This is a false negative, not merely the documented name-based false-positive approximation.
- **Evidence:** `electron-report.json` and `jsx-ranges.json` in the probe directory. The public-API regression assertion expecting two locations fails. LSP report language already uses the registry (`Electron:1311`), so its reported TSX language masks the stale parser selection.
- **Recommendation:** Make the parser-language lookup select `tsx` for `.tsx`, and add the TSX comment/string query entry. Prefer the shared extension map with explicit handling of any existing module-flavour aliases. Cover this exact public reference scenario with the real grammar. Audit `resolveImportedModule` (`:747`) because it shares the lookup. The separately declared lack of TSX index-free definition fallback is honest and need not be enabled to fix the reference filter.
- **Disposition:** **fix-now**, as the missed consumer in the atomic TSX activation; verify in the next Lane A review under Decision 24.

### R29b-02 — Serious: the activated code outliner is unreachable from tool results

- **File:** `MCP/mcp-core/tool-result-budget.ts:302` passes reducer options without `languageHint`; its input interface at `:135` has no such field. `MCP/mcp-core/protocol-dispatcher.ts:3124` passes an outliner but no language. `libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.ts:113` therefore takes the `no language hint` fallback before calling the adapter.
- **Trigger:** Return over-budget TSX source through a served tool, including `execute_code`. A file with three named component functions and long bodies is a useful contrast: an outline can preserve all three signatures within the window.
- **Observed symptom:** A real `handleMCPRequest` / `execute_code` call succeeds with trailer reducer `code-fallback:log-reduced`; the supplied outliner is called **zero** times. Independently, the same real TSX adapter given a language hint returns `code-outline`. In the three-function budget probe, the direct outline preserves `MiddleDeclaration`, while the production budget path omits it. The raw spool remains available; this is missing intended reduction behavior, not loss of the recovery file.
- **Coverage gap:** `MCP/mcp-core/mcp-language-coverage.spec.ts:304` proves `outline:tsx` by calling `outliner.outline` directly. It can remain green while every served tool misses the feature. Searches found only the budget call and the browser HTML acceptance probe as production `reduceOutput` callers; neither supplies a code language hint. The execute-code success route joins this budget path at `protocol-dispatcher.ts:3389`.
- **Recommendation:** Carry a trustworthy language/content hint from a source-returning tool through the budget input into `reduceOutput`, with appropriate handling of formatted envelopes. Do not infer a returned payload's language from the language used to execute its producer. Add a real dispatcher regression that invokes the actual TSX adapter, asserts `code-outline`, retains a middle declaration and checks the raw spool. Keep the direct grammar check as a lower-level contrast.
- **Disposition:** **fix-now**. The wiring gap predates 29b, but this batch explicitly requires MCP outline through the real dispatcher (`batches.md:3855`, language plan `:254`); accepting the activation without that boundary would repeat the named silent-degradation failure.

### R29b-03 — Moderate: tools/list still tells callers TSX enrichment is unsupported

- **File:** `MCP/mcp-core/tool-description.builder.ts:1726` and `:1736`.
- **Trigger:** A caller discovers `ptah_context_enrich_file` and decides whether to use it for a declaration-only TSX component file.
- **Observed symptom:** The generated description begins with `typescript, javascript, tsx file (not .tsx)` and still defines unsupported-language as including `.tsx`. The language argument description also says `.tsx is not summarised`, although its enum includes `tsx` and the production implementation summarizes that file.
- **Evidence:** Runtime-generated description recorded in `outline.json`; registry capability is true in `WI/ast/languages/tsx.language.ts:20`. Real dispatcher enrichment regressions at `MCP/namespace-builders/analysis-namespace.builders.spec.ts:1730,1742,1750` prove the newly supported behavior.
- **Recommendation:** Remove all three obsolete TSX exclusions, document `.tsx -> tsx` inference, and add a semantic description/schema assertion beside the behavior test. Preserve the declaration-only and load-time-JSX refusal distinctions.
- **Disposition:** **fix-now**, then verify in the next Lane A review. This is tool-facing behavioral guidance, not an internal comment/style issue.

## Other behavior examined

### TSX parsing, indexing and enrichment

`WI/ast/languages/tsx.language.ts:13` gives `.tsx` its own id and grammar while reusing the TypeScript query object. `languages/index.ts:20` registers it; TypeScript now owns only `.ts` (`typescript.language.ts:100`). Ten real-WASM TSX integration checks passed independently, covering JSX parse quality, function/arrow/generic components, class methods, imports and export kinds. A direct real-WASM outline also succeeds, including focus/declaration queries; the defect is its production entry path, not query compilation.

Graph parsing reads the shared map (`WI/ast/dependency-graph.service.ts:600`), as does the code index (`WI/services/code-symbol-indexer.service.ts:169`); these select `tsx`. AST namespace inference reads it at `MCP/namespace-builders/ast-namespace.builder.ts:387`. Diagnostics already includes `tsx` in its compiler-backed set (`WI/diagnostics/language-aware-diagnostics-provider.ts:139`). `file-type-classifier.service.ts:45` uses editor id `typescriptreact`, which is not a tree-sitter grammar selection and is not itself a defect.

The new fragment has exactly the four requested keys (`WI/testing/mcp-contract/matrix/activations/b29b.ts:24`). Real index and enrichment checks are registered, with a real index sink/coverage assertion at `language-honesty.contract.spec.ts:474` and declaration/load-time contrast at `:530`. The outline key's boundary shortfall is R29b-02. `resolveEnrichLanguage` reads the registry (`WI/context-analysis/enrich-language.ts:27,55`), and the service gate uses `enrichSummary` (`context-enrichment.service.ts:163`). Explicit and inferred TSX behavior is covered through the dispatcher.

The shortened `ptah_code_search_symbols` description (`tool-description.builder.ts:1835`) retains the distinction between code-index kinds and graph export lists. Its registry-generated claims agree with TSX indexing/export extraction; the existing 702-character pin remains (`mcp-contract.sweep.spec.ts:2101`) and the contract suite passes. R29b-03 concerns the separate enrichment tool.

### Packaging

The TSX manifest row is active (`scripts/tree-sitter-grammars.json:103`). Changing the activation self-test to **java** (`scripts/copy-wasm.js:301`) is appropriate: activating an already-active TSX row would no longer exercise a transition. The preceding assertion still compares copied files with all active rows (`:292`). The registry/manifest equality guard remains at `WI/ast/grammar-manifest.spec.ts:74`.

Independent temporary packaging checks:

- Ran the real copy script: exactly seven active WASM assets, including TSX and the runtime.
- Built resolver/config smoke bundles with the CLI and Electron esbuild settings, then loaded all six grammars from the copied assets. Both loaded TSX successfully.
- Put the copied assets into a temporary npm-style tarball and an actual ASAR. The production CLI/Electron archive verifier functions both accepted complete archives and both rejected a missing `wasm/tree-sitter-tsx.wasm`. ASAR cache was invalidated between fixture variants.

The package tasks call the shared copy step (`apps/ptah-cli/project.json:124`, `apps/ptah-electron/project.json:373`) and archive gates (`:136` and `:378`, respectively). These probes establish copying, resolution and archive-gate enforcement; they are not a full installed-app/installer smoke test.

## Five logic questions

1. **How does this fail silently?** Electron filters out a real expression reference while returning a supported TSX report (`Electron:1099,1271`): R29b-01. The outliner activation also misses the production path, although its fallback/spool is disclosed (R29b-02).
2. **What user action produces unexpected behavior?** Asking for TSX references produces the demonstrated incomplete set; requesting a large code result gets log reduction rather than an outline (`protocol-dispatcher.ts:3124`).
3. **What input produces a wrong answer rather than an error?** Valid JSX containing quoted expression text, such as `<div>"{needle}"</div>`, is parsed using TypeScript and excluded (`Electron:1126`). Long source with a middle declaration exposes the missing outline behavior.
4. **What happens when a dependency fails?** Grammar failure remains isolated by the per-language latch (`tree-sitter-parser.service.ts:231`); all eight concurrent rejected callers received the refusal and a sibling parsed successfully. Enrichment now preserves refusal reasons (`context-enrichment.service.ts:174`). Disposal invalidates old work instead of publishing it (`tree-sitter-parser.service.ts:185,225,297`).
5. **What was missing from the requirements?** The batch expressly names real dispatcher coverage, but does not specify the trustworthy language-hint source for arbitrary executed-code return values. That contract must be chosen when wiring R29b-02. The separate Electron grammar lookup was not included in the author's production file list despite the atomic language change; the user explicitly requested this audit.

## Data flow

1. `.tsx` discovery -> registry/map -> lazy TSX grammar: **OK** (`tsx.language.ts:13`, `tree-sitter.config.ts:16`).
2. Query compilation -> insights -> graph/index coverage: **OK in the tested cases** (`tsx-grammar.integration.spec.ts:139`, graph `:600`, index `:169`).
3. Enrichment inference -> capability gate -> structural summary or explicit refusal: **OK** (`enrich-language.ts:55`, enrichment `:163,174`).
4. Tool discovery -> agent selection of enrichment: **GAP R29b-03**.
5. Formatted tool text -> budget -> code reducer -> outliner: **GAP R29b-02** at the missing language hint.
6. Electron file -> local grammar switch -> reference exclusions -> LSP report: **GAP R29b-01**.
7. Manifest -> copy -> packaged resolver/archive checks: **OK in temporary bundle/archive probes**.

## Requirements fulfilment / edge cases

| Requirement / case                                     | Status                                  | Evidence or gap                                                        |
| ------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------- |
| Previous disposal race fixes and refusal reasons       | COMPLETE                                | Part 1 independent probes and submitted regression guards              |
| Concurrent grammar rejection / UTF-8 byte limit        | COMPLETE for tested schedules           | Eight shared failures; multibyte/surrogate limits rejected before load |
| Own TSX id, real WASM, query compatibility             | COMPLETE                                | Ten real-grammar checks passed                                         |
| Index and declaration-only enrichment activation       | COMPLETE                                | Required project suites and real-consumer harness checks               |
| Load-time JSX refusal; explicit/inferred TSX agreement | COMPLETE                                | Dispatcher tests at analysis namespace spec `:1742,1750`               |
| Real dispatcher outline                                | MISSING                                 | R29b-02; adapter-only activation check is insufficient                 |
| TSX consumer agreement in Electron                     | PARTIAL                                 | R29b-01; report id is updated, parser lookup is not                    |
| Honest tool discovery text                             | PARTIAL                                 | R29b-03; code-search description itself remains honest                 |
| TSX copied and checked in both app formats             | COMPLETE for reviewed pipeline/fixtures | Both resolver bundles and missing-asset archive negatives              |
| Full installed-app launch                              | NOT RUN                                 | Outside these scoped tests; not claimed as verified                    |

## Verification

- Required `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache`: **PASS**, exit 0, 2m32s, three projects plus six dependent tasks. Includes Electron main build. Log: `nx-main.log` in the probe directory.
- Required RPC test run: exit 1; **111 suites passed, 1 failed; 3275 tests passed, 4 skipped, 1 failed**. Sole failure is the disclosed `harness-skill-selection-rpc.service.spec.ts:113` state-file assertion (expected absent, found present). No six-suite module-mock gap remains. This known failure is not counted against 29b. Log: `nx-rpc.log`.
- Independent disposal/concurrency/byte probes: **4 passed**. Enrichment/graph/index/diagnostics real-WASM refusal probe passed, with output in `consumers.json`.
- Independent TSX query checks: **10 passed**, 7.4s. The temporary relocation script initially rewrote two import literals inside the fixture source; that probe-only mistake was corrected before the clean run. It is not a product defect.
- Direct outline/budget contrast passed; actual dispatcher call proves zero outliner calls. Three-function probe proves the middle declaration survives direct outlining but is absent from the budget fallback.
- Public Electron reference regression: **fails as expected**, returns one of two real occurrences. Source/spec untouched.
- Seven copied WASM assets; both six-grammar resolver smoke bundles passed; both archive formats pass complete and fail missing-TSX checks.

## Verdict

- **Part 1:** VERIFIED — no open 29a2 finding.
- **Part 2 recommendation: REVISE — 5/10.**
- **Confidence: HIGH** for the three findings, backed by real dispatcher/grammar/public-consumer evidence.
- **Top risk:** A correct TSX parser/index can coexist with an Electron reference result that silently omits real uses.
- **Required correction:** Wire TSX into Electron's parser/filter table, make source-aware dispatcher outlining reachable with a real boundary regression, and remove obsolete TSX enrichment exclusions from tool discovery text. Under Decision 24, verify those fixes in the next Lane A review rather than starting another review round for this batch.
