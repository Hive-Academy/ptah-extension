# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 22, r1, Lane H. Review scope: the seven files named in the executor report, read in full, plus the named plan/context/batch sections and the parser initialization path. Source was not edited; no git operations were run. No existing task-local code-style-review.md or task-description.md was found. `ptah_search_files` returned no AGENTS.md; local scoped instruction-file searches also found none. Project guidance supplied in the request applies.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 |

The five-condition clean-answer rule is implemented faithfully, but recognition drops common source extensions before those conditions can protect the caller. This separates the score from the sound 7–8 band. The implemented contract, separated capabilities and scoped regression evidence distinguish it from the 3–4 band: the core is usable, with a specific honesty gap and an incomplete drift guard.

Paths below are relative to this worktree. Abbreviations: **PC** = `libs/backend/platform-core/src`; **WI** = `libs/backend/workspace-intelligence/src`.

## Five logic questions

### 1. How does this fail silently?

A recognized-extension census can omit `.mjs/.cjs/.mts/.cts/.pyi` entirely: `WI/ast/language-registry.ts:198` derives only parser-supported extensions, and `:275` returns null for every other extension. The contract counts recognized unsupported source files (`PC/interfaces/language-coverage.interface.ts:140`), leaving these files outside that category. Zero qualifier counts with a complete census pass `isCleanAnswer` (`:185`). Defect 1 is a downstream honesty hole, not a claim that this batch already changes a tool response.

### 2. What user action produces unexpected behaviour?

Pointing a future registry-based census at a JavaScript repository using `.mjs` can yield the same empty eligible set as a repository with no source files (`WI/ast/language-registry.ts:232`, `:272`). Existing `.js` files are recognized; equivalent module extensions are not. The temporary probe reproduced null lookups and a clean result for the corresponding zero-file census.

### 3. What input data produces a wrong answer?

The five missing suffixes above do. The requested remaining suffixes are recognized: `.kts` → kotlin; `.hpp/.cc/.h` → cpp; `.rb` → ruby; `.php` → php; `.java` → java; `.rs` → rust (`WI/ast/language-registry.ts:159`); `.go` → go and `.cs` → csharp (`WI/ast/tree-sitter.config.ts:12`). Uppercase suffixes are normalized (`WI/ast/language-registry.ts:275`). Unknown/truncated census and null qualifier counts are rejected correctly (`PC/interfaces/language-coverage.interface.ts:186`, `:190`).

### 4. What happens when a dependency fails?

The registry is static metadata, not a runtime health result: parse is true when a grammar is declared (`WI/ast/language-registry.ts:194`, `:218`). The existing parser reports initialization errors through `Result.err` (`WI/ast/tree-sitter-parser.service.ts:141`); this batch does not translate them into coverage. Later callers must count grammar/read/parse failures or unknown coverage, using the vocabulary at `PC/interfaces/language-coverage.interface.ts:69`. A recorded failure is not clean (`:191`). No new async resource, timeout or cancellation path is introduced in the reviewed files. Grammar association drift is insufficiently guarded (Defect 2).

### 5. What is missing that the requirements never mentioned?

Recognition needs a policy distinct from parser availability for source suffixes in otherwise supported languages. The current `LanguageId` capability model is language-wide, so simply adding aliases to recognition must not claim their parsing/indexing succeeds when those consumers still reject the suffix. Add explicit recognized-only classification/accounting or extend support atomically and test it. Evidence: `WI/ast/language-registry.ts:54`, `:198`, `:272`. The plan's recognized-unsupported accounting (`implementation-plan-languages.md:318`) does not settle this distinction.

## Failure modes / numbered defects

### 1. Serious — Common source extensions disappear before coverage accounting

- File: `WI/ast/language-registry.ts:198` and `:272`; underlying extension list `WI/ast/tree-sitter.config.ts:4`.
- Trigger: a later discovery/counting batch uses this registry as the source of recognized extensions and encounters `.mjs`, `.cjs`, `.mts`, `.cts`, or `.pyi` files.
- Symptom: these files are indistinguishable from non-source files; they do not enter unsupported, unchecked, failed or omitted buckets. A repository consisting of them can receive a bare clean answer.
- Evidence: the OS-temp probe loaded the actual modules using TypeScript transpilation and returned null for all five suffixes. A hypothetical recognized-only census of `.mjs/.cjs` files yielded analyzed=0 and all qualifiers=0; the actual `isCleanAnswer` returned true. This models the later caller, which is not implemented in Batch 22. The executor report independently acknowledges four of these missing extensions.
- Current handling: none; the lookup returns null (`:275`). No production consumer of the new lookup exists yet, as the `libs` reference search confirmed.
- Impact: future callers following the registry can mistake skipped source files for successful complete analysis, contrary to Decision 18 (`context.md:57`). Serious per the requested review rubric for this latent honesty hole; no present tool-response regression is asserted.
- Recommendation / fix: distinguish recognized source extensions from supported analysis extensions before 23b/24b depend on the registry. Preserve unsupported/unchecked accounting or mark census unknown when support cannot be established. Do not merely return a supported language id and count the files as analyzed. Add regression cases for all five suffixes, including a module-only repository that must not be clean while its files are unprocessed.

### 2. Moderate — Grammar drift guard loses the language-to-file association

- File: `WI/ast/language-registry.spec.ts:233`, especially `:238` and `:242`.
- Trigger: a later edit swaps two grammar filenames between language keys while preserving the set of filenames.
- Symptom: the advertised grammar mapping can disagree with what the parser loads for each language, while the purported equality guard passes.
- Evidence: the guard sorts extracted filenames and compares them only with `Object.values(GRAMMAR_FILE_MAP)`. A temporary in-memory swap of javascript/typescript values still passed this exact comparison. The parser actually associates loaded grammar objects with language keys at `WI/ast/tree-sitter-parser.service.ts:130`. No source mutation was made.
- Current handling: catches added/removed/renamed literal filenames, but not reassignment. Registry derivation checks at `WI/ast/language-registry.spec.ts:184` compare against the same map and cannot close this gap.
- Impact: the temporary duplicated mapping can drift undetected until 29a2, when the wrong grammar may be selected if the map becomes authoritative. The mappings currently agree; this finding concerns the specifically promised guard.
- Recommendation / fix: compare the full language→grammar association, preferably by observing parser registration with mocked grammar loading. Include an in-memory swap negative case. Alternatively use a shared mapping at the load site if scope is explicitly expanded.

## Blocking issues

None supported by the reviewed evidence.

## Serious issues

Defect 1: source recognition loses files before coverage can disclose them (`WI/ast/language-registry.ts:275`).

## Moderate and minor issues

Defect 2: filename-set equality is not language-association equality (`WI/ast/language-registry.spec.ts:242`). No separate style/naming findings.

## Data flow

1. **OK** — closed ids and counts originate in PC (`interfaces/language-coverage.interface.ts:35`, `:107`, `:127`); no imports or reverse dependency are added there.
2. **OK, limited guard** — config supplies parsed extensions/grammar/query availability (`WI/ast/tree-sitter.config.ts:4`, `:24`); the parser still owns a second grammar mapping (`tree-sitter-parser.service.ts:113`). Defect 2 applies.
3. **OK** — registry builds twelve entries; codeIndex, publicSymbols, graphEdges, diagnostics and outline are separate (`WI/ast/language-registry.ts:54`, `:106`, `:204`). Grammar-less languages receive no capabilities (`:183`).
4. **GAP** — lookup construction and fallback omit five source suffixes (`WI/ast/language-registry.ts:232`, `:275`). Defect 1 applies before any bucket is incremented.
5. **OK** — clean-answer helper rejects all five specified qualifier classes (`PC/interfaces/language-coverage.interface.ts:185`). It cannot detect files never counted.
6. **OK** — approximation deduplication, deterministic priority ordering, four-item cap and omitted count are centralized (`PC/interfaces/language-coverage.interface.ts:213`, `:237`). Repeated inputs do not inflate omitted counts.
7. **OK** — PC exports types/constants/helpers (`PC/index.ts:77`); WI exports the registry through its public barrel (`WI/index.ts:105`). New cross-lib imports use the PC alias (`WI/ast/language-registry.ts:30`). No tool-output-reducers dependency is added. Search found only definitions, tests and barrel exports for new consumer-facing symbols, so no existing tool behaviour is wired to them in this batch.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Disjoint buckets, unknown=null, unchecked, per-import resolution | COMPLETE | Contract semantics documented at PC interface:10; fields at :119 and :127. Producers must enforce disjointness. |
| Saturation constant 9,999,999 | COMPLETE | PC interface:107; aggregation/saturation belongs to later producers. |
| Five-condition clean rule, freshness and unknown/truncated rejection | COMPLETE | PC interface:185; negative cases in interface.spec.ts:88, :92, :104, :123. |
| Approximation priority, at most four, disclosed overflow | COMPLETE | PC interface:84 and :237; spec:139 and :159. |
| Committed measured envelope ≤1,000, pinned 922 | COMPLETE | WI registry.spec.ts:76, :107, :110. A measured bounded fixture, not a universal runtime serializer guarantee. |
| Twelve language ids and independent capability model | COMPLETE | PC interface:35; WI registry.ts:54, :106, :226. |
| Source coverage without silent omissions | PARTIAL | Defect 1; five common source suffixes disappear. |
| Derived registry; parser drift protection | PARTIAL | Derivation exists at WI registry.ts:198 and :204; association guard incomplete (Defect 2). |
| Recognized unsupported languages and C/header mapping | COMPLETE | WI registry.ts:159 and :169. |
| Module boundaries and barrels | COMPLETE | PC has no new dependency; WI imports PC through alias. PC project.json:6 remains shared/util; reducer tags unchanged in the reviewed design. |
| No tool behaviour change | COMPLETE within reviewed scope | New symbols have no production callers; config adds only grammar metadata. No git diff was obtained because git operations were prohibited. |
| Ten honesty tools | COMPLETE for Batch 22 foundation only | Tool wiring intentionally deferred in plan inventory:113 and honesty matrix:488; not claimed delivered here. |

Implicit requirement not addressed: recognition and actual support must remain distinguishable for suffix variants of the same language.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty approximation input | YES | Returns {} (PC interface:241) | None found. |
| Repeated or reordered approximations | YES | Set + deterministic rank/order (:240) | None found for typed inputs. |
| More than four approximations | YES | Slice + omitted count (:244) | Per-language detail may be omitted, as planned. |
| Null unknown qualifier count | YES | Strict zero checks (:190) | analyzed/excluded null explicitly allowed by plan. |
| Updating/incomplete index | YES | State gate (:210) | Producer must report actual state. |
| Import cap, missing internal resolution, partial context | YES | Resolution gate (:200) | External count is not a clean-answer condition by design. |
| Unsupported known language | YES | No capabilities plus recognized suffix (WI registry:183) | Caller accounting is deferred. |
| Module-only / stub-only repository | NO | Five suffixes return null (WI registry:275) | Defect 1. |
| Wrong grammar assignment with unchanged filenames | NO | Set equality still passes (WI registry.spec:242) | Defect 2. |
| Concurrent/repeated calls | YES within these pure helpers | Only local arrays allocated; no async writes (PC interface:237) | Future census/index atomicity remains untested here. |

## Verification

- Independent temporary probe: all 15 requested extension classes checked; the five omissions and ten mapped suffixes are recorded above. Hypothetical recognized-only census returned clean=true. Current grammar-set guard passed both the real map and a swapped TS/JS map. Probe stored under the OS temp directory; no source changed.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: independently passed, including its dependency task.
- `nx run degradation-audit:lint --skip-nx-cache`: independently passed; TOTAL 300.
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache`: started with NX_ISOLATE_PLUGINS=false; still running without tail output at the one completion check permitted by the request (session 59798). This review does **not** claim an independent pass. Executor report records all six tasks passing; its evidence is prior evidence, not this run's result.
- `ptah_get_diagnostics`: returned Unavailable after 45 seconds, compiler still running; no clean diagnostics claim. No retry loop used.
- Scope limitation: full changed-file inventory/base diff was taken from the executor report rather than independently checked with git, which this role prohibits. No fresh CLI/Electron typecheck was run beyond requested verification; executor reports those passed.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: later coverage producers can label a repository clean after silently omitting common source extensions.
- What a robust implementation would add: recognition-versus-support accounting for module/stub extensions; a module-only non-clean regression; a language-keyed parser grammar guard; completion evidence for the scoped verification run before acceptance.
