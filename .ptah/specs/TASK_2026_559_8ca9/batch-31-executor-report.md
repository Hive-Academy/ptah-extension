# Batch 31 executor report — PHP, Ruby and C++ grammars (`.c/.h` via cpp), plus Task 37b3.2

- Worktree: `task-559-mcp-tool-contract`. Base HEAD: `da21c936c` (Batches 29a1-30 and Lane K merged).
- No git command that changes state was run. The working tree is left dirty for the team leader.
- Already untracked before this batch and not part of it: `code-logic-review.md`,
  `research/diagnostics-worktree-repro.ts`, `reviews/lane-k-closing-review-r3.md`.
- **Not mine:** `.ptah/specs/TASK_2026_559_8ca9/o2-go-vet-consent-surface.md` shows as modified. Another writer changed
  it at 22:32 during this batch (it now describes "the contract Lane K shipped"). This batch did not touch it or
  revert it. The team leader decides whether it goes into the Batch 31 commit.

## Changed paths (all of them)

New files:

- `libs/backend/workspace-intelligence/src/ast/languages/php.language.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/ruby.language.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/cpp.language.ts`
- `libs/backend/workspace-intelligence/src/ast/php-ruby-cpp-grammar.integration.spec.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/activations/b31.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/matrix/activations/b37b.ts` (Task 37b3.2)
- `.ptah/specs/TASK_2026_559_8ca9/batch-31-executor-report.md` (this file)

Modified files:

- `libs/backend/workspace-intelligence/src/ast/ast.types.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/index.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/types.ts` (comment)
- `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts` (comment)
- `libs/backend/workspace-intelligence/src/ast/language-registry.ts`
- `libs/backend/workspace-intelligence/src/ast/language-registry.spec.ts`
- `libs/backend/workspace-intelligence/src/index.ts` (exports `isCParsedAsCpp`)
- `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`
- `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts`
- `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`
- `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.spec.ts`
- `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.spec.ts`
- `libs/backend/workspace-intelligence/src/testing/mcp-contract/language-honesty.contract.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-language-coverage.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/diagnostics-coverage.e2e.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- `scripts/tree-sitter-grammars.json`
- `scripts/copy-wasm.js`

Unchanged, and checked: `rpc-handlers/src/test-utils/heavy-module-mocks.ts`. The new WI export `isCParsedAsCpp` is only
called at request time (the AST namespace's file coverage), never at module load, so the mock needs no entry. The
rpc-handlers suites load and pass.

## What changed

### Language modules (Tasks 31.1-31.3)

`SupportedLanguage` gains `php`, `ruby` and `cpp`, and `LANGUAGE_MODULES` registers them. `UNPARSED_LANGUAGE_EXTENSIONS`
now holds only `kotlin`, which the exhaustive `Exclude<>` record requires.

All three languages declare the same capabilities as Java and Rust:

| Capability                         | Value |
| ---------------------------------- | ----- |
| `outline`                          | true  |
| `codeIndex`                        | true  |
| `syntaxDiagnostics`                | true  |
| `enrichSummary`                    | false |
| `graphEdges`                       | null  |
| `definitionFallback`               | false |
| `publicSymbols` (`exportQuery ''`) | false |

Batch 36 owns publicSymbols and graphEdges. Every node and field name was proven against the shipped WASM
(`@vscode/tree-sitter-wasm` 0.3.1): first with `web-tree-sitter` probes in `%TEMP%\ts31`, then in the integration spec.

**PHP** (`.php`, `.phtml`)

- The grammar is the PHP-in-HTML one. Text outside `<?php … ?>` is a `text` node, so mixed templates parse cleanly.
  This includes a function whose body is HTML between `?>` and `<?php`.
- Functions: `function_definition` (`@function.*`) and `method_declaration` (`@method.*`).
- Types: class, interface, trait and enum declarations.
- Imports: `namespace_use_clause`.
  - A plain clause reports its name.
  - An alias is reported as the imported name.
  - A group `use A\{B, C as D}` reports its prefix, with each member or alias as the imported name.
  - `require`, `require_once`, `include` and `include_once` are reported only when the argument is a literal:
    `(string . (string_content) .)` or `encapsed_string`, bare or parenthesised. `__DIR__ . '/x.php'` and
    `"$dir/x.php"` are not reported.
  - Tree-sitter has no top-level alternation of parents, so the four include patterns are generated from a list.

**Ruby** (`.rb`, `.rake`)

- Functions: `method` and `singleton_method`, with an optional parameter list. Endless and one-line methods are
  included.
- Types: `class` and `module`, named by the last segment of the name (`Admin::Panel` → `Panel`, the Rust impl
  precedent).
- Imports: a `call` with no receiver whose only argument is a literal string with no interpolation, filtered with
  `(#match? @import.callee "^(require|require_relative)$")`.
  - The predicate text has no `require("` shape.
  - These are not reported: an interpolated path, a receiver-bound call (`loader.require`), a computed path
    (`File.join`) and a call with two arguments. A spec pins each one.

**C++** (`.cpp .cc .cxx .c++ .hpp .hh .hxx .c .h`; `C_EXTENSIONS_PARSED_AS_CPP = ['.c', '.h']`)

- Functions: `function_definition` only, per the plan, so prototypes are not indexed.
  - The name comes from a generated declarator alternation: plain, member, destructor, operator and conversion
    names, a template specialisation's base name, and the last segment of a qualified name up to 4 scopes
    (`int app::ui::Box<T>::area()` → `area`).
  - Tree-sitter queries cannot recurse, so the nesting is written out.
  - The declarator may sit behind one or two pointer declarators or a reference.
- Types:
  - class, struct, union and enum specifiers, **only with a body**, because `struct point p;` uses a type rather than
    declaring one;
  - an anonymous struct, union or enum named by its `typedef` (the C idiom `typedef struct {…} Size;`).
  - `union_specifier` goes beyond the plan's table. It is a type definition like the others.
- Imports: `preproc_include`.
  - A local `"x.h"` is reported without its quotes.
  - A system `<x>` keeps its brackets, so the two stay distinguishable for Batch 36.
  - An include through a macro is not reported.

### `c:parsed-as-cpp` (Decision 19)

- `language-registry.ts` has `isCParsedAsCpp(filePath)`: true for `.c` and `.h`, case-insensitive.
- **Code index** (`code-symbol-indexer.service.ts`):
  - `getCoverage` adds `approximations: ['c:parsed-as-cpp']` when any written file of the answer is C, whatever its
    outcome. A C file that failed is exactly where the disclosure explains the failure.
  - The single-file `reindexFile` coverage does the same for its one file.
  - `.cpp` answers carry no approximation.
- **Diagnostics** (`language-aware-diagnostics-provider.ts`):
  - A scoped check that parsed a `.c` or `.h` file adds `c:parsed-as-cpp` next to `cpp:syntax-only`.
  - Each syntax error in a C file says `(cpp, c:parsed-as-cpp; syntax-only check, not type-checked)`. Valid C that
    uses a C++ keyword such as `new` is therefore reported as a syntax error that names its cause.
  - The file header's language list is corrected. It still said "Python, Go, C# today".
- **`ptah_ast_analyze`** (`ast-namespace.builder.ts`): an eligible C file's coverage names `c:parsed-as-cpp`.
- **Parse failures:** C that the C++ grammar cannot parse is `recovered`. It becomes `failed.parse` in the index and
  is refused by the outliner. Specs pin two shapes: a variable named `new`, and the classic `extern "C" {` split
  across `#ifdef __cplusplus`.

### Outliner (`code-outliner.adapter.ts`)

**PHP**

- Omittable bodies: `compound_statement` of functions, methods and closures, plus arrow-function bodies. A body that
  holds HTML is still body content.
- Declaration names: functions, methods, class, interface, trait and enum declarations, properties (without the `$`)
  and constants.

**Ruby**

- A method body has no opening delimiter and closes with `end`.
- The existing Python `@colon` rule gives the start: the header is the parameters, or the name when there are none.
- A new optional `@owner` capture caps the end at the row before the method's `end`. So `end end`, where a block's
  `end` shares the method's `end` row, keeps that row.
- Only `method` and `singleton_method` bodies are omitted. A top-level `do`/`{}` block is often structure
  (`describe … do`, or `Struct.new … do` holding `def`s), so it is never omitted. A block inside a method is already
  inside that method's body.
- Declaration names:
  - methods, including singleton methods;
  - classes and modules, by their last segment;
  - constant assignments (`Tally = Struct.new …`).

**C/C++**

- Omittable bodies: function and lambda `compound_statement`.
- Declaration names:
  - definitions, **prototypes** (`declaration` and `field_declaration` with a function declarator), using the same
    name alternation as the index;
  - class, struct, union and enum specifiers with a body;
  - typedef and alias names, namespaces;
  - `#define` and function-like macros.
- A focus therefore keeps a member's prototype together with its out-of-line definition.

### Consumers that map extensions to languages (the R29b-01 lesson)

- **Electron `electron-ide-capabilities.ts`**
  - `extToLanguage` already reads the shared map. `COMMENT_STRING_QUERIES` gains three entries:
    - `php`: comment, `text` (HTML outside the PHP tags), single-quoted `string`, `string_content`, `nowdoc_string`.
      The `variable_name` inside `"$x {$x}"` and heredocs stays a reference.
    - `ruby`: comment, `string_content`, `heredoc_content`. The `#{needle}` interpolation, including in heredocs and
      regexes, stays a reference, and so do symbols (`:needle`, as used by `send` and `respond_to?`).
    - `cpp`: comment, `string_literal`, `raw_string_literal`, `char_literal`, `system_lib_string`. Macro bodies
      (`preproc_arg`) stay references.
  - Identifier boundaries: PHP and Ruby join Rust in treating `$` as not part of an identifier (`$` is a sigil). A
    cursor on `$needle` resolves to `needle`, and `$needle` matches `needle`. C/C++ keeps `$`, a GCC extension.
- **`extractCodeInsights`** (`workspace-analyzer.service.ts`) already reads `EXTENSION_LANGUAGE_MAP`. New spec cases
  cover `.php`, `.rb`, `.c`, `.h` and `.cpp`.
- **Already correct:** the graph, the index census, the AST namespace, the diagnostics classifier and the outliner's
  `resolveLanguage` all read the shared map or the registry.

### Packaging

- `scripts/tree-sitter-grammars.json`: `php`, `ruby` and `cpp` are set to `active: true`. The bytes are unchanged and
  match the installed files: 1,058,041, 2,106,352 and 5,394,393. All three are MIT.
- `scripts/copy-wasm.js --self-test`:
  - The probe "activating a row copies it" used `php`, which is now active. Every package grammar is now active, so
    the probe is proved from the other side: the active copy contains `tree-sitter-php.wasm`, and the same manifest
    with `php` deactivated does not.
  - The self-test prints PASS.
  - `--list` now includes the three new grammars.
- The Electron, CLI and VSIX verifiers and `publish-cli.yml` read the manifest and have no hard-coded list, so they are
  unchanged. `grammar-manifest.spec.ts` follows the registry and passes.

### Tool descriptions: compact language lists (team-leader decision)

- `languagesNote()` now renders each language by its usual extension, joined by commas without spaces. The names come
  from the new exported, exhaustive `DESCRIPTION_LANGUAGE_NAMES: Record<LanguageId, string>`:
  `ts, js, tsx, py, go, cs, java, kt, rs, php, rb, c/cpp`. `cpp` is `c/cpp` because `.c` and `.h` are cpp.
- For all twelve languages, a list costs 42 characters instead of 83 with full ids.
- No pin was raised and no required content was dropped.
- Every description that lists languages uses the same function: `ptah_ast_analyze`, enrich, search, reindex, graph,
  LSP and diagnostics.
- The enrich `language` enum still takes the full ids.

Measured description lengths (`ptah_code_search_symbols` / `ptah_code_reindex`, pins 702 / 536):

| State                                                         | search | reindex |
| ------------------------------------------------------------- | ------ | ------- |
| HEAD (8 languages, full ids)                                  | 702    | 535     |
| Batch 31 languages with full ids (not shipped)                | 718    | 551     |
| **After (11 languages, compact), measured**                   | 664    | 515     |
| All 12 languages in both lists (Kotlin and every graph batch) | 700    | 518     |

The last row is computed, and it is also asserted by a new spec that mocks `supportedLanguagesFor` to return all
twelve. The planned end state has no Kotlin `publicSymbols`, so it is 3 characters under that.

`tool-description.builder.spec.ts` changes:

- The Batch 24c row markers parse the compact form and compare it to the registry list, mapped through an
  **independent hand-typed** name table.
- The required-content items use the compact lists.
- The "follows the registry" mock expects `ts,kt`.
- A new describe, "Batch 31 — compact language lists keep every pin", checks:
  - the names equal the hand table, cover `LANGUAGE_IDS` and are distinct;
  - php, rb and c/cpp are listed now;
  - the all-twelve worst case is within 702 and 536.

### Harness

**`b31.ts`** lists exactly twelve keys: parse, outline, codeIndex and syntaxDiagnostics for php, ruby and cpp.

- Declared approximations: `syntax-only` for each syntaxDiagnostics key. `c:parsed-as-cpp` for every cpp key.
- `required-keys.ts` is not edited.

**`HONESTY_CHECKS`** (`language-honesty.contract.spec.ts`). Each check executes:

| Key                   | What the check does                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse:php`           | `grammarParseHonesty` on PHP inside HTML, with a function whose body is HTML. A broken file must not be `ok`.                                                                   |
| `parse:ruby`          | `grammarParseHonesty` on Ruby with interpolation and a scoped class. A broken file must not be `ok`.                                                                            |
| `parse:cpp`           | Runs on **each of** `widget.cpp`, `widget.c` and `widget.h`. The C contrasts are valid C the grammar rejects (`new`, and `extern "C"` split across `#ifdef`s).                  |
| `codeIndex:php/ruby`  | `codeIndexHonesty`, which fails on any repeated subject. The PHP fixture has the same method name in two classes; the Ruby one has a reopened class and a second `render`.      |
| `codeIndex:cpp`       | Runs on each of the three files, with a C++ overload. The new `approximations` parameter requires `['c:parsed-as-cpp']` for `.c`/`.h` and `[]` for `.cpp`.                      |
| `syntaxDiagnostics:*` | php, ruby and a broken `.cpp`, plus for cpp valid C with `new` in a `.c` file. The check requires `c:parsed-as-cpp` in the message and the coverage exactly when the file is C. |

**`CHECKED_ELSEWHERE`** (and `CHECKED_ELSEWHERE_KEYS` in the MCP spec) gains `outline:php`, `outline:ruby` and
`outline:cpp`.

**`MCP_HONESTY_CHECKS`** (`mcp-language-coverage.spec.ts`) runs `grammarOutlineHonesty` for php, for ruby, and for cpp
on a `.cpp`, a `.c` and a `.h` file. Each run checks:

- exact spans;
- that the outliner refuses a broken file (valid C with `new` for C);
- the served path through the real dispatcher: reducer `code-outline`, every signature kept, and a byte-equal spool.

Two optional subject fields were added: `broken` (Ruby has no `{` to break) and `resultLanguage`, so the C subjects are
served by `.c` and by `include/counter.h`.

### Task 37b3.2 (deferred from Lane K): `b37b.ts` and `HONESTY_CHECKS['typeCheck:go']`

`b37b.ts` activates `typeCheck:go` only, with the declared approximation `syntax-only`.

The check (`goVetTypeCheckHonesty`) runs these real components:

- `GoVetChecker`;
- `GoVetConsentStore`, over an in-memory workspace-scoped storage double;
- `LanguageAwareDiagnosticsProvider` with the real parser;
- a temporary Go module (`go.mod`, `a/a.go`).

Go is not installed, so two things are injected: `resolveGo` returns a fixed binary identity, and `run` is a runner
that counts its calls. It then asserts four scenarios:

1. **Consent off:** 0 runs; `goVet` is `unchecked/no-consent`; the Go file is named in `notChecked` with "go vet is
   off"; the answer does not read as clean.
2. **Stale consent** (granted for another binary size): 0 runs; `consent-stale`; "out of date"; not clean.
3. **Current consent, clean vet output:** 1 run; `checked`, with `checkedFiles: 1`.
4. **Unmapped finding** (vet `posn` outside the workspace): `reason: 'unmapped-findings'`, `unmappedFindings ≥ 1`, and
   the file is named with "outside the workspace"; not clean.

In **every** scenario the coverage has `checks: 'syntax-only'` and `go:syntax-only`, never `type-check`.

"Clean" uses the provider spec's own `readsAsClean` rule: available, no diagnostics, nothing in `notChecked`, no
unmapped findings. The existing test "typeCheck:go is handled explicitly" is unchanged.

### Spec literals that named PHP, Ruby or C as the "unsupported" example

These were updated to languages that stay unsupported permanently: Swift and Elixir, never Kotlin (30k).

- **`language-registry.spec.ts`:**
  - The pinned parse, outline, codeIndex and syntaxDiagnostics lists now include php, ruby and cpp.
  - `.php` has no parse → `.swift`.
  - `src/Widget.php` unsupported → `src/Widget.swift`.
  - The "recognises unsupported languages" `.php` example → `.ex`.
- **`language-aware-diagnostics-provider.spec.ts`:**
  - `A.php`/`m.rb` → `A.swift`/`m.ex`.
  - `svc/Widget.php` → `svc/Widget.swift`.
- **`diagnostics-coverage.e2e.spec.ts`:** `lib/tool.rb` → `lib/tool.ex`.
- **`ast-namespace.builder.spec.ts`:** `sample.php` → `sample.swift`.
- **`code-symbol-indexer.service.spec.ts` and `code-namespace.builder.spec.ts`:** the `CODE_INDEX_LANGUAGES` literals
  now include php, ruby and cpp.
- **`code-outliner.adapter.spec.ts`:**
  - New real-grammar tests: php (HTML included), ruby (including `end end` and a top-level block), cpp on `.cpp`, and
    C on real `.c`/`.h` with a refusal.
  - Eleven new hint cases (`php`, `.PHTML`, `rb`, `.rake`, `.C`, `h`, `.c++`, …).
- **`electron-ide-capabilities.spec.ts`**, new describe "Batch 31", all through the public `getReferencesReport`:
  - PHP: HTML, comments, single-quoted strings and nowdocs are dropped. `$needle`, `{$needle}`, heredoc variables and
    `<?= needle() ?>` inside HTML are kept.
  - PHP: a cursor on `$needle` resolves to `needle`.
  - Ruby: interpolations (string, heredoc, regex) and symbols are kept. Literal text and `%w[]` are dropped.
  - C, C header and C++ (`it.each` over `.c`, `.h`, `.cpp`): comments, strings, chars and `<needle.h>` are dropped. A
    macro body is kept.

## Fails-before evidence (base `da21c936c` production, specs written first)

Method, in `%TEMP%\ts31\fb\run-fb.sh`:

1. The 12 production files this batch changes were copied to `%TEMP%\ts31\fb\backup`.
2. Their HEAD text was written in place with `git show HEAD:<path>` (read-only).
3. The new specs were run with out-of-repo Jest configs set to `diagnostics: false`. The in-repo configs cannot compile
   `'php'` as a `SupportedLanguage` on base.
4. The files were restored by an EXIT trap. `git diff --stat` then matched the post-batch diff exactly (27 files,
   +1711/−475).

The new language modules existed during the run but were unregistered, so they had no effect.

| Project                | Failed | Passed | Failing specs                                                                                                                                                                                                                      |
| ---------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace-intelligence | 53     | 40     | all 38 php-ruby-cpp integration tests; the 5 new analyzer grammar cases; honesty `parse`, `codeIndex` and `syntaxDiagnostics` for php, ruby and cpp; "every activated capability:language key is actually granted by the registry" |
| vscode-lm-tools        | 36     | 119    | php, ruby, cpp and C outline tests; the 11 new hint cases; `outline:php/ruby/cpp` in `MCP_HONESTY_CHECKS`; all Batch 24c list markers; both pin tests; the 3 Batch 31 compact-list tests                                           |
| ptah-electron          | 6      | 0      | all 6 "Batch 31" reference tests (110 skipped by `-t`)                                                                                                                                                                             |

`typeCheck:go` passes on base, because the Lane K code is already there. That key's honesty check was proved by
sabotage instead (`%TEMP%\ts31\fb\sabotage-govet.sh`). Each mutation below made it throw, and the file was restored
after each run:

- The provider drops the go vet `notChecked` groups: 1 failed.
- A vet run is counted as a type check (`checksOf(typeCheckRan || vetChecked > 0, …)`): 1 failed.
- `unmappedFindings` is not forwarded: 1 failed.
- Unmodified: 2 passed. These are the new check and the existing explicit `typeCheck:go` test.

## Verification (after)

- **Scoped test, lint and typecheck:**
  `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache`
  printed "Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on". Lint reports 0
  errors. Test counts, taken from a static-output re-run:

  | Project                | Test suites               | Tests                          |
  | ---------------------- | ------------------------- | ------------------------------ |
  | vscode-lm-tools        | 77 / 77                   | 2451 / 2451                    |
  | workspace-intelligence | 62 passed, 1 skipped (63) | 1932 passed, 10 skipped (1942) |
  | ptah-electron          | 54 passed, 1 skipped (55) | 945 passed, 3 skipped (948)    |

- **rpc-handlers:** `nx run-many -t=test -p @ptah-extension/rpc-handlers --skip-nx-cache` gives Test Suites 112 passed,
  1 failed (113) and Tests 3300 passed, 1 failed, 4 skipped. The only failure is the known flake
  `harness-skill-selection` › "never writes state.json".
- **ptah-cli typecheck:** `nx run-many -t=typecheck -p ptah-cli --skip-nx-cache` printed "Successfully ran target
  typecheck".
- **validate-deps:** `nx run ptah-electron:validate-deps --skip-nx-cache` printed "All external imports are covered by
  package.json dependencies."
  - Production queries hold no quoted module-specifier shape. The Ruby predicate is `"^(require|require_relative)$"`.
  - Spec fixtures build `require` by concatenation (`'req' + 'uire'`).
- **Degradation audit:** `nx run degradation-audit:lint --skip-nx-cache` reports "TOTAL 300 unsuppressed site(s)".
- **`node scripts/copy-wasm.js --self-test`:** PASS.
- **Protected files:** `ptah-core-prompt.ts` and the `NATIVE_AGENT_TOOL_POLICY` file show an empty `git diff`.
- **Formatting:** `prettier --check` is clean on every changed code file. Prettier was run only on 3 files this batch
  changed. All changed files have LF endings.
- **Description pins:** 664/702 and 515/536. No pin was raised.

## Plan deviations

- **Files beyond the plan's ten.** Each is a direct consequence of activating the grammars, as in Batch 30:
  - the Electron filter (`COMMENT_STRING_QUERIES` and identifier characters);
  - the `c:parsed-as-cpp` emitters in the index, diagnostics and the AST namespace, plus the `isCParsedAsCpp` export;
  - the compact description lists (the team-leader decision);
  - the `copy-wasm.js` self-test probe;
  - the spec literals listed above;
  - the Task 37b3.2 fragment and its check.
- **`union_specifier`** is indexed alongside the plan's class, struct and enum specifiers. The typedef-named anonymous
  struct, union and enum is the C idiom; without it `typedef struct {…} Size;` would index nothing.
- **Prototypes:** outline focus finds them, and the code index does not. This follows the plan, which lists
  `function_definition` only, and the Rust precedent for `function_signature_item`.
- **Ruby outline** omits only method bodies, never top-level blocks. This is a conservative choice (see above).

## Out-of-scope observations (not changed)

- **Compact clean coverage drops approximations.** `compactCoverage` (platform-core, Batch 22c) returns only
  `{clean, analyzed}` for a clean answer, and the pinned legend says "if clean, only `analyzed`". A clean served
  code-index or `ptah_ast_analyze` answer over `.c`/`.h` files therefore shows `c:parsed-as-cpp` only in the raw
  (spooled) coverage. The disclosure is served whenever the answer is qualified, for example a C file with
  `failed.parse`, which is the case it explains. Diagnostics text adds its own qualifier lines. Changing this needs a
  platform-core contract decision.
- **Common C headers fail to parse.** Real C headers that split `extern "C" {` across `#ifdef __cplusplus` fail to parse
  with the C++ grammar. This is Decision 19's stated limit: they are reported as `failed.parse` and refused by the
  outliner, never presented as clean. It will be common in real C code bases.
- **`.h` files are always disclosed as C**, even pure C++ headers. That is the honest direction.
- **Unusual C++ declarator shapes are not indexed:** names qualified more than 4 scopes deep, functions returning
  function pointers, and parenthesised declarators.
- **Ruby parameter names:** `def name a, b` (no parentheses) gives an empty `parameters` list, because the shared
  extractor slices the parentheses.
- **A pre-existing Jest warning:** "Jest did not exit one second after the test run" appears when
  `mcp-language-coverage.spec.ts` runs alone. The suite passes.

## Fix round (review r1)

Source: `reviews/batch-31-code-logic-review-r1.md` (REVISE 4/10). The user decided the two still-open Batch 30 Blockings
(R30-02 → R31-03, R30-03 → R31-04) are fixed in this round. Base HEAD `69862ba6f`. No state-changing git command was
run, probes stayed under `%TEMP%\ts31`, and the formatter ran only on files changed in this round (see Formatting).

### R31-03 (Blocking; Batch 30 R30-02): same-line declarations collapsed before the unique subjects

- **Cause:** `AstAnalysisService` deduplicated function and class captures by `name:startLine`, so two declarations
  sharing a name and a line (one-line Java overloads, `struct Foo; impl Foo {…} impl Foo {…}`, two C++ namespaces)
  became one before the Batch 30 subject allocator ever saw them.
- **Fix:** `WI/ast/ast-analysis.service.ts` keys one declaration by the **position of its name** (row and column).
  Two patterns capturing the same declaration still merge (same name node); distinct nodes stay distinct. A walked
  C/C++ name uses its declarator's position.
- **Regression:** `php-ruby-cpp-grammar.integration.spec.ts`, "every declaration persists, with the expected
  cardinality", covers the reviewer's three one-line inputs through the real indexer and a subject-keyed sink. It
  asserts the exact row count and texts, not just subject uniqueness:
  - Java: class + 2 methods (3 rows);
  - Rust: 3 `Foo` rows + `first` + `second` (5);
  - C++: 2 `needle` rows (2).

### R31-04 (Blocking; Batch 30 R30-03): a Rust capture glued to an escaped brace was missed

- **Fix:** the Rust Electron query now captures every string (`@s`) and every comment and char literal (`@x`). All of
  them are excluded from the raw word scan.
  - The strings are read by the new `apps/ptah-electron/src/services/rust-format-references.ts`. It decodes the
    literal with Rust's escape rules: `\n \r \t \\ \0 \' \"`, `\xNN`, `\u{…}`, and a line continuation that skips the
    newline and the following whitespace. It keeps each character's origin offset.
  - It then applies the format rules: `{{`/`}}` are literal braces, `{arg[:spec]}` names `arg`, and a `name$` in the
    spec names a width or precision.
  - Hits are mapped back to file positions and merged, line by line and in column order, with the word-scan matches
    (streaming is kept).
- **Scan gate:** a Rust file is scanned when it merely contains the name, because `\x7bneedle` has no word boundary.
- **Byte strings:** they name no argument.
- **Behaviour change (safer and more precise):**
  - `"{{needle}}"` (literal text) is no longer a reference.
  - A brace-free string with an escape (`"needle \n …"`) is no longer kept "just in case".
  - The Batch 30 "pins the string decisions" test is updated to that rule.
- **Regressions** in `electron-ide-capabilities.spec.ts`, one `it.each` through the public `getReferencesReport`.
  - These are uses: `"\x7bneedle\x7d"` (the reviewer's probe), `"\u{7b}needle\u{7d}"`, `"{{{needle}"`,
    `"{needle}}}"`, `"\x7b0:needle$}"`, `"{:.needle$}"` and `r#"{needle}"#`.
  - These are not: `"{{needle}}"` and `b"{needle}"`.
  - The Batch 30 width, continuation and `{needle:?}` tests still pass.

### R31-01 (Blocking): the clean C approximation was lost at served boundaries

- **Compact coverage** (`libs/backend/platform-core/src/interfaces/language-coverage.interface.ts`, minimal): a clean
  answer is `{clean: true, analyzed}` **plus** `approximations` and a non-zero `approximationsOmitted` when there are
  any.
  - `isCleanAnswer`, the qualified shape and the Decision 21 worst case (a qualified object) are unchanged.
  - A clean block with 4 approximations and an omitted count is about 140 characters.
  - The `CompactCleanCoverage` type and its doc are updated.
  - Platform-core spec: a new "keeps approximations … in a clean answer, which stays clean" test. The old "busy but
    clean" case now expects its `text-scan` approximation kept, where it used to be dropped.
- **Legend** (both code-index descriptions): "if clean, only `analyzed`" became "clean→`analyzed`+approximations".
  `LEGEND_ITEMS` and the Batch 22c legend test are updated to match.
- **C outline** (`code-outliner.adapter.ts` + `tool-output-reducers` `code.reducer.ts`):
  - `CodeOutline` gains an optional `approximations`.
  - The adapter sets `['c:parsed-as-cpp']` when the hint names C (`c`, `.c`, `.h`, `.H`, `src/x.c`), and not for C++
    (`cpp`, `.hpp`, `.cc`).
  - The reducer renders it as the first line of the outline, `… approximations: c:parsed-as-cpp …`, so it reaches the
    served text. It also adds it to `notes`.
  - Only short `[a-z0-9:.-]` codes are echoed; the adapter's value is checked, not trusted.
  - The line is inside the body, so the budget and trailer logic is untouched.
- **Electron reference/definition report:** `lspReport` adds `c:parsed-as-cpp` when the queried file or any answering
  location is a `.c` or `.h` file.
- **Regressions:**
  - `ast-analyze-result.spec.ts`: a clean `.c` and `.h` served in the dispatcher's compact form carry
    `approximations: ['c:parsed-as-cpp']`, and `.cpp` does not.
  - `mcp-language-coverage.spec.ts`, inside `outline:cpp`: the real dispatcher's served text for the `.c` and `.h`
    subjects contains the approximation line, the `.cpp` subject's does not, and the outline object matches.
  - `code-outliner.adapter.spec.ts`: C and C++ hints are checked.
  - `code.reducer.spec.ts`: the line is rendered, unsafe codes are dropped, and the rest of the text equals the plain
    outline.
  - Electron: the `.c`/`.h`/`.cpp` report approximations.

### R31-02 (Blocking): valid C++ declarators gave a clean empty index

- **Fix:** the fixed-depth query alternation is gone. `cpp.language.ts` now captures every function definition's
  whole declarator (`@function.declarator`).
  - The new `WI/ast/c-declarator.ts` `cDeclaratorName` walks it through pointers, references, parentheses, arrays,
    attributes, init and function declarators, templates and any depth of `a::b::` scopes to the declared name. The
    parameters come from the innermost function declarator (`int (*needle())(int)` → `needle()`).
  - `tree-sitter-parser.service.ts` converts `…declarator` captures to depth 64 instead of 3; other captures keep
    depth 3, so there is no cost elsewhere.
  - The outliner uses the same walker for definitions, prototypes and other declarations (`@declarator`).
- **Honest partial extraction:** a definition whose declarator names nothing readable is listed in the new
  `CodeInsights.unextractedDeclarations`. The index counts that file `failed` (`unsupported-syntax`), never `analyzed`,
  and `ptah_ast_analyze` coverage reports it the same way (`ast-namespace.builder.ts`).
- **Regressions:**
  - `int (needle)(int x)`, `int ***needle()` and `int (*needle())(int)` (the reviewer's three), plus a five-scope
    qualified name and `int *&needle(int *p)`. Each is indexed as one `needle` row with its parameters, clean.
  - The outline focus finds each of them.
  - A synthetic unnamed chain returns `undefined` from the walker. An indexer given `unextractedDeclarations` reports
    `failed/unsupported-syntax`, `clean: false`.

### R31-05 (Serious): Ruby unparenthesised parameters were truncated

- **Fix:** `extractParamsFromText` strips the delimiters only when both are present. Other languages always pass them,
  so their behaviour is unchanged.
- **Regression:** these give the full names: `def needle alpha, beta` (was `['lpha','bet']`), `def needle a, b` (was
  `[]`), `def needle a, *rest, key:, &blk`, `def self.needle alpha`, and the parenthesised form.

### Description budgets

- `c/cpp` is now `cpp`: `.c`/`.h` is disclosed by every C answer itself, clean ones included.
- The legend grew by 6 characters.
- Measured with a temporary spec that was deleted afterwards:

  | Description                | Now | Pin |
  | -------------------------- | --- | --- |
  | `ptah_code_search_symbols` | 668 | 702 |
  | `ptah_code_reindex`        | 519 | 536 |

- Planned end state (every language in the code index; every language but Kotlin with public symbols, since there is
  no `publicSymbols:kotlin` key): search 699, reindex 522. This is asserted by the spec "with every planned language
  listed", which replaces the all-twelve-in-both test (search would be 702 there, with no Kotlin key planned). No pin
  was raised.

### Fails-before (this round)

`%TEMP%\ts31\fb\fix-round-fb.js` puts each pre-fix behaviour back in place, runs the matching regression specs, and
restores the file. `git diff --stat` was unchanged afterwards.

| Pre-fix behaviour restored                    | Result                   |
| --------------------------------------------- | ------------------------ |
| Function dedupe key `name:line`               | 2 failed                 |
| Class dedupe key `name:line`                  | 1 failed                 |
| Declarator captures cut at depth 3            | 3 of 5 declarator tests  |
| Always-slice parameters                       | 4 failed                 |
| Clean compact coverage without approximations | 2 failed                 |
| Adapter without the C approximation           | 1 failed (`outline:cpp`) |
| Electron report without `c:parsed-as-cpp`     | 2 failed                 |
| Rust strings not read by the format rules     | 7 failed                 |

Two notes on this table:

- **Declarator depth:** the parenthesised name and the reference-to-pointer pass at depth 3 on their own. On base they
  failed because the old query had no such shape; the reviewer's probes demonstrated that.
- **The two dedupe rows** each fail only the inputs their own loop handles.

### Verification (fix round)

- **Scoped test, lint and typecheck:**
  `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron @ptah-extension/platform-core @ptah-extension/tool-output-reducers --skip-nx-cache`
  printed "Successfully ran targets test, lint, typecheck for 5 projects and 6 tasks they depend on". Lint reports 0
  errors (warnings only).

  | Project                | Test suites               | Tests                          |
  | ---------------------- | ------------------------- | ------------------------------ |
  | workspace-intelligence | 62 passed, 1 skipped (63) | 1947 passed, 10 skipped (1957) |
  | vscode-lm-tools        | 77 / 77                   | 2454 / 2454                    |
  | ptah-electron          | 54 passed, 1 skipped (55) | 954 passed, 3 skipped (957)    |
  | platform-core          | 46 / 46                   | 998 passed, 4 todo             |
  | tool-output-reducers   | 9 / 9                     | 493 / 493                      |

- **rpc-handlers:** Test Suites 112 passed, 1 failed (113); Tests 3300 passed, 1 failed, 4 skipped. The only failure is
  the known flake `harness-skill-selection` › "never writes state.json".
  - `heavy-module-mocks.ts` is unchanged. The new WI exports `cDeclaratorName` and `isCParsedAsCpp` are read only at
    request time.
- **ptah-cli typecheck:** passes.
- **validate-deps:** "All external imports are covered".
- **Degradation audit:** TOTAL 300. No new catch site: `findFilteredSpans` keeps the existing one.
- **Protected files:** `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are unchanged.
- **Formatting:**
  - Prettier was run on the new `rust-format-references.ts` and on the new integration spec.
  - `code.reducer.spec.ts` was not prettier-clean at HEAD. After an accidental format run it was restored from HEAD
    with only the new test re-inserted, so its pre-existing style issues remain untouched.
  - Every other changed file passes `prettier --check`.

### Paths changed in this round

New:

- `libs/backend/workspace-intelligence/src/ast/c-declarator.ts`
- `apps/ptah-electron/src/services/rust-format-references.ts`

Modified:

- `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts`
- `libs/backend/workspace-intelligence/src/ast/ast-analysis.interfaces.ts`
- `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts`
- `libs/backend/workspace-intelligence/src/ast/languages/cpp.language.ts`
- `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`
- `libs/backend/workspace-intelligence/src/index.ts`
- `libs/backend/workspace-intelligence/src/ast/php-ruby-cpp-grammar.integration.spec.ts`
- `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts`
- `libs/backend/platform-core/src/interfaces/language-coverage.interface.spec.ts`
- `libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.ts`
- `libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/ast-analyze-result.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-language-coverage.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.ts`
- `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- `.ptah/specs/TASK_2026_559_8ca9/batch-31-executor-report.md` (this section)

The full Batch 31 path set is the first-round list plus the two new files above and these, which the first round did
not touch:

- `ast-analysis.service.ts`
- `ast-analysis.interfaces.ts`
- `tree-sitter-parser.service.ts`
- `ast-analyze-result.spec.ts`
- the two platform-core files
- the two tool-output-reducers files

The O2 doc noted in the first round is no longer modified; it was committed in `69862ba6f`.
