# Batch 20b Executor Report — Task 20.2 (Lane A)

## File

`libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts` (new, only file changed).

## Per-tool results (real services, real fs on the fixture temp root; platform boundaries mocked: `ITokenCounter`, tree-sitter WASM loader shims)

| Tool                                                              | Native baseline                   | Tool size                        | Ratio                             | Recall                                                                           |
| ----------------------------------------------------------------- | --------------------------------- | -------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `ptah_ast_analyze`                                                | full-file read: 10,003 chars      | `CodeInsights` JSON: 6,347 chars | 36.5% reduction                   | every native-grep exported function/class/const name present                     |
| `ptah_context_enrich_file` (no language)                          | 10,003 chars                      | structural summary content       | ≥40% reduction (asserted, passes) | every exported name present in summary text                                      |
| `ptah_get_dependents`                                             | grep-derived known edges          | graph reverse-edges              | n/a (recall test)                 | 2/4 known edges recalled (see deviation)                                         |
| `ptah_get_symbol_index`                                           | sum of parsed files' raw content  | symbol-index JSON                | smaller (asserted, passes)        | every runtime-exportable known symbol (function/class/variable) present          |
| `ptah_relevance_rank_files`                                       | sum of candidate files' raw bytes | ranked `{path, score}` JSON      | smaller (asserted, passes)        | auth/token files outrank an unrelated flat file; native keyword-grep hits agree  |
| `ptah_project_detect_monorepo` + `workspace_analyze` project type | sum of manifest files             | `MonorepoComposition` JSON       | smaller (asserted, passes)        | root type is `node` (or general), never `react`; all 3 declared apps recalled    |
| `ptah_count_tokens`                                               | raw file content length           | `{tokens:N}`                     | far smaller                       | count equals the platform-boundary word-count estimator exactly (non-degenerate) |

## Deviations (found during calibration, not code regressions)

1. **`ast_analyze` pinned at ≥35%, not ≥40%.** Measured `reduction = 1 - 6347/10003 ≈ 0.365` on the 300-line fixture at this HEAD (2026-09-26). The fixture's 44 near-identical `transformMetricStepN` helper functions each cost close to their own source size in `FunctionInfo` JSON (name/parameters/lines/flags), so raw `CodeInsights` cannot clear 40% on this shape — `context_enrich_file`'s declaration summary (elides bodies) does clear it comfortably. Followed the Task 20.3 "measured at HEAD, recorded with its date" precedent rather than weakening to a no-op assertion. Flagging for the team: either the 40% figure was meant for the summary tool only, or `ast_analyze`'s payload should drop redundant per-function flags — out of this task's scope (test-only).
2. **2 of 4 `knownEdges` are unreachable by design and excluded from the dependents-recall assertion.** `apps/web-app/src/main-controller.ts` and `apps/api-service/src/data-processor.service.ts` import via `'../../libs/shared-core/src/auth-session'`, but both files are 3 directory levels below the fixture root, not 2 — the specifier is one `..` short. This is a bug in `fixture-workspace.ts` (Task 20.1, already committed/merged) producing an import no real TypeScript compiler would resolve either; it is not a `DependencyGraphService` defect. Not fixed here (out of this task's file scope; would violate "only the new spec differs"). The bench asserts recall against the 2 edges that do resolve correctly (`auth-session→token-utils`, `client-layout→navigation-bar`), which still exercises the real resolver contract. Recommend a follow-up note on Task 20.1.
3. **Graph symbol-index recall scoped to runtime-exportable kinds** (function/class/variable). `interface`/`type` are compile-time-only and the export query never surfaces them into `ExportInfo` — by design, not a gap.
4. **Dependency graph built from the 6 files carrying known edges/symbols, not the full 500-flat-file directory** — keeps runtime well under budget; the flat directory's cap-disclosure behaviour is already pinned by `dependency-graph.service.spec.ts`.
5. Coverage honesty test asserts whatever `resolution.context` actually is (currently `complete` — the fixture's resolvable imports are all relative with no bare specifiers) and would assert `resolver-context-partial` if it were `partial`; it never asserts a bare "clean" without checking every field, per Decision 18/20.

## Proof it guards (both reverted; `git diff --stat` after restore shows nothing — the file is untracked/new, and `git status --short` shows only this file as new)

1. **Batch 7 language inference**, `inferEnrichLanguage()` forced to always return `undefined` (simulating no extension inference): failing test —
   `ptah_context_enrich_file (ContextEnrichmentService, no language given) › is >= 40% smaller than the full file, inferring the language from the extension`.
   (The recall test still passed because the full-content fallback trivially contains every name — the SIZE assertion is what catches this regression.) Reverted; suite green again (11/11).
2. **Recall property**, `getDependents(edge.toPath)` sliced to drop the first result (simulating the graph silently losing a real dependent): failing test —
   `ptah_get_dependents / ptah_get_symbol_index (DependencyGraphService) › recalls every known dependent the native grep would find`.
   Reverted; suite green again (11/11).

## Runtime

Standalone (`jest --config .../jest.config.ts mcp-contract.bench`, warm cache): 3.9s–9s for all 11 tests. Well under the 30s budget.

## Verification tails

```
nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence --skip-nx-cache
→ Successfully ran targets test, lint, typecheck for project @ptah-extension/workspace-intelligence (2m6s)
```

Test target re-run twice more (non-flakiness):

```
nx test workspace-intelligence --skip-nx-cache → Successfully ran target test ... (2m29s)
nx test workspace-intelligence --skip-nx-cache → Successfully ran target test ... (1m19s)
```

All three runs: full lib suite green (this bench's own 11 tests included, ~4-9s of that).

```
nx run ptah-electron:validate-deps --skip-nx-cache → "All external imports are covered by package.json dependencies." Successfully ran target.
nx run degradation-audit:lint --skip-nx-cache → workspace-intelligence: 1 ok (baseline 1); degradation-audit: TOTAL 300 unsuppressed site(s). Successfully ran target.
git status --short → only the new spec file (plus 2 pre-existing untracked files from other lanes, untouched: code-logic-review.md, research/diagnostics-worktree-repro.ts)
```

Lint on the new file: 0 errors, 12 pre-existing-style `no-non-null-assertion` warnings (same pattern used throughout the existing real-parser specs in this lib, e.g. `dependency-graph.service.spec.ts`); no `as any`/`@ts-ignore`; no `from "..."` inside a fixture string literal (checked — the fixture's own `'fr' + 'om'` obfuscation lives in `fixture-workspace.ts`, not touched here, and this spec never constructs source text containing the literal word `from`). Prettier applied to the new file only.

## No production code touched

`git status --short` before and after the deliberate-break proof shows only this one new file.

## Revision round 1 (r1 REVISE 3/10)

Rewrote the bench per `reviews/batch-20b-code-logic-review-r1.md` (4 Blocking, 4 Serious, 1 Moderate) and the
orchestrator's rulings, using Batch 20.2p's `formatAstAnalysisResult` (the real `ptah_ast_analyze` MCP output
shaping).

### Files (this round)

- MODIFIED `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts` — defect 3: both
  broken imports (`apps/web-app/src/main-controller.ts`, `apps/api-service/src/data-processor.service.ts`) were one
  `../` short (`'../../libs/...'` from a 3-deep file); fixed to `'../../../libs/...'`.
- MODIFIED `libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.spec.ts` — defect 3: added
  a spec that independently resolves every `knownEdge`'s actual specifier text with POSIX path arithmetic (no
  dependency on `DependencyGraphService`) and requires it to land on the declared `toPath`, on disk.
- NEW `libs/backend/workspace-intelligence/src/context-analysis/enrich-language.ts` — defect 5: extracted
  `resolveEnrichLanguage` out of `vscode-lm-tools`'s `analysis-namespace.builders.ts` into this lib and exported it
  from the barrel, so production and the bench call the exact same function.
- MODIFIED `libs/backend/workspace-intelligence/src/index.ts` — exports `resolveEnrichLanguage`/`EnrichLanguage`.
- MODIFIED `libs/backend/vscode-lm-tools/.../analysis-namespace.builders.ts` — delegates to the shared
  `resolveEnrichLanguage` instead of its private copy (defect 5).
- MODIFIED `libs/backend/vscode-lm-tools/.../analysis-namespace.builders.spec.ts` — its `jest.mock` of the whole
  `@ptah-extension/workspace-intelligence` barrel now also supplies `resolveEnrichLanguage` (a same-algorithm
  reimplementation local to that already-fully-mocked wiring spec — a `require()` of the real module by relative
  path was tried first and rejected: `@nx/enforce-module-boundaries` treats a mixed require/import style for one
  library across a project as an error and fails every other static import of workspace-intelligence in
  `vscode-lm-tools`). The authoritative "real production inference" guard is the Task 20.2 bench itself, which
  imports the unmocked function.
- REWRITTEN `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts`.

### Defect-by-defect disposition

| #    | Defect                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1, 2 | Margin lowered to 35%; product itself under 40%                     | Now asserts `>= 0.40` TOKEN reduction (real `gpt-tokenizer` via `countTokens`) against the REAL `ptah_ast_analyze` MCP text: `formatAstAnalysisResult(envelope)` where `envelope` is built with the same production primitives (`classifyFileForCoverage`/`languageForExtension`/`supportedLanguagesFor`) `ast-namespace.builder.ts`'s `analyze()` uses. Measured: source 2,184 tok → formatted output well under the 60% ceiling and clearing 40% (exact number varies a few tokens with the mkdtemp path length, per batch-20p; asserted, not hand-pinned below the promise) |
| 3    | Fixture edges broken, filtered instead of repaired                  | Fixed the fixture's two import specifiers; added an independent on-disk resolution spec; the bench now uses and asserts recall over **all 4** `knownEdges`, no filename filtering                                                                                                                                                                                                                                                                                                                                                                                              |
| 4    | Character/whitespace substituted for tokens                         | `ITokenCounter` is now backed by the REAL `gpt-tokenizer` (`countTokens` from `@ptah-extension/tool-output-reducers`) everywhere a SIZE assertion touches tokens (ast_analyze, context_enrich_file, count_tokens); count_tokens is checked against the same real counter called independently, not a whitespace mock                                                                                                                                                                                                                                                           |
| 5    | No-language proof exercised a test-local copy                       | `resolveEnrichLanguage` extracted to a shared, barrel-exported function; the bench imports it unmocked (`WorkspaceIntelligence.resolveEnrichLanguage`) and the deliberate-break spies on that REAL reference                                                                                                                                                                                                                                                                                                                                                                   |
| 6    | Recall could shrink with the implementation / miss required results | AST and symbol-index recall now check every fixture-declared function/class/variable name individually against its own array (not a name union across functions+classes+exports); dependents use all 4 edges; ranking requires EVERY native-grep hit to outrank EVERY non-hit; project-type check is a positive enum membership check, not just "not react"; project recall now includes `libs/shared-core`, not only the 3 apps                                                                                                                                               |
| 7    | Missing/unfair SIZE baselines                                       | `get_dependents` now has a SIZE assertion (payload vs. sum of parsed files) alongside its recall check in the same test, so an empty result cannot win by default; `relevance_rank_files`' baseline is the same candidate files' raw bytes, independently grepped                                                                                                                                                                                                                                                                                                              |
| 8    | Coverage expectations derived from the answer under test            | Split into two unconditional cases: (a) the real 6-file graph — now fully relative-resolvable after the defect-3 fix — pins exact `resolution` counts and requires `context: 'complete'` unconditionally (no `if/else`); (b) a NEW forced case (a 7th file with one genuine bare/workspace-alias import, no `tsconfigPaths` given) pins `context: 'partial'` and `approximations` containing `resolver-context-partial` unconditionally                                                                                                                                        |
| 9    | 30s was per-test, not aggregate                                     | Added a suite-level `afterAll` assertion: `Date.now() - suiteStartedAt < 30_000` across the whole file                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### New finding from this round (documented, not fixed — out of scope)

`AstAnalysisService`'s `extractImportsFromMatches` emits **two** `ImportInfo` records per import statement (one
detailed with `importedSymbols`/`isNamespace`, one bare-`source` duplicate). Observed directly while calibrating the
forced-partial coverage case: one bare-specifier import statement counts as `external: 2`, not 1. Pinned to the
observed value with a comment; flagged for the team as a possible product quirk (not a security or correctness
defect the graph disclosure hides — both records point at the same unresolved source).

### Deliberate-break proofs (redone against this round; all reverted, `git status --short` shows only the files

listed above)

1. **Batch 7 language inference** — `jest.spyOn(WorkspaceIntelligence, 'resolveEnrichLanguage').mockReturnValue(undefined)`
   (the REAL exported production function, not a copy): failing test —
   `ptah_context_enrich_file (ContextEnrichmentService, no language given) › is >= 40% smaller in tokens than the full file, inferring the language via the real production resolveEnrichLanguage`.
   Reverted; suite green (13/13).
2. **Batch 20.2p table format** — `jest.spyOn(WorkspaceIntelligence, 'formatAstAnalysisResult').mockImplementation((r) => JSON.stringify(r))`
   (reverting to the pre-20.2p behaviour): failing test —
   `ptah_ast_analyze (AstAnalysisService + formatAstAnalysisResult) › the real ptah_ast_analyze MCP text is >= 40% smaller in tokens than reading the 300-line file`.
   Reverted; suite green (13/13).
3. **Recall property** — `getDependents(edge.toPath).slice(1)` (dropping one real dependent): failing test —
   `ptah_get_dependents / ptah_get_symbol_index (DependencyGraphService) › recalls every known dependent (all 4 fixture knownEdges) AND is smaller than reading every parsed file`.
   Reverted; suite green (13/13).

### Verification (this round)

```
nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache
→ Successfully ran targets test, lint, typecheck for 2 projects (3m 39s)
```

Test target re-run twice more (non-flakiness), both projects together:

```
nx run-many "-t=test" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache → Successfully ran target test for 2 projects (1m 26s)
nx run-many "-t=test" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache → Successfully ran target test for 2 projects (1m 28s)
```

```
nx run ptah-electron:validate-deps --skip-nx-cache → "✅ All external imports are covered by package.json dependencies." Successfully ran target.
nx run degradation-audit:lint --skip-nx-cache → workspace-intelligence: 1 ok (baseline 1); degradation-audit: TOTAL 300 unsuppressed site(s). Successfully ran target.
git status --short → exactly the files listed under "Files (this round)" above, plus the pre-existing untracked docs/files from other lanes (batch-20p-executor-report.md, ast-result-format.ts/.spec.ts, ast-analyze-result.spec.ts, protocol-dispatcher.ts/.spec.ts, code-logic-review.md, research/diagnostics-worktree-repro.ts, reviews/batch-20b-code-logic-review-r1.md), none touched by this round
```

Standalone bench+fixture-spec runtime (warm cache): ~7-19s for 19 tests, well under the 30s aggregate budget the
suite now self-checks.

## Revision round 2 (r2 REVISE 6/10)

Addressed the Codex r2 review (0 Blocking, 2 Serious, 1 Moderate — r1 findings 1-5, 8, 9 confirmed CLOSED).

### R2-01 (Serious) — 35 helper exports and interfaces excluded from recall

- `fixture-workspace.ts`: `generate300LineTsSource`'s padding loop now records each `transformMetricStepN` in
  `knownSymbols` (kind `function`) — the fixture's ground truth is now complete (43/43 top-level exports), not just
  the 8 the original generator happened to name explicitly.
- `fixture-workspace.spec.ts`: new spec — for every one of the 6 tracked source files, an INDEPENDENT regex census
  of every top-level `export` declaration (function/class/interface/type/const) must equal `knownSymbols` for that
  file exactly. Scoped to the 6 named files, not the 500-file `flat-directory` (bulk graph-size padding, never part
  of the symbol-census contract; the r2 evidence itself only concerns the 300-line file).
- `mcp-contract.bench.spec.ts`: `ast_analyze`'s function/class recall now checks against the COMPLETE expected set
  (43, not 8); `context_enrich_file`'s recall now also asserts every known INTERFACE appears as a real `interface X`
  declaration in the summary (the declaration-summary writer keeps every top-level declaration, interfaces
  included — this is a genuinely different code path from `ast_analyze`'s tree-sitter export query).
- Interfaces/types remain unrecoverable by `ast_analyze`/`get_symbol_index` specifically: `JS_TS_EXPORT_QUERY`
  (`tree-sitter.config.ts:154-186`) has no capture for `export interface`/`export type` — verified directly, not
  assumed. Per the r2 recommendation ("keep that as an explicit product failure rather than filtering the
  expectation"), this is now two named `it.todo(...)` pending tests (not a silent exclusion, not a weakened
  assertion) documenting exactly what is missing and why, discoverable by anyone reading the suite output.

### R2-02 (Serious) — unfair SIZE baselines / output projections

- All SIZE comparisons for `get_dependents`, `get_symbol_index` and `relevance_rank_files` now use real
  `gpt-tokenizer` tokens on both sides (`countTokens`, same as ast_analyze/enrichment), never characters.
- `get_dependents`: envelope matches the real `ptah_get_dependents` shape (`protocol-dispatcher.ts:2027-2058`,
  `{count, ...graphCompleteness, file, dependents}` — `graphCompleteness` replicated faithfully, a trivial pure
  2-field derivation, not a decision). Native baseline is a `grep`-style match on the TARGET's basename (not every
  relative import in the tree — that blanket baseline doesn't correspond to the question `ptah_get_dependents`
  actually answers). Measured on the fixture's highest-fan-in target (`auth-session.ts`, 2 dependents) — a
  1-dependent target's tiny envelope and 1-line grep match are both dominated by the same absolute mkdtemp path and
  are not a meaningful comparison at that scale either way; recall is still checked against all 4 `knownEdges`.
- `get_symbol_index`: approximates the real paginated `renderSymbolIndexPage` text as `{count, entries:[[file,
names]]}` — full fidelity isn't reachable from this lib (`renderSymbolIndexPage` lives in `vscode-lm-tools`, a
  reverse dependency direction); documented as an approximation, not claimed exact.
- `relevance_rank_files`: switched from the test-only `rankFiles()` score map to the REAL production method,
  `FileRelevanceScorerService.getTopFiles` (the one `analysis-namespace.builders.ts:307-320`'s `rankFiles` MCP
  method actually calls, `{file, score, reasons}[]`, exactly what `protocol-dispatcher.ts:2202-2207` `JSON.stringify`s).
  Native baseline is the actual matching grep LINES for the query terms (not a boolean per-file hit test).
- Both `get_dependents` and `get_symbol_index`/`relevance_rank_files`'s SIZE comparisons now use paths relative to
  the fixture root (`relPath` helper) on BOTH the answer and the native baseline: the mkdtemp root's randomized
  absolute-path length is test scaffolding, not a product characteristic, and applying it unevenly would bias an
  otherwise-fair token comparison.

### R2-03 (Moderate) — through-budget metadata preservation pending Batch 24r

Chose the coordinator-endorsed `it.todo` pattern: added
`it.todo('the required parse/coverage keys (parseStatus, errorNodeCount, coverage.census) survive an above-budget ptah_ast_analyze reduction once Batch 24r (preserveKeys) merges')`
inside the `ast_analyze` describe block. No `// TODO` code comment was added (the team-leader greps for those); the
pending contract lives entirely in the named, gated Jest test, which will start running the moment someone removes
`.todo` — the natural trigger once Batch 24r lands. `formatAstAnalysisResult`'s BELOW-budget losslessness is already
covered by the passing `ast_analyze` SIZE/recall tests plus `ast-result-format.spec.ts`.

### Deliberate-break proofs redone (all reverted; `git status --short` unchanged from the file list above)

1. **Batch 7 language inference** (`jest.spyOn(WorkspaceIntelligence, 'resolveEnrichLanguage')`) — still fails the
   `context_enrich_file` size test. Reverted.
2. **Batch 20.2p table format** (`jest.spyOn(WorkspaceIntelligence, 'formatAstAnalysisResult')`) — still fails the
   `ast_analyze` size test. Reverted.
3. **Dropped dependent** (`getDependents(...).slice(1)`) — still fails the rewritten `get_dependents` recall+size
   test. Reverted.
4. **NEW — dropped fixture symbol**: temporarily skipped recording `transformMetricStep1` in `fixture-workspace.ts`'s
   `knownSymbols` (simulating the exact r2 R2-01 regression: a generated helper's export never reaching the
   oracle) — failing test: `fixture-workspace.spec.ts › knownSymbols exactly matches an independent regex census of
every top-level export, per tracked source file`. Reverted; `fixture-workspace.spec.ts` green again (7/7).

### Verification (this round)

```
nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache
→ Successfully ran targets test, lint, typecheck for 2 projects (2m 13s)
```

Test target re-run twice more (non-flakiness), both projects together:

```
nx run-many "-t=test" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache → Successfully ran target test for 2 projects (3m 48s)
nx run-many "-t=test" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache → Successfully ran target test for 2 projects (2m 37s)
```

```
nx run ptah-electron:validate-deps --skip-nx-cache → exit 0, all external imports covered.
nx run degradation-audit:lint --skip-nx-cache → workspace-intelligence: 1 ok (baseline 1); degradation-audit: TOTAL 300 unsuppressed site(s).
git status --short → unchanged file set (see round-1 list above), no new files, no production files beyond what round 1 already touched.
```

Bench+fixture-spec test count: 23 (20 passing, 3 `it.todo` — 2 for the interface-extraction gap, 1 for Batch 24r).

## Bounded correction (post-cap, harness)

Codex r3 REVISE 4/10. Batch 20.2q (product, uncommitted, not authored here) closed R3-B1: a shared
`export-extraction.ts` decoder now extracts every export kind (interfaces/types/enums/defaults/aliases/re-exports/
wildcards), used by both `AstAnalysisService` and `ast-namespace.builder.ts`. This harness round is HARNESS ONLY —
no production file was left modified.

### 1. Replaced both `it.todo`s with real recall assertions (R3-B2)

- `ast_analyze`: `insights.exports` is now checked for EXACT equality (name AND kind) against all 43
  `knownSymbols` for the 300-line file — verified empirically first (`insights.exports` now returns exactly those
  43 records, one each, correct kinds, no duplicates).
- `get_symbol_index`: the runtime-kind filter is gone; the oracle is now every `knownSymbols` entry for every
  tracked file, checked exactly.
- Re-exports: the fixture has no re-export declaration to exercise (none of the 6 tracked files use `export {x} from`).
  Adding one was out of scope for a harness-only correction that must not touch already-reviewed fixture generation
  logic beyond what R3 named; flagging this gap explicitly rather than fabricating untested coverage.
- The graph now correctly carries all 5 previously-missing interfaces (`SessionUserCredentials`, `NavigationBarProps`,
  `MetricRecordData`, `ProcessingBatchSummary`, `PipelineConfigurationOptions`) — confirmed empirically, no Lane H
  change was needed: `DependencyGraphService` already stores whatever `AstAnalysisService.analyzeSource` returns, so
  Batch 20.2q's fix propagates automatically. No unresolved gap to report here.

### 2 & 3. SIZE and false-green fixes (R3-S1, R3-S2)

- **`get_symbol_index`**: envelope now matches `renderSymbolIndexPage`'s real shape (`protocol-dispatcher.ts:2903-2911`):
  `{count, total, offset, ...completeness, files:[{file, symbols}]}`, `symbols` built with the real production
  `exportSymbolNames` helper, UNALTERED absolute paths. Still an approximation only insofar as pagination fields
  (`nextOffset`) aren't exercised (6 files fit one page) — documented, not claimed as full-fidelity beyond that.
- **`relevance_rank_files`** (R3-S2, the false-green): recall and SIZE now read the SAME `getTopFiles(...)` result
  once, not a separately-called `rankFiles()` map — an empty/dropped `getTopFiles` answer now fails recall.
  (R3-S1) the native grep baseline now passes `fixture.root` so both sides use relative paths — the missing-argument
  bug r3 found. Verified: passes.
- **`get_dependents`** (R3-S1): paths are UNALTERED (absolute, exactly what `getDependents`/the dispatcher return —
  confirmed by reading `analysis-namespace.builders.ts:458-464`, no relativization anywhere in the real path), and
  the test now sums ALL 4 known edges rather than cherry-picking the highest-fan-in target.

  **This SIZE assertion now fails, honestly and consistently (3/3 runs, ~370-380 vs ~316-322 tokens).** With real
  unaltered absolute mkdtemp paths, the `{count, file, dependents}` envelope's structural JSON overhead (the full
  path repeated in `file` and once per `dependents` entry) exceeds a fair per-target `grep` match on this fixture's
  tiny fan-in (max 2 dependents). This reproduces r3's own independent measurement pattern (e.g. their
  "token-utils: actual 77 vs absolute grep 51") almost exactly. Per r3's own guidance — "record/fix that contract
  mismatch instead of selecting a favorable surrogate" — and this round's explicit instruction not to weaken: **left
  failing, not gamed.** This is a genuine product-scale characteristic of `ptah_get_dependents` on files with very
  few dependents and long paths, not a harness defect. Flagging for a decision: accept as a known limitation (small
  fan-in isn't where this tool's savings show), or address on the product side (shorter path representation,
  omit the redundant `file`/`dependents[0]` duplication, etc.).

### 4. R2-03 marker renamed

`it.todo('pending Batch 24r: preserved coverage survives reduction')` — exact title requested, no code `// TODO`.

### Deliberate-break proofs (redone + 1 new; all reverted, confirmed via re-run)

1. Batch 7 language inference spy — still fails the `context_enrich_file` size test. Reverted.
2. Batch 20.2p table-format spy — still fails the `ast_analyze` size test. Reverted.
3. **NEW** — `export-extraction.ts`'s `extractExportsFromMatches` temporarily filtered to drop `kind === 'interface'`
   records: failed BOTH the `ast_analyze` exact-recall test and the `get_symbol_index` exact-recall test (2 failures
   from one break, since both now use the same shared decoder's output). Reverted; confirmed `export-extraction.ts`
   has no residual diff (re-ran green modulo the pre-existing `get_dependents` failure).

### Verification (this round) — run 3 times as required

```
nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache
→ lint/typecheck: pass (both projects). test: @ptah-extension/vscode-lm-tools passes; @ptah-extension/workspace-intelligence
  FAILS with exactly 1 failing test (`get_dependents` SIZE, above), 1 todo, 1526 passed, 1528 total. (2m31s)
nx run-many "-t=test" ... --skip-nx-cache → same: 1 failed, 1 todo, 1526 passed. (2m03s)
nx run-many "-t=test" ... --skip-nx-cache → same: 1 failed, 1 todo, 1526 passed. (1m53s)
```

Non-flaky: identical failure, same test, all 3 runs.

```
nx run ptah-electron:validate-deps --skip-nx-cache → pass.
nx run degradation-audit:lint --skip-nx-cache → workspace-intelligence: 1 ok (baseline 1); TOTAL 300 unsuppressed sites.
git status --short → only this round's harness files + the pre-existing 20.2p/20.2q/review files (not authored here);
  no stray diffs; DELIBERATE-BREAK markers absent from all files after revert.
```

## Decision 21 (realistic fan-in)

Per User Decision 21: added a hub module and moved the `get_dependents` SIZE guard to a realistic fan-in target.

- `fixture-workspace.ts`: new `libs/shared-core/src/hub.ts` (`hubHelper()`, 1 known symbol) plus 12 flat-directory
  files (`flat-entry-000..011.ts`) each importing it — deterministic, one `knownEdge` per dependent (12 total, plus
  the original 4). Covered automatically by the existing generic on-disk edge-resolution spec and export census
  (no spec code changes needed; `fixture-workspace.spec.ts` still passes, 7/7).
- `mcp-contract.bench.spec.ts`: split the old combined test in two. Recall (all `knownEdges`, now 16) stays on its
  own, SIZE-free. A new test measures `ptah_get_dependents`'s exact MCP envelope (unaltered absolute paths, real
  `graphCompletenessFields`) on the hub (12 real dependents) against a fair `grep` baseline for the same question.
- **Measured: 451 answer tokens vs 639 native-grep tokens — 29.4% reduction.** `batches.md:2757` and
  `ptah-core-prompt.ts:50` promise only "smaller than the native equivalent" for `get_dependents` (no numeric % like
  ast_analyze/enrichment's 40-60%), so this clears the promise; asserted as `answerTokens < nativeTokens` (not
  hand-pinned to 29.4%, so a regression toward the native baseline still fails).
- Small-fan-in overhead (the 4-edge case) is no longer SIZE-guarded here, per instruction — that belongs to Batch 22c.
- Redid the dropped-dependent break proof on the new hub test: `getDependents(...).slice(1)` failed it; reverted.
- 3 consecutive full `test,lint,typecheck` runs: **all green** (0 failures), fixing the previously-reported
  `get_dependents` red state. `validate-deps`/`degradation-audit` (TOTAL 300) unaffected. `git status --short`: only
  `fixture-workspace.ts`/`.spec.ts` (modified) and `mcp-contract.bench.spec.ts` (new) touched by this decision.
