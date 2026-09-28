# Code Logic Review — TASK_2026_559_8ca9

## Summary

Review of Batch 31 r1 and the Batch 30 fixes, against HEAD `69862ba6f76ce1c0082e971dac3ab64748f07875` and the submitted on-disk changes. Lane K was examined only through Batch 31's `b37b` activation/check.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 4              |
| Serious issues      | 1              |
| Moderate issues     | 0              |
| Failure modes found | 5              |
| Part 2 verdict      | REVISE, 4/10   |

The grammar, package and ordinary declaration paths work. The remaining failures are output honesty and silent extraction loss: clean C answers omit the required qualification; some valid C++ definitions disappear; same-line declarations still collapse before the fixed persistence boundary; Rust escaped format captures remain incomplete; Ruby parameters can be fabricated by slicing their names. These observed failures prevent a 5–6 score. Passing real-grammar, packaging and scoped verification checks keep the implementation above the foundational-failure bands.

Paths below are relative to the worktree. `WI` = `libs/backend/workspace-intelligence/src`; `MCP` = `libs/backend/vscode-lm-tools/src/lib/code-execution`; `Electron` = `apps/ptah-electron/src/services/electron-ide-capabilities.ts`.

## Part 1 — rolled-forward Batch 30 fixes

| Finding                              | Status                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R30-01 destructive pre-budget cut    | VERIFIED                              | `MCP/mcp-core/code-execution.engine.ts:485` now returns the complete serialized result. Re-ran the 195,104-character TSX result through the real dispatcher: reducer `code-outline`, all First/Middle/Last declarations retained, spool length 195,104 and byte equality true. The 40,004-character positive case and wrong/unknown-language fallback also preserve the full spool.                         |
| R30-02 unique declaration subjects   | OPEN, original multiline probes fixed | `WI/services/code-symbol-indexer.service.ts:1079` allocates distinct subjects. Against the production store's actual SQLite conflict handling, original Rust example now persists 5/5 rows and Java 3/3. However, the upstream extractor still deduplicates by name plus starting **line**, discarding distinct same-line declarations before subject allocation. Reproduced in Java, Rust and C++; R31-03. |
| R30-03 Rust format references        | OPEN, width/continuation probes fixed | `Electron:276` selects Rust boundaries without `$`; `{0:needle$}` now returns declaration and use. The escaped-brace plus line-continuation probe also returns both. `println!("\x7bneedle\x7d")` still returns only the declaration because the matcher sees `bneedle` in raw text. R31-04.                                                                                                                |
| R30-04 implemented-type query shapes | VERIFIED for requested forms          | `WI/ast/languages/rust.language.ts` and `MCP/mcp-core/code-outliner.adapter.ts:260` include scoped/generic/reference self types. Re-ran `impl nested::Foo`, generic `Foo<T>` and `impl Bar for &Foo`: implementation class rows and matching focus ranges now exist. The scoped example retains both struct and implementation focus ranges.                                                                |

**Decision 24 disposition:** R30-02 and R30-03 remain open Blocking findings. The orchestrator must surface these to the user under the rolled-forward rule, rather than silently treating this as another routine revise round. The exact prior multiline/width/continuation examples pass; the remaining cases below demonstrate why the broader guarantees are still incomplete.

## Part 2 — numbered findings

### R31-01 — Blocking: C's required approximation is lost at served boundaries

- **Disposition:** fix-now.
- **Anchors:** `libs/backend/platform-core/src/interfaces/language-coverage.interface.ts:490`; `MCP/mcp-core/protocol-dispatcher.ts:2011`, :2913; `MCP/mcp-core/code-outliner.adapter.ts:354`, :379; `Electron:1388`–:1390.
- **Trigger:** successfully analyze/index `a.c` containing `int needle(int x) { return x; }`; or return a large C function through `execute_code` with `resultLanguage: '.c'`.
- **Observed symptom:** the real index coverage contains `approximations: ['c:parsed-as-cpp']`, but compaction becomes only `{clean:true, analyzed:1}`. Feeding that real analysis/coverage result through the actual `ptah_ast_analyze` dispatcher produces a successful inline answer with no approximation. This small result has no spool providing an alternative disclosure. The real `.c` outline call emits `code-outline` and a full-output locator, but no `c:parsed-as-cpp`. An Electron `.c` reference report returns `language:'cpp'` with only `['text-scan']`, despite using the C++ exclusion parser.
- **Current handling:** producers were updated, but compaction deliberately drops all clean-answer qualifiers; the outline return type carries spans only, and the reference report independently constructs its approximation list. `b31`'s direct index assertion at `WI/testing/mcp-contract/language-honesty.contract.spec.ts:464` proves the raw field, not its survival in the served answer.
- **Impact:** the requirement is disclosure on every C answer, not only failed parses. A clean count can remain true while the grammar approximation is visible. Hiding the approximation is the defect; using the C++ grammar is the approved design.
- **Minimal correction:** retain non-empty approximations (and any omitted count) in the compact clean shape, without changing `isCleanAnswer`, and update its type, legend and exact-shape tests. If the Decision 21 compact-block shape must remain exact, preserve the same qualification adjacent to coverage in the served envelope/formatter instead. Also carry the original C hint into the outline trailer and add the qualification to the Electron report when its C++ parser handles `.c/.h`. Add clean `.c` and `.h` assertions at the real dispatcher/report boundary, with `.cpp` as a negative control. Do not rely on the raw spool or simply set `clean:false` to retain fields.

### R31-02 — Blocking: valid C++ function definitions are silently treated as an empty clean index

- **Disposition:** fix-now; not Batch 36, which owns exports/graphs rather than the codeIndex/outline capabilities activated here.
- **Anchors:** `WI/ast/languages/cpp.language.ts:60`–:68; `MCP/mcp-core/code-outliner.adapter.ts:123`–:131; `WI/services/code-symbol-indexer.service.ts:276`.
- **Reproductions, each in its own `.cpp` file:**

```cpp
int (needle)(int x) { return x; }
int ***needle() { return nullptr; }
int (*needle())(int) { return nullptr; }
```

- **Observed symptom:** every source parses `ok` with the shipped WASM, but yields zero functions, zero index rows, `clean:true`, `analyzed:1`, and no `needle` focus range. These are definitions, not the prototypes deliberately excluded by the plan.
- **Cause:** name/declarator alternatives enumerate a bounded subset, including at most two pointer wrappers. Parenthesized declarators and a function returning a function pointer are outside those alternatives. There is no unmatched-definition accounting to distinguish a genuinely empty file from incomplete extraction. The author's stated four-scope limit has the same architectural weakness; the examples above are independently reproduced.
- **Recommendation:** walk the declarator structure to locate its declared identifier instead of relying solely on a fixed-depth query alternation. At minimum, detect a `function_definition` that cannot be represented, report `unsupported-syntax`/partial extraction and refuse an incomplete focus outline. Add the three shapes to real-grammar and served-index tests. Parenthesized and recursively composed declarators are ordinary language syntax; see the [C++ working draft's declarator grammar](https://eel.is/c++draft/dcl.decl).

### R31-03 — Blocking: same-line declarations disappear before unique subjects are allocated

- **Disposition:** fix-now; unresolved R30-02, escalate under Decision 24.
- **Anchors:** `WI/ast/ast-analysis.service.ts:270` and :310; downstream subject allocator `WI/services/code-symbol-indexer.service.ts:1079`.
- **Trigger and observed results:**

| One-line input                                                                                | Expected declarations                      | Actual result                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `class A { void needle(int x) {} void needle(String x) {} }`                                  | Two methods plus class                     | One method plus class; indexed 2, clean         |
| `struct Foo; impl Foo { fn first() {} } impl Foo { fn second() {} }`                          | Struct, two implementations, two functions | One Foo row and two functions; indexed 3, clean |
| `namespace a { int needle(int x) {return x;} } namespace b { int needle(int x) {return x;} }` | Two distinct functions                     | One function; indexed 1, clean                  |

- **Cause:** `seen` is keyed by `${name}:${startLine}` in both extraction loops. Both declarations already exist in the syntax tree, but the second is discarded before the allocator can use its `.2` collision suffix. Unique persisted subjects cannot restore missing input chunks.
- **Recommendation:** deduplicate repeated captures of the **same node**, using full source identity/range including columns or offsets, not name plus line. Preserve distinct nodes even if their names and rows coincide. Test same-line Java overloads, Rust struct/impls and C++ namespaces end to end; assert expected cardinality as well as subject uniqueness. The present harness's uniqueness assertion alone is satisfied by an incomplete one-row result.

### R31-04 — Blocking: an escaped opening brace still hides a Rust format capture

- **Disposition:** fix-now; unresolved R30-03, escalate under Decision 24.
- **Anchor:** `Electron:1528`–:1534, called by the raw-source scanner at :1102.
- **Trigger:** `const needle: i32 = 1;` followed by `fn main(){ println!("\x7bneedle\x7d"); }`.
- **Observed symptom:** public `getReferencesReport` returns only the declaration, with Rust supported and no incomplete/truncation marker. The improved string exclusion query keeps this string, but the regex's left boundary sees the preceding hexadecimal escape character `b`, so it rejects `needle`.
- **Why still a defect:** the cooked string is `{needle}` and refers to the in-scope variable. The author's known-miss comment documents the loss but does not repair it. This is the same real-format-use omission reviewed in R30-03, with the boundary failure now isolated. Rust literal escape decoding and implicit format captures are specified by the [Rust Reference](https://doc.rust-lang.org/reference/expressions/literal-expr.html) and [formatting documentation](https://doc.rust-lang.org/std/fmt/).
- **Recommendation:** scan decoded format content with an offset map to original locations, or conservatively handle an identifier immediately after a complete escape inside retained formatting strings. Keep normal identifier-boundary checks outside that context. Add the exact no-whitespace escape case; the passing line-continuation case does not test this boundary.

### R31-05 — Serious: Ruby parameter names are corrupted when parentheses are omitted

- **Disposition:** fix-now in the newly enabled Ruby analysis path.
- **Anchors:** `WI/ast/languages/ruby.language.ts:22`–:27; `WI/ast/ast-analysis.service.ts:261`, :387–:389.
- **Trigger:** `def needle alpha, beta` followed by a body and `end`.
- **Observed symptom:** real analysis returns `parameters: ['lpha', 'bet']`. The shorter `def needle a, b` returns `[]`. Both parses and their index coverage are clean.
- **Cause:** Ruby's `method_parameters` capture omits delimiters when the source does. The shared extractor blindly applies `slice(1,-1)`, deleting characters from the parameter names rather than parentheses.
- **Recommendation:** strip delimiters only when present, or extract Ruby parameter nodes directly; preserve the existing other-language behavior. Add delimited/non-delimited parity assertions through AST analysis. This is legal, routine syntax, not an unsupported-language corner: [Ruby method documentation](https://docs.ruby-lang.org/en/3.3/syntax/methods_rdoc.html) explicitly permits omitted parentheses.

## Requested checks and accepted limits

### C headers and `.h` ambiguity

The common C/C++ interop header pattern that splits `extern "C" {` across `#ifdef __cplusplus` reproduces `parseStatus:'recovered'`, `failedByReason:{parse:1}`, clean false, and outliner `null`. That is an honest result **for the approved C++ parser**, not a claim that the C header is invalid. This is a practical coverage limitation for dual-language public headers, not an additional defect under Decision 19. The failed answer retains `c:parsed-as-cpp`; the clean-answer loss is R31-01. Treating all `.h` files conservatively as C parsed with C++ is the selected policy; no separate C language ID should be fabricated.

### Grammars, consumers and packaging

- New PHP/Ruby/C++ query modules were read; actual query compilation/extraction and focused outline probes use shipped WASM. Mixed PHP/HTML with a heredoc parses and indexes its function. Ruby string, heredoc and regex `#{needle}` interpolations all remain references. PHP interpolated/heredoc variables remain references. C macro bodies remain references while string/comment filtering is exercised by the submitted tests.
- Literal Ruby `require` and `require_relative` are captured; receiver-bound/computed/interpolated forms are deliberately excluded by the query at `ruby.language.ts:52`. PHP literal includes and grouped/aliased `use` are covered in the real-grammar integration suite. These do not yet claim Batch 36 graph resolution.
- Extension mapping is shared by the parser/config, indexer (:170), graph (`WI/ast/dependency-graph.service.ts:600`), analyzer (:598), diagnostics (:231), outliner and Electron (:1359). No additional hand-mapped old grammar was found for these extensions. Basename-only Ruby files remain outside the declared `.rb/.rake` extension scope; that is not silently claimed support.
- The real copy script produced exactly the active manifest: runtime plus 11 grammars. CLI/Electron-style temporary bundles loaded all 11 using the production WASM resolver. Real tarball and ASAR verification functions accepted complete fixtures and rejected removal of **each** PHP, Ruby and C++ asset. The copy self-test passes; its deactivation test is appropriate now every packaged grammar is active. No installed release/GUI launch was performed.

### Harness and descriptions

`b31.ts` declares 12 keys. The WI registry at `language-honesty.contract.spec.ts:453`–:479 and executing loop :1522 cover nine; the MCP registry at `mcp-language-coverage.spec.ts:896`–:904 executes the three outline keys. C++ checks run `.cpp`, `.c` and `.h`. The checks are real, but their asserted properties omit clean served approximation retention and missing captures, as the findings demonstrate.

`b37b.ts` adds only `typeCheck:go`. At `language-honesty.contract.spec.ts:1348`, the check builds a real consent store, GoVetChecker and LanguageAwareDiagnosticsProvider over a temporary module. The injected process runner increments a counter: no/stale consent requires zero launches; granted consent requires one launch and checkedFiles=1; unmapped output must not look clean. Every case asserts syntax-only, not a type-check claim. It therefore executes the checker/provider path rather than fabricating provider results. Go binary discovery/process execution are injected, so this is not evidence that an installed Go toolchain runs successfully. No broader Lane K review is implied.

`tool-description.builder.ts:41` maps all 12 language IDs exhaustively to distinct compact names; :65 preserves registry order and capability filtering. `ts,js,tsx,py,go,cs,java,kt,rs,php,rb,c/cpp` is concise and intelligible in these technical descriptions. The independent mapping snapshot and all-12-languages pin test pass. Current search/reindex lengths are 664/702 and 515/536; the all-language test does not grant Kotlin capabilities prematurely. The required approximation is not a substitute for, and cannot be inferred from, the short label `c/cpp`.

## Five logic questions

1. **How does this fail silently?** Clean C responses hide their grammar approximation (R31-01); captures and same-line declarations disappear while indexing reports clean (R31-02/03).
2. **What user action gives unexpected behavior?** Searching for a parenthesized C++ function or the second same-line overload can return nothing. Asking for escaped Rust format references misses a real use (R31-04).
3. **What input produces a wrong answer rather than an error?** Legal non-parenthesized Ruby parameters become misspelled names (R31-05); the concrete C++/Rust inputs above also succeed with incomplete data.
4. **What happens on dependency failure or refusal?** A C header rejected by the grammar is failed.parse and its outline is refused. Unknown/wrong result-language hints preserve complete raw output via explicit fallback. Missing packaged grammars fail archive verification. These guards do not detect an otherwise successful query that silently captures too little.
5. **What was missing from the acceptance examples?** Full node identity across same-line declarations, accounting for unmatched definitions, delimiter-free Ruby parameters, and approximation checks after every serialization/formatting boundary.

## Data flow and requirements fulfilment

| Stage / requirement                           | Status                                   | Evidence or gap                                                                                |
| --------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Extension → module → packaged grammar         | COMPLETE in tested fixtures              | Shared maps; all three new assets load and are verified in tar/ASAR fixtures.                  |
| Parse → declaration extraction                | PARTIAL                                  | Real grammar success; R31-02/03/05 lose or corrupt valid information.                          |
| Extracted declaration → unique stored subject | COMPLETE for surviving captures          | Original production SQLite probes now persist all rows; upstream same-line loss remains.       |
| C producer coverage → compact served answer   | PARTIAL                                  | Raw qualification exists; R31-01 drops it or never carries it to the outline/reference report. |
| PHP/Ruby interpolation → Electron references  | COMPLETE for tested cases                | Actual public reports retain string/heredoc/interpolation references.                          |
| Rust escaped formatting → references          | PARTIAL                                  | Width and continuation fixed; R31-04 remains.                                                  |
| New activation key → executing honesty check  | COMPLETE registration, PARTIAL assurance | All keys execute; missing negative cases above.                                                |
| Go vet activation → consent/checker/provider  | COMPLETE for injected-runner contract    | Consent off/stale, successful run, unmapped findings and no type-check overclaim asserted.     |

## Verification and hygiene

- Required Nx test/lint/typecheck for workspace-intelligence, vscode-lm-tools and ptah-electron: **PASS**, exit 0, 2m03s; three projects plus six dependency tasks. No rerun.
- Required rpc-handlers test run: **FAIL**, only known `harness-skill-selection` “never writes state.json” assertion at its spec:113. 112 suites passed, one failed; 3,300 tests passed, one failed, four skipped. No new mock-export failure observed.
- Scoped `ptah_get_diagnostics` on the three new language modules: TypeScript compiler, zero errors and warnings.
- Reviewer probes: eight observational tests passed in 46.955s, followed by one new same-line/parameter probe in 7.366s. Their captured outputs demonstrate the findings; a passing observational probe is not a passing regression assertion for the observed wrong result. Source was not sabotaged or edited.
- Evidence is under `C:/Users/abdal/AppData/Local/Temp/ptah-review31-56ea3f90/`: `dispatch-results.json`, `persisted.json`, `rust-index.json`, `new-languages.json`, `new-refs.json`, `same-line.json`, `followup-refs.json`, `last-results.json`, package logs and the two Nx logs.
- Reviewer-authored probes and package fixtures stayed under TEMP. Hygiene exception: invoking the repository's existing `copy-wasm.js --self-test` created its own `.wasm-copy-test-*` directory under the worktree, then removed it; a subsequent check found none. No reviewed source/spec or git state was changed. Required Nx runs naturally produce their normal build/cache outputs.
- Limits: no installed app launch or native Rust/Ruby/C++ compiler run. Language semantics were checked against primary language documentation; failures themselves were observed through production parser/extractor/dispatcher/scanner code. No task-description or code-style-review artifact was found in the inspected task inputs.

## Verdict

- **Recommendation: REVISE** — Batch 31, **4/10**.
- **Part 1:** R30-01 and R30-04 VERIFIED; R30-02 and R30-03 OPEN despite their original narrower regression examples passing.
- **Confidence:** HIGH for the reproduced failures; package assurance limited to builds/resolver/archive fixtures.
- **Top risk:** successful parse/index responses still lose declarations or qualifications without making the incompleteness visible.
- **What a robust correction adds:** approximation retention at served boundaries, complete node identities, unmatched-definition refusal/accounting, escape-aware Rust reference matching and Ruby parameter extraction that respects optional delimiters. All findings are fix-now; the two open rolled-forward Blocking findings additionally require Decision 24 escalation by the orchestrator.
