# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value                                   |
| ------------------- | --------------------------------------- |
| Review              | r3, Batch 20.2 revision round 2 / 20.2p |
| Overall score       | 4/10                                    |
| Assessment          | NEEDS_REVISION                          |
| Blocking issues     | 2                                       |
| Serious issues      | 2                                       |
| Moderate issues     | 0                                       |
| Failure modes found | 4                                       |

The orchestrator's position is supported: known export loss is a product defect, and two `it.todo` declarations cannot satisfy an executable recall guard. The product gap extends beyond interfaces/types to enums, default exports, aliases and wildcard re-exports. The formatter does not cause these losses; it faithfully serializes an already-incomplete result.

The helper census and enrichment interface assertions are repaired. The new SIZE checks use tokens and grep lines, but still contain altered/approximate output and an uneven path baseline. A new ranking gap separates recall from the production answer being sized. Passing verification therefore does not establish the requested contract. The explicit Batch 24r dependency marker is acceptable temporarily under the caller's pre-commit merge condition; it is not an implemented test or evidence of preservation.

Score rationale: real services, repaired edges, helper census, tokenizer, formatter and coverage cases distinguish this from a foundational 1–2 score. Silent product omissions and knowingly non-executing guards leave significant problems, below the 5–6 band despite the improvements. No reviewed source edits or git operations were performed.

### Evidence aliases

All paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`:

- `bench`: `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts`
- `fixture` / `fixture spec`: adjacent `fixture-workspace.ts` / `fixture-workspace.spec.ts`
- `query`: `libs/backend/workspace-intelligence/src/ast/tree-sitter.config.ts`
- `analysis`: adjacent `ast-analysis.service.ts`
- `graph`: adjacent `dependency-graph.service.ts`
- `dispatcher`: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- `AST builder`: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`

Review continues the fully read r1/r2 source, with current changed benchmark/fixture sections, export extraction, query consumers and response renderers traced. Task 20.2 still requires SIZE and every known/native-grep symbol, edge and dependent, and failure on regression (`.ptah/specs/TASK_2026_559_8ca9/batches.md:2757`). Context Strategy still treats prompts as the contract (`context.md:19`). No instruction waives export recall.

## r2 findings status

| Finding                                       | Status                                       | Evidence                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-01: helpers/interfaces omitted from recall | PARTIAL; product and harness blockers remain | fixture:242–246 now records all 35 helpers. fixture spec:231–252 independently checks its tracked-file export census. bench:396–413 now checks all known function names/start lines; bench:511–517 restores enrichment interface declarations. AST and symbol-index interfaces are still absent, represented only by todo at bench:424 and 730. |
| R2-02: char baselines/projections             | PARTIAL                                      | Dependent/index/ranking checks now tokenize grep-line baselines, but dependents rewrite shipped absolute paths, symbol index uses a different envelope/count meaning, and ranking grep paths remain absolute while answer paths are relative. R3-S1.                                                                                            |
| R2-03: above-budget metadata / Batch 24r      | ACCEPTED TEMPORARY DEPENDENCY, NOT CLOSED    | bench:438 records the requirement. Caller explicitly says approved Lane H work lands before this batch is committed. This marker is acceptable pending that merge, but a real through-budget test must be implemented and pass before claiming final closure.                                                                                   |

Previously closed size-margin, shared inference, fixture-edge and aggregate-time fixes remain present. No new formatter corruption was found or alleged; r2's lossless serialization/real-file token measurements remain relevant because these product files were not changed by this round.

## Export-kind gap measurements

Probes used the actual checked-out TreeSitterParserService and AstAnalysisService with the real TypeScript grammar. Every synthetic case and all four measured files returned `parseStatus: ok`. Thus these are semantic extraction omissions, not parse-error fallbacks. Expected synthetic names were explicit; real-file counts used independent TypeScript syntax enumeration to handle multiline export clauses, alongside the source export lines. It did not use the query under test as its oracle.

### Kind → found by grep/source → found by tool → query evidence

| Kind / input                          | Found by grep/source                  | Actual `CodeInsights.exports`                    | Query / extractor evidence                                                                                       |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `export interface I {}`               | I                                     | None                                             | query:154–188 contains no interface pattern; analysis:392–421 no interface capture branch                        |
| `export type T = string`              | T                                     | None                                             | Same; no type-alias pattern/branch                                                                               |
| `export enum E { A }`                 | E                                     | None                                             | Same; no enum pattern; ExportInfo.kind also lacks enum (`ast-analysis.interfaces.ts:90`)                         |
| `export const c=1`                    | c                                     | c, kind=variable                                 | query:177–180 lexical_declaration pattern works                                                                  |
| `export let l=1`                      | l                                     | l, kind=variable                                 | Same lexical_declaration pattern works                                                                           |
| `export var v=1`                      | v                                     | None                                             | query:177 only lexical_declaration, not variable_declaration                                                     |
| Destructured exported const `{x,y:z}` | x and z bindings                      | None                                             | query:180 only identifier, not binding patterns                                                                  |
| `const local=1; export default local` | default export of local               | None                                             | query:155–158 captures export.value, which analysis:391–421 never consumes                                       |
| `export default 42`                   | default export expression             | None                                             | Same ignored value capture                                                                                       |
| `export default function named(){}`   | named declaration with default status | named/function, **no isDefault**                 | query:167–169 declaration match lacks default capture; independent default capture is not merged into this match |
| `export default function(){}`         | anonymous default function            | None                                             | Named declaration pattern requires identifier; default value not interpreted                                     |
| `export default class Named {}`       | Named declaration with default status | Named/class, **no isDefault**                    | query:172–174 omits default capture on declaration match                                                         |
| `const a=1; export {a as b}`          | exported name b, local name a         | **a**, kind=unknown                              | query:164 captures name, not alias; analysis:413 reads it literally                                              |
| `export {a as b} from './other'`      | re-exported b with source ./other     | Two a records: one plain and one re-export; no b | Overlapping query:161–164 and 182–187; analysis:424 dedup key distinguishes source, retaining both               |
| `export * from './other'`             | wildcard re-export declaration/source | None                                             | query:182–187 requires export_clause/export_specifier; no wildcard pattern                                       |
| `export * as ns from './other'`       | namespace export ns/source            | None                                             | No namespace-export pattern                                                                                      |

A grep sees wildcard syntax and source, not all transitive exported names. The missing wildcard observation above means **even the declaration/source relationship is absent**, not that this probe resolved an entire transitive module graph. Complete symbol-index expansion of wildcard exports is a separate resolution step, with cycle/duplicate/default semantics to preserve.

### Fixture and three real repository files

| File                                                               |                    Independent source exports |                                                                      Tool result | Exact gaps                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------: | -------------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated `apps/api-service/src/data-processor.service.ts`         |          43 declarations; knownSymbols now 43 |                                                                40 export records | MetricRecordData line 6; ProcessingBatchSummary line 13; PipelineConfigurationOptions line 20                                                                                                                                                 |
| `libs/backend/workspace-intelligence/src/ast/ast.types.ts`         |                                3 declarations |                                                             **0** export records | CodePosition:4; GenericAstNode:12; SupportedLanguage:25                                                                                                                                                                                       |
| `libs/backend/workspace-intelligence/src/types/workspace.types.ts` |                               11 declarations |                                                             **0** export records | Enums ProjectType:13, Framework:33, MonorepoType:61, FileType:79; interfaces EnhancedWorkspaceInfo:91, IndexedFile:109, FileIndex:127, ContextOptimizationRequest:141, ContextOptimizationResult:155, DependencyInfo:167, ProjectAnalysis:179 |
| `libs/backend/workspace-intelligence/src/index.ts`                 | 92 named specifiers + 7 wildcard declarations | **184** records: duplicated plain/re-export named records; zero wildcard records | Wildcards at lines 7,107,108,109,132,133,134                                                                                                                                                                                                  |

A real six-file DependencyGraphService build independently confirmed 51 runtime export records and these five missing fixture symbols in getSymbolIndex: SessionUserCredentials, NavigationBarProps, MetricRecordData, ProcessingBatchSummary, PipelineConfigurationOptions. The last three are the 300-line file's interfaces; the first two come from auth-session.ts and navigation-bar.tsx (`fixture:450,517`, subject to generator metadata lines).

### Where the gap propagates — and where it does not

| Consumer                    | Actual dependency and impact                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ptah_ast_analyze            | analysis:87 runs language exportQuery; analysis:123 decodes captures; namespace forwards exports. Missing metadata reaches the otherwise-lossless formatter.                                                                                                                                                                                                                                  |
| ptah_get_symbol_index       | graph:608 stores insights.exports; graph:813 exposes symbol index. Query/extractor omissions and duplicate re-export records propagate.                                                                                                                                                                                                                                                       |
| typed ptah.ast.queryExports | parser:561–565 uses the same exportQuery, then AST builder:511–568 has a **second decoder** with the same missing kinds/default/alias handling. Updating only AstAnalysisService leaves this path broken.                                                                                                                                                                                     |
| CodeSymbolIndexerService    | Calls analyzeSource at `services/code-symbol-indexer.service.ts:398`, but inserts only insights.functions and insights.classes at lines 438 and 451. It does **not** consume insights.exports. Query changes alone will not add interfaces, enums or alias exports to the code index. Its scope/representation needs a separate decision and consumer change if broader symbols are required. |
| Batch 2d outliner           | `code-outliner.adapter.ts:76–96` has independent TS declaration queries including interfaces, aliases and enums; lines 164–175 call queryMulti with those queries. It does **not** consume JS_TS_EXPORT_QUERY. This export fix is not an outliner fix, and the evidence does not establish the same omission there.                                                                           |
| context_enrich_file         | Uses its declaration-summary path; the restored interface assertions pass. It is not constrained by the broken export query.                                                                                                                                                                                                                                                                  |

### Smallest corrective change supported by the probe

For the current fixture's interface/type gap, add a **TypeScript-only suffix** to the export query and interpret its captures. The following three patterns compiled successfully against the installed TS grammar and captured I, T and E in the probe:

```scheme
(export_statement declaration:
  (interface_declaration name: (_) @export.interface_name))
(export_statement declaration:
  (type_alias_declaration name: (_) @export.type_name))
(export_statement declaration:
  (enum_declaration name: (_) @export.enum_name))
```

Use `JS_TS_EXPORT_QUERY + TS_EXPORT_SUFFIX` only for the TypeScript entry (`query:393`); keep the JavaScript entry (`query:387`) free of TS-only node names or its query compilation can fail. Add matching branches in analysis:392–421 **and** AST builder:522–550. interface/type already have ExportInfo kinds; enum requires an honest supported kind or an explicit model extension propagated to AstExportInfo. Add grammar-compilation/extraction tests for both TS and JS.

This minimal suffix does **not** fix all measured export defects. Correct those with bounded query/decoder changes:

- Capture default status on the same declaration match and consume default-value exports; retain default identity for anonymous/expression exports.
- Read exported alias names while retaining source/local linkage where needed; do not emit a plain local-export record as well as its re-export record for one re-export declaration.
- Add var/binding-pattern cases and wildcard/namespace re-export captures with source. Model wildcard metadata explicitly; do not fabricate a named export, silently drop it, or pretend transitive resolution already happened.
- Share or consistently update the two capture decoders. Validate symbol-index behavior after extraction, not merely query compilation.

These are recommendations only; no source was changed. Re-run the ≥40% token assertions after restoring exports—omitted information must not be the mechanism that achieves the saving.

## New defects

### R3-B1 — Blocking: product reports successful but incomplete/wrong export information

- File: query:154–188,387,393; analysis:391–433; graph:608; AST builder:521–562.
- Trigger → symptom: inspect an interface/type/enum-only file, default export, aliased export or re-export barrel → successful parse produces empty, misnamed or duplicated export records. Real examples above include complete loss of all 11 exports in workspace.types.ts.
- Current handling: isOk/parseStatus=ok; omitted symbols are not disclosed as an extraction limitation. Graph symbol index inherits the result. The formatter preserves this incorrect/incomplete input faithfully.
- Impact: callers looking for exports or change impact miss real public API while following the mandated tool substitution. This violates the task's “save tokens without losing quality” and native-symbol recall requirements.
- Recommendation: implement the query **and decoder** corrections above with real-parser, default/alias/re-export and graph-index assertions. Do not classify interfaces as an acceptable runtime-only omission when the contract and fixture explicitly include them. Do not claim the query fix alone repairs code-index/outliner consumers that have different data paths.

### R3-B2 — Blocking: todo declarations certify the known recall failure as a green suite

- File: bench:424–426 and 730–732; runtime-only filter at bench:673–675.
- Trigger → symptom: required fixture interfaces are missing today → Jest records pending tests and the scoped suite succeeds. These are not failing regression assertions.
- Current handling: comments explain the product gap, but no callback exercises it and no failure reaches CI. The runtime-only filter remains active despite the expanded oracle.
- Impact: the harness knowingly gives a success-looking result for a current contract failure—the precise regression failure mode this task was created to prevent.
- Recommendation: replace both todos with executable assertions over the complete expected symbol sets **before** product correction; demonstrate red on current code, then green only after R3-B1 is fixed. Retain exact helper census and per-kind/function-range checks. Documentation of a failure is useful, but is not a substitute for a failing guard.
- Orchestrator position: **verified**. My r2 instruction to record an explicit product gap did not authorize suppressing the required assertion.

### R3-S1 — Serious: SIZE still measures modified answers and an inflated ranking baseline

- File: bench:633–663,701–722,805–819; dispatcher:2051–2055,2896–2912.
- Trigger → symptom: real payload exceeds the native baseline, or response overhead grows → benchmark can remain green because it changes the answer or compares against a larger path representation.
- Evidence and measurements:
  - Dependents: production sends resolved absolute file/dependent paths. The benchmark rewrites them relative and selects only a target with at least two dependents. On this mkdtemp fixture, auth-session's **actual** envelope was 112 tokens versus absolute-path grep's 110; benchmark-style relative envelope was 37 versus relative grep's 60. For token-utils: actual 77 vs absolute grep 51; relative 27 vs relative grep 26. Navigation-bar: actual 79 vs 51; relative 29 vs 26. Root/suffix lengths vary, but the measured passing surrogate is demonstrably not the response being shipped.
  - Symbol index: test serializes `{count: totalSymbols, entries: [[file,names]]}` at bench:711. Production renderSymbolIndexPage sends `{count: numberOfFiles,total,offset,nextOffset?,...completeness,files:[{file,symbols}]}` at dispatcher:2900–2912. This is a different count meaning and representation. “Approximation” is candid but does not guard the real renderer.
  - Ranking: answer paths are relative, but grepLines at bench:815 omits the `fixture.root` third argument. Independent measurement: answer **105 tokens**, absolute grep **682**, normalized relative grep **307**. The executor's claim that both sides use relative paths is false for this call. It currently passes the fair comparison too, but the inflated threshold would allow a 400-token regression to pass.
- Current handling: token units and grep-line baselines are genuine improvements, but actual-output fidelity and path symmetry remain incomplete.
- Recommendation: move boundary-size tests to vscode-lm-tools or expose shared production formatters rather than substitute layouts. Size the actual answer; choose and document a native path representation without rewriting only real tool costs away. Pass fixture.root to the ranking grep. If the genuine small-answer product cannot be smaller than grep because of envelope overhead, record/fix that contract mismatch instead of selecting a favorable surrogate.

### R3-S2 — Serious: ranking recall checks a different result from the production result being sized

- File: bench:786–795 versus 805–820; `context-analysis/file-relevance-scorer.service.ts:158–203`.
- Trigger → symptom: getTopFiles drops every entry or one relevant file while rankFiles remains correct → recall still passes on the independent score map; SIZE gets smaller and passes too.
- Current handling: recall calls rankFiles(), while the new production-shaped answer calls getTopFiles(). These are separate methods; getTopFiles independently maps/sorts/slices and does not call rankFiles.
- Independent probe: using the same fixture and recall predicates, replacing only the locally observed getTopFiles answer with `[]` leaves **recall=true and size=true**. No reviewed source was mutated to demonstrate this.
- Impact: the newly corrected production SIZE path can ship empty results without the required recall guard failing.
- Recommendation: call getTopFiles once and use that **same returned array** for both native-hit membership/order checks and serialized SIZE. Assert every expected hit and its ordering against non-hits on that result, with nonempty/cardinality bounds. Demonstrate a dropped-entry mutation fails those assertions.

## Batch 24r marker disposition

The marker at bench:438 is acceptable **as pending work** because the caller explicitly confirms that approved Batch 24r lands before this batch is committed. It is not another blocker for this intermediate review and is not counted as a new defect.

However, an `it.todo('description')` contains no callback. Merging preserveKeys does not automatically activate it, and merely removing `.todo` does not implement a test. Before commit, implement a real through-budget scenario in the owning boundary project, prove required parse/coverage keys survive reduction/cut, and confirm the full table output remains recoverable from the spool. Then remove the marker and record the result. The author's “enforced automatically once Batch 24r lands” comment at bench:436 is not technically accurate. Metadata preservation remains unverified until that work is executed.

## Five logic questions

1. **How does this fail silently?** Valid TS files return successful empty/wrong export lists (R3-B1), and known missing symbols become green todos (R3-B2).
2. **What user action produces unexpected behavior?** Asking the tool to locate an exported alias/default or public enum fails to return the actual export; changing getTopFiles to lose entries does not fail the benchmark (R3-S2).
3. **What input produces a wrong answer rather than an error?** The measured interface/type/enum/default/alias/re-export forms all parse successfully; see the export-kind table. This is not malformed-input handling.
4. **What happens when a dependency fails?** Existing parser error/recovered-state and graph partial-context checks remain, but successful parsing does not imply complete extraction. Future preserveKeys integration still needs the explicit above-budget callback. No new swallowed filesystem/WASM failure was found in this revision.
5. **What was not specified adequately?** The export model for wildcard/default/alias identities, which consumer owns transitive export resolution, and the exact public/native serialization to size. A fixed token margin cannot justify dropping API information.

## Data flow

1. Fixture generation → independent export census: **OK for current tracked fixture syntax**, now 43/43 on the large file (fixture spec:231–252). The regex is deliberately fixture-specific, not a general TS parser.
2. Tree-sitter export query → capture decoder: **GAP**, unsupported forms and ignored/misinterpreted captures (R3-B1).
3. AST/graph → MCP formatter/index: **GAP propagates**, lossless formatting does not restore missing exports (analysis:123, graph:608).
4. Fixture expectations → benchmark: **GAP**, two recall requirements pending instead of failing (R3-B2).
5. Actual tool output → SIZE comparator: **PARTIAL**, real token measures but altered outputs/path asymmetry (R3-S1).
6. Ranking → recall + SIZE: **GAP**, two different method results checked (R3-S2).
7. Scope verification → green: expected despite these gaps; todos and surrogate checks do not enforce missing requirements.

## Requirements fulfilment

| Requirement                                    | Status                                    | Gap                                                                        |
| ---------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Fixture includes every generated helper export | COMPLETE                                  | Independent census now matches                                             |
| Enrichment recalls interface declarations      | COMPLETE on fixture                       | Executable assertions restored                                             |
| AST / symbol index recalls all known exports   | MISSING                                   | Product gap + non-executing todos                                          |
| ≥40% AST/enrichment token margin               | COMPLETE on current incomplete AST result | Must re-verify after restoring exports                                     |
| All four dependent edges recalled              | COMPLETE on fixture                       | Source paths repaired in prior round                                       |
| SIZE uses real tokens / grep lines             | PARTIAL                                   | Units fixed; output fidelity/path symmetry still wrong                     |
| Ranking recall covers shipped result           | MISSING                                   | Different methods tested                                                   |
| 24r metadata integration                       | PENDING, explicitly accepted prerequisite | Implement real test after merge, before commit                             |
| Nx non-React root / all four projects          | COMPLETE on fixture                       | Prior active checks retained                                               |
| <30s benchmark / regression failure            | PARTIAL                                   | Aggregate bound retained and passing; known recall failures cannot fail CI |

## Edge cases

| Case                           | Handled                                 | Evidence / concern                                           |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------ |
| Exported const/let identifiers | YES                                     | Real grammar probe, query:177–180                            |
| Interfaces/types/enums         | NO                                      | Empty output on real files                                   |
| Default exports                | NO / incorrect metadata                 | Value captures ignored; named declarations lose default flag |
| Aliased / wildcard re-exports  | NO / wrong names / duplicates           | Measured table above                                         |
| Pipe/newline table values      | YES in prior unchanged formatter review | No formatter changes this round                              |
| Zero ranking results           | NO in guard                             | Empty production answer can pass R3-S2                       |
| One-dependent target           | NOT size-guarded                        | Filter at bench:633; measured output not smaller             |
| Above-budget coverage metadata | PENDING 24r                             | Marker only; not yet executable evidence                     |

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: **PASS**, all six targets, **3m05s** total. This is not benchmark-only timing. Passing does not turn pending tests into executed assertions.
- `ptah_get_diagnostics`, scoped to benchmark/project: **0 errors, 0 warnings**, TypeScript compiler source.
- `nx run degradation-audit:lint --skip-nx-cache`: **PASS**. First tail omitted its numeric total; a streamed audit verification exposed **TOTAL 300 unsuppressed sites** and success. No failed test suite was rerun to recover logs.
- Independent native Node probes in an fs.mkdtemp root: real checked-out parser/service/fixture/graph/scorer, actual grammar, installed tokenizer; platform/logging adapters only. All synthetic export cases parsed ok. Query-suffix compilation and capture results verified without editing source.
- Current fixture: 43 expected / 40 extracted on the 300-line file; six-file graph: 51 extracted runtime records, five interfaces missing. Three real repo files and all requested export forms measured above.
- Existing independent r2 formatter round-trip, adversarial string and token results were not needlessly rerun; formatter/inference production code is unchanged this round. New probes target the newly exposed export and revised harness paths.
- Reviewed sources, task/batch state, and git state were not modified. Only this review deliverable and isolated temporary probe artifacts were written.

## Verdict

- Recommendation: REVISE
- Assessment: NEEDS_REVISION
- Confidence: HIGH
- Top risk: valid public exports disappear from successful tool output while the regression suite explicitly leaves their recall tests pending.
- What a robust implementation would add: active complete-export assertions; TS-specific query additions plus both decoder updates and JS compilation checks; default/alias/re-export modeling; real public-output SIZE measurements; ranking recall on the exact getTopFiles array being returned; executable 24r integration proof before commit.
