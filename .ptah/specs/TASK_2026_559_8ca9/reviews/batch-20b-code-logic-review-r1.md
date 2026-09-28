# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value                                                   |
| ------------------- | ------------------------------------------------------- |
| Scope               | Batch 20, Task 20.2, r1; benchmark and consumed fixture |
| Overall score       | 3/10                                                    |
| Assessment          | NEEDS_REVISION                                          |
| Blocking issues     | 4                                                       |
| Serious issues      | 4                                                       |
| Moderate issues     | 1                                                       |
| Failure modes found | 9                                                       |

The suite passes while its central size and recall promises are unmet. The implementation uses real services and meaningful positive-path assertions, which separates it from the 1–2 band. Explicitly lowering the required threshold, excluding broken ground truth, and substituting character/word counts for tokens prevent a 5–6 score. No source was edited and no git operations were performed.

Paths below are relative to the worktree. Abbreviations: `bench` = `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts`; `fixture` = the adjacent `fixture-workspace.ts`; `fixture spec` = the adjacent `fixture-workspace.spec.ts`; `AST` = `libs/backend/workspace-intelligence/src/ast/ast-analysis.service.ts`. These aliases are used only for file:line evidence.

Read the complete benchmark, fixture, fixture spec and AST service, plus relevant service/boundary contracts. The task directory has no `task-description.md`, base `implementation-plan.md`, or `code-style-review.md`; context explicitly uses plan-free implementation batches. Read only Batch 20 of batches.md, the requested context decisions, the executor report, and relevant language-plan contracts. `ptah_search_files` returned no AGENTS.md; direct file/Write tools were not listed, so native filesystem reads/writes were used. Scoped Ptah diagnostics were available.

## Contract and measurements

The frozen `PTAH_MCP_SUBSTITUTION_SECTION` says **“Functions/classes/imports/exports with line ranges; 40-60% fewer tokens than Read”** (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:48`). The per-tool description independently says **“WITHOUT reading the full file (40-60% fewer tokens)”** (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1665`). Context Strategy at `.ptah/specs/TASK_2026_559_8ca9/context.md:19` prohibits weakening prompts to match degraded tools; Decision 4 at line 30 freezes shared prompt constants even where per-tool descriptions may change. Task 20.2 expressly requires both tools to save at least 40% (`.ptah/specs/TASK_2026_559_8ca9/batches.md:2757`). Task 20.3 calibration is not an exception to Task 20.2.

Measurements used the checked-out real parser and services, real fixture filesystem, and installed `gpt-tokenizer.encode`, the tokenizer used by the CLI adapter (`libs/backend/platform-cli/src/implementations/cli-token-counter.ts:15`). This is a deterministic BPE measure, not a claim about every model's tokenizer. The source baseline is the exact full file, without artificially inflating it with Read line numbers.

| Tool                                             | Promised margin (source file:line)                                                                       | Measured                                                                                                                                                              | Asserted                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ast_analyze                                      | 40–60% fewer tokens, core prompt:48 and description builder:1665 above; ≥40% on fixture, batches.md:2757 | 10,003→6,347 chars: **36.55%**; 2,184→1,537 tokens: **29.62%**. Namespace result including coverage/file/language: 6,647 chars, 1,614 tokens: **26.10%** token saving | **≥35% characters**, bench:246–261, despite ≥40% title                                                                          |
| context_enrich_file                              | ≥40% fixture, batches.md:2757; API-surface summary, core prompt:49                                       | Content: 3,976 chars / 805 tokens, **63.14%** token saving; complete summary object: 910 tokens, **58.33%** saving                                                    | ≥40% characters plus mocked word-count reduction, bench:294,317–320                                                             |
| get_dependents                                   | Smaller native equivalent AND all dependents, batches.md:2757; reverse edges, core prompt:50             | Only 2/4 intended edges resolve; graph has six unresolved import records                                                                                              | Two filtered edges; **no size assertion**, bench:395–403                                                                        |
| get_symbol_index                                 | Smaller AND every known symbol, batches.md:2757; exported names, core prompt:54                          | Six graph nodes / 51 runtime export records; interfaces excluded                                                                                                      | Character size against files selected by returned nodes; runtime kinds only; missing nodes skipped, bench:411–447               |
| relevance_rank_files                             | Smaller AND native recall, batches.md:2757; ranking with reasons, core prompt:52                         | Three selected candidates exercised; no independent whole-tree size/recall measurement established                                                                    | Projected path/score pairs versus full candidate source; only auth outranks unrelated and first is not unrelated, bench:479–511 |
| project_detect_monorepo / workspace_analyze type | Smaller; every member; never React, batches.md:2757                                                      | Passing scoped suite confirms three app memberships and not-React check                                                                                               | Composition characters versus four manifests; only three app paths, negative-only type check, bench:550,568–587                 |
| count_tokens                                     | Smaller AND accurate result against native equivalent, batches.md:2757                                   | Real BPE source count **2,184**, mock whitespace count **1,187**                                                                                                      | Equals whitespace estimator; tiny fabricated `{tokens: count}` versus source chars, bench:599–611                               |

Two ordinary similarly sized production files were measured, without selecting them for poor reduction:

| File under `libs/backend/workspace-intelligence/src/` | Lines | Source / AST chars | Source / AST tokens | Token saving |
| ----------------------------------------------------- | ----: | -----------------: | ------------------: | -----------: |
| context-analysis/context-enrichment.service.ts        |   278 |     11,400 / 2,131 |         2,567 / 515 |       79.94% |
| file-indexing/pattern-matcher.service.ts              |   321 |      9,333 / 1,464 |         2,280 / 391 |       82.85% |

A third scanned file, `diagnostics/ts-diagnostics-worker-source.ts` (290 lines), returned 241 chars / 62 tokens from 12,283 chars / 2,918 tokens, but carried a recovered parse. Its apparent 97.88% saving is **not evidence of preserved recall**. Good savings on the two normal files do not excuse the mandated fixture failure.

## Five logic questions

### 1. How does this fail silently?

A 35–39.99% character saving is presented as a passing ≥40% contract (bench:234,261). Broken fixture edges are removed from expected recall (bench:395). Token cost is replaced by characters or whitespace words (bench:246,294). These produce misleading green regression results: findings 1–4.

### 2. What user action produces unexpected behaviour?

A maintainer breaks production extension inference, drops a graph node, removes the token-file ranking, or omits rootType; this benchmark can still pass (bench:178,308,438,502,550). Findings 5–6 explain the missing checks.

### 3. What input data produces a wrong answer?

The default 300-line fixture already violates AST size; two relative imports resolve below `apps/libs`, not root `libs` (fixture:88,593). Exported interfaces are real known symbols but are filtered away (bench:427–429). Findings 2–4 and 6.

### 4. What happens when a dependency fails?

AST query failure returns Result.err (AST:97–105); the benchmark's isOk/unwrap checks reject that failure (bench:243,273). A successful-file enrichment fallback fails the required structural mode check (bench:316). WASM shims still use real Language.load (bench:47–58), which is appropriate. However, no failure case pins coverage when parsing/resolution becomes partial: accepting whatever context is returned can miss dishonest success metadata (bench:377–380), finding 8. Token-counter mocks test delegation, not backend accuracy, finding 4.

### 5. What is missing that the requirements never mentioned?

The harness needs an independent expected file/symbol census, the full representation actually being sized, and an aggregate runtime bound rather than per-test timeouts (bench:411,438,508,210). Long temp paths affect path-bearing size comparisons. Broader polyglot activation is explicitly assigned to Batch 27 in the language plan; this review does not demand all later language implementations now, but existing partial-state honesty still needs deterministic cases.

## Failure modes / numbered defects

### 1. Blocking — the mandatory margin is deliberately lowered

- File: bench:246–261; contract: batches.md:2757 and core prompt:48 above.
- Trigger → symptom: AST saves between 35% and 40% in characters → the test titled “>= 40%” passes. Present result is 36.55%.
- Current handling: compares against 0.35, not 0.365 and not 0.40. The executor report acknowledges ≥35%; the task's shorthand “pinning 36.5%” describes the measurement, not the assertion.
- Impact: the central regression guard certifies a known broken promise.
- Recommendation: assert ≥0.40 using real tokens, preserve independent recall checks, and repair product output until that assertion passes. Do not copy Task 20.3's measured-baseline policy into this requirement.

### 2. Blocking — AST product output itself misses the promised token reduction

- File: AST:127–135,269–274,427–433; `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts:93`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1999`.
- Trigger → symptom: the required 300-line, function-heavy file → raw service output saves 29.62% tokens; actual namespace JSON saves 26.10%.
- Evidence: 42 function records occupy 3,872 chars; 40 export records occupy 2,049; imports 245; classes 67. Repeated `name`, `parameters`, `startLine`, `endLine` keys and names repeated in exports dominate. The query path does **not** emit per-function async/export flags (AST:269); removing purported flags cannot solve it. The author's “44 helpers” explanation is inaccurate: there are 42 total extracted function records, including methods.
- Current handling: namespace forwards object arrays; dispatcher stringifies. Existing generic compaction does not rescue this answer: defaults are 2,000 tokens / 8,000 chars (`tool-result-budget.ts:48`), and below-budget output is unchanged (`tool-result-budget.ts:233`). The measured namespace result is below both.
- Impact: callers follow the frozen prompt and spend materially more tokens than promised.
- Smallest demonstrated fix: compact the **presentation** of repetitive records, preserving internal CodeInsights consumers. A header plus function rows `[name, parameters, startLine, endLine]` retained every current function field and reduced the service result to **1,173 tokens (46.29% saving)**. Tabulating functions **and exports** in the namespace-equivalent representation retained current fields, all rows, imports, parse metadata and coverage and produced **1,138 tokens / 4,421 chars (47.89% token saving)** including its envelope.
- Recommendation: add/use a lossless AST output formatter at the stringification boundary (`protocol-dispatcher.ts:2005`), with shared production formatting accessible to the benchmark. Use column unions and an explicit absent-value representation for optional fields; retain defaults/re-exports/source when present. Round-trip/equivalence assertions must prove every field survives. This is a measured proposal, not an implemented fix. Do not change the internal service array API merely to lower a benchmark number; size the shared public representation and pin full-boundary recall too.

### 3. Blocking — invalid fixture ground truth is excluded instead of repaired

- File: fixture:88,593,626,651; fixture spec:155–167; bench:395–403.
- Trigger → symptom: two imports use `../../libs/...` from `apps/<app>/src` → both resolve toward nonexistent `apps/libs/...`; their knownEdges claim root `libs/...`. The bench removes them by filename and passes with 2/4 recall.
- Current handling: fixture spec checks both endpoint files and a target basename occur, not whether the source specifier resolves to that endpoint. Disk probe confirmed exactly those two edges fail.
- Impact: a guard advertised as complete dependent recall cannot catch loss of either cross-project edge.
- Recommendation: use `../../../libs/shared-core/src/auth-session` in both generated sources; require every knownEdge to resolve independently on disk to its exact normalized toPath, with nonempty importedSymbols and matching declarations. Pin the expected edge count and exercise **all four** edges without filename filtering. Re-measure size after repair.

### 4. Blocking — token assertions use incompatible units

- File: bench:246–248,294,317–320,599–611; `libs/backend/platform-core/src/testing/mocks/token-counter.mock.ts:25–27`.
- Trigger → symptom: JSON/source have different token densities → passing character reduction or whitespace count is treated as token reduction. Here characters report 36.55% while BPE reports 29.62%; enrichment's mock reports 74% versus real 63% content savings.
- Current handling: AST never invokes a tokenizer; enrichment trusts metrics produced through a word-count mock and adds a character check. count_tokens only proves delegation to the same whitespace algorithm used for the expected value.
- Impact: the harness cannot establish its stated token-cost guarantee. The count-token test is meaningful as a delegation check, but not as token accuracy evidence.
- Recommendation: use installed gpt-tokenizer consistently for source and output; a platform boundary implementation that delegates to real encode is permitted. Pin known token counts for count_tokens and compare the complete intended returned representation. Keep character limits as additional checks, never substitutes.

### 5. Serious — the “no language given” regression proof exercises a test-local implementation

- File: bench:178–186,308–314; production `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:119,164`.
- Trigger → symptom: production resolveEnrichLanguage regresses while EXTENSION_LANGUAGE_MAP remains intact → this test independently derives TypeScript and explicitly supplies it; it stays green.
- Current handling: the reported deliberate break changed inferEnrichLanguage **in this test**, not production inference. It proves sensitivity to its own helper only.
- Impact: the promised Batch 7 regression remains unguarded by this benchmark.
- Recommendation: exercise the real namespace with language omitted in the owning vscode-lm-tools project, or extract a shared production inference seam and call it from both. Keep cross-library boundaries valid. Demonstrate failure by mutating the actual production inference in a controlled author verification, not the test helper.

### 6. Serious — recall assertions can shrink with the implementation or miss required results

- File: bench:196,274–283,332–335,427–447,499–504,550,568–573; fixture:92–130,445,512.
- Trigger → symptom: drop a graph node → line 438 skips its expected symbols; remove token-utils from ranked results → auth can remain first and outrank unrelated, so lines 502–503 still pass; omit rootType → undefined is “not React.” Exported interfaces are excluded up front, despite being fixture knownSymbols.
- Current handling: expected symbol scope is reduced to runtime kinds and actual returned nodes. AST name unions let an export record hide a missing function record/line range; substring summary checks can match a reference instead of a declaration. Native ranking hits are never each required in rankedFiles. Only apps are checked although shared-core is a declared project.
- Impact: visible tool regressions and known-symbol loss may ship with green recall tests. The interface exclusion is a contract gap, not justified by the implementation currently omitting it: ExportInfo.kind even includes interface/type (`ast-analysis.interfaces.ts:90`), and core prompt:54 promises exported symbol names without a runtime-only qualifier.
- Recommendation: build independent fixed expected sets and pin their cardinalities; assert all expected files exist before symbol loops; compare exact per-file declarations/kinds/ranges and import targets, not a union of arbitrary name occurrences. Require every native hit in ranking and both relevant files above the unrelated file. Assert a valid expected root enum and all four declared projects. Either implement all promised known symbols or explicitly record a product gap; do not filter it into success.

### 7. Serious — per-tool size coverage is missing or uses an inflated native baseline

- File: bench:384–405,411–420,479–511,595–611.
- Trigger → symptom: dependent payload grows without limit → no size check notices; ranking becomes larger than a native keyword grep while smaller than three full files → the test still passes.
- Current handling: dependent recall has no SIZE half. Ranking synthesizes a path/score array and compares to full sources, although the native equivalent is keyword grep and the public promise includes reasons. Symbol baseline is selected from the service's returned graph nodes instead of the fixed input set. No tree-wide grep baseline is constructed.
- Impact: “per mandated tool — size AND recall” is not implemented for all tools; output and baseline can diverge from what a caller receives/needs.
- Recommendation: define deterministic native grep output (paths, line numbers and matching declarations/imports, with a fixed serialization) and compare the real intended public projection against it. Use source reads for AST/enrichment, where reading the whole file is the genuine alternative. Freeze baseline inputs independently of returned results. Add dependent SIZE with recall together so an empty result cannot win.

### 8. Serious — coverage expectations are chosen from the answer under test

- File: bench:368–381; `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts:667–671`; existing concrete partial case in adjacent service spec:889–907.
- Trigger → symptom: resolver starts reporting complete for an unresolved bare alias → the benchmark takes its else branch and approves complete, without requiring a partial scenario.
- Current handling: only census and context label are pinned; no analyzed/failed/unsupported/unresolved counts or cap state. The six-file fixture actually yields context=complete, analyzed=6, unresolvedInternal=6, external=0. Complete here means resolver context is known, **not** that all imports resolved. It would be incorrect to demand partial solely because these relative paths are broken.
- Impact: the Batch 22–24a honesty guard does not reject a fabricated clean result and does not exercise resolver-context-partial before Batch 32b.
- Recommendation: separately pin the corrected relative-only fixture's exact expected counts, and add a real unresolved bare/workspace-alias case whose expected context is unconditionally partial and approximations contains resolver-context-partial. Add unsupported and recovered-parse cases with explicit counters/state. Do not derive the expectation from returned context. Full polyglot support remains the later Batch 27 activation work, not a reason to omit current honesty cases.

### 9. Moderate — 30 seconds is per test, not the benchmark budget

- File: bench:210; repeated graph builds at bench:369,385,408.
- Trigger → symptom: each of 11 tests or hooks remains below 30 seconds but the aggregate exceeds 30 seconds → Jest still succeeds.
- Current handling: jest.setTimeout controls each test/hook. Author reports 4–9 seconds warm and three successful library runs, which is useful present-tense evidence, not an aggregate regression guard.
- Impact: future regressions can exceed the normal-test-target budget unnoticed. No flake was observed in this review.
- Recommendation: measure aggregate benchmark duration in a suitable controlled runner/CI check (account for load), or share expensive setup and pin an explicit total budget. Keep per-test timeout for hangs as a separate mechanism.

## Blocking issues

Findings **1–4** above: weakened assertion, product output failure, invalid/excluded fixture edges, and non-token measurement. Each has a concrete current failing contract and repair recommendation.

## Serious issues

Findings **5–8** above: duplicated inference, incomplete recall oracles, absent/unfair size checks, and self-selecting coverage expectations.

## Moderate and minor issues

Finding **9**: aggregate runtime is not bounded. No standalone style or naming findings are included.

## Data flow

1. Fixture generation → real mkdtemp workspace and deterministic source content: positive-path generation works; two import specifiers invalidate intended ground truth (fixture:88,593).
2. Native baseline → source text/regex names: full-file baseline is fair for structure; name regex excludes interfaces and no tree grep is built (bench:196,492).
3. Parser → AST service: real WASM and real analysis; Result errors propagate; payload repetition misses token target (AST:97,269).
4. Enrichment → token counter: real summary, but supplied language bypasses production inference and mock words replace tokens (bench:294,308).
5. Graph → coverage and reverse edges: real graph over six files; expected broken edges filtered and coverage expectation follows implementation (bench:354,377,395).
6. Graph/ranking/detectors → recall checks: returned-node skip, missing per-hit ranking assertions, and negative-only project type permit false greens (bench:438,502,550).
7. Output serialization → size assertion: raw CodeInsights or test-made projections; not uniformly the public shape or native grep equivalent (bench:246,415,508).
8. Jest completion → CI green: scoped suite passes despite the failures above; timeout is per case (bench:210).

## Requirements fulfilment

| Requirement                           | Status             | Gap                                                                                                    |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| AST ≥40% reduction on 300-line source | MISSING            | Both product and asserted margin fail; wrong units                                                     |
| Enrichment ≥40% reduction             | PARTIAL            | Real measurement passes, committed check uses mock words/chars                                         |
| No-language enrichment path           | MISSING            | Test supplies locally inferred language                                                                |
| Every known dependent/edge            | MISSING            | 2/4 filtered out; invalid fixture oracle                                                               |
| Every known symbol                    | PARTIAL            | Runtime-only filter; missing-node skip; declaration/range loss unchecked                               |
| Ranking recall                        | PARTIAL            | Neither every hit nor both relevant rankings enforced                                                  |
| Every mandated tool has SIZE          | MISSING            | Dependents absent; grep baselines not established                                                      |
| Nx root not React                     | PARTIAL            | Negative assertion passes missing type; real composition exercised                                     |
| Real services / platform-only mocks   | PARTIAL            | Real services/fs/WASM; local inference duplicates product; counter mock unsuitable for token guarantee |
| Honest existing partial states        | PARTIAL            | No forced partial case or exact failure counters                                                       |
| Fails on regression                   | PARTIAL            | Some positive assertions meaningful; documented proof misses production inference                      |
| <30s normal test target               | PARTIAL            | Author timing meets it; aggregate bound absent                                                         |
| Polyglot harness                      | PARTIAL / deferred | Language plan schedules activation in Batch 27; not claimed complete here                              |

Implicit requirements not addressed: stable independent expected sets, complete output representation for measurement, and platform path-length effects on size ratios.

## Edge cases

| Case                            | Handled                                | How                                                        | Concern                                                          |
| ------------------------------- | -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Broken relative imports         | NO                                     | Removed from expected edges                                | Finding 3                                                        |
| Dropped graph file              | NO                                     | Expected symbols skipped if node absent                    | Finding 6                                                        |
| Missing relevant rank result    | NO                                     | Only auth-vs-unrelated score required                      | Finding 6                                                        |
| Missing root type               | NO                                     | not-React accepts undefined                                | Finding 6                                                        |
| Token-dense output              | NO                                     | Characters/whitespace used                                 | Finding 4                                                        |
| Dependency/query failure        | YES for successful fixture expectation | AST isOk/unwrap, enrichment structural mode reject failure | No explicit failure-state honesty case                           |
| Bare alias / unsupported source | NO in benchmark                        | Conditional coverage assertion only                        | Finding 8; existing service unit tests are stronger              |
| Empty expected set              | PARTIAL                                | Some length checks; symbolsByFile loop unguarded           | Finding 6                                                        |
| Repeated execution              | YES, observed/reported                 | Temporary fixtures and parser disposal, bench:225–227      | Cleanup errors swallowed in fixture:714–719; no failure observed |
| Aggregate slowdown              | NO                                     | 30s per test                                               | Finding 9                                                        |

## Verification

- `ptah_get_diagnostics` scoped to benchmark: TypeScript compiler source, **0 errors, 0 warnings**.
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence --skip-nx-cache`: **PASS**, all three targets, **2m9s** total library verification. This is not the benchmark-only runtime.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: **PASS**, **TOTAL 300**, 14.1s.
- Independent native Node probe loaded checked-out TypeScript via transpilation, real tree-sitter/WASM, fixture generator and services. Logging/DI plumbing was stubbed; filesystem reads, extraction and tokenizer were real. The namespace probe used real buildAstNamespace with filesystem stat/read adapters. It reproduced 6,347-character AST, both invalid edge paths, BPE counts, summary counts and graph coverage listed above. One initial namespace probe lacked stat; after supplying the real fs-backed stat adapter it completed successfully.
- In-memory table-format experiment changed no production files. It demonstrates feasible lossless compaction of the currently returned fields; it does not establish new extraction correctness or replace required production tests.
- Author's reported benchmark timings and repeated runs were read, not independently repeated three times. No skipped benchmark cases were found; most weak presence checks accompany substantive assertions. The exceptions that can hide regressions are identified above. No mutation of reviewed source was used to manufacture a failure.

## Verdict

- Recommendation: REVISE
- Assessment: NEEDS_REVISION
- Confidence: HIGH
- Top risk: CI certifies a token-saving and complete-recall contract that the implementation and its own fixture demonstrably violate.
- What a robust implementation would add: ≥40% BPE assertions over a shared real output formatter; repaired and independently resolved fixture edges; exact unfiltered recall oracles; real no-language boundary coverage; fair native grep baselines for every applicable tool; unconditional partial-state cases; an aggregate runtime check.
