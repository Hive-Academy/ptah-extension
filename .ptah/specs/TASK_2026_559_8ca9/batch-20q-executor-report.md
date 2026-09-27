# Batch 20.2q executor report: complete JS/TS export extraction

Lane A, part of the Batch 20.2 bounded correction. This fixes R3-B1 from `reviews/batch-20b-code-logic-review-r3.md`. Nothing was staged or committed. The bench spec, the fixture, `dependency-graph.service.ts` and its spec, and the code-symbol indexer files were not touched.

## Query: before and after

The query lives in `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`.

**Before** (HEAD, lines 154-188, used by both the `javascript` and `typescript` entries at lines 387 and 393):

- The `default` value pattern captured `export.value`, which no decoder read.
- Two overlapping patterns captured the same `export { }` clause: one without a source and one with a source. A named re-export therefore produced two records.
- Function and class declarations were captured, but neither pattern recorded whether the export was a default.
- Only `lexical_declaration` with an identifier name was captured, so `var` and destructuring were missed.
- There were no patterns for interface, type alias, enum, abstract class, overload signatures, namespaces, `export declare`, `export *` or `export * as ns`.

**After:**

- `JS_TS_EXPORT_QUERY` (lines 161-221) uses only node types that exist in both grammars:
  - function and generator declarations;
  - class declarations;
  - `lexical_declaration` and `variable_declaration` identifiers;
  - the ranges of exported destructuring patterns, plus binding captures inside any pattern;
  - `export default <value>`;
  - a single `export_specifier` pattern that covers local and re-export clauses;
  - `namespace_export` together with its source;
  - a plain `"*"` together with its source.
- Every declaration pattern also captures `@export.statement`. The decoder reads the `default` keyword and the `string` source from that statement's children.
- `TS_EXPORT_QUERY_SUFFIX` (lines 224-253) covers function signatures (overloads), abstract classes, interfaces, type aliases, enums (including `const enum`) and `internal_module`, plus the same set under `ambient_declaration` (`export declare …`).
- The TypeScript entry is `JS_TS_EXPORT_QUERY + TS_EXPORT_QUERY_SUFFIX` (line 454). The JavaScript entry is unchanged (line 448). A probe confirmed that the suffix does not compile against the JavaScript grammar (`Bad node name 'function_signature'`), and a spec pins that the JavaScript query still compiles.

## Decoders changed

- **New shared decoder** `libs/backend/workspace-intelligence/src/ast/export-extraction.ts`:
  - `extractExportsFromMatches` (line 53) turns query matches into export records.
  - `exportSymbolNames` (line 87) produces the names shown in the symbol index.
  - Both are exported from `src/index.ts`.
- **`ast-analysis.service.ts`**: the private decoder was deleted. It now calls the shared decoder (line 124). This path serves ptah_ast_analyze, the graph's `insights.exports` and therefore `getSymbolIndex`. The graph file is unchanged; it benefits because its data comes through this service.
- **`vscode-lm-tools/.../ast-namespace.builder.ts`**: the second, duplicate decoder was deleted. `queryExports` now calls the shared decoder (line 201).
- **The 20.2p table formatter (`ast-result-format.ts`) is unchanged.** It builds its columns from whatever fields the records have, so the new `localName` field becomes a column with no code change. The 20.2p specs (lossless, ≥40% tokens, status and coverage first) still pass with the larger export lists.
- **Symbol-index path** (`analysis-namespace.builders.ts:347`): now uses `exportSymbolNames`. Each name appears once (overloads and merged declarations no longer repeat), and a wildcard is listed as `* from <module>`.
- **Model changes**:
  - `ExportInfo.kind` and `AstExportInfo.kind` gain `enum`, `namespace` and `wildcard`.
  - Both gain an optional `localName`.
  - `types.ts` mirrors the change.
  - The `ptah.ast` prompt line (`system-namespace.builders.ts:387`) now lists the kinds and fields.

**Naming rules:**

- A default export of a named declaration keeps its declared name and gets `isDefault: true`.
- Any other default export is named `default`: kind `function` or `class` for anonymous functions and classes, `variable` for other expressions, and `unknown` with `localName` for `export default x`.
- `export { a as b }` gives `b` with `localName: 'a'`.
- `export * as ns` gives `ns`, kind `namespace`, with the source.
- `export *` gives `*`, kind `wildcard`, with the source. The names behind it are not resolved.
- Records are unique by (name, kind, source). Overloads collapse to one record; declaration merging keeps one record per kind.

## Export-kind table: before and after

| Kind                                                                                             | Before (r3)              | After                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------- |
| interface / type / enum / const enum                                                             | none                     | I interface / T type / E, CE enum                                |
| `var`                                                                                            | none                     | variable                                                         |
| destructuring (nested, default values, rest, arrays)                                             | none                     | every binding (e.g. a, c, d, f, rest), kind variable             |
| default named function/class                                                                     | name, but no isDefault   | name with isDefault                                              |
| default anonymous / expression / identifier                                                      | none                     | `default` (function / class / variable / unknown with localName) |
| `{a as b}`                                                                                       | `a`                      | `b`, with localName `a`                                          |
| `{e as f} from`                                                                                  | two `e` records          | one `f` record (re-export, source, localName `e`)                |
| `export *` / `* as ns`                                                                           | none                     | `*` wildcard / `ns` namespace, each with its source              |
| `export declare` (const, let, function, class, abstract class, interface, type, enum, namespace) | none                     | all of them                                                      |
| abstract class / overloads / `namespace`                                                         | none / 2+ records / none | class / 1 record / namespace                                     |

## Real files: before and after

| File                     | Census                | Before                        | After              |
| ------------------------ | --------------------- | ----------------------------- | ------------------ |
| ast/ast.types.ts         | 3                     | 0                             | 3                  |
| types/workspace.types.ts | 11                    | 0                             | 11                 |
| src/index.ts             | 94 named + 7 wildcard | 184 (duplicates, 0 wildcards) | 101, no duplicates |

The census for index.ts is 94 rather than the review's 92 because this batch adds 2 new named exports to that file.

## Specs and fails-before

- **New real-WASM spec** `src/ast/export-extraction.integration.spec.ts`: 51 tests.
  - It is table-driven over every export kind, running in TypeScript and also in JavaScript wherever the source is valid JavaScript.
  - Each case asserts the exact records and no duplicates, through both `analyzeSource` and `queryExports` plus the shared decoder.
  - The three real files are checked against a regex census computed inside the spec.
  - Module strings are built as `${FROM} './m'`, so the word and the quote are never adjacent in the source text.
- **Fails-before**: I swapped the HEAD versions of `tree-sitter.config.ts` and `ast-analysis.service.ts` back in and ran the spec: **49 failed, 2 passed**. The two that passed are:
  - the JavaScript-query-compiles guard, which protects against future regressions;
  - the unit test for the new `exportSymbolNames` helper.

  I then restored my versions and confirmed they match the backup with `cmp`.

- **Updated existing specs**:
  - `ast-namespace.builder.spec.ts`: the default-export mock now uses the new statement capture.
  - `analysis-namespace.builders.spec.ts`: the hand-written module mock now loads the real `exportSymbolNames`, and a new test covers deduplication and wildcard listing in the symbol index.

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck for 2 projects`.
  - The first run failed in three suites:
    - `analysis-namespace.builders.spec.ts`: a real failure. The hand-written mock had no `exportSymbolNames`, so the symbol index returned `[]`; fixed as described above.
    - `ast-analyze-result.spec.ts`: its `beforeAll` hit the 5 s timeout.
    - `protocol-dispatcher.spec.ts:5707`: a background-build timing assertion.

    The last two passed in the isolated run and the full rerun, so they look load-dependent.
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → `All external imports are covered`.
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300 unsuppressed site(s)`, success.
- Prettier was run on the changed files only.

## Still not covered, and why

- **Not modelled**: `export = x`, `export as namespace X`, `export import A = B` and `declare module 'm'`. They are CommonJS/UMD/ambient forms that the brief did not list, and each would need its own naming rule.
- **Wildcard names are not resolved.** `export *` is recorded with its source, but the names it brings in are not expanded. Resolving them requires following the graph across files, and the graph is owned by Lane H.
- **Possible false positive in destructuring.** A destructuring pattern _inside a default value_ of an exported destructuring would also be counted, e.g. the `q` in `export const { a = (({q}) => q)() } = o`. This comes from the range-containment rule.
- **Kind `unknown` for clause entries.** `export { a }` and `export type { T }` records get kind `unknown`, because the statement does not declare what `a` is.
- **Code-symbol indexer and outliner are unchanged** (as stated in the review; the indexer is Batch 24d's scope).
- **Bench todos (R3-B2)** are still for the tester to turn into real assertions.
- **`.tsx` files are parsed with the TypeScript grammar, not the TSX grammar.** This is pre-existing and not changed.

## Narrow fix (Decision 22)

This responds to `reviews/batch-20b-code-logic-review-r4-postcap.md`, findings R4-01 and R4-02. The same exclusions apply as before: the graph service and its spec, the code indexer, the bench spec and the fixture were not touched. Nothing was staged or committed.

### R4-01: specifiers are decoded from syntax nodes

`decodeSpecifier` in `export-extraction.ts` now reads the child nodes of the `export_specifier` node instead of splitting its text:

- Comment nodes are skipped.
- The anonymous `as` and `type` tokens are skipped.
- The first remaining node is the local name and the last one is the exported name.
- A `string` node is read as its value (its named `string_fragment` children), so `a as "x-y"` gives the name `x-y`.

The same node-based reading (`nameOf`) applies to `export * as "s-t"`, `export as namespace` and `Object.defineProperty` names.

### R4-02: module-system exports are records, and gaps are disclosed

**New patterns**

- TypeScript suffix in `tree-sitter.config.ts`:
  - `export = v`
  - `export as namespace N`
  - `export import X = N.Y`, filtered with `#not-eq? "require"`
  - `export import X = require(...)`, matched as a sibling pair. This grammar splits the `require(...)` part into the next statement and inserts a MISSING `;`, so the parse is honestly reported as `recovered`.
- Shared JS/TS query:
  - `module.exports = v`
  - `exports.a = v`
  - `module.exports.a = v`
  - `Object.defineProperty(exports, "a", …)`, where the `__esModule` marker is skipped
  - a reference pattern that catches every other use of `exports` or `module.exports`.

**Naming rules**

- `export = v` and `module.exports = v` are recorded under the name `export=`, which is the TypeScript compiler's own symbol name for a whole-module export. The kind comes from the value, and an identifier value also gets `localName`.
- `export import X = N.Y` gives `{X, unknown, localName: 'N.Y'}`.
- `export import X = require('m')` gives `{X, namespace, isReExport, source: 'm'}`.
- `export as namespace UMD` gives `{UMD, namespace}`.
- `exports.default = x` gets `isDefault`.

**Disclosure for forms that are still not extracted**

- `extractExportsFromMatches` now returns `{ exports, unextracted }`.
- `CodeInsights.unextractedExports` and `AstCodeInsights.unextractedExports` list each such use as `line N: <source>`, for example `exports[key] = v` or a read of `module.exports`.
- ptah_ast_analyze serialises that list immediately after `coverage`, ahead of the tables.
- In that case the coverage for a cleanly parsed file is `analyzed: 0, failed: 1, failedByReason: {'unsupported-syntax': 1}`, and `isCleanAnswer` returns false.
- **New failure reason:** `unsupported-syntax` is added to `FAILURE_REASONS` in platform-core. It is an additive change to the shared vocabulary, and I updated the pinned spec.
- **Size pin changed:** the worst-case coverage length went from 965 to 994 characters, still within the 1,000-character bound. I updated the pin in `language-registry.spec.ts`.

### Specs and fails-before

- `export-extraction.integration.spec.ts` gains 13 cases (20 runs across TS and JS), covering every reviewer probe. Each case also asserts `parseStatus` and `unextractedExports`. The suite now has 71 tests.
- `ast-analyze-result.spec.ts` gains 4 tests through the real namespace. They assert the `export=` result, the alias result, an unclean coverage for `exports[key]`, and the node-decoded aliases.
- I also gave that spec's `beforeAll` a 60 s timeout, because it hit the 5 s default under load in the earlier run.
- **Fails-before:** I swapped in the pre-fix 20.2q decoder (with only its return type adapted so it would compile) and the pre-fix query:
  - **extraction spec: 19 new runs fail**, and all 51 original tests pass. The one new run that passes, the inline `type` modifier with an alias, is a coverage case the old text split already handled.
  - **namespace spec: all 4 new tests fail.**

  I restored my files afterwards and confirmed them with `cmp`.

### Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/platform-core --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck for 3 projects`. The first run failed only on the two coverage-size pins in `language-registry.spec.ts`, which I then updated as described above.
- The bench, run once (`mcp-contract.bench.spec.ts`): 14 passed, 1 todo (the Batch 24r marker).
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success.
- `nx run ptah-electron:validate-deps --skip-nx-cache`:
  - First run: it flagged the module `m`, because the query comment's example `require('m')` ends up in a runtime string.
  - Fix: I reworded that comment and the matching JSDoc example to `require(<module string>)`.
  - Rerun: `All external imports are covered`.
  - After the rewording, the extraction spec still passes 71 of 71 and prettier reports clean.
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300 unsuppressed site(s)`.
- Prettier was run on the changed files only.

### Remaining limits

- **`ptah.ast.queryExports`:** it returns a bare array and has no coverage channel, so its gaps are not disclosed there. `ptah_ast_analyze` is the path that carries the disclosure.
- **Dependency graph and symbol index:** they store only `insights.exports`. Carrying `unextractedExports` into graph coverage requires a change to `dependency-graph.service.ts`, which is owned by Lane H.
- **Possible false positives from the reference pattern:** any identifier named `exports`, or any read of `module.exports`, marks the file as partial. This is deliberate: the answer errs towards not clean rather than towards a clean answer that is wrong.
- **Exports inside a `namespace` or `declare module` body** (for example `namespace N { export const Y }`) are still listed as file exports. This is pre-existing; I found it while testing and did not change it.
