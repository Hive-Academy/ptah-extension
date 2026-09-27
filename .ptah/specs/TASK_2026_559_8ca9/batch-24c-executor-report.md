# Batch 24c executor report — Registry-generated descriptions (Lane J)

Base: `fix/task-559-lane-j` HEAD 68b8eb13b. Executor: backend-developer (sub-agent). No git state changed.

## Scope delivered

1. **24c.1 `languagesNote(capability)`**: every language-bound tool description gets its language list from the
   registry (`supportedLanguagesFor`), never from a hand-written list.
2. **24a r1 M2 (carried)**: `ast.parse`, `ast.queryFunctions`, `ast.queryClasses` and `ast.queryImports` now report
   parse honesty the same way `analyze` does.
3. **Ruling R2**: final sizes of the `ptah_code_search_symbols` and `ptah_code_reindex` descriptions, with the
   budget-table comments restored.
4. **26a finding R26A-m1**: the `ptah.help('ide.lsp')` text lists `getDefinitionReport` and `getReferencesReport`.
5. **Coordinator extra item (from Batch 24d)**: the `ptah_code_search_symbols` description lists every kind the
   code index now holds. It says: "It holds functions, classes, methods of <codeIndex> files, plus exported
   interfaces, types, enums, variables, namespaces and export-clause names (kind `export`) of <publicSymbols>
   files".
   - Both language lists are generated from the registry.
   - The export rows use `publicSymbols` because they come from the export query (24d `insights.exports`).
   - Wildcard exports get no row, so they are not listed.
   - On this branch the kind claim is accurate only once 24d (Lane A) is merged. Merge 24c and 24d together, or
     24d first.

## Files (all under `libs/backend/vscode-lm-tools/src/lib/code-execution/`)

- MODIFIED `mcp-core/tool-description.builder.ts`
  - Adds the exported `languagesNote(capability)` and a shared `GRAPH_LANGUAGES_NOTE`.
  - The `ptah_context_enrich_file` `language` enum now comes from the registry (`enrichSummary`).
  - Descriptions rewritten: `ast_analyze`, `context_enrich_file`, `code_search_symbols`, `code_reindex`,
    `get_dependents`, `get_dependencies`, `get_symbol_index`, `lsp_definitions`, `lsp_references`,
    `get_diagnostics`.
  - The coverage legend is shortened; it keeps every term the 24b specs require.
- MODIFIED `mcp-core/tool-description.builder.spec.ts`: new "Batch 24c" specs (listed under FB evidence) and
  `import 'reflect-metadata'`.
- MODIFIED `mcp-core/mcp-contract.sweep.spec.ts`: two budget pins re-pinned with justification comments and moved
  into sorted position. The `tools/list` total pin is unchanged.
- MODIFIED `mcp-core/agent-spawn-surface-parity.spec.ts`: adds `import 'reflect-metadata'` only (see Deviations).
- MODIFIED `namespace-builders/ast-namespace.builder.ts`:
  - New `queryWithQuality`: one `queryMulti` parse returns both the matches and the parse quality.
  - New `parseHonesty`: builds the honesty fields; `analyze` now uses it too.
  - `parse`, `queryFunctions`, `queryClasses` and `queryImports` return honesty fields first.
- MODIFIED `namespace-builders/ast-namespace.builder.spec.ts`:
  - Mocks moved from the per-query parser methods to `queryMulti`.
  - New stubbed specs for the recovered, unknown and clean cases.
  - New real-parser spec on a `.tsx` file with JSX. It uses the same WASM shims as `ast-analyze-result.spec.ts`.
- MODIFIED `types.ts`:
  - New `AstParseHonesty` interface; `AstCodeInsights` and `AstParseResult` extend it.
  - New result types `AstFunctionsResult`, `AstClassesResult` and `AstImportsResult`.
  - `AstNamespace.query{Functions,Classes,Imports}` return these new types.
- MODIFIED `namespace-builders/system-namespace.builders.ts`: help text changes.
  - `ide.lsp` lists both report methods, the report shape and the mechanism values.
  - `ast` states the parse-status contract and the new result shapes.
  - The stale "currently: javascript, typescript" is removed.
- MODIFIED `namespace-builders/system-namespace.builders.spec.ts`: new `HELP_DOCS — Batch 24c` specs.

## Design

### Language lists

- `languagesNote(cap)` returns `supportedLanguagesFor(cap).join(', ')` (`'none'` when the list is empty).
- The capability each tool uses is the one that tool's own coverage uses:

| Tool | Capability |
| --- | --- |
| `ast_analyze` | `parse`, plus `publicSymbols` for exports |
| `context_enrich_file` | `enrichSummary` (also used for the schema enum) |
| `code_search_symbols`, `code_reindex` | `codeIndex` |
| `get_dependents`, `get_dependencies`, `get_symbol_index` | `graphEdges` (graph coverage) |
| `lsp_definitions` | `definitionFallback` (the desktop declaration scan) |
| `lsp_references` | `graphEdges` (the desktop graph-scoped scan) |
| `get_diagnostics` | `syntaxDiagnostics` (the desktop/CLI syntax-only check) |

### The two indexes are named apart

- `ptah_code_search_symbols` searches "the SQLite code index" and points to exports: "graph export index:
  ptah_get_symbol_index".
- `ptah_get_symbol_index` reads "the graph export index (… files; not the SQLite code index of
  ptah_code_search_symbols)".
- `ptah_code_reindex` refreshes "the SQLite code index".

### Host mechanisms

`ptah_get_diagnostics` now names both hosts:

- VS Code extension: the editor's language services.
- Desktop app and CLI: the TypeScript compiler for TS/JS, plus a syntax-only check of scoped python, go and csharp
  files.

The two LSP tools already named their hosts. They now also carry the registry lists.

### Parse honesty on the four operations

- Each of `queryFunctions`, `queryClasses` and `queryImports` runs its query through `queryMulti`. That gives one parse
  that reports both the matches and the `parseStatus`, `errorNodeCount` and `errorNodeCountCapped` of that same tree.
- `parse` keeps `treeSitterParser.parse` for the generic tree, and adds a `queryMulti(content, language, [])` call for
  the quality. The generic tree drops tree-sitter's MISSING flag, so the quality cannot be read from it.
- Missing metadata means `unknown`, which is reported as unchecked coverage and never as clean.
- Field order is `parseStatus`, `errorNodeCount`, `errorNodeCountCapped`, `coverage`, then `file`, `language` and the
  list.
- The parser service was not changed: the signal already existed in `queryMulti`.

## Sizes

### Description lengths (chars)

| Tool | Before | After | Budget |
| --- | ---: | ---: | --- |
| ptah_code_search_symbols | 972 | **991** (894 before the 24d kinds) | 1,021 → **1,041** |
| ptah_code_reindex | 949 | **813** | 997 → **854** |
| ptah_ast_analyze | 448 | 479 | 503 |
| ptah_context_enrich_file | 1,059 | 1,075 | 1,175 |
| ptah_get_dependents | 647 | 712 | 722 |
| ptah_get_dependencies | 617 | 682 | 689 |
| ptah_get_symbol_index | 944 | 983 | 1,048 (and the builder-spec `< 1000` guard) |
| ptah_lsp_definitions | 572 | 609 | 639 |
| ptah_lsp_references | 472 | 495 | 529 |
| ptah_get_diagnostics | 477 | 497 | 535 |

- All other per-tool budgets are unchanged and all hold.

### Ruling R2 outcome

- The pre-24b budgets (702 and 536) cannot hold without dropping required content:
  - the 24b coverage legend (about 300 chars, required in both descriptions by the 24b specs);
  - the registry-generated language list (Batch 24c);
  - the code-index versus export-index distinction (Batch 24c).
- The prose around those parts was rewritten to its minimum, and the legend was shortened further. The tightest honest
  pins are **measured + 5%**, the same convention as ruling R2: 1,041 and 854.
- `ptah_code_search_symbols` now ends **above** the interim R2 pin (1,021). The 24d kind list adds about 100 chars
  of required content. It stays under the builder spec's `< 1000` guard (991).
- The comments in the sweep's budget table say this. The two entries are moved into sorted position.

### `tools/list` JSON size

- Before 126,190 bytes; after 126,367 bytes (+177), including the 24d kind list.
- The pin stays 125,374, with a +5% cap of 131,643. The pin was not edited.

## FB evidence (fails on HEAD 68b8eb13b, passes after)

### Method

- The four source files (builder, ast builder, system help, types) were replaced with `git show HEAD:<path>` copies.
- The new specs were run against those copies, then the working copies were restored.
- The run used a temporary jest config with ts-jest `diagnostics: false`, so a type-only change shows up as an
  assertion failure instead of a compile error. That config is deleted.

### Result on HEAD

Command: `-t "24c|Batch 24c|per-tool budget"`. Result: **37 failed, 2 passed**.

Failing on HEAD:

- `Batch 24c — description language list equals registry`:
  - all 11 marker rows (ast parse and exports, enrich, search, reindex, dependents, dependencies, symbol_index,
    lsp_definitions, lsp_references, diagnostics);
  - "no … old hand-written TS/JS-only claims";
  - "follows the registry: a capability granted to a new language appears without editing the builder" (a mocked
    `supportedLanguagesFor('codeIndex')` → `typescript, kotlin`).
- `Batch 24c — index and host mechanisms are named`: all 4 specs.
- `buildAstNamespace — 24c parse honesty (stubbed parser)`: recovered, unknown and clean × 4 operations, plus the
  "same parse" check (13 specs).
- `buildAstNamespace — 24c parse honesty (REAL parser, .tsx with JSX)`: `parse`, `queryFunctions`, `queryClasses` and
  `queryImports` all report recovered. On HEAD, `parseStatus` was absent.
- `HELP_DOCS — Batch 24c`: both specs (`ide.lsp` report methods; `ast` parse status).
- Sweep "keeps every tool description within its OWN per-tool budget": in the first FB run, `ptah_code_reindex` was
  949 against its new 865 pin (the final pin is 854).
  - After the 24d item, `ptah_code_search_symbols` (972 on HEAD, pin 1,041) no longer fails this spec.
  - Its FB is carried by the specs in the "Extra 24d-kinds FB" item below.
- Extra 24d-kinds FB: the HEAD builder was run against the final spec. These fail:
  - "ptah_code_search_symbols lists every kind the code index holds";
  - the new `publicSymbols` marker row.
  - Result: 13 failed in the filtered run.

Passing on HEAD (controls, not FB):

- "analyze agrees with the four operations": `analyze` already reports `recovered` since 24a.
- The `context_enrich_file` enum-equals-registry guard: the hand list happened to equal the registry.

After the change, all of these pass in the full run below.

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache`
  - Result: **Successfully ran** — Test Suites 75 passed / 75; Tests **2285 passed** / 2285 (final run, after the
    24d item).
  - Lint: 0 errors, 65 warnings. All 65 warnings are pre-existing. The only warning in a touched file is the existing
    `max-lines` warning on `tool-description.builder.ts`.
  - First run: one failure in `protocol-dispatcher.spec.ts` › "delivers a slow empty build to the next call, then
    rediscovers". This is a real-graph-service timing test that this batch does not touch. It passes in isolation, and
    the full run above was clean on re-run. Recorded as a load flake.
- `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: Successfully ran for 2
  projects.
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by
  package.json dependencies."
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: TOTAL 300.
- `ptah-core-prompt.ts` is unchanged versus HEAD, and `cli-adapter.utils.ts` (`NATIVE_AGENT_TOOL_POLICY`) is
  untouched.
- No new `as any` or `@ts-ignore`; catches are unchanged; imports use the package alias.

## Deviations

1. **File count is 9, not the 2 to 6 planned.**
   - The carried items explicitly add `ast-namespace.builder.ts` and its spec.
   - `types.ts` has to change, because the four operations' return types change (as 24a changed it for `analyze`).
   - R26A-m1 adds `system-namespace.builders.ts` and its spec.
   - `agent-spawn-surface-parity.spec.ts` needed a one-line `import 'reflect-metadata'`. The builder now imports the
     workspace-intelligence barrel, whose tsyringe services need the polyfill. That spec imported the builder without
     it and failed at suite load. No assertion changed.
2. **Breaking change in the `ptah.ast` API (execute_code only).**
   - `queryFunctions`, `queryClasses` and `queryImports` now return `{ parseStatus, errorNodeCount,
     errorNodeCountCapped, coverage, file, language, <list> }` instead of a bare array.
   - `parse` gains the same leading fields. That part is additive.
   - An array cannot carry the honesty signal "as analyze does" through a JSON result.
   - No in-repo consumer exists: grep shows only the help text and the specs. The `ast` help topic documents the new
     shapes. `queryExports` is unchanged: it stays an array, and unsupported languages already raise an error for it.
3. **Pre-24b budgets not reached** (ruling R2 allowed this): justified above, pinned at measured + 5%.
4. **`lsp_references` uses `graphEdges`, not `referenceScopeComplete`.** The desktop scan today scopes to any language
   in the graph (`electron-ide-capabilities.ts` `computeReferenceScope`). Both lists are equal today. Batch 26b owns
   the stricter rule.

## Out-of-scope observations

- **Merge conflict risk with Lane A 24d.** The Lane A worktree also has uncommitted edits to three files this batch
  changes:
  - `namespace-builders/ast-namespace.builder.ts`
  - `namespace-builders/ast-namespace.builder.spec.ts`
  - `types.ts`

  Expect a manual merge in the ast query and parse methods and in the `AstNamespace` types.

- Grammar batches (29b-31, 30k) will lengthen every generated description as they grant capabilities. Tools with
  about 10 chars of headroom will then need their per-tool pins re-measured in those batches:
  - `ptah_get_dependents` (712/722)
  - `ptah_get_dependencies` (682/689)
  - `ptah_get_symbol_index` (983, against both 1,048 and the `< 1000` builder-spec guard)
- `ptah.help('ide')` still says "exclusive to VS Code", although the desktop app serves `ptah.ide.lsp` by name-based
  lookup. Not changed here.
- `ptah_ast_analyze` returns `exports: []` with clean coverage for a Python, Go or C# file. The description now says
  exports cover TS/JS only, but the result itself does not qualify the empty `exports` list. This is a candidate for
  the Batch 27 honesty keys.

## Fix round (review r1)

Source: `reviews/batch-24c-code-logic-review-r1.md`, finding 1, "R2's claimed minimum is disproved" (fix-now).
Carried forward, not fixed in this round:

- finding 2, registry growth against the fixed guards → Batch 29b;
- finding 3, the `ide` help topic "exclusive to VS Code" → Batch 27.

### Change

The reviewer's shorter texts are adopted with equivalent wording. Every language list stays generated by
`languagesNote(...)`.

Shared `COVERAGE_LEGEND`, 209 chars:
`` `coverage` first: `clean`; if clean, only `analyzed`; else up to 3 `reasons`, omitted counts=0, null=unknown.
`?`=unknown; `truncated`=census cut; `stale`=last run partial; `updating`=writing; 999999=at least. ``

`ptah_code_search_symbols`, **699 chars** (was 991; pre-24b budget 702), keeps:

- SQLite code index, BM25+vector, "beats Grep";
- `Functions/classes/methods: <codeIndex>`;
- the Batch 24d kinds, `exported interfaces/types/enums/variables/namespaces/export-clause names (`export`):
  <publicSymbols>`;
- `ptah_get_symbol_index (graph export index)`;
- the hit fields and the `index` fields;
- empty or >24h index → background reindex; stale 0 hits inconclusive;
- the "index unavailable" fallback;
- the legend.

`ptah_code_reindex`, **524 chars** (was 813; pre-24b budget 536), keeps:

- the SQLite code index and `ptah_code_search_symbols`, and when to use it;
- the background full run and its return fields; "search when done";
- `filePath`: its own coverage and stats;
- `unsupported-language outside <codeIndex>`;
- no index → error;
- the legend.

Sweep: the budget pins are restored to **702 / 536** in their original table positions. The comments cite the measured
699 / 524 and the item-by-item spec.

### Specs

- New `Batch 24c fix round — shortened code index descriptions keep their required content`, 2 specs. Each asserts
  every required item as a meaning-bearing fragment, including the registry-generated lists, the 24d kinds and the
  10 legend items, plus `length <= 702` / `<= 536`.
- Phrase assertions updated to the new wording. The meaning of each is unchanged:
  - the 24b legend (`if clean, only `analyzed``, `omitted counts=0, null=unknown`);
  - the reindex single-file claim (`filePath: own coverage/stats`);
  - the 24c markers and host/index specs;
  - the 24d kinds spec.
- FB: on the pre-fix text (991 / 813) the new specs fail their length assertions. The restored sweep pins 702 / 536
  also fail against 991 / 813. Both pass now.

### Sizes

- `tools/list`: 126,367 bytes before the fix, 125,782 bytes after (−585). The unchanged pin is 125,374, with a cap of
  131,643.
- Search keeps only 3 chars of headroom (699 / 702). Any registry growth in `codeIndex` or `publicSymbols` must
  re-measure it. That is part of carried finding 2 (29b).

### Verification

`node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools
@ptah-extension/workspace-intelligence --skip-nx-cache`: **Successfully ran targets test, lint, typecheck for 2
projects**.

| Project | Suites | Tests | Lint |
| --- | --- | --- | --- |
| vscode-lm-tools | 75 / 75 | 2,287 passed | 0 errors (pre-existing warnings only) |
| workspace-intelligence | 52 / 52 | 1,629 passed, 1 skipped | 0 errors (pre-existing warnings only) |

This round changed only description strings and specs, so the earlier CLI/Electron typecheck, validate-deps and audit
(TOTAL 300) evidence stands.
