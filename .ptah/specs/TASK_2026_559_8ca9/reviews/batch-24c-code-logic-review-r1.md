# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 24c, Lane J, single review round. Verdict: **REVISE**, **7/10**.

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Minor issues | 1 |
| Failure modes found | 3 |

The parse-honesty implementation and present capability lists are supported by the inspected code and tests. The remaining issues concern unjustified recurring description overhead, predictable capability-expansion test failures, and misleading host discovery. This separates 7 from the 5–6 band of substantive runtime gaps; unresolved findings and the non-green verification snapshot prevent 8.

Paths below are workspace-relative. Abbreviations:
- B = `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- BS = the adjacent `tool-description.builder.spec.ts`
- SW = the adjacent `mcp-contract.sweep.spec.ts`
- A = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`
- H = the adjacent `system-namespace.builders.ts`
- R = `libs/backend/workspace-intelligence/src/ast/language-registry.ts`

## Five logic questions

### 1. How does this fail silently?

No new swallowed parser failure was found: A:271 throws a failed query result, and A:290 defaults missing quality to unknown rather than clean. Host discovery can nevertheless conceal working desktop operations: H:241 says IDE access is exclusive to VS Code, contradicting its own desktop report documentation at H:253 (finding 3).

Residual pre-existing limitation: A:103 uses parse coverage for a combined analysis; an unsupported export extractor can still yield an empty exports list. B:1691 now explicitly limits exports to publicSymbols languages. This review does not treat that inherited limitation as a newly introduced 24c failure.

### 2. What user action produces unexpected behaviour?

Existing external execute_code scripts using `(await ptah.ast.queryFunctions(file)).map(...)` now fail because A:165 returns an object. The corresponding class/import results change at A:188 and A:211. Current help documents each member at H:395–397; no in-repository caller retaining the old array contract was found. External persisted scripts remain a compatibility risk, not evidence of an unfixed internal consumer.

A desktop caller following H:241 may abandon an available lookup (finding 3).

### 3. What input data produces a wrong answer?

The inspected clean/recovered/unknown paths preserve their honesty fields before file/list data (A:285). No new wrong-answer case in these paths was established. Future supported-language additions change description lengths without changing prose, causing the guards described in finding 2. This is a verification failure, not a claim that an added language is currently advertised incorrectly.

### 4. What happens when a dependency fails?

File stat/read errors propagate through A:377 onward. Parser errors throw at A:123 and A:271; successful results lacking quality become unknown at A:290. The underlying queryMulti frees allocated queries and trees in `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:687`. parse performs two parses of the same already-read content (A:121, A:133); it incurs extra work but does not re-read potentially changed file content.

The diagnostics service itself returned unavailable after its 45-second deadline during this review. The Nx typecheck tasks subsequently passed; that does not convert the unavailable tool response into a successful diagnostics run.

### 5. What is missing that the requirements never mentioned?

Migration/versioning for external saved execute_code scripts, and a budget policy distinguishing fixed prose from registry-controlled growth. H:395 supplies the new shape but no explicit old-to-new migration example. The former is residual compatibility uncertainty; the latter is finding 2.

## Failure modes

### 1. Moderate — R2's claimed minimum is disproved by shorter equivalent descriptions

- Trigger: accepting the enlarged description pins as the minimum needed to preserve the contract.
- Symptom: every tools/list consumer pays unnecessary description overhead; future authors inherit a false lower-bound justification.
- Evidence: SW:2092–2104 claims the old 702/536 limits cannot hold and calls the replacement the tightest honest pin. The current descriptions are at B:1835 and B:1874.
- Current handling: search is pinned at 1,041 for 991 characters; reindex at 854 for 813. These supersede the original report's 939/865 pins.
- Recommendation: shorten the prose and update phrase-specific tests to check semantics. Do not retain a mathematical impossibility claim merely because existing tests pin a verbose sentence.
- Disposition: **fix-now**.

**Meaning of the final measured + 5% pins (re-read after the team-leader update):** SW:2099 and SW:2104 are fixed constants, not values recalculated from the description during the assertion. They therefore remain meaningful forward growth ceilings: search fails this sweep at 1,042 characters and reindex at 855. However, the old 972-character search description now passes 1,041, so this assertion no longer proves the search rewrite or rejects that old text. The separate kind-list and publicSymbols-marker assertions (BS:456, BS:577) supply that semantic regression protection; the updated executor report explicitly acknowledges the old search text no longer fails the size test. This is not a new defect simply because a shorter predecessor passes. Nor does measured + 5% prove that 991/813 are minimal or satisfy R2's old budgets; the counterexamples below address that distinct claim. Repeatedly raising the constants whenever text grows would defeat the guard, so each future increase needs a separately reviewed content/capability justification.

The strict shared builder assertion (BS:400) further limits both descriptions to at most 999 characters. Thus search's sweep pin of 1,041 is currently redundant while that assertion remains: search has only eight additional permissible characters, not fifty. Reindex's 854 pin remains the tighter limit. Keep these two ceilings coordinated rather than presenting the sweep headroom as the effective growth allowance.

Counterexamples, measured with JavaScript string.length, including the late export-kind requirement:

**Search: 696 characters, old limit 702**

> Search SQLite code index (BM25+vector); prefer to Grep. Functions/classes/methods: typescript, javascript, python, go, csharp; exported interfaces/types/enums/variables/namespaces/export-clause names (kind export): typescript, javascript. Exports/file: ptah_get_symbol_index (graph). Hits: path/kind/name/score; index: symbolCount/indexAgeMs/reindexStarted/reindexInFlight. Empty/>24h index: background reindex; stale 0 hits inconclusive. "index unavailable": ptah_search_files/Grep. `coverage` first: `clean`; if clean, only `analyzed`; else up to 3 `reasons`, omitted counts=0, null=unknown. `?`=unknown; `truncated`=census cut; `stale`=last run incomplete; `updating`=writing; 999999=at least.

**Reindex: 523 characters, old limit 536**

> Refresh SQLite code index (ptah_code_search_symbols) after empty/old searches. Omit filePath: background full run, returns {started,symbolCount,indexAgeMs,reindexInFlight}; search when done. filePath: own coverage/stats; unsupported-language outside typescript, javascript, python, go, csharp. No index: error. `coverage` first: `clean`; if clean, only `analyzed`; else up to 3 `reasons`, omitted counts=0, null=unknown. `?`=unknown; `truncated`=census cut; `stale`=last run incomplete; `updating`=writing; 999999=at least.

These retain the SQLite/graph distinction, capability-specific lists, all requested indexed kinds, result/index fields, background refresh behavior, unavailable-index handling, and every coverage-legend concept. The schema continues to identify the search query as a natural-language description (B:1848) and filePath as a single absolute path (B:1885). Existing exact-wording assertions such as BS:413 must be revised alongside equivalent prose; a literal assertion is not itself a product requirement.

### 2. Moderate — Generated-list growth exhausts fixed description guards

- Trigger: granting additional capabilities in grammar/graph batches.
- Symptom: supported functionality breaks otherwise unrelated description tests, inviting repetitive pin increases.
- Evidence: B:1758 generates graph-language prose; SW:2108–2109 retains 722/689 limits. BS:35 and BS:79 enforce a separate strict 1,000-character limit for symbol-index; BS:400 applies it to code search. Search interpolates both codeIndex and publicSymbols at B:1836–1838.
- Current handling: dependents 712/722; dependencies 682/689; symbol-index 983/<1000; search 991/<1000. There is no explicit allowance for generated-list growth.
- Concrete cases: granting Python graphEdges adds eight characters, making dependencies 690 > 689. Adding TSX to both search lists adds ten characters, making search 1,001 and failing the strict <1,000 assertion even though the new sweep pin is 1,041. Symbol-index can absorb one eight-character addition, but not the combined Python/Go/C# additions (+20).
- Recommendation: independently pin the fixed prose and exact capability-derived list, retain a deliberate absolute per-tool/whole-tools-list ceiling, and test planned registry expansions. If sticking to absolute pins, make remeasurement and shortening an explicit activation-batch acceptance criterion and update both guards. Do not make budgets depend on the measured full description itself.
- Disposition: **carry-to-29b**, before the first affected capability activation; graph-only growth must also be checked in the graph batches.

This does **not** mean the next grammar addition necessarily changes graph descriptions. They use graphEdges, not parse: parser-only support leaves those three lists unchanged.

### 3. Minor — Parent IDE help contradicts the newly documented desktop methods

- Trigger: a desktop agent calls `ptah.help('ide')` before choosing a capability.
- Symptom: it is told the whole namespace is exclusive to VS Code and can skip an available desktop lookup.
- Evidence: H:241 versus H:253–261; the actual desktop declaration queries are in `apps/ptah-electron/src/services/electron-ide-capabilities.ts:153`.
- Current handling: the child ide.lsp topic now correctly describes report methods and host mechanisms, but the parent discovery topic still excludes the desktop host.
- Recommendation: describe IDE capabilities as host-dependent; state which operations require VS Code without excluding working desktop LSP fallbacks.
- Disposition: **carry-to-27**. This is inherited text, also acknowledged by the executor, exposed by the 24c help work.

## Blocking issues

None established.

## Serious issues

None established.

## Moderate and minor issues

Findings 1–3 above are the complete numbered finding set. The failed initial budget assertion is not counted separately: its pin changed during the review.

## Data flow

1. **OK — registry to description.** B:39 calls supportedLanguagesFor; R:306 filters by the requested capability. Current mappings are parse/publicSymbols for analysis, enrichSummary for summary and enum, codeIndex for code search/reindex, graphEdges for graph tools, definitionFallback for desktop definitions, graphEdges for the reference-scope description, and syntaxDiagnostics for scoped syntax checks.
2. **OK today — runtime alignment.** Parser configuration supplies TS/JS/Python/Go/C#; enrichment explicitly gates TS/JS at `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:155`; the indexer classifies files by codeIndex at `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:702`. Desktop declaration queries cover TS/JS/Python/Go at electron-ide-capabilities.ts:153. The diagnostics provider checks syntaxDiagnostics at `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts:149`.
3. **Qualified — graph and exports.** Graph and publicSymbols lists are equal today. The symbol-index tool correctly describes the files in the graph; this is not a license to grant export support merely by adding a grammar. Reference-scope tightening remains the assigned 26b work, not a new 24c defect.
4. **OK — AST request to result.** A:377 resolves and reads one file; A:259 runs the requested query and obtains its quality from the same tree; A:285 assembles honesty first; each query then adds file/language/list.
5. **Gap — description to budget guard.** Registry expansion increases measured description size without a coordinated budget policy (finding 2).
6. **Qualified — late 24d integration.** B:1837 explicitly includes interfaces, types, enums, variables, namespaces and export-clause names, so neither a missing-kind finding nor an overclaim defect is warranted under the agreed combined integration. Against the supplied 24d behavior, the split is appropriate: structural rows use codeIndex, export-query rows use publicSymbols, and wildcard exports are not advertised because 24d creates no row for them. This worktree's indexer still constructs function/class/method chunks at code-symbol-indexer.service.ts:1012–1054; the other lane was not independently inspected. **Merge gate: merge 24d first or integrate 24c and 24d together; do not release 24c alone.** The updated executor report also identifies overlapping AST builder/spec/types changes; resolve those conflicts preserving both the new result shapes and export extraction, then run merged Batch 27 symbol-kind and parse-honesty checks. This is a merge-order dependency, not a fourth numbered defect.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Registry-generated per-capability language lists and enrich enum | COMPLETE | Current inspected capabilities align; future capabilities need activation checks |
| Distinguish SQLite and graph export indexes | COMPLETE | B:1839 and B:1977 |
| Name host mechanisms | PARTIAL | Direct descriptions and ide.lsp do; parent ide help contradicts desktop support |
| Four operations expose parse honesty before paths/lists | COMPLETE | A:143,167,190,213; recovered/unknown/clean and real TSX specs |
| Find internal consumers of the old array results | COMPLETE | No affected internal consumer found; external scripts unknown |
| R2 final size justification | PARTIAL | The “cannot fit” claim is false; smaller equivalents supplied |
| Late indexed-kind description | COMPLETE | B:1837; runtime depends on 24d merge |
| R26A-m1 report methods discoverable in ide.lsp | COMPLETE | H:253–263 |
| Scoped test/lint/typecheck pass | PARTIAL | Five tasks passed; test snapshot failed old search pin, subsequently edited |

Implicit requirements not addressed: external saved-script migration; planned registry-growth budgeting.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Recovered TSX parse | YES | Quality marks failed coverage; real-parser spec at ast-namespace.builder.spec.ts:754 | TSX grammar itself remains later work |
| Missing quality metadata | YES | Unknown status, null error count, unchecked coverage at A:290 | None established |
| Empty source | YES | queryMulti returns clean empty map at tree-sitter-parser.service.ts:589 | No tree allocated |
| Parser/grammar/query failure | YES | Result error thrown, resources freed | No cancellation/performance benchmark performed |
| Large file path before lists | YES | Honesty fields precede path at A:143,167,190,213 | Broader execute_code reduction not independently re-probed |
| Language without export capability | YES for queryExports | A:227 rejects it | Combined analyze export coverage remains inherited limitation |
| External script expecting arrays | NO compatibility shim | New objects documented at H:395 | External inventory unavailable; no internal consumer found |
| Registry expansion | NO explicit growth allowance | Existing fixed ceilings | Finding 2 |

## Checks run and evidence limits

- Read the requested batch/common-check/resume sections, Decisions 18–24, the language-plan description/registry contracts, and executor evidence. No task-description.md, standard implementation-plan.md, or code-style-review.md was present in this task folder; the language plan is the applicable design document. No AGENTS.md was discovered in the worktree scan.
- Searched apps/, libs/, .claude/ and remaining repository text (excluding dependency/vendor/task-history noise) for queryFunctions/queryClasses/queryImports. The only production use outside the changed namespace/help/types is `libs/backend/workspace-intelligence/src/quality/rules/architecture-rules.ts:342`, which calls TreeSitterParserService and still correctly consumes its unchanged Result<QueryMatch[]> API (`tree-sitter-parser.service.ts:506`). No root prompts/ directory exists.
- Read the complete AST namespace builder and traced the affected description/help/type/test regions and runtime consumers. This is not an approval of every unrelated line in the large dispatcher, types file or sweep.
- Ran the requested Nx test/lint/typecheck command with PowerShell quoting and output redirected to a temporary log. Header explicitly named **2 projects**: @ptah-extension/vscode-lm-tools and @ptah-extension/workspace-intelligence.
- Result: **5 successful tasks; @ptah-extension/vscode-lm-tools:test failed**. That project reported **75 suites passed / 1 failed; 2,285 tests passed / 1 failed**. Sole failure: search description **991 > 939**. No slow-empty-build flake occurred in this run. Whole run: 4m23s.
- Files changed externally during review: the sweep pin was subsequently raised to **1,041**, reindex pin set to **854**, and the executor report updated. Static measurement confirms those pins now contain the current 991/813 descriptions; the completed test run does not verify the final edited sweep. No second suite was run.
- After the team-leader update, re-read the final description functions, sweep budget table and updated executor report. The author now reports a final successful lm-tools run with **75 suites / 2,285 tests**, after the 24d wording, and separate fail-before evidence for the added kinds/publicSymbols marker. These are author-reported results, distinct from the independent earlier two-project snapshot above. No current failing size assertion is alleged merely from that earlier snapshot.
- The tools/list byte-cap test did not fail. Updated executor report gives **126,367 bytes**, under the unchanged **131,643** cap (SW:2194); that exact byte count is executor evidence, not an independent byte measurement.
- Direct ptah_get_diagnostics with the two changed production paths returned **unavailable: still running after 45s**. Scoped Nx typecheck passed for both projects.
- Description measurements used TypeScript transpilation with a dependency stub containing the inspected registry lists; independent Jest output corroborates the 991-character search measurement. The symbol-index constant values are 30/1000 at symbol-index-query.ts:23–25, giving 983 characters.
- Did not independently rerun CLI/Electron typecheck, validate-deps, degradation audit, or fail-before-base experiments; executor evidence covers them. Did not run git operations because the reviewer-role contract forbids them, so the supplied file inventory/base is not an independently verified diff inventory.
- SHA-256 on the team-leader-requested final re-read: B `F2914DEDD5487AE651A3CA49D6ACAA87C7DB1B5EE9E7DFAED831DD90972370D9`; SW `D2D98076696ED6786F9AA65BE2AAC47D8E5971DCBB84F94FEF465061A675A449`. The earlier B hash was `A6D97316F336C8BF68B1F89CD14FC81387D58DB95E4F25C637A2BA0987FA0ED5`; the reviewed search/reindex text and lengths on the final re-read are the stated 991/813.
- Source and task state were not edited. The role output contract requires this canonical code-logic-review.md; the requested reviews/batch-24c-code-logic-review-r1.md was not written because it conflicts with that higher-priority path restriction.

## Verdict

- Recommendation: **REVISE**
- Confidence: **MEDIUM** — moving working files and no final-snapshot rerun limit verification.
- Top risk: language activations break fixed description guards and encourage unjustified budget growth.
- What a robust implementation would add: shorter equivalent descriptions with semantic tests, explicit expansion guards, corrected parent IDE help, and merged 24d symbol-kind assertions in Batch 27. Verify the rolled-forward fixes in the next lane review, as Decision 24 requires.
