# Batch 24d executor report — the code index records every TS/JS export kind (+ R5-01..03)

Lane A, worktree `task-559-mcp-tool-contract`, base HEAD `68b8eb13b`. Nothing was staged or committed. `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are unchanged (checked with `git diff --stat` against the base). memory-curator was not touched: `code_symbols.kind` is free `TEXT` (migration 0013), so the new kind values need no store change.

## Files

- MODIFIED `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`: writes export rows; unextracted exports count as `failed` / `unsupported-syntax`.
- MODIFIED `libs/backend/workspace-intelligence/src/ast/export-extraction.ts`:
  - R5-03: string escapes are decoded.
  - R5-02: bracket CommonJS names are read through `nameOf`.
  - New `exportRowRange()` records the row range of each export (see Design).
- MODIFIED `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts` (R5-02):
  - Constant-string bracket forms of the CommonJS patterns.
  - `module["exports"]` is now recognised as a reference.
- MODIFIED `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts` (R5-01):
  - New `FileNode.unextractedExports` field.
  - Coverage counts such files as failed (`unsupported-syntax`), not analysed.
  - Partial files stay in the symbol index.
  - New `getUnextractedExports(filePath)`.
  - Invalidating a partial node does not move it to `unchecked`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`:
  - New optional `SymbolIndexEntry.unextractedExports`.
  - `queryExports` now documents the `@throws`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`: symbol-index entries carry `unextractedExports`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`: `queryExports` refuses a partial extraction. The error message carries the compact coverage (`unsupported-syntax`) and the unread forms, and points the caller to `ptah.ast.analyze`.
- CREATED `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.exports.integration.spec.ts`: the 24d FB spec (real WASM).
- CREATED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/export-disclosure.integration.spec.ts`: R5-01 and R5-02 end to end (real WASM, real graph, `handleMCPRequest`).
- MODIFIED specs:
  - `export-extraction.integration.spec.ts`: new R5-02 and R5-03 cases, each run for both TS and JS.
  - `dependency-graph.service.spec.ts`: new R5-01 describe.
  - `code-outliner.adapter.spec.ts`: new guard for the 2d outliner.
  - `ast-namespace.builder.spec.ts` and `analysis-namespace.builders.spec.ts`: mock fixes only (capture positions; `getUnextractedExports` stub).

## Design

**Export rows in the indexer.** After the function, class and method rows, each `insights.exports` record becomes one row.

- **Subject and kind.** The subject is `code:<kind>:<path>:<name>`.
  - The kind column keeps the declared kind: `interface`, `type`, `enum`, `variable`, `namespace`, `function`, `class`.
  - `unknown` becomes `export`. This covers clause names, aliases, `exports.x = local` and `export import`.
- **Text.** `<kind> <name>[ = <localName>][ from <source>] in <rel>:<start>-<end>`, using the same 0-based rows as the function rows.
- **Records that get no row:**
  - `*` wildcards. They name nothing here; their names are indexed in their own modules.
  - `default` and `export=`. A named default keeps its declared name.
  - Names containing `:`. `MemoryStoreSymbolSink.parseSubject` splits on the last `:`, so such a name cannot be stored.
- **No duplicate rows.** A record is skipped when the same declaration already has a function or class row:
  - that row has the same name and starts inside the export statement; or
  - the record is a bare local `export { f }` and the file has a function or class named `f`.

  An exported const that only shares its name with a method elsewhere keeps its row. Rows are also deduplicated by subject.

**Row ranges without changing the wire shape.** `ExportInfo` is serialised as-is by `ptah_ast_analyze` and by the symbol index. Adding a line field would have grown the 20.2p table and the SIZE benchmarks. Instead, `extractExportsFromMatches` records each record's range (the union of its match's captures, i.e. the whole statement) in a module-level `WeakMap`, read through `exportRowRange()`. Output sizes of ast_analyze and the symbol index are unchanged for files that extract fully.

**Batch 24b coverage.**

- A clean parse with `unextractedExports` is now `failed` with reason `unsupported-syntax`, the same reason `ast_analyze` and the graph give. The known symbols are still written.
- Every other outcome is unchanged.
- Freshness and state logic are untouched.

**Batch 2d outliner.** No defect was found. Its declaration queries already cover interface, type alias, enum, namespace, `declare`, abstract class and variable declarators. Omittable spans are only function-body interiors, so an export line is never hidden. A guard spec now pins this (below).

## FB evidence (fails on HEAD 68b8eb13b, passes after)

HEAD run: `jest -c libs/backend/workspace-intelligence/jest.config.ts code-symbol-indexer.exports export-extraction.integration` → **18 failed / 71 passed / 89**. The failures were:

- **Indexer spec (6/6 failed).**
  - Fixture: `defaultTokenEntropyBits` was missing (the first file checked).
  - `ast.types.ts`: CodePosition, GenericAstNode and SupportedLanguage were missing.
  - `workspace.types.ts`: all 11 were missing (ProjectType … ProjectAnalysis).
  - Barrel: 98 re-export names were missing (TokenCounterService, …).
  - Kinds test and unsupported-syntax coverage test both failed.
- **Extraction spec (12 failed):**
  - R5-02: the `module["exports"].actual` probe, the constant-key bracket forms, and computed-key disclosure, each in TS and JS.
  - R5-03: the escaped alias probe `x-y`, escaped re-export/local names, and escaped `defineProperty` / bracket names, each in TS and JS.
- **LM spec** (`export-disclosure.integration`): **5 failed / 1 passed**. The failures were R5-01 empty page, R5-01 mixed page, `queryExports` partial refusal, and R5-02 in `.ts` and `.js`. The one pass is the `queryExports` clean-file control.
- **Graph spec, new R5-01 describe:** fails to compile on HEAD with `TS2339: Property 'getUnextractedExports' does not exist`. Its two coverage tests use only existing APIs. The behaviour they check (empty and mixed partial files counted as failed, not analysed) is also shown failing by the LM spec above.

After the change, all of these pass: extraction 83/83, indexer 6/6, LM 6/6, graph describe included in the full WI run.

The r5 probe table, re-checked by the new specs:

| Probe                                 | Before                                          | After                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `const key="actual"; exports[key]=1;` | graph index empty, analyzed=1 / failed=0, clean | entry `{symbols: [], unextractedExports: ["line 2: exports"]}`, coverage `clean:false, failed:1, failedByReason: {unsupported-syntax: 1}` |
| mixed file                            | not qualified                                   | entry keeps `known` and names the gap; page coverage `analyzed:1, failed:1`                                                               |
| `module["exports"].actual=1;`         | clean-empty                                     | `actual`, kind variable, in TS and JS                                                                                                     |
| `export {a as "x-y"}`                 | `x-y`                                           | `x-y`                                                                                                                                     |

The 2d outliner guard spec passes both before and after. It is a guard, not a fix, because no defect was found.

## Verification

- `nx run-many -t=test,lint,typecheck -p workspace-intelligence vscode-lm-tools --skip-nx-cache --parallel=2`: **Successfully ran targets test, lint, typecheck for 2 projects**.
  - workspace-intelligence: Test Suites 53 passed / 53; Tests 1650 passed, 1 skipped / 1651.
  - vscode-lm-tools: Test Suites 76 passed / 76; Tests 2254 passed / 2254.
  - The first run caught 9 mock failures (see Deviations); these counts are from the re-run.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: Successfully ran target typecheck for 2 projects.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache`: **TOTAL 300**.
- Prettier was applied to every changed file after the runs. The changes were whitespace and wrapping only.
- **SIZE and 22c pins.** For fully extracted files, the `ptah_ast_analyze`, symbol-index and coverage shapes are unchanged. The only new field (`unextractedExports`) appears only on partial files, and the fixture has none. The 20.2 bench and 22c compact-coverage specs pass unchanged inside the runs above, so old → new is unchanged. `code_search_symbols` returns more rows, but it has no SIZE benchmark.
- **Fixture strings.** The new specs build module strings by concatenation (`'fr' + 'om'`, `${FROM}`).

## Deviations

- **`index.ts` is not indexed.** The indexer's skip list excludes `index.ts` on purpose: a barrel's names are indexed in their declaring files. Changing that would add duplicate re-export rows to exact-name answers (Batch 5). The spec therefore indexes the real `index.ts` text under the name `barrel-index.ts`, to prove every re-export name is kept when a file is indexed.
- **Code-index coverage is never `clean: true`.** A full run always carries the `unrecognised?` reason. So "Batch 24b unchanged" is asserted as `reasons: ['unrecognised?'], analyzed: N, failed: 0, unchecked: 0`.
- **Methods are `function` rows.** In the functions query, methods are captured as `function` rows (pre-existing behaviour; no `Class.method` row appears). The kinds spec pins what is actually stored.
- **Mock fixes in existing specs** (`ast-namespace.builder.spec`, `analysis-namespace.builders.spec`): the new row-range bookkeeping reads capture positions, and the symbol-index builder calls `getUnextractedExports`. Both mocks lacked the member; no assertion changed.
- **The graph R5-01 spec fails on HEAD at compile time** (the new method), not by assertion. The same behaviour is shown failing by assertion in the LM spec.

## Out-of-scope observations

- The `ptah_code_search_symbols` description (`tool-description.builder.ts`, owned by Batch 24c) still says "functions, classes, methods". It should now also name interfaces, types, enums, variables, namespaces and `export` rows.
- **Edge cases not handled:**
  - Names containing `:` are not indexed, because of the subject grammar in memory-curator.
  - `module["exports"]` (an escape inside the key) and `module[k]` are neither decoded nor disclosed.
  - Re-export sources are still read with the plain `unquote`, so escapes in them are not decoded.
- **Invalidating a partial graph node keeps its `failed` count** (it does not move to `unchecked`). This is deliberately conservative, but the coverage stays non-clean until the next build.

(The first two edge cases above are fixed in the round below. The review found that the old limit note did not waive them.)

## Fix round (review r1)

Source: `reviews/batch-24d-code-logic-review-r1.md` (REVISE 5/10). All five findings are fixed. The review's probes (`%TEMP%/review-24d-probes/`, not copied into the repo) are FB evidence for the pre-fix behaviour. Each fix has its own regression spec, and each spec was shown failing before its fix. No git commands were run.

Principle applied throughout: an export whose name the extractor cannot determine exactly makes the file `failed` with reason `unsupported-syntax`, listed in `unextractedExports`. It is never reported clean and never given a guessed name.

### R24d-01 (Blocking): escaped or computed `module[...]` keys

**Fix.**

- `tree-sitter.config.ts`: every `module[<key>]` form (the whole-object assignment, `.name`, and `["name"]`) and every `module[<key>]` reference now captures the whole index node (`@export.module_key` / `@export.module_reference_key`). Nothing is matched on a single `string_fragment` any more.
- `export-extraction.ts`, `moduleKeyClass`: the key is decoded as a whole.
  - A constant (string, number, or template without substitutions) whose value is exactly `exports` is the export object.
  - Any other constant (`module["id"]`, `module["exports\x78"]`) is not an export.
  - A computed or undecodable key is unknown. The match is then reported unnameable and its target goes into `unextracted`.
- The "decoded target" set, which suppresses gap references, now holds only matches that were actually understood. Previously a captured-but-undecodable target hid its own reference.

**FB (before the fix).**

- WI `export-extraction.integration.spec.ts`: 10 new runs across TS and JS failed. They cover the escaped key `module["exports"]`, the computed `module[k]` and template keys, the false positive `module["exports\x78"]`, legacy escapes, and an undecodable name.
- Reviewer probes (`exports.spec.ts`, `index.spec.ts`): real dispatcher `ptah_get_symbol_index` returned `count:0, coverage {clean:true}` for `module["exports"].actual`.

**After.** Extraction spec 93/93. New LM tests in `export-disclosure.integration.spec.ts`:

- `analyze` and `queryExports` return `actual` for the escaped key.
- A computed key gives `unextractedExports: ["line 2: module[k].actual"]`, `queryExports` refuses with `unsupported-syntax`, and the symbol index lists the file with coverage not clean.
- The `exports\x78` key produces no export and no gap.

### R24d-02 (Blocking): names containing `:` dropped from the code index

**Fix (complete, not just a disclosure).**

- `memory-contracts` `SymbolChunkInsert` gains optional `kind` and `symbolName`.
- `MemoryStoreSymbolSink` stores those as given, and falls back to parsing the subject only when they are absent.
- The indexer sets both on every chunk (function, class, method, export) and no longer filters out `:` names.

**FB.**

- New `libs/backend/memory-curator/src/lib/symbol-sink.adapter.spec.ts`: with the old parse-only adapter it failed 1 of 2 (the name was stored as `y`). It now passes 2/2.
- Indexer spec "indexes an exported name holding ':'" failed before and now passes. The row `x:y` (kind `export`) is written, and `reindexFile` reports `symbolsIndexed: 1`.

### R24d-03 (Serious): deduplication dropped distinct exports

**Fix.** Removed the name-and-overlapping-row test (`isAlreadyIndexed`). An export row is now skipped only when a row with the same subject (same kind and name) already exists, i.e. an exported function or class declaration.

- Same-named symbols of a different kind or scope keep their own rows: declaration merges, a method beside an exported const, a nested function beside a module-scope const.
- An exported arrow const now has both a `function` row and a `variable` row. The review allows this: when identity is uncertain, keep the separate export row.

**FB.** Three new `it.each` indexer cases (declaration merge on one line, a method and an exported const on one line, a nested function with a clause export) failed before and now pass. The fixture and real-file census tests still pass, with every known kind exactly as before.

### R24d-04 (Moderate): legacy escape names decoded wrongly

**Fix.** `decodeEscapeSequence` now follows the runtime's rules:

- legacy octal escapes `\0`–`\377` (`\141` → `a`; a 3-digit escape starting 4–7 splits, so `\400` → ` 0`);
- `\8` and `\9` are the digit itself;
- an escape with no exact value (e.g. `\u{110000}`) returns `undefined`, which becomes an `unextracted` entry (`line 2: a as "\u{110000}"`) instead of the escape's source text.

`nameOf` returns `undefined` for any part of a string it cannot decode. Every caller (specifier, namespace, `defineProperty`, CommonJS name) turns that into an unnameable, disclosed export.

**FB.** Included in the 10 extraction failures above. The oracle is the runtime key: `\141` is `a`, which matches the reviewer's Node VM probe `octal.cjs`.

### R24d-05 (Serious): manifest proof accepted a mutated setup object

**Fix.** `mcp-mandate-manifest.spec.ts`: new `setupKeepsOption`, which fails closed. When the returned value is a `const` setup object, every mention of it inside the callback must be one of:

- its declaration;
- `return setup`;
- a member access of another key;
- a read of `createSecondCheckout` (a call of it, a value passed on or returned, a condition, `typeof`, `!`, a right-hand side);
- or `setup.createSecondCheckout = <function>`.

Everything else fails the proof: `delete`, compound assignments, `++`/`--`, a non-function value, a computed key, `Object.assign` or `Object.defineProperty` on the setup, an alias, a spread, a destructuring target.

**FB.** 11 new negative self-tests (including the review's exact counterexample `setup.createSecondCheckout = undefined`). With the check bypassed: 11 failed, 37 passed. With it: 48/48. Positive controls (reassigning a function, touching other members) still count as proof.

### Workspace-intelligence suite failure seen by the reviewer

**Reproduced cause.** The failing suite is `mcp-contract.bench.spec.ts`. Its `afterAll` requires the whole file to finish within 30,000 ms of wall-clock time, measured from module load.

| Run                                                      | Bench file duration |
| -------------------------------------------------------- | ------------------- |
| Alone                                                    | 16 s                |
| WI suite alone (default workers)                         | passed              |
| WI suite with vscode-lm-tools tests running concurrently | 29.1 s, then 31.4 s |

31.4 s exceeds the old bound. This batch added WASM-heavy suites (the indexer integration spec takes 15.6 s under load; the extraction spec gained cases), which increased CPU contention in the full scoped run. The reviewer's run took 3 m 36 s and exceeded the bound.

**Fix.** The aggregate bound now measures the file's own CPU time (`process.cpuUsage`, user + system) against 30 s. A 120 s wall-clock limit remains as a hang guard. Measured cost: about 10 s of CPU alone. Under the same concurrent load that took 31.4 s of wall time, the bench now passes.

### Verification (fix round)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools @ptah-extension/memory-contracts @ptah-extension/memory-curator --skip-nx-cache`: **Successfully ran targets test, lint, typecheck for 4 projects**. memory-contracts and memory-curator are added because the sink port changed.

| Project                | Suites | Tests                  |
| ---------------------- | ------ | ---------------------- |
| workspace-intelligence | 53/53  | 1664 passed, 1 skipped |
| vscode-lm-tools        | 76/76  | 2270 passed            |
| memory-curator         | 44/44  | 783 passed             |

- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: success.
- `validate-deps`: "All external imports are covered by package.json dependencies."
- `degradation-audit:lint`: **TOTAL 300**.

**Sizes.** The `ExportInfo`, symbol-index and coverage wire shapes are unchanged. The 20.2 SIZE bench and the 22c compact pins pass unchanged, so old → new is unchanged. `unextractedExports` appears only on partial files.

**Deviations.** memory-contracts and memory-curator are outside the original 24d file list. They were touched for the complete R24d-02 fix, which is a two-field optional port extension; the sink still falls back to parsing the subject when the fields are absent. `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are unchanged.
