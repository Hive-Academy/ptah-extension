# Code Logic Review — TASK_2026_559_8ca9

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 1              |
| Moderate issues     | 1              |
| Failure modes found | 4              |

**Batch 7, round 2: REVISE.** Both round-one reproductions are fixed. However, the new completeness guard still accepts summaries that omit real JavaScript exports, and the renderer changes retained string values. Large initialisers also defeat the token-saving purpose. These reproduced silent wrong answers place the work below the 5–6 band; successful ordinary TypeScript reductions, conservative parse fallbacks and passing verification keep it above the foundational-failure band.

All paths below are relative to D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract. Review date: 2026-09-26. Only this review document was intentionally written; source and specs were not edited.

## Round-one findings

| Finding                                                      | Status | Reproduction and evidence                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1: inferred TSX arrow components disappear                  | FIXED  | The exact App/Next fixture now traverses the real namespace/service/dispatcher and returns full content with unsupported-language. Explicit typescript returns full/parse-failed; JSX returns structural with both names. analysis-namespace.builders.ts:120 excludes inferred TSX; context-enrichment.service.ts:164 rejects recovered parses. |
| B2: ambient functions, interfaces and type aliases disappear | FIXED  | Real .d.ts fixture with greet, User and Id returns structural with all three complete declarations, through the dispatcher. declaration-summary.ts:65 includes declaration kinds and export wrappers; :174 guards truly empty declaration sets.                                                                                                 |

The .tsx change closes silent data loss by refusing to summarise. It does not implement the original structural-TSX acceptance case in batches.md:1639. This is an explicit, safe capability limitation recorded in the revision report and requested round-two scope, not an additional reproduced defect.

## Five logic questions

### 1. How does this fail silently?

The writer classifies conditional statements and most expression statements as non-declarations without checking whether they publish API. A file with an ordinary const and a conditional CommonJS export returns structural content containing only the const, with no reason (declaration-summary.ts:90, :161, :196). See R2-B1.

The final whitespace replacement operates inside retained template literals. It changes a two-newline string into a one-newline string while presenting it as source text (declaration-summary.ts:287). See R2-B2.

### 2. What user action produces unexpected behaviour?

Call ptah_context_enrich_file with a .cjs file containing a conditional export, Object.defineProperty export, or bracket-form module['exports'] assignment: the public name disappears. Call it on a constants file containing a large array/object initializer: nearly all implementation data remains and a later API declaration is cut out of the inline MCP response (declaration-summary.ts:43, :285; protocol-dispatcher.ts:1944). See R2-B1/R2-S1.

### 3. What input data produces a wrong answer?

A retained exported template literal containing a blank line. The source value is "first\n\nlast"; the returned declaration's value is "first\nlast". The actual dispatcher response is structural with no reason. The multiline literal is valid TypeScript, with no parser error (declaration-summary.ts:287).

Computed CommonJS exports and conditional exports produce incomplete API answers rather than errors (declaration-summary.ts:114, :196). Non-ASCII names, emoji, BOM and CRLF did not reproduce an offset error; their names and signatures survived (offset resolver at :220).

### 4. What happens when a dependency fails?

Read rejection returns full/read-failed with empty content (context-enrichment.service.ts:115). A parser Result.err or recovered parse returns the original content with parse-failed (:152, :164). Unsupported language skips parsing and returns the original content (:143). The real-parser specs cover these cases; all scoped tests passed.

queryMulti releases its queries and tree in finally (tree-sitter-parser.service.ts:655); reusable parsers are disposed by the service's existing lifecycle (:892). No new per-call resource leak was found. Unexpected throws still reach the namespace's broad read-failed catch (analysis-namespace.builders.ts:159), an existing broad classification; no independent probable failure was reproduced and it is not counted.

### 5. What is missing that the requirements never mentioned?

The classification needs to distinguish side effects that build API from safely discardable statements, not merely recognise top-level syntax kinds (declaration-summary.ts:90). Retained lexical text must be immutable outside the exact elision spans (:287). Rendering needs a monotonic body cursor instead of a declaration/body cross-product (:178, :273). These are requirements implied by truthful summaries and bounded runtime cost.

## Failure modes

### R2-B1 — Export-producing statements bypass the completeness guard

- Trigger: Summarise any of the valid JavaScript fixtures below with a .cjs extension.
- Symptom: structural success with no reason and no publicApi name.
- Evidence: libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:90, :114, :161, :196.
- Current handling: if statements are unconditionally discarded. Expression statements survive only when the first expression is an assignment and its target text starts with module.exports or exports. A surviving unrelated declaration prevents the no-declarations fallback.
- Recommendation: preserve recognised export-producing statements, including bracket access, and conservatively return unsupported-declarations when executable statements may publish API but cannot be represented. Do not evaluate conditionals or assume calls cannot export.

Literal reproductions, each run independently through real parser → service → namespace → dispatcher:

```javascript
const ready = true;
if (ready) {
  exports.publicApi = function publicApi(x) {
    return x;
  };
}
```

```javascript
const ready = true;
Object.defineProperty(exports, 'publicApi', {
  value: function publicApi(x) {
    return x;
  },
});
```

```javascript
const ready = true;
module['exports'].publicApi = function publicApi(x) {
  return x;
};
```

All three return a header followed only by "const ready = true;". This is not a budget cut: the entire response is small, has no partial trailer, and claims structural success. A related real reproduction, "export class API {}" followed by "API.prototype.publicMethod = function (x) { return x; };", likewise drops publicMethod. These are grouped under one classifier failure.

### R2-B2 — Blank-line cleanup corrupts retained template-literal values

- Trigger: An exported template literal contains an empty or whitespace-only line.
- Symptom: The summary shows a different constant value.
- Evidence: libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:287.
- Current handling: the global newline/whitespace regex is applied to the complete reconstructed declaration, including untouched literal contents.
- Recommendation: remove that global cleanup, or restrict it to whitespace introduced by a known removed span. Preserve all retained source slices exactly.

Reproduction: declare banner using a backtick literal containing first, a blank line, then last; follow it with "export function f() { return 1; }". The input constant contains two LF characters between the words. The actual MCP result contains only one, mode structural, no reason. Original/summary counts were 19/35 tokens; this is semantic mutation, independent of the small-file header overhead.

### R2-S1 — Large initialisers survive as implementation data and crowd out API

- Trigger: A top-level exported const contains 5,000 payload strings in an array or 5,000 object properties, followed by a small exported function.
- Symptom: structural output is larger than the source; the inline MCP response consists mostly of literal payload and omits the trailing function.
- Evidence: libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:43 captures only function-like bodies/static blocks; :285 copies every remaining initializer verbatim. context-enrichment.service.ts:183 accepts the result without checking whether it saves tokens. tool-description.builder.ts:1632 promises a large reduction and API-oriented output.
- Current handling: no bound or abstraction applies to object/array/string initialisers. An explicit partial trailer and spool preserve recoverability at the later budget layer; this is not counted as silent budget-layer loss.
- Recommendation: represent initialisers structurally with types/property names and explicit elision of implementation values; if that cannot preserve API, return full with an honest reason. Add a non-beneficial-summary guard so headers cannot make a supposed reduction larger. Keep exported names ahead of bulky values.

Measured with installed gpt-tokenizer, using the actual service:

| Fixture                                                                       | Original tokens | Summary tokens | Summary characters |
| ----------------------------------------------------------------------------- | --------------: | -------------: | -----------------: |
| export const data = ["payload0", ..., "payload4999"]; plus tailApi            |          19,015 |         19,034 |             69,028 |
| export const data = {k0: "payload0", ..., k4999: "payload4999"}; plus tailApi |          43,015 |         43,034 |            102,919 |

The actual dispatcher/budget/reducer path returned 7,941 characters for the array case, beginning with mode structural, and cut around payload510. tailApi was absent inline but present in the captured spool payload. The trailer correctly said partial/cut mid-line. Spool writes were intercepted in memory for this probe; no probe spool file was created.

### R2-M1 — Rendering is quadratic in declarations and bodies

- Trigger: A large generated file containing many exported functions.
- Symptom: synchronous rendering stalls the host disproportionately as file size grows, before token counting or result budgeting can help.
- Evidence: libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:178 calls renderDeclaration for every declaration; :273 scans the complete bodies array each time, including all bodies before and after that declaration.
- Current handling: D declarations × B bodies comparisons, even though body ranges are already sorted.
- Recommendation: walk sorted declarations and bodies with a shared cursor, or index the relevant body interval per declaration. Avoid repeated scans of unrelated bodies.

Real queryMulti captures were used; render-only timings exclude parsing, grammar initialisation and tokenisation:

| Exported functions | Source characters | Parse/query ms | Render ms |
| ------------------ | ----------------: | -------------: | --------: |
| 2,000              |            79,779 |             92 |        14 |
| 4,000              |           161,779 |            158 |        43 |
| 8,000              |           325,779 |            368 |       149 |
| 16,000             |           665,779 |            639 |       887 |
| 32,000             |         1,353,779 |          1,359 |     2,093 |

First four render measurements are means of three renders; final row is one render in a separate process. Timing is machine-dependent, but the D×B loop is deterministic evidence of non-linear cost. Moderate because the largest cases are unusual generated files, rather than ordinary services.

## Blocking issues

### R2-B1 — Missing runtime exports presented as a complete API

- File: libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:161.
- Scenario: the CommonJS fixtures above.
- Impact: an agent can incorrectly conclude that publicApi is absent and make wrong edits/import decisions.
- Fix: conservative export-aware classification or full-content refusal, with real-parser regressions for conditional, computed and defineProperty exports.

### R2-B2 — Retained literal source is changed

- File: libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:287.
- Scenario: a multiline template constant includes a blank line.
- Impact: an agent receives a false literal value while being told the declaration was preserved.
- Fix: preserve lexical slices outside explicitly elided spans; add a literal byte-preservation regression.

## Serious issues

### R2-S1 — Structural output remains dominated by huge initialisers

- File: libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts:285.
- Scenario: large array/object constants preceding public functions.
- Impact: the API tool spends its entire inline budget on implementation payload; callers must perform another read to discover the remaining API.
- Fix: structural initializer handling plus an honest no-savings fallback, as above.

## Moderate and minor issues

- R2-M1: declaration-summary.ts:178 / :273 performs D×B range comparisons. Replace with a sorted sweep.
- No additional minor finding counted. Small-file negative reductions are disclosed by metrics and grouped with R2-S1, not charged separately.
- The description's phrase "whole content" includes read-failed, but that branch necessarily has no content (context-enrichment.service.ts:121). Clarify the exception while fixing the API/reduction promises; no separate severity count.

## Data flow

1. Dispatcher checks a nonblank file string, then calls context.enrichFile — OK (libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1939).
2. Namespace resolves the workspace path and explicit/inferred language — OK, with disclosed TSX refusal (analysis-namespace.builders.ts:112, :155).
3. Service reads once or uses pre-read content, classifies unsupported languages and read failures — OK (context-enrichment.service.ts:111, :143).
4. One queryMulti parse captures errors, statements and bodies — OK for tested syntax; queries/tree are released (context-enrichment.service.ts:149; tree-sitter-parser.service.ts:655).
5. Statement coverage guard — R2-B1: recognises syntax but can discard export-producing behaviour (declaration-summary.ts:158).
6. Body elision and reconstruction — R2-B2 changes literals; R2-S1 retains huge initialisers; R2-M1 rescans every body (:178, :273, :285, :287).
7. Count tokens and return mode structural — accurate counts, but no savings criterion (context-enrichment.service.ts:178).
8. Serialize metadata before content and apply budget — OK; the giant case retains mode and honest partial/spool trailer (protocol-dispatcher.ts:1947, :2348).

## DI and optimiser blast radius

LSP references were requested, but the provider returned paths in the main checkout rather than this worktree. Worktree-local rg references therefore supplied the authoritative caller inventory. The only production calls to generateStructuralSummary are the analysis namespace (analysis-namespace.builders.ts:155) and ContextSizeOptimizerService (context-size-optimizer.service.ts:314). PtahAPIBuilderService injects it at :348 and passes it into analysisDeps at :550, then builds the namespace at :596. Other matches are registration, types, exports and tests.

The shared workspace-intelligence registration provides TREE_SITTER_PARSER_SERVICE at libs/backend/workspace-intelligence/src/di/register.ts:172, resolves it for architecture rules at :182, then registers ContextEnrichmentService at :187. All three hosts call this registration:

- VS Code: apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:76.
- Electron: apps/ptah-electron/src/di/phase-2-libraries.ts:173.
- CLI: libs/backend/cli-engine/src/lib/container.ts:620.

No missing registration was found. Host processes were not launched; this is source-level wiring verification plus the scoped typecheck/test evidence, not a claim that three full boots were exercised.

Python/Go/C# now return full/unsupported-language without parsing (context-enrichment.service.ts:143). The optimiser charges summary.tokenCount before selection and uses mode full without a content override (context-size-optimizer.service.ts:319, :322, :329). A real optimiser probe with a 100-token budget, a 10-token top file and three oversized unsupported-language files selected only the top file, reported 10 used/90 remaining and excluded the others. Thus the change reduces how many files fit but does not bypass the budget. Direct service probes preserved original content for all three languages. No additional budget-overrun finding is supported.

## Requirements fulfilment

| Requirement                                           | Status   | Gap                                                             |
| ----------------------------------------------------- | -------- | --------------------------------------------------------------- |
| Explicit supported hint and extension inference       | COMPLETE | TSX safely refused as disclosed; language override retained     |
| Original TSX structural acceptance                    | PARTIAL  | Full fallback instead; packaged TSX grammar remains unavailable |
| Ambient functions/interfaces/type aliases             | COMPLETE | R1 B2 real-path reproduction now retains all names              |
| Every exported name survives, or full with reason     | PARTIAL  | R2-B1                                                           |
| Retained source text remains truthful                 | PARTIAL  | R2-B2                                                           |
| Large implementation content omitted                  | PARTIAL  | R2-S1                                                           |
| Linear large-file rendering                           | MISSING  | R2-M1                                                           |
| Distinct full-result reasons, metadata before content | COMPLETE | Verified service and dispatcher results                         |
| Normal repo files save tokens                         | COMPLETE | Three measurements below                                        |
| DI change resolves in host registration graphs        | COMPLETE | Shared registration used by all three hosts                     |
| Unsupported languages respect optimiser budget        | COMPLETE | Charged at full token count and excluded when too large         |
| Fixed degradation logs and baseline audit             | COMPLETE | Scoped tests and audit pass; no new baseline allowance found    |
| Truthful tool description                             | PARTIAL  | Completeness/large-reduction promise fails the reproduced cases |

Implicit requirements not addressed: lexical preservation of retained literals, conservative recognition of runtime API construction, and bounded renderer traversal.

Measured ordinary files, using real parser/service plus gpt-tokenizer:

| File under libs/backend/workspace-intelligence/src | Original tokens | Summary tokens | Reduction |
| -------------------------------------------------- | --------------: | -------------: | --------: |
| context-analysis/context-enrichment.service.ts     |           2,243 |          1,187 |       47% |
| context-analysis/context-size-optimizer.service.ts |           3,397 |          1,441 |       58% |
| ast/tree-sitter-parser.service.ts                  |           6,683 |          2,393 |       64% |

## Edge cases

| Case                                                         | Handled                        | How                                                               | Concern                                  |
| ------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------- |
| Decorators; class arrow fields; getters/setters              | YES                            | Names, decorators and signatures retained; function bodies elided | No loss reproduced                       |
| Generic signatures containing arrow types and brace comments | YES                            | Parse spans rather than text splitting                            | No loss reproduced                       |
| Braces in strings/template interpolations                    | YES                            | Correct span boundaries                                           | Blank-line literal case separately fails |
| Template literal with blank line                             | NO                             | Global cleanup changes contents                                   | R2-B2                                    |
| Overloads plus implementation                                | YES                            | Overloads and implementation signature retained                   | No loss reproduced                       |
| Abstract members                                             | YES                            | Abstract signatures retained                                      | No loss reproduced                       |
| Re-export alias/from; export namespace                       | YES                            | Export statement source retained                                  | No loss reproduced                       |
| declare global                                               | YES                            | Ambient wrapper and members retained                              | No loss reproduced                       |
| Multi-declarator const with arrow                            | YES                            | All names retained; arrow body elided                             | No loss reproduced                       |
| CRLF, BOM, accented/CJK names, emoji before body             | YES                            | UTF-16 points aligned with source slices                          | No offset defect reproduced              |
| CommonJS conditional/computed/defineProperty exports         | NO                             | Export-producing statements discarded                             | R2-B1                                    |
| Giant object/array initializer                               | NO                             | Values copied verbatim                                            | R2-S1                                    |
| Many top-level function declarations                         | NO                             | Full body scan for each declaration                               | R2-M1                                    |
| Empty, import-only, invalid parse                            | YES                            | Empty header or explicit full fallback                            | Covered by passing real-parser specs     |
| Concurrent/repeated parser use                               | YES within inspected lifecycle | Initialisation promise guard; per-call trees released             | No full host concurrency stress run      |

## Verification evidence and limitations

- Required command: node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache. All six targets passed; 53.0 seconds. No real-port failure occurred.
- Required degradation-audit:lint with cache skipped passed; 3.7 seconds. tools/degradation-audit/baseline.json:35 and :36 remain 2 for vscode-lm-tools and 1 for workspace-intelligence. No baseline file was modified by this review.
- Scoped ptah_get_diagnostics reported typescript-compiler, zero errors and zero warnings.
- No AGENTS.md was found by ptah_search_files. This task folder has no task-description.md, implementation-plan.md or code-style-review.md; context.md, batches.md Batch 7 and the executor report supplied the contract.
- Runtime probes transpiled the actual worktree TypeScript in memory. TreeSitterParserService, summary writer, ContextEnrichmentService, namespace, dispatcher, request context, budget and reducers were real. WASM came from dist/apps/ptah-cli/wasm. Decorator/logging/platform dependencies and unrelated dispatcher tools were shimmed; fixture reads were in memory. Token counts used installed gpt-tokenizer. Large-output spool writes were intercepted in memory.
- Both round-one fixtures and the new silent failures were verified through the real MCP dispatcher, not only by calling the pure renderer. The giant-data case also exercised the actual budget/reducer path.
- No git operations were performed under the reviewer role constraint. Consequently no independent status/diff inventory or byte-comparison of shared prompt constants is claimed. The supplied six-file scope was reviewed; findings cite current worktree lines. No raw .jsonl/.sqlite session logs were read.
- The revised degradation branches log fixed text or a closed summary-kind enum (context-enrichment.service.ts:119, :145, :154, :166, :172). The unchanged empty-file debug line still contains a path (:126); it is not a new degradation-log finding.
- Timing probes are evidence of algorithmic growth, not stable performance thresholds. Full VS Code/Electron/CLI boots and live transport integration were outside this scoped execution.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for all four reproduced failure modes.
- Top risk: a small, successful structural response can omit a real public export or invent a different literal value, with no reason or partial-output warning.
- What a robust implementation would add: conservative export-aware refusal, literal-preserving reconstruction, bounded initializer summaries with a no-savings guard, a monotonic range sweep, and real-parser/dispatcher regressions for these exact fixtures.
