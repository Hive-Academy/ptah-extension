# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| Review              | r2 — Batch 20 Task 20.2 revision 1 and first review of 20.2p |
| Overall score       | 6/10                                                         |
| Assessment          | NEEDS_REVISION                                               |
| Blocking issues     | 0                                                            |
| Serious issues      | 2                                                            |
| Moderate issues     | 1                                                            |
| Failure modes found | 3                                                            |

The MCP AST product fix meets the measured size target and preserves the pre-existing JSON field values before budgeting. The repaired fixture covers all four intended edges, and real token counting, shared inference, unconditional coverage cases and an aggregate runtime assertion materially improve the guard. Two r1 harness gaps remain: incomplete symbol recall and inappropriate SIZE comparisons. Budget-layer metadata preservation is also not complete before the announced Batch 24r dependency.

Score rationale: this now works with meaningful regression checks, unlike r1's 3/10. It is below the 7–8 band because a loss of 35 generated exported functions can still evade the benchmark, and several size assertions still do not measure the promised comparison. Source was read-only; no git operations or source mutations were performed.

Evidence aliases (all relative to this worktree):

- `bench`: `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts`
- `fixture` / `fixture spec`: adjacent `fixture-workspace.ts` / `fixture-workspace.spec.ts`
- `formatter` / `formatter spec`: `libs/backend/workspace-intelligence/src/ast/ast-result-format.ts` / `.spec.ts`
- `result spec`: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/ast-analyze-result.spec.ts`
- `dispatcher`: adjacent `protocol-dispatcher.ts`
- `budget`: adjacent `tool-result-budget.ts`
- `JSON reducer`: `libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts`
- `builders`: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`
- `inference`: `libs/backend/workspace-intelligence/src/context-analysis/enrich-language.ts`

Reviewed the new formatter/inference modules and their consumers, complete benchmark and formatter/result specs, fixture changes against the fully read r1 fixture, and relevant production response/budget paths. This is not blanket approval of unrelated dispatcher or repository code. No AGENTS.md was found; task intent and the prior review remain as established in r1. Ptah read/write tools were not listed, so native filesystem tools were used; scoped Ptah diagnostics were attempted.

## r1 findings status

| r1                                                         | Status                                            | Evidence and disposition                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Lowered AST margin                                     | CLOSED                                            | bench:303–315 sizes real production formatter text with countTokens and requires ≥0.40. No 35% exception remains.                                                                                                                                              |
| 2 — AST product misses promised saving                     | CLOSED for requested MCP scope                    | dispatcher:2009 now uses formatter. Independent fixture result saves approximately 47%; see measurements below. Typed execute_code return remains unchanged by design.                                                                                         |
| 3 — Broken/excluded fixture edges                          | CLOSED                                            | fixture:88,593 now use ../../../libs; fixture spec:180–209 independently resolves actual specifier text on disk; bench:520–523 tests all knownEdges.                                                                                                           |
| 4 — Characters/words substituted for promised token margin | CLOSED for AST/enrichment/count_tokens            | bench:133–136,305–315,392–394 uses real tokenizer. Remaining character-only SIZE checks are included in R2-02. TokenCounterService's delegation check at bench:740–746 is legitimate; it is not independent validation of the tokenizer implementation itself. |
| 5 — Local copy of language inference                       | CLOSED for shared logic                           | inference:53–70 is the extracted production decision; builders:117 and bench:380 call it. Production spy probe confirms interception; details below.                                                                                                           |
| 6 — Incomplete recall                                      | PARTIAL                                           | Missing-node skip removed (bench:569–582); both ranking hits compared to misses (643–645); root enum checked (698); all four projects checked (709–719). But helper exports and interfaces remain unguarded: R2-01.                                            |
| 7 — Missing/unfair SIZE checks                             | PARTIAL                                           | Dependent SIZE exists at bench:529–534, but compares against full sources; symbol/ranking projections and character measures remain. R2-02.                                                                                                                    |
| 8 — Self-selecting coverage expectations                   | CLOSED for the existing relative/bare-alias cases | bench:471–478 pins complete with zero unresolved records; bench:505–512 unconditionally pins partial and resolver-context-partial. It no longer chooses expectations from returned context. General budget preservation is a separate dependency, R2-03.       |
| 9 — Per-test rather than total budget                      | CLOSED                                            | bench:249,263–269 asserts aggregate elapsed time including fixture construction/cleanup. Current scoped suite passes it. CI wall-clock assertions remain inherently load-sensitive; no observed failure justifies another defect.                              |

## 20.2p findings

### Representation and losslessness

The actual format is **JSON arrays**, not pipe-delimited text. `formatter:31–34` leaves non-list top-level values intact and JSON-serializes the result; `formatter:42–57` builds a union header and positional rows. Pipes, quotes, backslashes and newlines are JSON-escaped; they cannot split a row. Missing/undefined cells use null with trimmed trailing cells. Real null values force an unchanged object-list fallback (`formatter:61–69`). Nested method records remain nested JSON rather than undergoing another table transformation.

Independent probes decoded the formatted result and compared it deeply against `JSON.parse(JSON.stringify(oldResult))` for:

- The real fixture and three selected production files.
- Nested classes/methods, function overload declarations/implementation, default exports, re-exports, and decorated classes/parameters.
- Explicit AST-shaped records with pipe/newline/quote/backslash strings in names, parameters and import sources, plus nested method lists and optional export fields.

All these comparisons passed. This validates preservation of **fields the old extractor actually returned**, not completeness of the extractor: e.g. an overload or default export omitted by the old extractor is not restored by a serializer. The committed real-parser spec covers one generated file plus recovered syntax (`result spec:204–256`); adding the successful adversarial cases as permanent specs would improve confidence but no formatter corruption was found.

### Parse metadata ordering and budget boundary

The formatter preserves insertion order; it does not reorder an arbitrary caller's object (`formatter:31`). The real namespace constructs parseStatus/error counts/coverage first, and the dispatcher wiring spec pins the exact text (`protocol-dispatcher.spec.ts:939–945`). Under budget, the result is preserved byte-for-byte (`budget:233–243`). Independent fixture budget probe: roughly 1,157 tokens, reducer=none, truncated=false, unchanged=true.

It does **not** survive all above-budget paths intact today. A 2,058-token synthetic AST envelope with 220 functions, parseStatus=unknown, errorNodeCount=null and partial coverage went through the real budget function. Result: reducer=json-compact, truncated=true, approximately 1,980 tokens; parseStatus remained first, but errorNodeCount=null and coverage.excluded=null disappeared. R2-03 records this existing integration dependency. The table's positional null/empty-array cells were not shifted. The spool/truncation disclosure is intentional and is not itself classified as silent data loss.

### Real token measurements

Measured with installed gpt-tokenizer and real buildAstNamespace → AstAnalysisService → TreeSitterParserService → formatAstAnalysisResult. Paths were absolute; the randomized mkdtemp suffix changes output by a few tokens. Source baselines are exact full files without added line numbers.

| Source                                                                    | Lines | Source tokens | Old namespace JSON tokens | New MCP formatter tokens |     Saving |
| ------------------------------------------------------------------------- | ----: | ------------: | ------------------------: | -----------------------: | ---------: |
| Corrected 300-line fixture                                                |   300 |         2,184 |                     1,645 |                    1,159 | **46.93%** |
| workspace-intelligence/src/context-analysis/context-enrichment.service.ts |   278 |         2,567 |                       622 |                      532 | **79.28%** |
| workspace-intelligence/src/file-indexing/pattern-matcher.service.ts       |   321 |         2,280 |                       499 |                      382 | **83.25%** |
| workspace-intelligence/src/ast/dependency-graph.service.ts                | 1,424 |        11,498 |                     1,948 |                    1,391 | **87.90%** |

All parseStatus values were ok, all round trips passed, and all new outputs were below 2,000 tokens / 8,000 characters. The first two production selections are close to the requested 300-line size; the third tests a substantially larger real service. These independently support the executor's measured improvement without relying on its chosen files.

The quoted contract remains unchanged: `ptah-core-prompt.ts:48` says “40-60% fewer tokens than Read”; `tool-description.builder.ts:1665` repeats that claim for ptah_ast_analyze. The typed API still returns the old object, as authorized here. A separate existing execute_code help string also claims 40–60% savings (`namespace-builders/system-namespace.builders.ts:391`); the measurements do not establish that claim for the unchanged typed path. Record that as a scope limitation, not a request to break the typed API or weaken a frozen prompt.

### Production spy proofs and extraction

The earlier suspicion that a barrel getter might prevent jest.spyOn did **not** hold in this checkout. I compiled the actual barrel using installed TypeScript and the project's CommonJS setting, with unrelated imports stubbed only to isolate the check. Both target exports were configurable and `jest-mock.spyOn` succeeded. Running real buildContextNamespace.enrichFile with a spy returning undefined produced one spy call and forwarded undefined to generateStructuralSummary. The dispatcher compiles its formatter invocation as a live module-property call:

`(0, workspace_intelligence_1.formatAstAnalysisResult)(result)`

It is not an inaccessible internal lexical reference. Thus the reported deliberate breaks are meaningful for these production exports; this review independently verified the binding mechanism, not the historical author's red-run logs. The permanent bench tests shared inference and formatting; the existing consumer wiring tests cover their use.

Inference behavior matches the previous implementation: explicit supported language wins; path.extname is lowercased; mts/cts/mjs/cjs map to base extensions; inferred TSX is refused; unsupported/no extension returns undefined (`inference:57–70`). The new barrel export and higher-level alias import follow the allowed dependency direction (`workspace-intelligence/src/index.ts:82–85`, `builders:20`). The mocked builder spec still contains a copy, but the shared production implementation is now separately exercised, closing the original gap.

## New defects / remaining failure modes

### R2-01 — Serious: recall still excludes known interfaces and 35 real exported helpers

- Evidence: `fixture:235–249` generates helper exports without recording them in knownSymbols. `bench:273–280,321–339` checks only fixture metadata; `bench:329–334` explicitly permits the untracked helpers. `bench:557–559` filters out interface/type symbols, and `bench:577–580` again excuses the helpers. Enrichment checks only function/class/variable metadata (`bench:409–419`).
- Trigger → symptom: AST/graph extraction loses transformMetricStep1 (or every transformMetricStep helper) → these recall checks still pass and SIZE improves. Enrichment could lose interface declarations and still pass its declaration checks. This is a green guard after real output loss.
- Independent evidence: the 300-line source has **43 native exported declarations**, but only **8** entries in knownSymbols: three functions, one class, one variable and three interfaces. **35 exported helpers are absent from the oracle**; the three interfaces are then deliberately excluded. The r1 regex at least enumerated those helper export names; this rewrite removes that coverage.
- Current handling: meaningful per-kind checks for the remaining names, but no independent complete declaration census. The formatter round-trip cannot catch extraction loss because it compares against the already-incomplete service result.
- Recommendation: enumerate generated helpers in the fixture or derive an independent native export census from disk, pin nonempty expected counts, and require every promised declaration/export in its proper output. Restore interface/type recall for the API summary and exported-symbol contract; if the current AST/index query cannot provide it, keep that as an explicit product failure rather than filtering the expectation. For lossless formatting, retain separate round-trip checks after extraction recall succeeds.
- Requirement impact: r1 finding 6 remains open. No visible task instruction authorizes weakening “every known symbol / every native-grep symbol” to the runtime-only subset.

### R2-02 — Serious: several SIZE assertions still do not measure the native alternative or returned output

- Evidence: `bench:529–534` compares a test-created map of dependents against complete source files selected from returned graph nodes. `bench:541–551` does the same for a names-only symbol projection. `bench:649–656` compares path/score pairs against full candidate sources. Those checks use `.length`, not token counts. `builders:313–320` actually returns ranking records with file, score **and reasons**.
- Trigger → symptom: ranking explanations or actual dependent response overhead grows, or output exceeds a native import/name grep while remaining smaller than full files → green SIZE assertion. Character savings can also diverge from token savings.
- Current handling: every tool now has something labelled SIZE, but the new dependent assertion repeats the unfair baseline already raised in r1. Ranking does independently identify native hits; it never serializes or sizes that grep result. Full reads are fair for AST/API summaries, not automatically for finding matching paths/import declarations.
- Recommendation: freeze the candidate tree independently of returned nodes, construct a deterministic native grep payload of matching paths/declarations/imports, and measure it against the actual public result representation including metadata/reasons. Use the same real tokenizer on both sides. If a service-level projection is intentionally the contract, define and use the production projection rather than a test-only smaller surrogate. Require recall and size together.
- Requirement impact: r1 finding 7 remains open; adding an assertion without the fair baseline does not close it. Enrichment's current ≥40% check also sizes content only (`bench:393`); measure its full returned object to guard overhead, although the known current envelope still clears the threshold.

### R2-03 — Moderate: full metadata preservation remains dependent on the unlanded budget fix

- Evidence: `formatter:31–34` initially preserves metadata; `budget:255` invokes reduction above budget; `JSON reducer:136–150` recursively drops empty/null object fields. `result spec:229–256` checks only pre-budget text; the dispatcher fixture is small (`protocol-dispatcher.spec.ts:904–945`).
- Trigger → symptom: AST envelope exceeds the budget with unknown/null or empty coverage metadata → reduction removes fields before the cut. The real 2,058-token probe lost errorNodeCount:null and coverage.excluded:null while retaining parseStatus:unknown and coverage.census:partial.
- Current handling: original output is spooled and the response discloses reduction/truncation. Positional table cells are not shifted, and the current benchmark fixture bypasses reduction entirely. This is therefore not a newly introduced silent loss by the table formatter, nor a reason to reject its demonstrated under-budget losslessness.
- Recommendation: land/verify Batch 24r's preserveKeys behavior and add a through-budget AST regression covering null/empty metadata and a cut. Assert required parse/coverage keys before and after reduction, and that the spool retains the complete formatted answer. Until then, qualify 20.2p as lossless **before budget processing**, not unconditionally on the wire.
- Requirement impact: the requested parse/coverage preservation through the current reducer is not fully established. This known pending dependency is tracked separately from the two serious harness defects.

## Tool → promised → measured → asserted

| Tool                      | Promised (source)                                                                        | Measured / observed                                                                                                     | Asserted now                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ast_analyze MCP           | ≥40% fixture (batches.md:2757); 40–60% tokens (core prompt:48, description builder:1665) | ~47% fixture; selected real files 79–88%                                                                                | ≥40% tokens on formatter text, bench:315; extraction recall incomplete                          |
| context_enrich_file       | ≥40% fixture, batches.md:2757; API surface, core prompt:49                               | Scoped suite passes real-token content assertion; r1 independently measured ~63% content / ~58% complete summary object | ≥40% content tokens, bench:394; no full-envelope size assertion; interfaces omitted from recall |
| get_dependents            | Smaller native equivalent + all edges, batches.md:2757                                   | Four repaired edges pass                                                                                                | All edges + char-size map versus full sources, bench:520–534                                    |
| get_symbol_index          | Smaller + every exported symbol, batches.md:2757 / core prompt:54                        | Scoped checks pass retained runtime subset                                                                              | Full source char baseline; interfaces and generated helpers omitted, bench:541–582              |
| relevance_rank_files      | Smaller + native recall; reasons, core prompt:52                                         | Both selected grep hits outrank non-hit                                                                                 | Ranking recall improved; synthetic path/score char-size comparison, bench:643–656               |
| monorepo / workspace type | Smaller + all members + non-React root, batches.md:2757                                  | All four project paths and valid non-React enum pass                                                                    | Positive enum check + four-project recall + manifest char-size baseline, bench:698–729          |
| count_tokens              | Accurate token result and smaller answer, batches.md:2757                                | Corrected fixture baseline 2,184 tokens; real-counter delegation passes                                                 | Same real tokenizer called directly versus service; JSON character-size check, bench:740–750    |

## Five logic questions

1. **How does this fail silently?** Dropping untracked helper/interface output improves SIZE and escapes recall (R2-01, bench:329,557); growth in omitted response fields escapes SIZE (R2-02, bench:654).
2. **What user action produces unexpected behavior?** Refactoring a helper into an extraction shape the service misses can still leave CI green; inspecting an oversized AST returns reduced/cut rather than intact JSON, honestly disclosed but with some metadata removed (R2-03).
3. **What input produces a wrong answer?** The fixture already contains 35 untracked exports and three filtered interfaces (fixture:92,107,122,243). Special JSON string characters did not corrupt formatter output in the probes (formatter:34).
4. **What happens when a dependency fails?** Recovered syntax remains explicitly recovered before budget processing (result spec:246–256); forced unresolved alias is unconditionally partial (bench:505–512). Missing read/parser service failures continue through existing paths, not newly rewritten here. Unknown/empty metadata is vulnerable during reduction, R2-03.
5. **What was never specified adequately?** The exact native grep serialization and full public payload to size; the distinction between lossless formatter output and intentionally budgeted/spooled output. These must be explicit for an auditable regression guarantee.

## Data flow

1. Real mkdtemp fixture → corrected imports and disk edge oracle: **OK**, fixture spec:180–209.
2. Real parser → structured result → shared formatter: **OK for serialization**, formatter:29–69; native declaration recall remains incomplete in the guard, R2-01.
3. Shared language inference → summary service → real token counter: **OK**, builders:115–118, bench:133–136,380–394.
4. Graph → dependent/index assertions: repaired edges and complete/partial states **OK**; symbol census and size baselines **PARTIAL**, R2-01/R2-02.
5. MCP formatted JSON → budget precheck/reducer → response/spool: **OK below budget**, partial metadata preservation above it, R2-03.
6. Suite teardown → aggregate <30s assertion: **OK on this run**, bench:263–269.

## Requirements fulfilment

| Requirement                                    | Status                                       | Gap                                                              |
| ---------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| ≥40% AST fixture reduction                     | COMPLETE                                     | MCP scope; real token measurement and production formatter       |
| ≥40% enrichment reduction                      | PARTIAL                                      | Content passes; envelope overhead not guarded                    |
| All four intended fixture edges                | COMPLETE                                     | Repaired and independently resolved                              |
| Every native/known symbol                      | PARTIAL                                      | 35 helpers and interfaces excluded                               |
| SIZE per tool against fair native equivalent   | PARTIAL                                      | R2-02                                                            |
| Shared production inference / meaningful spies | COMPLETE                                     | Verified module bindings and real consumer interception          |
| Current graph partial states                   | COMPLETE for covered cases                   | Unsupported/polyglot activation remains later planned work       |
| Lossless AST serialization                     | COMPLETE for tested current AST value domain | Distinct from extraction completeness and post-budget truncation |
| Metadata survives budget                       | PARTIAL                                      | Pending preserveKeys integration, R2-03                          |
| <30s aggregate benchmark                       | COMPLETE on scoped run                       | Wall-clock load sensitivity remains a limitation                 |

## Edge cases

| Case                                     | Handled                            | Evidence / concern                                                |
| ---------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| Pipe/newline/quote in names or sources   | YES                                | JSON round-trip probes; formatter:34                              |
| Nested method records                    | YES before budget                  | formatter spec:83–101; independent nested record round-trip       |
| Missing versus real null fields          | YES in formatter                   | Null fallback and absent-cell rules, formatter:39,51,69           |
| Overloads/defaults/re-exports/decorators | YES for preservation of old output | Real-parser round trips; no claim that old extraction is complete |
| Recovered parse                          | YES before budget                  | result spec:236–256                                               |
| Over-budget unknown metadata             | PARTIAL                            | R2-03; original preserved in spool                                |
| Missing graph file / rank hit / rootType | YES                                | Revised positive assertions reject these                          |
| Missing helper/interface output          | NO                                 | R2-01                                                             |

## Verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`: **PASS**, all six targets, 3m21s. This is project verification duration, not the benchmark's aggregate runtime.
- Combined scoped audit/validate invocation: **PASS** for degradation-audit:lint and ptah-electron:validate-deps (including its build-main dependency). The invocation also ran ptah-electron:lint, which passed. Nx's successful-task output was suppressed; the executor report states audit **TOTAL 300**, but that numeric line was not exposed in this independent run's tail. Do not treat the reported number as independently re-counted here.
- Scoped `ptah_get_diagnostics`: **unavailable**, compiler still running at its 45s response limit. No clean diagnostics result is claimed; both Nx typechecks passed independently.
- Native probes under a Node mkdtemp root used real checked-out services/parser/formatter, real fs reads, installed tokenizer, and real budget implementation. Platform/logging plumbing was adapted only at boundaries. Temporary source/adversarial inputs and spool files remained under temp roots. Initial probe had an incorrect secondary-entry alias; corrected it to surface.index.ts before recording budget results.
- Recorded independent measurements, whole-result equality checks, and production binding interception above. No reviewed source edits were made for a deliberate-break run. Historical executor failure counts and repeated timing runs were read, not re-created or asserted as independently reproduced.

## Verdict

- Recommendation: REVISE
- Assessment: NEEDS_REVISION
- Confidence: HIGH for the remaining harness gaps and pre-budget formatter behavior; MEDIUM for comprehensive above-budget metadata preservation pending Batch 24r.
- Top risk: the regression guard can remain green after losing most of the generated exported helpers, while its SIZE checks still overstate the native alternative for several tools.
- What a robust implementation would add: complete independent symbol/export census; full production-payload token measurement versus deterministic native grep; permanent through-budget metadata preservation tests after preserveKeys lands. Keep the successful lossless MCP formatter, repaired edges, real token counter and shared inference extraction.
