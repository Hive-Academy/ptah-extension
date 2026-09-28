# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 22, Lane H, review r2. Both r1 defects are fixed for their original cases. The new non-source allowlist introduces one Serious honesty defect: executable MDX and CMakeLists.txt are classified as nonSource and can produce a clean answer with zero analyzed files.

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 1 |

The rule implementation, recognition-only distinction, grammar-association test and successful scoped checks support a functioning foundation rather than the 3–4 band. A reproduced source-skipping clean answer keeps it below the sound 7–8 band.

Scope: all seven source/spec/barrel files named in the executor report, read in full; the r1 review and prior plan/context evidence retained from this session; the revision and orchestrator-ruling sections; an actual repository MDX example. The accepted nonSource/unrecognised amendments supersede the original plan where they differ. No source edits or git operations. Task-description.md and code-style-review.md remain absent. Instruction discovery from r1 found no AGENTS.md; supplied project guidance applies. Changed-file scope comes from the executor report, not a git diff.

Paths below are relative to the Lane H worktree. **PC** = `libs/backend/platform-core/src`; **WI** = `libs/backend/workspace-intelligence/src`.

## r1 findings status

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 — .mjs/.cjs/.mts/.cts/.pyi disappear | FIXED for the reported suffixes | WI/ast/language-registry.ts:185 recognizes them and .pyw; :319 checks support per extension; :472 returns unsupported. PC/interfaces/language-coverage.interface.ts:214 rejects unrecognised null and nonzero counts. Census regressions: WI/ast/language-registry.spec.ts:362. Independent probe returned unsupported for all six suffixes. |
| M1 — grammar guard compares only filename sets | FIXED | WI/ast/language-registry.spec.ts:551 runs the actual parser with mocked grammar loading, records setLanguage per language, and :575 compares the keyed map. The swap regression at :583 detects both JS/TS mismatches. Scoped tests passed. The mock tests wiring, not the validity of actual WASM assets. |

The broader promise that skipped source cannot read as clean is still violated by R2-S1 below; this is a new classification path, not a failure to implement the original suffix fix.

## Five logic questions

### 1. How does this fail silently?

The classifier places every .mdx and CMakeLists.txt in nonSource because .mdx and .txt are allowlisted (`WI/ast/language-registry.ts:338`, `:340`, `:475`). That bucket deliberately never qualifies an answer (`PC/interfaces/language-coverage.interface.ts:157`, `:206`). A complete one-file census therefore reports clean with analyzed=0. Independently reproduced for both names.

### 2. What user action produces unexpected behaviour?

A later registry-based census of an MDX application page or CMake build definition can skip its code without qualifying the result. This repository already has an MDX module importing components (`apps/ptah-docs/src/content/docs/index.mdx:20`) and invoking them (`:38`). Renaming a CMake script from helper.cmake to its conventional CMakeLists.txt name changes its classification from unrecognised to nonSource (`WI/ast/language-registry.ts:449`, `:477`). R2-S1 covers both manifestations.

### 3. What input data produces a wrong answer?

MDX and CMakeLists.txt produce the demonstrated wrong classification. Otherwise the requested source-like suffixes .html/.css/.sql/.sh/.ps1/.gradle/.cmake/.proto/.graphql all return unrecognised and cannot be clean when counted (`WI/ast/language-registry.ts:481`; PC interface:214). Unknown extensions and unknown extensionless names also default there.

JSON schemas return nonSource, just like package.json (`WI/ast/language-registry.ts:344`). This is the explicitly accepted data/config policy, not a separate implementation defect. It does mean a clean code-analysis answer is not evidence of JSON-schema validation or of semantic analysis of configuration/embedded expressions. The classifier reads only the name, never content (`:467`). No broader content-level guarantee is established by these lists.

### 4. What happens when a dependency fails?

The new helpers are synchronous and do no I/O. Grammar capabilities remain static declarations (`WI/ast/language-registry.ts:218`, `:244`), not proof that a particular host loaded its WASM successfully. The existing parser's failure path remains Result.err (`WI/ast/tree-sitter-parser.service.ts:141`). Producers must count failures/unknowns; the contract can represent read, parse, grammar-unavailable, too-large and timeout (`PC/interfaces/language-coverage.interface.ts:71`) and rejects failed/unknown qualifier counts (`:212`). This batch does not wire tool consumers or introduce async resources to leak.

### 5. What is missing that the requirements never mentioned?

A safe non-source allowlist needs precedence for conventional executable filenames whose suffix looks like documentation, and must distinguish MDX modules from ordinary Markdown. The current classifier has only language-extension recognition followed by broad non-source matches (`WI/ast/language-registry.ts:469`). The permitted data/config exemption also needs to remain a clearly scoped product policy, rather than a claim that those formats can never encode behaviour.

## Failure modes / new defects

### R2-S1 — Serious: nonSource swallows MDX modules and CMakeLists.txt

- File: `WI/ast/language-registry.ts:338`, `:340`, `:475`.
- Trigger: an in-scope page.mdx containing imports/exports/JSX, or a CMakeLists.txt build program, reaches classifyFileForCoverage for a code capability.
- Symptom: the file returns nonSource. A later complete census with that file alone can report clean despite analyzed=0, unsupported=0 and unrecognised=0.
- Evidence: the independent OS-temp probe transpiled and loaded the actual contract/config/registry, classified both paths, incremented the returned bucket and called the actual isCleanAnswer. Both results were `{classification:"nonSource", clean:true}`. The actual MDX import at `apps/ptah-docs/src/content/docs/index.mdx:20` demonstrates that this is a source-bearing format already in the repository. CMakeLists.txt hits the .txt suffix branch, while a .cmake file reaches the unknown fallback.
- Current handling: nonSource intentionally has no clean-answer check (`PC/interfaces/language-coverage.interface.ts:206`); its list is pinned verbatim by `WI/ast/language-registry.spec.ts:436`. Existing code-like negative cases at :522 omit MDX and CMakeLists.txt, so the suite passes with this gap.
- Impact: later tools using the prescribed classifier can give a bare complete/clean answer after skipping code. Serious for the latent honesty hole, consistent with r1's severity; no present tool-response regression is asserted because production consumers are not wired yet.
- Recommendation / fix: remove .mdx from NON_SOURCE_EXTENSIONS so it defaults to unrecognised until supported. Add explicit code-like filename precedence for CMakeLists.txt before the generic .txt non-source rule (or another conservative classification that preserves ordinary text documents). Add fails-before single-file and mixed-census regressions showing these files remain unrecognised/unsupported and never clean while unprocessed. Retain README.md + package.json + logo.png as a clean non-source census. No grammar implementation is necessary for this fix.

## Blocking issues

None supported by the reviewed evidence.

## Serious issues

R2-S1 above: overly broad nonSource classification (`WI/ast/language-registry.ts:475`).

## Moderate and minor issues

No additional supported findings. JSON/config exemptions are recorded as an accepted policy limit, not counted again as a defect.

## Data flow

1. **OK** — full basename normalization handles slash/backslash paths and case; leading-dot names have no extension (`WI/ast/language-registry.ts:443`, `:449`).
2. **OK** — supported extension → eligible; recognition-only or capability-less language → unsupported (`:469`, `:472`). Recognition no longer grants unsupported suffixes a capability (`:319`).
3. **GAP R2-S1** — generic non-source extension matching can override the actual role of an MDX module or CMakeLists.txt (`:475`).
4. **OK** — every other name → unrecognised (`:481`); no null classification or discarded-file result exists.
5. **OK as contract** — producers distribute eligible files into analyzed/failed/unchecked/omittedByCap and count the other disjoint classes (`PC/interfaces/language-coverage.interface.ts:11`; WI registry:455). This batch's census is a test model, not a production enumerator (`WI/ast/language-registry.spec.ts:294`). A producer using narrow globs must not fabricate unrecognised=0; enumeration honesty still belongs to later batches.
6. **OK** — clean predicate implements the accepted amended rule (`PC/interfaces/language-coverage.interface.ts:206`); it cannot detect a source file mislabeled nonSource.
7. **OK** — overflow helper preserves deterministic four-item priority and omitted count (`PC interface:259`); 965-character fixture includes both new buckets (`WI/ast/language-registry.spec.ts:119`).
8. **OK** — PC introduces no imports; WI imports its contract via the public PC alias (`WI/ast/language-registry.ts:30`). Barrels export the new API (`PC/index.ts:77`; `WI/index.ts:105`). Reference search found no production caller of the classifier/clean helper beyond definitions and barrels. No tool-output-reducers dependency was added.

## Requirements fulfilment

| Requirement | Status | Evidence / limitation |
| --- | --- | --- |
| r1 suffix recognition and per-extension capability distinction | COMPLETE | WI registry:182, :319; six suffixes independently return unsupported. |
| Unknown default and unrecognised null never clean | COMPLETE | WI registry:481; PC interface:214; PC spec:117. |
| Non-source bucket does not qualify; vendor-only excluded semantics retained | COMPLETE | PC interface:157, :162, :219; accepted orchestrator amendment. |
| Safe classification of every in-scope file | PARTIAL | Total classifier exists, but R2-S1 mislabels code as nonSource. |
| Disjoint counts, Count null semantics, per-import resolution | COMPLETE as declaration | PC interface:11, :30, :121. Actual enumeration/aggregation remains future work. |
| Clean-answer five conditions plus unrecognised | COMPLETE | PC interface:206; truth table below. |
| Twelve ids and separate capability families | COMPLETE | PC interface:37; WI registry:54, :111. |
| Grammar association guard | COMPLETE | WI registry.spec:551, :573, :583; scoped test run passed. |
| Saturation, approximation overflow, ≤1,000 measured envelope | COMPLETE | PC interface:109, :259; independently measured fixture 965, pinned at WI registry.spec:152. Not a universal serializer bound on arbitrary invalid counts/arrays. |
| Barrels/boundaries and no tool behaviour change | COMPLETE within reported file scope | PC index:77; WI index:105; imports and production-reference search checked, scoped lint/typecheck passed. |

Implicit requirement not addressed: executable filename/format exceptions must take precedence over generic document suffixes.

## Edge cases and clean-answer truth table

All predicate rows below assume other required conditions are clean. Predicate evidence: `PC/interfaces/language-coverage.interface.ts:206`; classifications: `WI/ast/language-registry.ts:463`.

| Case | Handled / result | Concern |
| --- | --- | --- |
| census complete + all qualifiers zero | YES / clean | Correct baseline. |
| census unknown or truncated | YES / not clean | PC spec:90. |
| unchecked, failed, unsupported, unrecognised, omittedByCap positive or null | YES / not clean | PC spec:94. |
| nonSource positive or null | YES / clean | Accepted ruling, PC spec:121; classification accuracy is essential. |
| analyzed null; excluded zero/null | YES / clean | Original plan allowance, PC spec:68. |
| excluded positive | YES / not clean | PC spec:105. |
| unresolvedInternal/truncatedImports positive or null, edge cap, partial context | YES / not clean | PC spec:126. |
| state updating/incomplete | YES / not clean | PC spec:145. |
| empty/repeated/more than four approximations | YES | Deduplicate, deterministic priority, omitted count; PC spec:150. |
| .mjs/.cjs/.mts/.cts/.pyi/.pyw | YES / unsupported | No accidental parse/index capability. |
| .html/.css/.sql/.sh/.ps1/.gradle/.cmake/.proto/.graphql | YES / unrecognised | Independently probed. |
| Dockerfile, Makefile, unknown extensionless name, .bashrc | YES / unrecognised | Conservative fallback. |
| .gitignore, .env | YES / nonSource | Pinned exact-name exceptions. |
| .env.local | YES / unrecognised | Conservative false positive, not a silent omission. |
| schema.json | nonSource by policy | Clean does not claim schema/config analysis. |
| Windows path or uppercase suffix | YES | Slash/backslash basename normalization and lowercase lookup. |
| page.mdx / CMakeLists.txt | NO / nonSource, clean | R2-S1. |
| Concurrent calls | YES within reviewed helpers | No async operations or shared mutations per call; future census concurrency not established here. |

## Verification

Independent runs, NX_ISOLATE_PLUGINS=false, --skip-nx-cache, each launched once and collected with one completion check:

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence`: PASS, all six tasks, duration 2m34s. Includes both revised spec files. No repeated suite runs.
- `nx run degradation-audit:lint`: PASS, TOTAL 300.
- `nx run ptah-electron:validate-deps`: PASS, including its dependency task.
- `ptah_get_diagnostics` with the two absolute scoped file paths: Unavailable after 45s, compiler still running. No clean tool-diagnostics result claimed; independent Nx typechecks above passed.
- OS-temp Node probe: 30 classification inputs, both R2-S1 clean-answer reproductions, unrecognised null=false, nonSource null=true, actual committed fixture serialization=965. No source modifications.
- Full seven-file review and targeted production-reference search completed. The executor's fails-before reports were read; destructive reverts were not repeated by this read-only reviewer. Actual WASM loading/package validity is outside the mocked association test. No new end-to-end tool coverage is claimed for this foundation batch.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: nonSource lets later tools report a clean answer after skipping executable MDX or CMake build code.
- What a robust implementation would add: conservative MDX classification, executable-filename precedence for CMakeLists.txt, and fails-before non-clean census regressions for both while preserving the accepted documentation/data/asset exemption.
