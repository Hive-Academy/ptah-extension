# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 0              |
| Moderate issues     | 0              |
| Failure modes found | 2              |

Batch 7: REVISE. Automatic language selection exposes two existing parser/summary limitations on previously full-content default calls. Both now present missing API declarations as successful structural summaries. This separates 4/10 from the 5–6 band: these are silent wrong answers on ordinary supported inputs, not peripheral gaps. Inference, metadata ordering and scoped checks otherwise behave as described.

## Five logic questions

### 1. How does this fail silently?

TSX arrow components and ambient function declarations disappear while the result says `mode: "structural"`, with no reason. The namespace enables parsing at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:143`; the service accepts the resulting incomplete insights at `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:152`. See B1/B2.

### 2. What user action produces unexpected behaviour?

Call `ptah_context_enrich_file` without a language on `App.tsx` containing two exported arrow components, or `api.d.ts` containing an exported declared function. Both return “No declarations found,” through the real dispatcher (`protocol-dispatcher.ts:1939`). The equivalent JSX fixture preserves both functions.

### 3. What input data produces a wrong answer?

B1: `export const App = () => <div />;\nexport const Next = () => <span />;`.
B2: `export declare function greet(name: string): string;`.
The summary writer emits its empty-insights message at `context-enrichment.service.ts:271` despite these declarations being present.

### 4. What happens when a dependency fails?

Actual read rejection becomes empty full content with `read-failed` (`context-enrichment.service.ts:107`); AST Result.err becomes full original content with `parse-failed` (:145). No language skips parsing and returns `unsupported-language` (:133). Their changed log messages are fixed text (:109, :135, :147).

The namespace catch labels any unexpected pipeline exception `read-failed` and retains its message in content (`analysis-namespace.builders.ts:147`). That is broader than a literal read failure, but no additional probable production failure was reproduced, so it is not counted as a defect. A read-failed response does not mean parsing was attempted. An absolute outside-workspace path is deliberately accepted (:61); the filesystem service delegates the read (`services/file-system.service.ts:35`). This batch adds no containment check and no newly reproduced containment bypass.

### 5. What is missing that the requirements never mentioned?

A successful AST query is not proof of a complete summary. Error-recovered trees and declaration-only syntax need a conservative completeness rule. `tree-sitter-parser.service.ts:611` only rejects a missing tree/root; `context-enrichment.service.ts:183` formats the available insights without checking what was omitted. The nearby `code-outliner.adapter.ts:17` explicitly documents refusing ERROR/MISSING nodes for this reason.

## Failure modes

### B1 — TSX components silently disappear

- Trigger: omit language on the two-component TSX fixture above.
- Symptom: MCP text contains `"mode":"structural"` and `// No declarations found`; neither App nor Next survives and no fallback reason appears.
- Evidence: `analysis-namespace.builders.ts:145`; `tree-sitter.config.ts:10`; `tree-sitter-parser.service.ts:114`, :611; `context-enrichment.service.ts:152`.
- Current handling: .tsx maps to typescript, which loads tree-sitter-typescript.wasm. Query execution accepts its recovered tree and produces empty insights.
- Recommendation: provide a JSX-capable TypeScript parse path and reject recovered/incomplete parses before claiming a structural summary. Add a real-parser regression using arrow components, not a mock that succeeds whenever language is defined.

### B2 — Ambient function declarations silently disappear

- Trigger: omit language on `api.d.ts` containing `export declare function greet(name: string): string;`.
- Symptom: MCP text contains `"mode":"structural"` and `// No declarations found`; greet is absent.
- Evidence: `analysis-namespace.builders.ts:109`, :145; `tree-sitter.config.ts:34`; `context-enrichment.service.ts:202`, :271.
- Current handling: the last .ts extension selects the existing TS query. Its function-declaration/arrow patterns omit ambient function signatures; the formatter cannot restore declarations absent from insights.
- Recommendation: extract declaration signatures and retain their API, or conservatively return full content for declaration forms the writer cannot represent. Add a real-parser .d.ts regression. Exported interfaces/type aliases also reproduced empty insights, but are grouped here as the same declaration-coverage failure.

## Blocking issues

### B1 — Successful empty TSX summary

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:145`.
- Scenario: normal React arrow components in .tsx, no hint.
- Impact: the agent is told the file has no declarations and can make incorrect edits or dependency decisions.
- Fix: JSX-aware parsing plus completeness/error checks, as above.

### B2 — Successful empty declaration-file summary

- File: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:153`.
- Scenario: public ambient function declarations in .d.ts, newly inferred as TypeScript.
- Impact: the agent loses the file's actual API while receiving a success-looking answer.
- Fix: preserve declaration signatures or fall back without discarding their content.

## Serious issues

None reproduced.

## Moderate and minor issues

None counted. Existing tests check forwarding and mocked outcomes, not grammar compatibility (`analysis-namespace.builders.spec.ts:320`; `context-enrichment.service.spec.ts:73`). The two real-parser regressions above are required to close B1/B2.

## Data flow

1. Dispatcher validates nonblank file and forwards language — OK (`protocol-dispatcher.ts:1940`).
2. Namespace resolves path, honors explicit typescript/javascript, lowercases last extension and applies module aliases — OK (`analysis-namespace.builders.ts:101`).
3. Service reads once — OK; failure is identifiable (:107).
4. Unsupported language skips AST — OK (:133).
5. AST query and summary formatting — B1/B2: partial/empty insights are accepted as complete (:139–153).
6. Result serialized through createToolSuccessResponse, budgetToolText and applyToolResultBudget — metadata preserved (`protocol-dispatcher.ts:1948`, :2348, :2392).

## Requirements fulfilment

| Requirement                                   | Status   | Gap                                                         |
| --------------------------------------------- | -------- | ----------------------------------------------------------- |
| Explicit supported hint wins                  | COMPLETE | Contradicting extensions remain overridden                  |
| Last-extension and module-extension inference | COMPLETE | Correct mapping is not sufficient for grammar completeness  |
| TSX structural summaries                      | PARTIAL  | B1                                                          |
| Declaration-file API preservation             | MISSING  | B2                                                          |
| Reason on full results, absent on summaries   | COMPLETE | Incomplete parses incorrectly take the structural branch    |
| Metadata survives budget                      | COMPLETE | Verified in returned MCP text                               |
| Public barrel/module lattice                  | COMPLETE | Both projects are scope:extension/type:feature; lint passed |
| Decision 4 per-tool description               | PARTIAL  | Correct scope, but TS/JS API-summary promise fails B1/B2    |

Implicit requirements not addressed: distinguish a complete summary from a successfully queried incomplete AST.

Deviations: the four local module-extension aliases are a reasonable bounded choice; expanding the shared map would affect other consumers. Ignoring an out-of-enum hint and inferring instead is acceptable normalization for the declared two-value MCP schema; it changes permissive string callers, as the executor disclosed. Moving content last is justified and verified. None of those deviations independently caused a reproduced defect. The claimed TSX support itself requires revision.

## Edge cases

| Case                                             | Handled | How                                             | Concern                                           |
| ------------------------------------------------ | ------- | ----------------------------------------------- | ------------------------------------------------- |
| Uppercase / last extension / .mts .cts .mjs .cjs | YES     | Lowercase extname and local aliases             | Forwarding tests pass                             |
| No extension / dotfile / dir.ts/Dockerfile       | YES     | Undefined language                              | Unsupported full result                           |
| Directory path ending .ts                        | YES     | Provider read rejects; read-failed              | Extension alone does not establish a file         |
| Explicit contradictory supported hint            | YES     | Explicit hint wins                              | Caller chooses grammar                            |
| .jsx arrow components                            | YES     | Real JS grammar preserved both functions        | Tested fixture                                    |
| .tsx arrow components                            | NO      | Structural empty result                         | B1                                                |
| .d.ts ambient function                           | NO      | Structural empty result                         | B2                                                |
| Empty content                                    | YES     | Structural empty-file header                    | Deliberate existing special case                  |
| Large full-content response                      | YES     | Leading metadata, partial-cut trailer and spool | Returned JSON may be partial, as the plan permits |
| Read/AST failure                                 | YES     | Distinct full-result reasons                    | Read failure need not reach parser                |

## Verification evidence and limitations

- Requested Nx run-many test/lint/typecheck for the two projects: all six targets passed, cache skipped, 64 seconds.
- Requested degradation-audit:lint: passed, 300 unsuppressed sites within baselines. Executor report records the relevant baselines as vscode-lm-tools 2 and workspace-intelligence 1; this review independently confirmed the audit succeeds.
- Scoped ptah_get_diagnostics: TypeScript compiler, zero errors/warnings.
- Runtime probes loaded the worktree TypeScript with transpileModule, using the actual TreeSitterParserService, AstAnalysisService, ContextEnrichmentService, namespace, dispatcher, request context and result-budget/reducer code. WASM came from this worktree's dist/apps/ptah-cli/wasm. DI/logging, unrelated dispatcher tools, token metrics and fixture reads were stubbed; budget tokenization remained real. No source or spec was edited.
- The complete namespace→service→parser→dispatcher path reproduced B1 and B2; the same JSX fixture preserved both exported functions.
- A real read of the 200,123-character batches.md went through service, namespace and dispatcher budget: returned text was 7,941 characters, beginning with mode/full and reason/unsupported-language; trailer said partial, cut mid-line and named the spool. A 24,000-character fallback fixture likewise retained both fields under the token limit. These flat envelopes have no table-shaped values or empty fields for json-compact to remove; the JSON reducer preserves insertion order (`json.reducer.ts:144`, :176), and the selected reducer ultimately reports none when no reduction shrinks them.
- ptah_search_files found no AGENTS.md. No task-description.md, implementation-plan.md or existing code-style-review.md was discovered for this task; context, approved batches, research and executor report supplied intent.
- No git operations or raw session-log reads were performed. Therefore an independent status/diff comparison and byte-identity check of unrelated prompt constants were not performed. The description review covers the named enrich-file definition, not approval of every unrelated tool description in that large file.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the two reproduced defects.
- Top risk: inferred TSX and declaration files silently lose their public API while claiming successful structural summaries.
- What a robust implementation would add: JSX-capable parsing, incomplete-tree refusal, ambient declaration support or safe full-content fallback, and real-parser regression tests for both fixtures.
