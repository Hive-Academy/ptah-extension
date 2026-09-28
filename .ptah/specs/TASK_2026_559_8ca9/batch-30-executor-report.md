# Batch 30 executor report — Java + Rust grammars

- Worktree: `task-559-mcp-tool-contract`.
- Base HEAD: `04a4874b8` (29b).
- No git command that changes state was run. The working tree is left dirty for the team leader.
- `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` were already untracked before this batch. They are
  not part of it.

## Changed paths (all of them)

New files:

- `libs/backend/workspace-intelligence/src/ast/languages/java.language.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/rust.language.ts`
- `libs/backend/workspace-intelligence/src/ast/java-rust-grammar.integration.spec.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/activations/b30.ts`
- `.ptah/specs/TASK_2026_559_8ca9/batch-30-executor-report.md` (this file)

Modified files:

- `libs/backend/workspace-intelligence/src/ast/ast.types.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/index.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/types.ts`
- `libs/backend/workspace-intelligence/src/ast/language-registry.ts`
- `libs/backend/workspace-intelligence/src/ast/language-registry.spec.ts`
- `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`
- `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`
- `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.spec.ts`
- `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.spec.ts`
- `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-language-coverage.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- `scripts/tree-sitter-grammars.json`
- `scripts/copy-wasm.js`

## What changed

### Language modules and registry (Tasks 30.1 and 30.2)

`SupportedLanguage` gains `java` and `rust`. `LANGUAGE_MODULES` registers `JAVA_LANGUAGE` and `RUST_LANGUAGE`. The
`java` and `rust` placeholders are removed from `UNPARSED_LANGUAGE_EXTENSIONS`, because the exhaustive `Exclude<>` record
requires it.

Both languages get the same capabilities:

| Capability           | Value | Why                                                      |
| -------------------- | ----- | -------------------------------------------------------- |
| `outline`            | true  |                                                          |
| `codeIndex`          | true  |                                                          |
| `syntaxDiagnostics`  | true  |                                                          |
| `enrichSummary`      | false |                                                          |
| `graphEdges`         | null  | Batches 34 and 35 own it                                 |
| `definitionFallback` | false | the Electron declaration scan has no Java/Rust query     |
| `publicSymbols`      | false | derived: `exportQuery` is `''`; Batches 34 and 35 own it |

Java queries (node names proven against `tree-sitter-java.wasm` 0.3.1):

- **Methods, as `@method.*`:**
  - `method_declaration`
  - `constructor_declaration`
  - `compact_constructor_declaration`
- **Types:**
  - `class_declaration`, `interface_declaration`, `enum_declaration`, `record_declaration`
  - `annotation_type_declaration`
- **Imports:** `import_declaration`.
  - A single-type or static import matches through the `.` last-named-child anchor.
  - An on-demand import reports the package with imported symbol `*`.

Rust queries (proven against `tree-sitter-rust.wasm`):

- **Functions:** `function_item`.
- **Types:**
  - `struct_item`, `enum_item`, `trait_item`
  - `impl_item`, indexed under the type it implements. This covers `impl Draw for Shape` → `Shape` and
    `impl<T> Point<T>` → `Point`.
- **Imports:**
  - `use_declaration`: the whole use tree. An alias reports its path, with the alias as the named symbol.
  - `mod_item` with `!body`.
  - `extern_crate_declaration`.

### Outliner and packaging

- **Outliner:** `OUTLINE_QUERIES` gains `java` and `rust`.
  - Java bodies: method, constructor (`constructor_body`), compact constructor, lambda and static initialiser.
  - Rust bodies: `function_item` and closure blocks.
  - Declaration sets cover types, members, fields, mods, consts and macros. For Rust, `impl` blocks are found under the
    type they implement.
- **Manifest:** `scripts/tree-sitter-grammars.json` sets `java` and `rust` to `active: true`.
  - The bytes are unchanged and match the installed files: 414,641 and 1,113,644 bytes (`wc -c`). Both rows are MIT.
- **`copy-wasm.js --self-test`:** its "activating a row copies it" probe used `java`, which is now active, so the probe
  proved nothing. It now uses `php`.
  - `--self-test` passes.
  - `--list` now includes `wasm/tree-sitter-java.wasm` and `wasm/tree-sitter-rust.wasm`.
  - The Electron, CLI and VSIX verifiers and `publish-cli.yml` read the manifest and have no hard-coded grammar list, so
    they are unchanged.
  - `grammar-manifest.spec.ts` follows the registry automatically and passes.

### Harness (Batch 27)

- **Fragment:** `b30.ts` lists exactly eight keys:
  - `parse`, `outline`, `codeIndex` and `syntaxDiagnostics`, each for `java` and `rust`.
  - Each `syntaxDiagnostics` key declares `syntax-only`.
  - `required-keys.ts` is not edited.
- **Checks in `language-honesty.contract.spec.ts`**, each of which runs:
  - `parse:java|rust`: `grammarParseHonesty`. The real parser gives `ok` and finds `Widget`/`render`. The contrast is a
    broken file of the same language, which must not be `ok`.
  - `codeIndex:java|rust`: the real `CodeSymbolIndexer` indexes the declarations, with coverage analysed 1 / unsupported
    0 / failed 0. The 29b TSX index check was generalised into `codeIndexHonesty` (third use); `codeIndex:tsx` now calls
    it with the same inputs.
  - `syntaxDiagnostics:java|rust`: the real `LanguageAwareDiagnosticsProvider` reports a syntax error and discloses
    `<id>:syntax-only`.
- **Checks in `mcp-language-coverage.spec.ts`:** `outline:java` and `outline:rust` are in `CHECKED_ELSEWHERE` here and
  in `CHECKED_ELSEWHERE_KEYS` / `MCP_HONESTY_CHECKS` there.
  - `grammarOutlineHonesty` checks exact adapter spans and that a syntax error is refused.
  - It also takes the served path: `execute_code` with `resultLanguage` `java`/`rust` → real dispatcher → budget →
    outliner. The reducer must be `code-outline`, every signature (the middle one included) must be kept, and the spool
    must be byte-equal.
  - The TSX dispatcher helper was generalised into `executeThroughDispatcher`, and `ServedTsx` was renamed
    `ServedResult`.

### Consumers that map extensions to languages (the R29b-01 lesson)

- **Electron `electron-ide-capabilities.ts`:** `extToLanguage` already reads `EXTENSION_LANGUAGE_MAP`, so `.java` and
  `.rs` now select their grammars. `COMMENT_STRING_QUERIES` gains `java` and `rust`:
  - **Java:** comments, char literals, and only `string_fragment`/`multiline_string_fragment`. The `\{expr}` of a
    string template stays a reference.
  - **Rust:** comments, char literals, and string/raw-string literals only when they contain no brace, using
    `#not-match? @x "[{}]"`.
    - Why: a format string's `{name}` can capture a variable, and the grammar does not parse it.
    - The query keeps such a string, which is the documented safe direction.
  - `declarationLanguage` stays unresolved for Java and Rust. That matches `definitionFallback: false`.
- **`WI/composite/workspace-analyzer.service.ts` `extractCodeInsights`:** it hard-coded tsx/ts, else javascript, so
  `.java`, `.rs`, `.py`, `.go` and `.cs` were all parsed with the JavaScript grammar. It now looks the extension up in
  `EXTENSION_LANGUAGE_MAP` and keeps the javascript fallback for anything else.
- **Already correct:** the graph, code index, AST namespace, diagnostics provider, enrich-language and the outliner's
  `resolveLanguage` all read the shared map or the registry.
- **rpc-handlers `heavy-module-mocks.ts`:** no new workspace-intelligence export, so the mocks are unchanged, and the
  rpc-handlers suites load.

### Tool descriptions (24c per-tool budgets)

The registry lists grew by `java, rust`. Before trimming:

- `ptah_code_search_symbols` measured 714 against its 702 pin.
- `ptah_code_reindex` measured 541 against its 536 pin.

I shortened the wording and raised no pin:

- **Shared `COVERAGE_LEGEND`:** "else " and the final period are dropped: "if clean, only `analyzed`; up to 3
  `reasons`, …, 999999=at least". Every `LEGEND_ITEMS` fragment is kept.
- **Search tool:**
  - "(BM25+vector); beats Grep" → "(BM25+vector) beats Grep".
  - "Export lists: ptah_get_symbol_index (graph export index)" → "Exports: ptah_get_symbol_index (graph export index)".
  - The Batch 24c assertion in `tool-description.builder.spec.ts` is updated to the new fragment. Every required item
    is still asserted.
- **Result:** search is 702 of 702 (0 headroom), reindex 535 of 536. The `tools/list` total pin and every other
  per-tool budget pass.
- **Risk for the next batches:** Batch 31 (php, ruby, cpp) and 30k (kotlin) add about 25 more characters to both lists.
  No honest slack is left in these two texts, so those batches need a decision: either render the lists compactly or
  raise the pin with a recorded reason.

### Spec literals that named Java or Rust as the "unsupported" example (updated in the batch that changes them)

- **`language-registry.spec.ts`:**
  - The pinned parse, outline, codeIndex and syntaxDiagnostics lists now include `java` and `rust`.
  - The unsupported examples `.java` / `src/Main.java` became `.php` / `src/Widget.php`.
- **`language-aware-diagnostics-provider.spec.ts`:** the unsupported examples `A.java`/`m.rs`/`svc/Main.java` became
  `A.php`/`m.rb`/`svc/Widget.php`.
- **`code-symbol-indexer.service.spec.ts` and `code-namespace.builder.spec.ts`:** the `CODE_INDEX_LANGUAGES` literals
  now include `java` and `rust`.
- **`ast-namespace.builder.spec.ts`:** the `sample.java` unsupported case became `sample.php`.
- **`code-outliner.adapter.spec.ts`:**
  - The refused-hint list swaps `rust` for `kotlin` and `.kt`.
  - New hint cases: `java`, `.JAVA`, `src/main/java/App.java`, `rust`, `rs`, `src/lib.rs`.
  - New real-grammar tests: "java outline not refused" and "rust outline not refused", with exact spans and focus.

## Fails-before evidence (base `04a4874b8` production, specs written first)

I ran the new specs against unmodified production code. At that point the new language modules existed but were not
registered, so they had no effect. The Jest configs were temporary, out-of-repo copies of the project configs with
`diagnostics: false`, because the normal configs fail to compile with `'java'` not assignable to `SupportedLanguage`.
The temporary configs were deleted afterwards.

- **Workspace-intelligence** (java-rust integration, honesty contract, workspace-analyzer): 3 suites failed; 26 failed
  / 30 passed.
  - All 16 `java-rust-grammar.integration` tests failed.
  - The `parse`, `codeIndex` and `syntaxDiagnostics` honesty checks failed for both languages. Two of the messages:

    ```
    AST analysis failed for /ws/src/com/example/Widget.java: Cannot read properties of undefined (reading 'functionQuery')
    src/com/example/Widget.java declarations were not indexed: ["Widget","render"] (indexed [])
    ```

  - "every activated capability:language key is actually granted by the registry" failed.
  - All three analyzer grammar-selection cases failed. The `.py` case failed too, because the base parsed it as
    javascript.
- **vscode-lm-tools** (outliner, coverage): 10 failed / 58 passed.
  - "java/rust outline not refused" failed.
  - Six hint-resolution cases failed.
  - `outline:java` and `outline:rust` in `MCP_HONESTY_CHECKS` failed with "the .java outline was refused".
- **Electron** ("Batch 30: .java and .rs references are filtered with their own grammars"): both tests failed. The base
  kept comment and string matches: 25 extra received lines for Java, and similar for Rust.

After the change, all of these pass. The FB runs double as the sabotage proof for each new honesty check: each one
throws while its capability is absent.

## Verification (after)

- **Scoped test, lint and typecheck:**
  `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache`
  printed "Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on".

  | Project                | Test suites               | Tests                         |
  | ---------------------- | ------------------------- | ----------------------------- |
  | vscode-lm-tools        | 77 passed / 77            | 2356 passed / 2356            |
  | workspace-intelligence | 57 passed / 57            | 1746 passed, 1 skipped (1747) |
  | ptah-electron          | 54 passed, 1 skipped (55) | 933 passed, 3 skipped (936)   |

- **rpc-handlers:** `nx run-many -t=test -p @ptah-extension/rpc-handlers --skip-nx-cache` gives Test Suites 111 passed,
  1 failed (112) and Tests 3275 passed, 1 failed, 4 skipped. The only failure is the known flake
  `harness-skill-selection` › "never writes state.json".
- **ptah-cli typecheck:** `nx run-many -t=typecheck -p ptah-cli --skip-nx-cache` printed "Successfully ran target
  typecheck".
- **validate-deps:** `nx run ptah-electron:validate-deps --skip-nx-cache` printed "All external imports are covered by
  package.json dependencies." The new query text and fixtures hold no quoted module-specifier shapes; Java `import` and
  Rust `use` carry no quotes.
- **Degradation audit:** `nx run degradation-audit:lint --skip-nx-cache` reports TOTAL 300.
- **`copy-wasm.js --self-test`:** PASS.
- **Protected files:** `ptah-core-prompt.ts` and the `NATIVE_AGENT_TOOL_POLICY` files show an empty `git diff`.
- **Formatting:** `prettier --check` is clean on every changed file. All changed files have LF endings (checked with
  `git ls-files --eol`).

## Plan deviations

The files beyond the nine listed are each a direct consequence of the activation:

- `workspace-analyzer.service.ts` and the Electron `COMMENT_STRING_QUERIES` are the extension-to-language consumers the
  batch instruction names.
- `tool-description.builder.ts` is the budget trim.
- The spec-literal updates listed above.
- `copy-wasm.js` needed its self-test probe row moved.
- `language-registry.ts` needed the `Exclude<>` record trimmed.

The Java and Rust modules claim no graph or export capability, as planned.

## Out-of-scope observations (not changed)

- Rust bodiless trait method signatures (`function_signature_item`) are not in the code index, because the plan's query
  table lists only `function_item`. The outliner does find them by focus name.
- `extractCodeInsights` still falls back to the JavaScript grammar for extensions with no grammar, which is pre-existing
  behaviour. A `null`/unsupported answer would be more honest there.
- There is no budget headroom left for the language lists in Batch 31 or 30k; see "Tool descriptions" above.

## Fix round (review r1)

Source: `reviews/batch-30-code-logic-review-r1.md` (REVISE 4/10). I fixed all four findings, and each has a regression
spec that failed before the fix and passes now.

- No git command that changes state was run.
- Probes lived only under `%TEMP%\ts30`.
- The formatter ran only on files changed in this round.

### R30-01 (Blocking): pre-budget truncation left an incomplete spool (29b R29b-02 recovery)

- **Fix:** `serializeResult` (`MCP/mcp-core/code-execution.engine.ts`) no longer cuts at 51,200 characters. It returns
  the whole value, so the dispatcher's tool-result budget is what bounds the answer and spools the complete raw text.
  - The 50 KiB constant and the `[TRUNCATED: …]` notice are removed; the budget layer already bounds the answer and
    spools the full output.
  - A value with no JSON form (for example a symbol) is now answered as `String(value)`. Before, `JSON.stringify` gave
    `undefined` and the length check threw.
  - Stale "50 KiB cap" comments are updated in `protocol-dispatcher.ts` and `mcp-contract.sweep.spec.ts` (comments
    only, no assertion changed).
- **Schema wording:** the `resultLanguage` schema text in `tool-description.builder.ts` now reads "outlined if it
  parses, else cut; the full text is spooled".
  - This text is in the schema, not the description, so it has no per-tool pin. The `tools/list` total pin still
    passes.
- **Regressions:**
  - `mcp-language-coverage.spec.ts`, "a result far above the old 51,200-char serializer cut is outlined whole and
    spooled byte-equal". It sends a 36-component TSX module of about 180,000 characters through the real dispatcher.
    The reducer must be `code-outline`, every component (including the late ones) must be present, there must be no
    `[TRUNCATED:`, and the spool must equal the raw text.
  - `code-execution.engine.spec.ts`: "never cuts a large result" replaces the old "truncates large results" test.
    "answers a value with no JSON form" is new.
- **Fails-before:** `Expected "code-outline"`, `Received "code-fallback:log-reduced"`, and serializeResult's
  never-cuts test failed.

### R30-02 (Blocking): code-index rows overwrote each other

- **Cause:** the store keys rows by `(workspace_root, subject)` and overwrites on conflict (`code-symbol.store.ts`).
- **Fix:** `WI/services/code-symbol-indexer.service.ts` gives every function, class and method row its own subject.
  - The first declaration of a kind and name keeps the plain subject, which stays byte-identical to before.
  - Each later one appends `@<1-based start line>`, with `.2`, `.3` and so on if two start on the same line.
  - Rows are visited in source order, so subjects are stable across re-indexes of an unchanged file.
  - The export-row de-duplication uses the same subject set, so its behaviour is unchanged.
  - Store and sink are untouched. The sink stores the producer's `kind`/`symbolName`, and search maps hits by rowid, so
    both rows are returned. `memory-curator` is therefore unchanged and was not re-run.
- **Regressions in `java-rust-grammar.integration.spec.ts`**, describe "code-index rows never overwrite each other".
  They use the real `CodeSymbolIndexer` and real grammar, with a sink keyed by subject like the store:
  - Rust `struct Foo<T>(T)` plus two `impl<T> Foo<T>` blocks: 5 inserted, 5 persisted, including all three `Foo` spans.
  - Java `method(int)` / `method(String)`: 3 inserted, 3 persisted.
  - Re-indexing gives identical subjects.
- **Harness hardening:**
  - `codeIndexHonesty` in `language-honesty.contract.spec.ts` now fails on any repeated subject.
  - `JAVA_HONESTY` gains an overload. `RUST_HONESTY` gains a second `impl Widget` block.
- **Fails-before:** "rows would overwrite each other in the store: [...Widget.java:render]" and "[...widget.rs:Widget]",
  plus the Rust and Java row tests (for example, 5 inserted, 3 persisted).

### R30-03 (Blocking): Rust format-variable references were dropped (Electron)

- **Identifier boundaries** (`electron-ide-capabilities.ts`): `$` is an identifier character in TS/JS/Java/C#, but not
  in Rust.
  - `identifierCharsFor(file)` picks `A-Za-z0-9_` for `.rs` files.
  - Both the cursor extraction and the reference matcher use it (one matcher per character set).
  - Result: `{0:needle$}` matches `needle`, and a cursor on `needle$` resolves to `needle`.
- **String rule, decided and pinned:**

  | Literal                       | Excluded when                                                                  |
  | ----------------------------- | ------------------------------------------------------------------------------ |
  | `str` literal                 | it holds no `{`, `}` or backslash (an escape such as `\x7b` can spell a brace) |
  | raw string                    | it holds no brace                                                              |
  | byte string (`b"…"`, `br"…"`) | always (it can never be a format string)                                       |

  A kept non-format string that contains a brace or escape can add a false reference. That is the documented
  text-scan approximation; a real use is never dropped.
  - The query is built with `String.raw`, because the regex needs a literal backslash class. Node names and predicates
    were proven against the shipped grammar.

- **Regressions** in `electron-ide-capabilities.spec.ts`, Batch 30 describe, all through the public
  `getReferencesReport`:
  - dynamic width `{0:needle$}`, the reviewer's escaped-brace string with line continuation, and
    `format!("{needle:?}")`;
  - a cursor on `needle$`;
  - the pinned string decisions: plain, raw and byte strings are excluded; escaped and braced-raw strings are kept.
- **Known miss:** a name glued to an escape (`"\x7bneedle"`) has no identifier boundary in the raw text and is still
  missed. The spec comment records it.
- **Fails-before:** all three new tests failed.

### R30-04 (Serious): qualified Rust impl blocks were not captured

- **Fix:** both the index class query (`rust.language.ts`) and the outliner declarations (`code-outliner.adapter.ts`)
  capture the last path segment of an impl's self type.
  - Covered forms: bare, scoped (`nested::Foo`), generic with a scoped head (`path::Type<T>`), and one reference level
    over any of those (`&Foo`, `&'a mut crate::m::Baz<'a>`).
  - Array, slice, tuple and `dyn` self types name no single type. They are not impl rows, but their functions are
    still indexed; a test pins this.
- **Regressions:**
  - In the integration spec, "qualified Rust impl blocks": five `it.each` shapes, including the reviewer's
    `impl nested::Foo` and `impl fmt::Display for Foo`, plus the slice case.
  - In `code-outliner.adapter.spec.ts`: "rust focus keeps qualified, generic-qualified and referenced impl blocks of
    the type".
- **Fails-before:** all five shapes returned `[]`, and the focus lacked the impl spans.

### Fails-before method

- The five fixed production files were copied to `%TEMP%\ts30\fb-backup`.
- Their pre-fix text was written in place by `%TEMP%\ts30\fb-revert.js`:
  - `code-execution.engine.ts` and `code-symbol-indexer.service.ts` from `git show HEAD:` (read-only);
  - the Rust, outliner and Electron query edits reversed by text substitution.
- I ran the new specs, then restored the files and confirmed with a grep that the fixed text was back.
- Results on the pre-fix text:

  | Project                | Failed | Skipped | Passed |
  | ---------------------- | ------ | ------- | ------ |
  | workspace-intelligence | 8      | 44      | 3      |
  | vscode-lm-tools        | 3      | 95      | 0      |
  | ptah-electron          | 3      | 105     | 2      |

  The 2 Electron passes are the pre-existing Batch 30 tests. The 3 workspace-intelligence passes include "re-indexing
  gives identical subjects", which holds on either side.

### Verification (after the fix round)

- **Scoped test, lint and typecheck:**
  `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache`
  printed "Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on". Lint reports 0
  errors (warnings only).

  | Project                | Test suites               | Tests                         |
  | ---------------------- | ------------------------- | ----------------------------- |
  | vscode-lm-tools        | 77 / 77                   | 2359 / 2359                   |
  | workspace-intelligence | 57 / 57                   | 1755 passed, 1 skipped (1756) |
  | ptah-electron          | 54 passed, 1 skipped (55) | 936 passed, 3 skipped (939)   |

- **rpc-handlers:** 111 passed, 1 failed (112 suites); 3275 passed, 1 failed, 4 skipped. The only failure is the known
  `harness-skill-selection` › "never writes state.json".
- **ptah-cli typecheck:** passes.
- **validate-deps:** "All external imports are covered". The fixtures and queries hold no quoted module-specifier
  shapes.
- **Degradation audit:** TOTAL 300.
- **`ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY`:** unchanged.
- **Formatting:** every changed file has LF endings. Prettier is clean on every file changed in this round; only the
  three specs that were new or changed and failing it were formatted.
- **Description pins:** `ptah_code_search_symbols` 702/702 and `ptah_code_reindex` 535/536, unchanged. No pin was
  raised.

### Paths changed in this round

Production:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (comment only)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`resultLanguage` schema
  text)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`
- `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/rust.language.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.ts`

Specs:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-language-coverage.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts` (comments only)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`
- `libs/backend/workspace-intelligence/src/ast/java-rust-grammar.integration.spec.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`

Report:

- `.ptah/specs/TASK_2026_559_8ca9/batch-30-executor-report.md` (this section)

The full set of paths the batch changed is the first-round list plus `code-execution.engine.ts`,
`code-execution.engine.spec.ts`, `protocol-dispatcher.ts`, `mcp-contract.sweep.spec.ts` and
`code-symbol-indexer.service.ts`.
