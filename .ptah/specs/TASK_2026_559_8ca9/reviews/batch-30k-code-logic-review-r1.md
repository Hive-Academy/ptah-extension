# Code logic review — Batch 30k r1 and rolled-forward Batch 31 fixes

## Verdict

**Recommendation: REVISE — 6/10.** Batch 30k: NEEDS_REVISION. Batch 31 fix verification: all five findings CLOSED for the reproduced scenarios.

0 Blocking, 2 Serious, 1 Moderate; 3 concrete failure modes. Provenance and ordinary Kotlin parsing are established, but packed integrity and user-visible honesty remain incomplete.

Reviewed the on-disk changes against HEAD `1308f750f080c4a4a9def1e63e48e7656522210b`, plus Batch 31 fixes in `e6c155260`. Paths below are worktree-relative. `WI` means `libs/backend/workspace-intelligence/src`; `MCP` means `libs/backend/vscode-lm-tools/src/lib/code-execution`.

## Part 1 — Batch 30k findings

### R30K-01 — Serious: all three packed verifiers accept corrupted Kotlin WASM

**Anchors:** `apps/ptah-cli/scripts/verify-packed-wasm.cjs:111`; `apps/ptah-electron/scripts/verify-packed-wasm.js:127`; `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs:77`.

**Trigger → observed symptom:** run the real copy function to create a complete temporary package, flip the first byte of `wasm/tree-sitter-kotlin.wasm` without changing its length, then build an npm tarball, Electron ASAR and VSIX. All three production verification functions return an empty problems array. The corrupted byte is part of the WASM magic header; this is not merely a benign binary difference. A corrupted cache/artifact or a later packaging step can therefore deliver an unloadable grammar while the release gate passes.

The loops enforce presence and nonzero size, but do not compare WASM bytes to the reviewed SHA-256. The new licence checks do hash their bytes. The copy-stage guard is good: independent probes rejected altered source WASM, altered/missing licence and a provenance byte-count mismatch before creating output. It cannot prove the bytes in a later archive are unchanged.

**Recommendation / disposition: fix-now.** Carry the vendored asset's expected digest and byte count into each packed verifier and hash the extracted archive member. Preserve the VSIX CLI boundary with an explicit metadata listing if needed. Add non-empty changed-WASM negatives to all three self-tests. The existing missing/empty-WASM and changed/missing-licence negatives do pass. This finding does not require shipping the provenance JSON; it requires the packed bytes to match the approved record.

### R30K-02 — Serious: known valid Kotlin is presented as a syntax error without the grammar limitation

**Anchors:** `WI/ast/languages/kotlin.language.ts:14` and `:89`; `WI/diagnostics/language-aware-diagnostics-provider.ts:1073`; the newly added expectation at `WI/ast/kotlin-grammar.integration.spec.ts:624`.

**Trigger → observed symptom:** the real ABI-14 grammar, parser service and diagnostics provider process `object Keys { const val A = 1 }`. The provider emits severity `error`, code `syntax`, line 0, message `Syntax error at an unknown position (kotlin; syntax-only check).` Its only approximation is `kotlin:syntax-only`. The same happens for `class C { init { println() } }`. Both are valid Kotlin forms affected by the acknowledged grammar limitation.

The developer-facing comment and executor report do not reach the caller. “Syntax-only” distinguishes syntax checking from type checking; it does not disclose that supported valid syntax can be rejected. The new test explicitly locks in this unqualified false positive. The diagnostics coverage's `clean:true` describes accounting completeness, not absence of errors; that boolean is not the defect here.

**Recommendation / disposition: fix-now.** Make this a caller-visible parser limitation, with a named approximation and diagnostic wording that does not assert the source is invalid. If affected recoveries cannot be distinguished safely, report that syntax validation was incomplete/refused rather than inventing a source error, or withhold the Kotlin syntax-diagnostics capability until an honest result can be supplied. Add a valid-source negative assertion at the provider/served boundary. An upstream grammar replacement would require a new provenance round, but is not the only acceptable fix.

### R30K-03 — Moderate: a comment makes a valid Kotlin import disappear

**Anchor:** `WI/ast/languages/kotlin.language.ts:59`.

**Trigger → observed symptom:** compare `import a.b.C\nfun needle() = 1` with `import a./* comment */b.C\nfun needle() = 1`. The real grammar parses both with `parseStatus:'ok'`. The first analysis reports source `a.b.C`; the second reports no imports. The plain-import query rejects any import statement containing `*`, including the delimiters of a block comment, rather than testing for an actual wildcard token.

This is an AST-analysis extraction defect, not a request for a Kotlin graph key. The module exposes an import query and successfully returns an incomplete answer for a supported file.

**Recommendation / disposition: fix-now.** Distinguish the wildcard anonymous token structurally, or filter/canonicalize the captured syntax rather than searching raw statement text. Keep plain, wildcard and aliased imports distinct without duplicate captures. Test comments within and adjacent to each form, and compare semantic module names with their comment-free equivalents.

## Provenance, capabilities and scope checks

The independent re-check satisfies User Decision 25's provenance gate:

| Evidence                | Reviewer result                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Checked-in WASM         | 3,441,042 bytes; SHA-256 `7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7`                        |
| Checked-in licence      | 1,101 bytes; SHA-256 `0eea8dc45e89deeb03c7799bbbc7b4688f365fb274562f4540ecfebdea82e727`                            |
| Fresh npm 1.1.0 tarball | Registry SHA-512 integrity verified before extraction; both extracted buffers byte-equal to checked-in files       |
| Source identity         | npm gitHead `77dd60ea0a9003ce062c9728a513ffe1aaff8c82`; manifest and provenance record agree                       |
| Attestation             | `gh attestation verify` passed with repository, signer workflow, tag `v1.1.0` and exact source digest restrictions |
| Runtime                 | Real shipped WASM loads under web-tree-sitter; reports ABI 14; actual Kotlin query integration suite passes        |

No source rebuild was performed or required under Decision 25. These checks establish the approved artifact identity; they do not remove the packed-artifact gap R30K-01.

The manifest activates Kotlin with `.kt/.kts`. `b30k.ts` adds precisely parse, outline, codeIndex and syntaxDiagnostics; no graph/publicSymbols key. The executing WI registry entries are at `language-honesty.contract.spec.ts:495–498`; the real outline check is at `mcp-language-coverage.spec.ts:963`. Query node names compile against the actual grammar, rather than being inferred from the language name. Export extraction and graph support remain unclaimed.

`language-registry.ts:91` assigns the module map to `Readonly<Record<LanguageId, LanguageModule>>`; removing the now-dead unsupported branch is appropriate now every LanguageId has a module. A future missing module is a type error rather than an unchecked runtime lookup. The registry suite and scoped compiler diagnostics passed. The module is configuration data and introduces no new grammar-loading side effect.

Independent same-line Kotlin probes retain two overloads with the same name, and retain four declarations from two same-line classes each containing a same-named method. Index subjects are distinct. Search/reindex description pins remain within 702/536 (671/522 as specified); the executing description suite passes. Compact aliases add `kt` while the capability-filtered lists avoid claiming Kotlin graph support.

The additional spec changes outside the original short batch list are justified by activation: Kotlin-unsupported cases move to still-unsupported extensions; registry snapshots and description expectations change; real-WASM test resolvers learn the vendored location; required honesty registries gain Kotlin. No removed budget/marker/spool assertion was identified in these changes. The licence filename follows the reviewed manifest amendment, not the stale illustrative filename in the batch text.

## Kotlin limitation ruling

**A disclosed parser approximation is acceptable; the current syntax-diagnostic presentation is not.** For the valid one-line object probe, the code index retains a partial object row but reports one failed file with reason `parse`, analyzed zero and clean false. That is honest incomplete extraction. An outliner refusing an error-containing nested body is also honest; a refusal must retain the normal raw-output fallback. The simple recovered object can still produce an outline; this review does not infer data loss merely from that fact.

The source-level disclosure needs to become a user-visible qualification as described in R30K-02. A generic syntax-only label is insufficient. The upstream [multiple-members issue](https://github.com/tree-sitter-grammars/tree-sitter-kotlin/issues/12) and [related parser change](https://github.com/tree-sitter-grammars/tree-sitter-kotlin/pull/13) corroborate the broader grammar limitation; the exact one-line examples above were independently reproduced. No claim is made that upstream has fixed the reviewed 1.1.0 artifact.

## Part 2 — Batch 31 fix verification

| Prior finding                                    | Status     | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R31-01: clean C qualifications disappear         | **CLOSED** | `platform-core/src/interfaces/language-coverage.interface.ts:495–513` retains clean approximations. Replayed actual AST dispatch for a clean `.c` file: inline coverage includes `c:parsed-as-cpp`. Real C resultLanguage outline includes the qualifier; `code-outliner.adapter.ts:377` carries it. Electron public reference report also includes it (`electron-ide-capabilities.ts:1426`). Coverage tests pass; registry enumeration pins worst compact length at **994**, below 1,000. |
| R31-02: composed C++ declarators silently vanish | **CLOSED** | New `WI/ast/c-declarator.ts` walks declarators; analysis consumes the recovered name at `ast-analysis.service.ts:294`. Real probes for `int (needle)(int x)`, `int ***needle()` and `int (*needle())(int)` each return and index one function, with a nonempty outline. Unextractable declarations have explicit accounting rather than an empty-clean answer.                                                                                                                             |
| R31-03 / R30-02: same-line declaration collapse  | **CLOSED** | Function keys use name row and column at `ast-analysis.service.ts:304–305`; class keys do likewise at `:346`. Replayed exact old cases: Java overloads + class = **3** rows; Rust struct + two impls + two functions = **5**; same-named functions in two C++ namespaces = **2**. All subjects distinct. Kotlin overload/class probes additionally confirm this fix survives the new module.                                                                                               |
| R31-04 / R30-03: escaped Rust captures missed    | **CLOSED** | `rust-format-references.ts:51,122,185` decodes literals, handles format braces and maps positions back. Public Electron report now finds declaration plus use for `"\x7bneedle\x7d"` and escaped dynamic width. Additional direct helper probes reject literal `"{{needle}}"`, retain `"{{{needle}}}"`, and retain `{0:needle$}` at correct original columns. Regression cases are present in `electron-ide-capabilities.spec.ts:2592`.                                                    |
| R31-05: Ruby delimiter-free parameters corrupted | **CLOSED** | `ast-analysis.service.ts:428` strips only actual parentheses. Real probes now return `['alpha','beta']` for `def needle alpha, beta` and `['a','b']` for the short form; no fabricated/truncated names.                                                                                                                                                                                                                                                                                    |

The dual-language `extern "C"` header remains an explicit failed parse under the approved C++ approximation. This is the previously accepted limitation, not a reopened finding. PHP/Ruby interpolation reference probes remain successful.

## Logic and data-flow assessment

1. **Silent failure:** comment-sensitive imports disappear from an otherwise successful Kotlin analysis (R30K-03).
2. **Unexpected user result:** routine valid one-line Kotlin receives an error diagnostic without its parser limitation (R30K-02).
3. **Incorrect success at a boundary:** corrupted non-empty WASM passes every packed verifier (R30K-01).
4. **Failure handling:** source hash/provenance/licence mismatches fail before copy output; recovered index parses report failed.parse; packed byte corruption is the missing check.
5. **Missing negative coverage:** current suites lack altered-but-nonempty packed WASM and comment-containing plain imports; the new valid-Kotlin test asserts the misleading behavior instead of preventing it.

Data flow was followed from manifest/source validation through copied archive members, and from registry/grammar load through real queries, index accounting, outline and diagnostics. Identity and ordinary execution are complete; archive integrity and diagnostic/extraction honesty are partial for the concrete cases above.

## Verification and limits

- Requested scoped Nx test/lint/typecheck attempt (five relevant projects, including the rolled-forward platform-core/reducer surfaces): **infrastructure failure before targets ran**, exit 1. Nx package-json plugin worker exited during startup. The separately attempted scoped rpc-handlers run likewise failed during Nx js-plugin startup. These are not counted as product defects, and no project pass is claimed from either run. No retry of the full suites.
- Direct focused Jest fallback: Kotlin integration + platform-core coverage + description builder: **148 tests passed**, 3 suites, 20.491s. Separate registry suite: **135 tests passed**, 4.936s. These do not substitute for full project lint/test/typecheck.
- Scoped `ptah_get_diagnostics` for the Kotlin module: TypeScript compiler, **0 errors / 0 warnings**.
- Independent observational probes: the initial reused probe run had 9 passes and one obsolete reviewer call to removed private `findExcludedRanges`; it was not a production failure. Its initial Kotlin resolver incorrectly pointed at the npm grammar directory. Corrected only that TEMP fixture and reran the Kotlin probe: 1 passed, 9.649s, with real vendored grammar outputs. No conclusions above use the initial grammar-unavailable results.
- Archive/copy probes used the production functions, real temporary tar/ASAR/VSIX files and byte mutations. Complete archives pass; missing/empty WASM and missing/changed licence fail; corrupted non-empty WASM incorrectly passes. Copy provenance/hash negatives fail before output creation.
- Temporary evidence is under `C:/Users/abdal/AppData/Local/Temp/ptah-review30k-d7d1b622` (`gate-results.json`, `kotlin-results.json`, `same-line.json`, `new-languages.json`, `new-refs.json`, `rust-curly.json`, test and attestation logs). No source/test/task-plan edits or state-changing git commands. Only this review and its required mirror were written in the task folder. No installed packaged-app launch was performed.
