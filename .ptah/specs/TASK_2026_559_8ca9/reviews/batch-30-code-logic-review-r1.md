# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 30 r1, including the rolled-forward 29b fixes; baseline HEAD 04a4874b8. Reviewed the on-disk changes, language modules, consumer paths, persistence boundary, harness registrations and packaging scripts. No reviewed source or spec was edited; probes were confined to the system temporary directory.

| Metric                | Value          |
| --------------------- | -------------- |
| Overall score         | 4/10           |
| Assessment            | NEEDS_REVISION |
| Blocking issues       | 3              |
| Serious issues        | 1              |
| Moderate issues       | 0              |
| Failure modes found   | 4              |
| Part 2 recommendation | REVISE         |

The real grammars compile and the principal checks pass, but successful parsing does not imply a complete persisted index. Two new language scenarios silently overwrite indexed declarations, and reference filtering loses real Rust uses. These observed failures separate this score from 5–6; functioning parsing, refusal handling and packaging separate it from 1–3.

Paths below are relative to the worktree. `WI` means `libs/backend/workspace-intelligence/src`; `MCP` means `libs/backend/vscode-lm-tools/src/lib/code-execution`; `Electron` means `apps/ptah-electron/src/services/electron-ide-capabilities.ts`.

## Part 1 — rolled-forward 29b findings

| Finding                        | Status                | Evidence                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R29b-01 TSX consumer mapping   | VERIFIED              | Electron's TSX exclusion query at Electron:282 and shared extension mapping now parse JSX with TSX. Re-ran the public reference report for `export const needle = 1;` followed by a component returning `<div>"{needle}"</div>`: declaration and JSX use both returned, language `tsx`. `WI/composite/workspace-analyzer.service.ts:598` also uses the shared extension map.       |
| R29b-02 reachable outliner     | OPEN, wiring verified | `MCP/mcp-core/protocol-dispatcher.ts:3387` feeds the execution result into serialization before budgeting. A 40,004-character TSX result reaches the real outliner, preserves three declarations and spools byte-equal. A 195,104-character result loses its tail before that same path; see R30-01. The fix makes outlining reachable, but does not satisfy full-result recovery. |
| R29b-03 enrichment description | VERIFIED              | `MCP/mcp-core/tool-description.builder.ts:1726` no longer excludes TSX; extension wording at :1741 agrees with the registry. Existing description regression assertion at builder.spec.ts:532 and scoped checks pass.                                                                                                                                                              |

### New `resultLanguage` API

The schema at `MCP/mcp-core/tool-description.builder.ts:326` declares a string, not a registry enum. Runtime validation at `MCP/mcp-core/protocol-dispatcher.ts:3369` trims it and rejects nonstrings, empty strings and values over 32 characters before executing code. Probes with `42`, empty string and 33 characters returned -32602 without invoking the outliner. Advertising the length constraints in the schema would improve consistency, but this is not an unvalidated execution boundary.

Allowing language IDs and extensions rather than a closed enum is acceptable here: an unknown ID or a wrong supported language produces an explicit `code-fallback:log-reduced` result, does not throw away the result, and retains the complete 40,004-character spool. The wording “outlined, not cut” should be qualified to describe this fallback. `tool-result-budget.ts:318` forwards the explicit hint; it is not guessed from source contents.

The enrichment JSON envelope is not an additional defect. `protocol-dispatcher.ts:2017` serializes the structured enrichment response as JSON, preserving its mode/reason fields. My oversized envelope probe did not invoke the source outliner; the JSON attempt ultimately fell back to reducer `none`, and its spool exactly matched the complete JSON response. An envelope is not a raw source string and should not be forced through a source-language parser.

## Part 2 — findings

### R30-01 — Blocking: serialization destroys output before the recoverable budget boundary

- **Disposition:** fix-now; rolled-forward R29b-02 remains open on recovery.
- **Anchors:** `MCP/mcp-core/protocol-dispatcher.ts:3387`; `MCP/mcp-core/code-execution.engine.ts:478`, :500, :503.
- **Trigger:** `execute_code` returns a valid 195,104-character TSX source string with `resultLanguage: 'tsx'`. This is below the outliner's 256 KiB ceiling and the parser's 1 MiB ceiling.
- **Symptom:** the serializer first cuts the result at 51,200 characters and appends its truncation notice. The outliner sees incomplete syntax, falls back, and the “full output” spool contains only 51,315 characters. Middle and final declarations are unrecoverable. The same probe at 40,004 characters outlines successfully and has a byte-equal spool.
- **Current handling:** the earlier serializer cap bypasses the later raw-spool guarantee; this predates the hint but defeats the newly exposed public path.
- **Recommendation:** pass the complete serialized result into the bounded output/spool layer, with any necessary upstream refusal made explicit before destructive truncation. Add a real-dispatch regression above 51,200 characters that asserts full raw byte equality and preservation of late declarations. Qualify the API description for parser/refusal fallback.

### R30-02 — Blocking: Rust implementations and Java overloads overwrite one another in the real index

- **Disposition:** fix-now, before enabling these codeIndex capabilities.
- **Anchors:** `WI/ast/languages/rust.language.ts:32`, :40; `WI/services/code-symbol-indexer.service.ts:1055`, :1070, :1085, :1149; `libs/backend/memory-curator/src/lib/code-symbol.store.ts:165`.
- **Trigger:** index a Rust `pub struct Foo<T>(T)` followed by two separate `impl<T> Foo<T>` blocks, containing `new` and `get`. Or index Java `class Foo { void method(int x) {} void method(String x) {} }`.
- **Symptom:** Rust emits five chunks and reports `symbolsIndexed: 5`, clean coverage, but SQLite retains three rows: `new`, `get`, and only the last `Foo` implementation span. The struct and first implementation spans disappear. Java emits/reports three rows but persists two; only the last overload's span remains.
- **Current handling:** names within a file determine subjects; the store's `(workspace_root, subject)` conflict handler overwrites the earlier row. The new Rust query intentionally names each implementation after its implemented type, making the collision routine.
- **Proof:** exercised the production indexer and production store insertion SQL against an in-memory SQLite database, including its actual conflict handling. This is not inferred from a mock collecting chunks.
- **Recommendation:** give distinct declarations stable, distinct identities, including appropriate scope/signature/span information, or explicitly aggregate all declaration spans without dropping any. Preserve the primary type declaration alongside implementations. Add persistence-level tests; the harness's name-collecting sink at `WI/testing/mcp-contract/language-honesty.contract.spec.ts:588` cannot detect this loss.

### R30-03 — Blocking: Rust reference filtering drops genuine format-variable uses

- **Disposition:** fix-now for the newly enabled Rust reference path.
- **Anchors:** `Electron:296`–:299 and :1469–:1471.
- **Trigger A:** `const needle: usize = 5; fn main() { println!("{0:needle$}", 1); }`.
- **Symptom A:** the public reference report returns only the declaration. The brace heuristic retains the string, but the shared identifier matcher treats `$` as an identifier continuation and rejects the real dynamic-width use.
- **Trigger B:** a format string whose opening/closing braces are `\x7b` and `\x7d`, with a string line continuation before `needle`. Its cooked value is `{needle}`; the raw syntax contains no literal braces.
- **Symptom B:** the real grammar parses successfully, but the new string query excludes the entire literal. The public report again returns only the declaration, with language supported and no truncation. The line-continuation probe places whitespace before the raw identifier, isolating the exclusion failure from the regex boundary issue.
- **Current handling:** ordinary/raw strings with literal braces are retained indiscriminately, while strings with encoded braces are discarded. Normal `{needle}` and raw-string `{needle}` probes work; plain ordinary/raw/byte strings without braces are filtered.
- **Recommendation:** use Rust-appropriate identifier boundaries and conservatively retain ambiguous formatting strings, or decode and classify format arguments before excluding them. Add public-path tests for dynamic width and escaped braces. Keeping false positives in non-format brace strings is an acceptable documented text-scan approximation; systematically deleting actual format uses is not.

Rust's named format arguments/dynamic width and literal decoding establish these uses: [formatting rules](https://doc.rust-lang.org/std/fmt/), [string literal rules](https://doc.rust-lang.org/reference/expressions/literal-expr.html#string-literal-expressions). The probes used the shipped grammar and real reference scanner; rustc was unavailable, so they were not compiled with Rust's compiler.

### R30-04 — Serious: qualified Rust implementations are absent from indexing and focused outlining

- **Disposition:** fix-now within the activated codeIndex/outline capabilities, not the later public-symbol/graph batches.
- **Anchors:** `WI/ast/languages/rust.language.ts:40`–:45; `MCP/mcp-core/code-outliner.adapter.ts:191`–:192.
- **Trigger:** `mod nested { pub struct Foo; }` followed by `impl nested::Foo { fn method(&self) { let x = 1; } }`.
- **Symptom:** parsing succeeds, but only the struct is captured as `Foo`. The qualified implementation has no index row. Focusing the outline on `Foo` retains only the struct as a focus range and still marks the implementation method body omittable. A reference-type implementation (`impl Bar for &Foo`) is also absent.
- **Current handling:** both queries accept only a bare type identifier or a generic type whose base is a bare identifier. The documented intent at rust.language.ts:25 is that searching a type finds its implementation blocks too.
- **Recommendation:** cover scoped and supported wrapped implemented-type forms, normalize their type names consistently, and assert implementation capture/focus with the real grammar. The ordinary `impl<T> Foo<T>` positive case passes, but does not cover these shapes.

## Five logic questions

1. **How does this fail silently?** Successful indexing reports more symbols than persist (R30-02, indexer:1149); Rust reference reports omit genuine uses (R30-03, Electron:298).
2. **What user action produces unexpected behaviour?** Requesting a large source result with `resultLanguage` yields an incomplete recovery spool (R30-01, dispatcher:3387). Searching a Rust type can miss its qualified implementation (R30-04).
3. **What input produces a wrong answer?** Java overloads, repeated Rust implementations, qualified implementation types and Rust format width/escaped-brace strings; see anchored reproductions above.
4. **What happens when a dependency fails or refuses input?** Unknown/wrong language probes take explicit code fallback and retain the raw spool below the serializer cap. Submitted real-grammar tests cover broken syntax and syntax-only diagnostics. Packaging negative probes reject a missing Java or Rust asset. These safeguards do not repair the upstream cap.
5. **What was missing from the requirements?** The new-language acceptance boundary needed real persistent identity checks, not just captured-name checks, and a source-result test crossing the pre-existing serializer limit. No semantic macro expansion is claimed or required here.

## Data flow and requirements fulfilment

| Path / requirement                                   | Status                                   | Evidence / gap                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension → Java/Rust registry → lazy parser         | COMPLETE                                 | New modules, shared map; real shipped WASM/query compilation succeeds.                                                                                                                                                                   |
| Parse → query captures → persisted symbols           | PARTIAL                                  | Ordinary declarations work; R30-02/R30-04 lose declarations.                                                                                                                                                                             |
| Source hint → serialization → reducer → spool        | PARTIAL                                  | Explicit hint reaches real outliner; R30-01 destroys large raw results first.                                                                                                                                                            |
| Electron text scan → string exclusions → locations   | PARTIAL                                  | Correct grammar selection; R30-03 loses format uses.                                                                                                                                                                                     |
| Parse/outline/codeIndex/syntaxDiagnostics activation | COMPLETE registration; PARTIAL assurance | b30.ts has eight keys; WI registry at language-honesty.contract.spec.ts:426 and executing loop :1072, MCP outline registry at mcp-language-coverage.spec.ts:686 and loop :691. Checks execute; index sink misses persistence collisions. |
| Packaged Java/Rust WASM                              | COMPLETE in tested package fixtures      | Both copied and loaded; CLI archive and Electron ASAR verifiers reject either missing grammar.                                                                                                                                           |
| Description pins/honesty                             | COMPLETE for Batch 30 trims              | Search-symbols 702/702 and reindex 535/536; syntax-only/coverage qualifications remain. Enrichment does not claim Java/Rust structural summaries.                                                                                        |

Generic/annotated/nested Java and ordinary Rust traits/implementations are covered by the real-WASM integration checks. Bodiless Rust trait signatures are explicitly outside the plan's `function_item` query (rust.language.ts:14); macro expansion and public exports/graph edges are deferred, not newly claimed. This review does not imply semantic completeness for those features.

## Verification and edge cases

- Required Nx test/lint/typecheck run for workspace-intelligence, vscode-lm-tools and ptah-electron: **PASS**, exit 0, about 3m19s, including six dependency tasks and Electron main build.
- Required rpc-handlers tests: **FAIL**, exit 1: only the known `harness-skill-selection` state.json assertion. 111 suites passed, one failed; 3,275 tests passed, one failed, four skipped. No new mock-export failure observed.
- Temporary real-grammar reviewer run: 19 passing tests (16 submitted integration checks plus three reviewer probes). Additional focused runs passed two and one observational probe tests respectively; their captured outputs reproduce the findings, rather than asserting those defects are correct behaviour.
- Real dispatcher probes: valid/invalid/unknown/wrong hints, 40,004 and 195,104-character source strings, and oversized JSON enrichment envelope.
- Packaging: actual copy script produced runtime plus eight grammar assets. Temporary CLI/Electron-style bundles located and loaded all eight grammars. Actual archive-verification functions accepted complete tar/ASAR fixtures and rejected Java-removed and Rust-removed fixtures. The copy self-test's Java→PHP inactive-language change is justified now Java is active; it does not weaken the active-asset assertions.
- Residual uncertainty: no installed desktop/CLI release launch, no Rust compiler execution, and no claim of exhaustive Rust type/macro semantic coverage. The decisive failures were observed against production dispatch, queries, scanner and persistence SQL.

Probe evidence/logs: `C:/Users/abdal/AppData/Local/Temp/ptah-review30-af1bb3b5/` (`dispatch-results.json`, `persisted.json`, `rust-index.json`, `followup-refs.json`, `last-results.json`, `nx-main.log`, `nx-rpc.log`, packaging logs). No source mutations or state-changing git operations were used.

## Verdict

- **Recommendation: REVISE** — Part 2 Batch 30, **4/10**.
- Part 1: R29b-01 and R29b-03 VERIFIED; R29b-02 wiring verified, full-result recovery OPEN under R30-01.
- Confidence: HIGH for reproduced failures; packaging confidence limited to the tested build/archive fixtures.
- Top risk: clean-looking index results silently replace declarations, and the recovery spool can itself be incomplete.
- A robust correction needs complete raw spooling before reduction, persistent declaration identities, Rust-aware reference filtering and qualified implementation capture. All four findings are fix-now; verify their corrections in the next lane review under Decision 24.
