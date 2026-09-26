# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Verdict             | REVISE         |
| Blocking issues     | 2              |
| Serious issues      | 1              |
| Moderate issues     | 1              |
| Failure modes found | 4              |

Batch 7, independent post-cap review r3, 2026-09-26. Root: `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`.

The bounded correction fixes the exact previous export fixtures, literal corruption and quadratic renderer. It does not yet satisfy the core no-quality-loss contract: real runtime API members still disappear from successful structural results. Large wrapped/mixed initialisers can still consume the inline budget. The score remains below 5–6 because the two blocking findings are silent incorrect API answers, not merely coverage gaps. Passing scoped checks, safe parse fallbacks, preserved lexical slices and measured normal-file reductions distinguish this from the 1–2 band.

## r1 and r2 findings

“Not fixed” below means the failure class remains; the evidence column explicitly distinguishes the original reproduction from the new variant.

| Prior finding                                 | Status    | Independent reproduction / current evidence                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-B1: TSX components lost                    | fixed     | Exact App/Next fixture returns full/unsupported-language through namespace→service; explicit typescript returns full/parse-failed. Both names and original content survive. `analysis-namespace.builders.ts:120`; `context-enrichment.service.ts:169`. Structural TSX support remains a disclosed capability gap. |
| R1-B2: .d.ts / interfaces / type aliases lost | fixed     | greet/User/Id fixture returns exact full content with summary-not-smaller. The writer retains their declarations. `declaration-summary.ts:131`; `context-enrichment.service.ts:182`.                                                                                                                              |
| R2-B1: runtime/CommonJS exports bypass guard  | not fixed | All original conditional, defineProperty, bracket-module and direct-prototype fixtures now preserve API (small fixtures return full/summary-not-smaller). Aliases and module-load installation still bypass the guard: R3-B1. `declaration-summary.ts:98`, `:397`.                                                |
| R2-B2: template-literal whitespace changed    | fixed     | Original blank-line/whitespace-only-line banner is identical in structural output. CRLF/non-ASCII/emoji probe also passes. No global cleanup remains. `declaration-summary.ts:490`, `:496`.                                                                                                                       |
| R2-S1: huge initialisers crowd out API        | not fixed | Original direct 5,000-entry array/object fixtures now return 174-character summaries with tailApi. Wrapped literals and method-plus-data objects still reproduce inline starvation: R3-S1. `declaration-summary.ts:86`, `:409`.                                                                                   |
| R2-M1: quadratic rendering                    | fixed     | Shared monotonic cursor; 2k→32k render-min timings 1.31→23.73 ms. `declaration-summary.ts:478`, `:485`. Sorts remain; no quadratic cross-product reproduced.                                                                                                                                                      |

Paths abbreviated in that table are under `libs/backend/workspace-intelligence/src/context-analysis/`, except `analysis-namespace.builders.ts`, under `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`.

## Five logic questions

### 1. How does this fail silently?

An alias of exports can publish a member inside an elided function, and a large exported object can lose a callable property whose value references another function. Both return mode structural, no reason, and no public member name. R3-B1 and R3-B2 detail runtime-confirmed examples. Evidence: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:98`, `:409`, `:462`.

### 2. What user action produces unexpected behaviour?

Request enrichment without a language for the .cjs fixtures below: publicApi/publicMethod disappear although executing those modules publishes callable members. Request enrichment for a large `as const` + `satisfies` table or an object with a method and data: tailApi is absent from the returned inline budgeted text. Evidence: `analysis-namespace.builders.ts:155`; `declaration-summary.ts:86`, `:409`; `protocol-dispatcher.ts:1944` (latter two tool files under the paths identified above / mcp-core).

### 3. What input data produces a wrong answer?

Export aliases and reference-valued object members produce incomplete API answers. Separately, `'export function f() {' + ' '.repeat(350) + 'return 1; }'` returns a “reduction” of -114%: 14 original tokens become 30 summary tokens. Counts are truthful, but the no-savings branch compares characters before counting tokens. Evidence: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:182`, `:189`, `:198`.

### 4. What happens when a dependency fails?

Read rejection returns full/read-failed with empty content; parser Result.err and recovered syntax return original content with parse-failed; unsupported languages skip parsing. Existing real-parser specs and scoped tests passed. Evidence: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:122`, `:148`, `:157`, `:169`.

queryMulti deletes queries and its tree in finally (`libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:655`). No new resource leak was reproduced. Unexpected pipeline exceptions still become the namespace's broad read-failed envelope with an error comment (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:159`); this is not separately counted.

### 5. What is missing that the requirements never mentioned?

“Contains a function body” is not equivalent to “contains callable API,” and syntactic containment in an executable statement is not a reliable test of module-load execution. A const initializer executes when its declaration executes; a named installer invoked at top level also executes. Evidence: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:395`, `:409`. The token-saving contract also needs a token comparison, not only a character comparison (`context-enrichment.service.ts:182`).

## Failure modes

### R3-B1 — Export aliases and module-load API installation bypass refusal

- Trigger: publish API through an exports alias, destructuring, a top-level CJS this alias, globalThis, or a prototype inside a function that is called during module initialization.
- Symptom: successful structural result removes the public member entirely.
- Evidence: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:98` only recognizes literal exports/module access; `:381` elides named function bodies; `:397` preserves executed captures only inside the selected executable statement ranges; `:462` tests only captured references.
- Current handling: an exports reference in a retained alias declaration does not trigger refusal when the alias is used inside an elided body. Named installers are elided despite a subsequent top-level call. Initializer IIFEs are also elided.
- Recommendation: conservatively refuse when an export channel escapes through an alias or when an elided body can install externally visible members. Preserve or refuse module-load initializer calls and named installation paths that cannot be safely represented; do not assume declaration initializers are lazy.

Reproduction generator (padding makes the output beneficial in size, so the small-file fallback does not mask the bug):

```javascript
const padding = 'const padding = "' + 'x'.repeat(350) + '";';
const source = 'const e=exports; function install(){ e.publicApi = x => x; ' + padding + ' } install();';
```

Run source as a .cjs file. The actual namespace/service result is structural, 69→37 tokens, and contains only:

```javascript
const e=exports;
function install();
install();
```

The same isolated CommonJS runtime fixture publishes a function at exports.publicApi. Replacing the first declaration with `const { exports: e }=module;` or `const e=this;` also publishes a function and loses its name in the summary (73→41 and 68→36 tokens). Runtime verification used a CommonJS wrapper called with this=exports.

Further runtime-confirmed variants:

- `function install(){ globalThis.publicApi = x => x; /* padding */ } install();`: callable publicApi disappears (65→32 tokens).
- `class API {} function install(){ API.prototype.publicMethod = x => x; /* padding */ } install(); module.exports=API;`: callable exported prototype member disappears (73→40 tokens).
- `const api=(() => { globalThis.publicApi = x => x; /* padding */ return globalThis; })();`: initializer executes immediately, but the summary is `const api=(() => { … })();` (71→36 tokens).

These are one failure class: API publication hidden inside an elided body without a recognized export reference. They are not separately charged.

**Judgment on documented limits:** globalThis/prototype elision is a real silent API loss, not an acceptable explicit limitation under the current contract. The report documents it, but the caller receives no limitation or fallback reason. The demonstrated functions actually execute during loading. The initializer exception is also based on an incorrect execution assumption. Decision 4 permits accurate per-tool descriptions; it does not waive the core quality requirement (`.ptah/specs/TASK_2026_559_8ca9/context.md:4`, `:24`). A conservative full-content fallback would be acceptable.

### R3-B2 — Large object elision removes callable members stored by reference

- Trigger: an exported object exceeds 400 characters and stores methods as references/shorthand rather than inline function bodies.
- Symptom: the summary replaces the whole object with { … }, removing its callable member names and their relation to the implementation functions.
- Evidence: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:405`, `:409`, `:411`; whole-object replacement at `:221`.
- Current handling: only an actual body inside the literal protects it from wholesale elision. Function-valued identifiers, spreads and computed member keys do not.
- Recommendation: preserve property keys and callable/reference relationships while eliding individual bulky values; refuse when the shape cannot be preserved, including unresolved spread/computed shapes.

Reproduction:

```javascript
const source = 'function externalFn(x) { return x; }\n' + 'const api={ publicMethod: externalFn, payload:"' + 'x'.repeat(450) + '" };\n' + 'module.exports=api;';
```

Real runtime: `typeof module.exports.publicMethod === 'function'`.
Real service: structural, 85→42 tokens, no reason:

```javascript
function externalFn(x);
const api={ … };
module.exports=api;
```

publicMethod is absent everywhere. An ESM exported object and an object containing `...otherApi` plus a computed public key also collapse. This is API shape loss, not merely omission of a long string value.

### R3-S1 — Wrapped literals and objects mixing methods with data still starve the inline API

- Trigger: 5,000 payload strings under multiple expression wrappers, or inside an object that also contains a method, followed by an ordinary implementation body and tailApi.
- Symptom: structural output remains approximately 69 KB / 19,000 tokens; the actual budget layer cuts before tailApi.
- Evidence: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:86` only matches one wrapper; `:409` exempts the entire containing literal if any body occurs inside it. The service accepts any character saving at `context-enrichment.service.ts:182`.
- Current handling: whole object retention protects method signatures but also retains its huge nested data; nested property values are not independently captured. Two wrappers bypass literal detection altogether.
- Recommendation: walk initializer wrappers and retain object member structure while independently eliding large nested payloads. If safe structural representation cannot be provided, return an honest fallback rather than a nominal structural reduction dominated by data.

Exact generators:

```javascript
const payloads = Array.from({ length: 5000 }, (_, i) => '"payload' + i + '"');
const literalA = '([' + payloads.join(',') + '] as const) satisfies readonly string[]';
const literalB = '{ method(x) { return x; }, data: [' + payloads.join(',') + ']}';
const padding = 'const padding = "' + 'x'.repeat(350) + '";';
// For each literal:
const source = 'export const data = ' + literal + ';\n' + 'function work(input) { ' + padding + ' return input; }\n' + 'export function tailApi(x: number): number { return x+1; }';
```

| Fixture                            | Source tokens | Summary tokens | Summary chars | tailApi offset |
| ---------------------------------- | ------------: | -------------: | ------------: | -------------: |
| as const + parentheses + satisfies |        19,088 |         19,053 |        69,121 |         69,093 |
| Method plus nested data array      |        19,092 |         19,055 |        69,108 |         69,080 |

Both actual applyToolResultBudget calls returned 7,941 characters, truncated=true, reducer=none, and no inline tailApi. Their trailers truthfully said partial/cut mid-line; in-memory intercepted spool payloads equaled the entire JSON result byte-for-byte and retained tailApi. This is a summary-quality/budget-efficiency defect, not silent loss at the budget layer.

Without the extra ordinary function body these cases correctly fall back to summary-not-smaller. That safe fallback is not itself a finding.

### R3-M1 — Character savings can increase token cost

- Trigger: a valid function with 350 spaces before return.
- Symptom: mode structural, 14→30 tokens, reductionPercentage=-114.
- Evidence: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:182`, `:189`, `:194`.
- Current handling: the character gate passes; token counts are computed afterward but never compared.
- Recommendation: use the already-computed counts to return full/summary-not-smaller whenever summaryTokens >= originalTokens. Preserve the character gate as an early rejection if useful.
- Severity: Moderate, because the reproduced input is an unusual formatting edge and the metrics expose the increase rather than hiding it.

## Blocking issues

### R3-B1 — Missing runtime-published API

- File: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:98`.
- Scenario: alias/destructuring/CJS-this or global/prototype installation in an elided body executed at load.
- Impact: an agent receives a success-looking API summary without a real callable export and may make incorrect edits or usage decisions.
- Fix: conservative escape/publication detection and correct load-time handling or full-content refusal.

### R3-B2 — Missing referenced object methods

- File: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:409`.
- Scenario: a large exported object stores a public method by reference.
- Impact: callable member names and object API relationships disappear from the API view.
- Fix: preserve keys and reference-valued member signatures, or refuse.

## Serious issues

### R3-S1 — Implementation payload consumes the API tool's inline budget

- File: `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:86`.
- Scenario: multiply wrapped initializers or method-plus-data objects.
- Impact: users must fetch the spool to find later API declarations; almost no token saving is achieved.
- Fix: recursive wrapper handling and member-aware nested payload elision.

## Moderate and minor issues

- R3-M1: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:182` checks characters rather than tokens; use both computed counts.
- No additional minor issue counted. Safe grammar refusals and deliberate TSX fallback are recorded as limitations, not new defects.

## Data flow

1. Dispatcher requires a nonblank file and forwards language — OK (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1939`).
2. Namespace resolves path and supported hint / last-extension inference — OK; TSX safely refused (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:112`, `:151`).
3. Service reads once or takes supplied content; distinct fallbacks — OK (`libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts:117`, `:148`).
4. queryMulti produces captures from one parse, then releases its resources — OK for tested grammars (`libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts:610`, `:655`).
5. Statement classification and body/export guard — R3-B1 (`libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:266`, `:294`, `:397`).
6. Literal span selection — R3-B2 / R3-S1 (`declaration-summary.ts:405` in the same directory).
7. Rendering uses source slices and shared cursor — original R2-B2/M1 fixed (`declaration-summary.ts:478`, `:490`).
8. Character savings gate then token counting — R3-M1 (`context-enrichment.service.ts:182`, `:189` in the same directory).
9. Metadata precedes content; actual result budget preserves metadata and identifies partial/spooled output — OK in probes (`context-enrichment.service.ts:194`, `:214`; `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts:210`).
10. Context optimizer can also consume this content as a structural override, so missing API is not restricted to MCP (`libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts:314`, `:332`). It charges reported token counts before selection; no budget bypass found.

## Requirements fulfilment

| Requirement                                                  | Status   | Gap                                                                                                          |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| Explicit supported language wins; module-extension inference | COMPLETE | Namespace specs and real probes agree                                                                        |
| Original TSX structural acceptance                           | PARTIAL  | Safe full fallback, not structural support; batches.md:1639                                                  |
| Ambient declarations/interfaces/types survive                | COMPLETE | Full original or retained writer declarations                                                                |
| Every API preserved, or full with reason                     | PARTIAL  | R3-B1/B2                                                                                                     |
| Retained lexical slices remain faithful                      | COMPLETE | Tested templates, blank lines, CRLF, BOM-adjacent text and UTF-16 characters                                 |
| Huge initializers do not displace API                        | PARTIAL  | Direct originals fixed; R3-S1                                                                                |
| Scalable renderer                                            | COMPLETE | Monotonic cursor; measured scaling                                                                           |
| No token increase from structural summary                    | PARTIAL  | R3-M1                                                                                                        |
| Normal files save tokens                                     | COMPLETE | Measurements below                                                                                           |
| Fixed degradation logs and baseline audit                    | COMPLETE | Scoped tests and audit passed                                                                                |
| Truthful per-tool description / Decision 4                   | PARTIAL  | Inference/reasons/literal omission accurately stated; “complete, smaller” guarantee contradicted by findings |

Implicit requirements not addressed: alias-aware publication, object API shape distinct from implementation data, and token-level no-savings fallback.

The deviation to retain all executable top-level statements is a sensible conservative improvement at `declaration-summary.ts:274`; it fixes the prior statement-dropping error. It is not proof that nested bodies can be elided safely. The description at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1632` still overpromises completeness. No additional description-only finding is counted.

## Edge cases

| Case                                                         | Handled                  | How                                                      | Concern                                                                                      |
| ------------------------------------------------------------ | ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Exact R1 TSX fixture                                         | YES                      | Full/unsupported-language, explicit TS full/parse-failed | No structural TSX capability                                                                 |
| .d.ts, interfaces, types                                     | YES                      | Full/summary-not-smaller                                 | No API loss                                                                                  |
| Blank-line template literal                                  | YES                      | Exact retained text                                      | Tested through service                                                                       |
| CRLF, BOM, accented/CJK names, emoji                         | YES                      | UTF-16 offsets aligned                                   | BOM/interstatement separators are not retained statement slices; no lexical corruption found |
| Decorated class/arrow field, getter, overloads               | YES                      | Names/decorators/signatures retained                     | One grammar-rejected decorator variant safely returned full                                  |
| Static blocks/direct IIFE/direct callback statement          | YES                      | Source bodies preserved                                  | Tested structural results                                                                    |
| IIFE in const initializer                                    | NO                       | Body elided                                              | R3-B1                                                                                        |
| Direct exports reference inside elided body                  | YES                      | unsupported-declarations                                 | Real refusal probe                                                                           |
| Alias/destructuring/CJS top-level this                       | NO                       | Reference outside span does not protect alias use        | R3-B1                                                                                        |
| globalThis/prototype installer                               | NO                       | Installation body elided                                 | R3-B1; runtime-confirmed                                                                     |
| Large object with referenced functions, spread, computed key | NO                       | Whole literal replaced                                   | R3-B2                                                                                        |
| Direct huge array/object/string; single as const wrapper     | YES                      | Explicit value elision                                   | Original regressions pass                                                                    |
| Multiple wrappers / methods with nested bulk                 | NO                       | Bulk survives                                            | R3-S1                                                                                        |
| Empty file                                                   | YES as existing contract | Structural empty-file header                             | Existing special case can exceed original size; not separately counted                       |
| Many declarations                                            | YES                      | Shared cursor plus sorts                                 | 32k probe below                                                                              |
| Whitespace-heavy small body                                  | NO                       | Character-only gate                                      | R3-M1                                                                                        |

## Verification evidence and limits

- Required `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`: all six targets passed, 51.0 seconds. No EACCES failure.
- Required `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache`: passed, 10.8 seconds, 300 unsuppressed sites. Baselines remain 2 and 1 in `tools/degradation-audit/baseline.json:35` and `:36`. No baseline changes made by this reviewer.
- Scoped ptah_get_diagnostics: typescript-compiler, zero errors/warnings.
- Changed degradation branches use fixed text or the closed summary-kind union (`context-enrichment.service.ts:124`, `:150`, `:159`, `:171`, `:177`, `:184`). The unchanged empty-file debug message contains the path; not counted as a new degradation failure.
- In-memory probes transpiled this worktree's actual parser, summary writer, service and namespace. Tree-sitter loaded installed WASM grammars. Decorators, logging, Result/platform boundaries and fixture filesystem reads were shimmed; the namespace map shim mirrored the known extension map. Token counts used installed gpt-tokenizer. No source/spec/probe file was written.
- Runtime verification of public members executed only constructed fixtures in isolated Node VM contexts, with a CommonJS wrapper for exports/this behavior.
- Large-output probes ran the actual tool-result budget and reducers against JSON.stringify(namespaceResult), matching the dispatcher call at protocol-dispatcher.ts:1944. Filesystem spool operations were intercepted in memory. No spool files were written. A full live MCP transport was not launched in this round.
- ptah_search_files found no AGENTS.md; native discovery found no AGENTS.md/CLAUDE.md. No task-description.md, implementation-plan.md or code-style-review.md exists in this task folder. Context, Batch 7, both prior reviews and all executor-report sections supplied intent.
- No git operations were performed under the reviewer role restriction. Therefore independent git status/diff inventory and byte-comparison of shared prompt constants were not performed. Scope follows the six named source/spec files; unrelated tool descriptions are not given a separate approval.
- No raw .jsonl/.sqlite session logs were read. Only code-logic-review.md was intentionally written.
- Host boot, concurrency stress and transport lifecycle are outside this scoped run. No additional defect is inferred from their absence.

Normal-file results (real namespace/service/parser + gpt-tokenizer; summary header included; displayed path affects a few tokens):

| File under workspace-intelligence/src              | Original tokens | Summary tokens | Reduction |
| -------------------------------------------------- | --------------: | -------------: | --------: |
| context-analysis/context-enrichment.service.ts     |           2,406 |          1,282 |       47% |
| context-analysis/context-size-optimizer.service.ts |           3,397 |          1,438 |       58% |
| ast/tree-sitter-parser.service.ts                  |           6,683 |          2,403 |       64% |

Scaling, real queryMulti captures, render minimum of four runs (parse excluded):

| Functions | Parse/query ms | Render ms |
| --------: | -------------: | --------: |
|     2,000 |            186 |      1.31 |
|     4,000 |            348 |      2.33 |
|     8,000 |            635 |      4.12 |
|    16,000 |          1,289 |      9.87 |
|    32,000 |          2,479 |     23.73 |

Timing is machine-dependent; the monotonic cursor is the algorithmic evidence. These measurements support removal of the previous quadratic renderer, not a hard latency guarantee.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for all four reproduced failure modes.
- Top risk: successful structural output silently omits callable public members even when they exist immediately after module initialization.
- What a robust implementation would add: conservative alias/publication refusal; correct initializer execution treatment; property-aware object summaries with nested payload elision; recursive wrapper handling; and a token-count savings gate, with real-parser regression cases for each.
