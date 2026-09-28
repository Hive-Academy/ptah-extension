# Batch 7 executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent). Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. No git operations were run.

## Tasks completed

### Task 7.1 — Extension→language inference in `enrichFile` — COMPLETE

- `analysis-namespace.builders.ts`: new `resolveEnrichLanguage(resolvedPath, language)`.
  - An explicit `typescript` or `javascript` value wins, even when it contradicts the extension. This is today's behaviour.
  - Otherwise the language comes from `path.extname(...).toLowerCase()` through `EXTENSION_LANGUAGE_MAP`. The map is imported from the `@ptah-extension/workspace-intelligence` public barrel, which already exports it. `code-outliner.adapter.ts` and `ast-namespace.builder.ts` import it the same way. The barrel file was not changed.
  - The map has no `.mts/.cts/.mjs/.cjs` entries. A four-entry local `MODULE_EXTENSION_BASE` maps each of them onto `.ts` or `.js` before the lookup.
  - Only `typescript` and `javascript` are forwarded, because the service's `.d.ts` formatter can only render those. `.py/.go/.cs`, files without an extension, and dotfiles get `undefined`. The service then answers with `reason: 'unsupported-language'`.
- The `enrichFile` catch path (no workspace root for a relative path, or a throw inside the pipeline) now returns `reason: 'read-failed'`, with `content` as the last key.
- `tool-description.builder.ts` (`ptah_context_enrich_file`):
  - `language` now reads: "Optional; inferred from the file extension when omitted (.ts/.tsx/.mts/.cts → typescript, .js/.jsx/.mjs/.cjs → javascript). An explicit value overrides the extension."
  - The tool description now says the summary covers TS/JS only, and that other files return `mode 'full'` with a `reason`.
  - Only this per-tool description was changed, as Decision 4 allows. The shared prompt constants (`ptah-system-prompt.constant.ts`, `ptah-core-prompt.ts`) are unchanged.
- Spec `analysis-namespace.builders.spec.ts`:
  - It gets a `jest.mock('@ptah-extension/workspace-intelligence')` holding the map's real entries, following the pattern in `ast-namespace.builder.spec.ts`.
  - Inference table: `.ts .tsx .mts .cts .js .jsx .mjs .cjs .spec.ts .D.TS .TSX .MJS`.
  - Cases that must return undefined: `.py .go .cs README.md Makefile .eslintrc src/dir.ts/Dockerfile`.
  - An explicit value that contradicts the extension is forwarded unchanged (`.ts`+javascript, `.py`+typescript).
  - An unsupported explicit value (`tsx`) falls back to inference.
  - End to end: `.ts` with no language → structural; `.tsx` → structural; `.py` → full with `unsupported-language`.
  - `read-failed` is checked on the catch path and on the no-workspace-root path.
  - The existing absolute-path test now expects `'typescript'` instead of `undefined`, which is the fix itself.

### Task 7.2 — `reason` on full-content fallbacks — COMPLETE

- `context-enrichment.service.ts`:
  - `StructuralSummaryResult` gains `reason?: 'unsupported-language' | 'parse-failed' | 'read-failed'`, with a doc comment for each value.
  - `createFullContentResult(content, reason, precomputed?)` now requires a reason, so the type system rejects a `mode:'full'` result without one.
  - How each fallback maps to a reason:
    - A read error → `read-failed`, with content `''`.
    - No language → `unsupported-language`, and no parse is attempted.
    - `analyzeSource` returns an error → `parse-failed`.
  - Structural results carry no reason.
  - The three log lines on these branches are now fixed text. They no longer include the file path or the raw error message.
- The new `context-enrichment.service.spec.ts` (8 tests) covers each branch with a mocked file system, AST service and token counter. It checks:
  - a structural result has no `reason`;
  - `unsupported-language`, `parse-failed` and `read-failed` each appear on the right branch;
  - pre-read content is used as given;
  - an empty file returns a structural header with no reason;
  - the three reasons are pairwise distinct;
  - the logs contain no path or raw error message;
  - key order is `mode` first and `content` last.

## How the reason reaches the MCP tool output

`protocol-dispatcher.ts:1939-1950` sends `JSON.stringify(result)` through `createToolSuccessResponse` → `budgetToolText` → `applyToolResultBudget`, so any field on the result reaches the agent. There was one gap. A full-content fallback is exactly the large case, and over the 8,000-char budget the JSON reducer keeps key order and the cut drops the tail. With `content` as the first key, `mode` and `reason` would have been cut off.

Every result is now built with `mode` first, `reason` next, and `content` last, so a tail cut keeps both. This session's own `ptah_context_enrich_file` call on `tool-result-budget.ts` (run before the fix) returned `{"content":...,"mode":"full",...}` with no reason, showing the P0 live. No dispatcher change was needed; `protocol-dispatcher.ts` is untouched.

## Risks and edge cases

| Risk / edge case                                   | Handling                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit vs contradicting `language`               | An explicit supported value always wins (spec: `.ts`+javascript → javascript, `.py`+typescript → typescript). An explicit value outside the enum is not a language this tool renders, so it is ignored and the language is inferred (spec: `'tsx'` on `.tsx` → typescript). This is a small deviation: previously such a value produced full content. |
| "Didn't try" vs "tried and failed" never identical | `unsupported-language` (no parse attempted; spec asserts `analyzeSource` was not called) vs `parse-failed` / `read-failed`. Enforced by the required `reason` parameter on `createFullContentResult`. A spec asserts all three are distinct and defined.                                                                                              |
| Uppercase / multi-dot extensions                   | `path.extname` takes the last extension and it is lower-cased: `.D.TS`, `.TSX`, `.MJS`, `.spec.ts` are all pinned.                                                                                                                                                                                                                                    |
| Files without an extension                         | `Makefile`, `.eslintrc` and `src/dir.ts/Dockerfile` → undefined → `unsupported-language`.                                                                                                                                                                                                                                                             |
| `.py` inference                                    | Pinned to `unsupported-language`, as batches.md:1639 requires. The map does know `python/go/csharp`, but the `.d.ts` formatter emits TS syntax, so only TS/JS are forwarded. code-intel.md:224 suggested `reason: undefined` for `.py`; batches.md is newer, and "every full result has a reason" supersedes that.                                    |
| Module boundary                                    | The import goes through the existing public barrel, as sibling files in the same lib already do. `lint` (module boundaries) passed. No 6th file was needed.                                                                                                                                                                                           |
| Degradation audit                                  | No new catch was added. The service read catch now uses `catch {}` with a fixed-text log. The audit result is unchanged: `vscode-lm-tools: 2 ok (baseline 2)`, `workspace-intelligence: 1 ok (baseline 1)`. The two listed vscode-lm-tools hits are the pre-existing `getDependencies`/`getDependents` catches, whose line numbers moved.             |
| Budget cut dropping metadata                       | `content` is the last key on every result (service and builder catch). Pinned in both specs.                                                                                                                                                                                                                                                          |

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2` → `NX Successfully ran targets test, lint, typecheck for 2 projects`.
- Targeted runs:
  - `nx test @ptah-extension/workspace-intelligence --testFile=context-enrichment.service.spec.ts` → 1 suite, 8/8 passed.
  - `nx test @ptah-extension/vscode-lm-tools --testFile=analysis-namespace.builders.spec.ts` → 1 suite, 47/47 passed.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `vscode-lm-tools: 2 ok (baseline 2)`, `workspace-intelligence: 1 ok (baseline 1)`, success.
- `prettier --check` on all 5 changed files → "All matched files use Prettier code style!"

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract/.ptah/specs/TASK_2026_559_8ca9/batch-7-executor-report.md` (this report)

## Plan deviations

- `.mts/.cts/.mjs/.cjs` are not in `EXTENSION_LANGUAGE_MAP`. They are aliased locally in the builder instead of being added to the shared map. Adding them to the map would change the code-symbol indexer, the dependency graph, architecture rules and the outliner, which is outside this batch.
- An explicit `language` outside `typescript`/`javascript` falls back to inference instead of forcing full content (see the risk table).
- `content` was moved to the last key of every result so the reason survives the budget cut. The tests assert key order, but no consumer depends on it.

## Out-of-scope observations

- `types.ts:763-768` (the `ContextNamespace.enrichFile` JSDoc) still says "Optional language hint". It is accurate but does not mention inference. Not touched.
- `EXTENSION_LANGUAGE_MAP` lacks the ESM/CJS module extensions. If they were added there, the local alias could be deleted. That needs a decision on how the indexer and dependency graph should treat those files.

## Revision round 1

Review: `reviews/batch-7-code-logic-review-r1.md` (REVISE 4/10, B1 and B2 blocking).

### Root cause

The summary was written from `CodeInsights`, the output of the symbol indexer's queries. Those queries do not match ambient or overload signatures, interfaces, type aliases or enums. Nothing checked whether the parse had needed error recovery. A recovered TSX parse, or a file made only of those declaration forms, therefore produced `mode: "structural"` with `// No declarations found`.

### Fix per finding

| Finding                                                          | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1: TSX components silently disappear                            | The namespace no longer infers `.tsx`, and it answers `unsupported-language`. `tree-sitter-tsx.wasm` exists in `@vscode/tree-sitter-wasm`, but `scripts/copy-wasm.js` does not ship it and the parser service does not load it. Shipping it is packaging work outside this batch (see below). With an explicit `typescript` on a `.tsx` file, the parse contains ERROR nodes, and the service now answers `parse-failed` with the full content. The same guard covers the context-size optimiser, which still maps `.tsx` to typescript. `.jsx` stays inferred as javascript: the JavaScript grammar parses JSX without errors, and a real-parser spec pins both components.                                                                                                                                                                                                                                                                                                |
| B2: ambient declarations and interfaces/types silently disappear | The summary is now built from the parse tree, not from `CodeInsights`. The new module `context-analysis/declaration-summary.ts` runs one `TreeSitterParserService.queryMulti` with three queries: ERROR/MISSING nodes, every top-level statement, and every function-like body. Each top-level declaration is kept as its own source text with the bodies elided. Function declarations and class methods get a `;` signature, as in a .d.ts file. Arrow and function-expression bodies become `{ … }` or `…`. Class static blocks are removed. This covers imports, all `export` forms including `export default`, `export *` and `export =`, function declarations, `declare`/ambient declarations, overload signatures, classes with every member, abstract classes, interfaces, type aliases, enums and const enums, `const`/`let`/`var` including arrow and function expressions, namespaces, `declare module`, and CommonJS `module.exports`/`exports.x` assignments. |
| Completeness guard (always on)                                   | Full content with a reason, instead of a summary, when: (a) the tree has an ERROR or MISSING node → `parse-failed`; (b) the file is non-empty but only imports, statements or comments survive → `no-declarations`; (c) a top-level node type is neither a known declaration nor a known non-declaration → `unsupported-declarations`. Each branch has a fixed-text log line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Language scope                                                   | Only `typescript` and `javascript` are summarised. python, go and csharp, which only the context-size optimiser passes, now answer `unsupported-language`. The old writer rendered them as TS-shaped text and silently dropped their module-level constants and other forms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`reason` union: `'unsupported-language' | 'parse-failed' | 'unsupported-declarations' | 'no-declarations' | 'read-failed'`. The service JSDoc and the `ptah_context_enrich_file` description both list all five. The language parameter description now says `.tsx` is not summarised.

`ContextEnrichmentService` now injects `TOKENS.TREE_SITTER_PARSER_SERVICE`, which is already registered before it in `di/register.ts`, in place of `TOKENS.AST_ANALYSIS_SERVICE`. The insights-based `formatAsDeclaration` and its helpers were deleted. They had no other caller (grep).

### Files (round 1)

- CREATED `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts`: queries, top-level classification and body elision (pure).
- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts`: parser-based flow, guards, reason union; old writer removed.
- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.spec.ts`: rewritten on the real grammars, using the `csharp-grammar.integration.spec.ts` shims.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`: `.tsx` is no longer inferred.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`: `.tsx`/`.TSX` forward undefined; explicit typescript on `.tsx` is forwarded.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`: description lists the new reasons and the `.tsx` rule.

### Regression specs (real parser, `context-enrichment.service.spec.ts`)

- `keeps every exported name of a normal .ts file and drops the bodies`
- `keeps ambient and overload signatures of a .d.ts file (B2)`
- `keeps interfaces, type aliases, enums and namespaces verbatim`
- `keeps export default declarations and expressions`
- `keeps JSX arrow components of a .jsx file (the JavaScript grammar parses JSX)`
- `returns full content with reason 'parse-failed' for TSX parsed as typescript (B1)` (the reviewer's two-component fixture)
- `returns full content with reason 'parse-failed' when the parse needed error recovery`
- `returns full content with reason 'no-declarations' for a script that declares nothing`
- `keeps CommonJS export assignments and drops other statements`
- `answers 'unsupported-declarations' for a top-level node kind the writer does not know` (pure-function case; the real grammars have no uncovered top-level kind)
- The fallback-reason, read-failed, pre-read, empty-file and key-order specs were kept. `parse-failed` from a parser `Result.err` is exercised with a spy on the real parser.

Namespace spec: `.tsx`/`.TSX` are in the `forwards undefined` table; `forwards an explicit typescript for a .tsx file (the service refuses a JSX parse)`; `enrichFile('src/a.tsx')` → full/unsupported-language.

### Verification (round 1)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck for 2 projects`.
- Targeted: `context-enrichment.service.spec.ts` 17/17; `analysis-namespace.builders.spec.ts` 48/48.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `vscode-lm-tools: 2 ok (baseline 2)`, `workspace-intelligence: 1 ok (baseline 1)`, total 300. No catch was added. The new module has no try/catch; parser failures arrive as `Result.err`.
- `prettier --check` on the 6 changed source/spec files → clean.

### Deviations (round 1)

- `.jsx` is still inferred, because the JavaScript grammar parses JSX (a real-parser spec proves it). Only `.tsx` is excluded.
- Structural summaries for python, go and csharp were dropped in favour of `unsupported-language`, because the writer cannot guarantee their completeness. This affects `ContextSizeOptimizerService`, which gets full content (more tokens, no lost API) for those files.

### Out-of-scope observations (round 1)

- Real TSX summaries need `tree-sitter-tsx.wasm` added to `scripts/copy-wasm.js`, to the three `verify-packed-wasm` scripts and to the `TreeSitterParserService` grammar set, plus a `SupportedLanguage` entry. That is packaging and indexer scope, not this batch.
- For a very small file the summary header can make the summary longer than the original (tokens are still reported truthfully). A "return full if not smaller" rule would need its own reason value, so it was not added.

## Bounded correction (round 2 review)

Review: `reviews/batch-7-code-logic-review-r2.md` (REVISE 4/10; R2-B1 and R2-B2 blocking, R2-S1 serious, R2-M1 moderate). The r1 fixes B1 and B2 still hold.

### Fix per finding

| Finding                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-B1: runtime exports bypass the completeness guard | The writer no longer tries to decide which executable statements publish API. Every top-level statement except comments, empty statements and hash-bang lines is kept verbatim, with only function bodies elided. That includes `if`/loops/`try`/blocks, bracket and computed `exports[...]`/`module['exports']` assignments, `Object.defineProperty(exports, …)`, `API.prototype.x = …` and every other call. Code that runs while the module loads is not elided: class static blocks, and function bodies that are the callee (IIFE) or a direct argument of a call inside a top-level executable statement (callbacks, `define` factories). A new `exportRefs` query finds each `exports` identifier or shorthand, `module.exports` and `module[…]`. If any of them falls inside an elided span (a function body or an elided literal), the writer returns `unsupported-declarations`, so the service returns the full content. `no-declarations` is still returned when the only non-import statements are calls or compound statements. |
| R2-B2: blank-line cleanup changed template literals  | The global regex was removed. Retained text is copied with `content.slice` between spans. The only whitespace that is removed is the gap between a signature and its dropped body (`trimEnd` on that one slice). Static blocks are no longer removed, so no removal can leave a blank line behind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R2-S1: huge initialisers crowd out the API           | A `literals` query captures object, array, string and template-string values of `variable_declarator` and class-field `value`, either directly or one wrapper deep (`as const`, `satisfies`, `??`). A value longer than `LARGE_INITIALISER_CHARS` (400) becomes `{ … }`, `[ … ]` or `"…"`. The name, type annotation, `export` and wrapper are kept. A literal that contains a function body is not elided, because its method signatures are API. It is rendered with its bodies elided instead. New guard in the service: when `summary.text.length >= content.length`, the result is full content with the new reason `'summary-not-smaller'` and a fixed-text debug log. The reason is in the `reason` union, the JSDoc and the `ptah_context_enrich_file` description. The description also says that `read-failed` content is empty, and that the reduction is "usually" large rather than always.                                                                                                                                      |
| R2-M1: quadratic rendering                           | Kept statements and outermost spans are both sorted, and one shared cursor walks the spans once (`renderStatements`). The other passes are also a sort or a single forward sweep: executed-body filtering against executable statements, export-reference containment and the outermost-span pass. The "literal contains a body" check is a binary search over the sorted body starts. Statement output is assembled from a parts array, so `trimEnd` is never applied to a growing string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Files (round 2)

- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts`: keeps executable statements, handles load-time bodies, adds literal elision and the exports-reference refusal, renders with a linear sweep, and no longer runs the global cleanup.
- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts`: adds the `summary-not-smaller` guard, union member and JSDoc.
- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.spec.ts`: shape tests now call the writer through the real parser. Adds the round-2 regressions. `SOURCE` is longer, so the service path still produces a summary.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`: the description lists the new reason and the literal elision.

### Regression specs (real parser, `context-enrichment.service.spec.ts`)

- `runtime exports (R2-B1, real parser)`:
  - `keeps %s in the summary`, covering a conditional export, an Object.defineProperty export, a bracket-form `module['exports']` export, a computed `exports['…']` export and a prototype method added to an exported class. The first three are the reviewer's exact fixtures. Each is checked through the writer and through the service.
  - `keeps load-time code verbatim: an IIFE and a top-level callback`.
  - `returns full content with reason 'unsupported-declarations' for %s`, covering exports inside a function body, `module.exports` inside a method, `module['exports']` inside an arrow body and a shorthand `{ exports }`. Each case also checks that the log is fixed text.
  - `does not refuse a local named module or an exports reference in kept code`.
- `retained source is byte-identical (R2-B2, real parser)`:
  - `keeps a template literal with blank and whitespace-only lines exactly`, run through the writer and the service.
  - `renders a statement with nothing to elide as its exact source`.
- `large initialiser values (R2-S1, real parser)`:
  - `elides a huge %s initialiser and keeps the API after it`, covering the reviewer's 5,000-item array and 5,000-property object, an `as const` array with a type annotation, and a template string. Each runs through the service and must stay under 400 chars.
  - `elides a large class field value but keeps small constants`.
  - `keeps a large object whose values are functions (their signatures are API)`.
  - `refuses with 'unsupported-declarations' when an elided value refers to exports`.
  - `returns full content with reason 'summary-not-smaller' when the summary is not smaller`.
- `renders 16,000 function declarations in linear time (R2-M1)`. This uses the lib's relative timing guard, timing render only: the fastest of 3 runs must be under an absolute 250 ms. Above that, it must stay under a 10 s ceiling and under `LOAD_FACTOR` 8 × the time for a quarter-size input. The jest timeout is 120 s.
- Changed round-1 specs:
  - The .d.ts case (B2) checks the writer's summary and expects `summary-not-smaller` through the service, because a .d.ts file has nothing to elide.
  - The CommonJS case now expects top-level calls to be kept.
  - The normal-file case expects the static block and the side-effect call to be kept.
  - A service-level `returns a smaller structural summary through the service for a normal file` was added.

### Verification (round 2)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck for 2 projects` (57.6 s). Targeted run: `context-enrichment.service.spec.ts` 40/40.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `vscode-lm-tools: 2 ok (baseline 2)`, `workspace-intelligence: 1 ok (baseline 1)`.
- `prettier --check` on the 4 changed files → clean.
- Size reduction was measured with the real TypeScript grammar, the round-2 writer (header included) and gpt-tokenizer:

| File                                                                          | Original tokens | Summary tokens | Reduction |
| ----------------------------------------------------------------------------- | --------------: | -------------: | --------: |
| workspace-intelligence/src/context-analysis/context-enrichment.service.ts     |           2,406 |          1,289 |       46% |
| workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts |           3,397 |          1,445 |       57% |
| workspace-intelligence/src/ast/tree-sitter-parser.service.ts                  |           6,683 |          2,411 |       64% |
| vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts   |          16,324 |            795 |       95% |
| workspace-intelligence/src/context-analysis/declaration-summary.ts            |           4,120 |          1,235 |       70% |

### Deviations and limits (round 2)

- The reviewer suggested keeping only the recognised export forms and refusing the rest. This correction keeps every executable top-level statement verbatim instead. That is a superset with no refusal, and it cannot drop a statement that publishes API. The cost is less reduction for script-heavy files, and the `summary-not-smaller` guard bounds that cost.
- Elided function bodies that publish API through channels other than `exports`/`module` are still elided. Examples are a non-load-time function that assigns `globalThis.x` or `Foo.prototype.x`. Only the CommonJS export channels trigger the refusal. A local variable named `exports` inside an elided body also triggers the refusal: this is a false refusal, and it is safe.
- Callbacks passed to a call inside a declaration initialiser (`export const x = wrap(() => …)`) are elided, because they are not load-time statements. The declared name stays visible.

## Decision 13 fix

Review: `reviews/batch-7-code-logic-review-r3-postcap.md` (REVISE 4/10; R3-B1 and R3-B2 blocking, R3-S1 serious, R3-M1 moderate). User Decision 13: refuse more. A structural summary is produced only for pure declaration files; any other file returns the whole file with an honest reason. This replaces the round-2 approach, which kept every executable statement verbatim. The load-time `executed`/`static`/`verbatim` spans were removed along with it.

### Fix per finding

| Finding                                                                                                      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R3-B1: API published through an exports alias, CJS `this`, `globalThis` or a prototype inside an elided body | Four rules now refuse these files.<br><br>**1. Declaration-only gate.** Every top-level statement must be one of the following:<br>- an import or `import =`;<br>- an `export` clause or a re-export;<br>- a function, class, interface, type, enum, namespace, `module` or `declare` declaration, or its `export` / `export default` form;<br>- a `const`/`let`/`var` declaration.<br><br>Anything else returns `unsupported-declarations`: expression statements (calls, IIFEs, `module.exports =`, `exports.x =`), `if`, loops, blocks and so on. The only exception is a TS `namespace`, which the parser reads as an expression statement.<br><br>**2. Top-level initialisers.** They are judged after unwrapping `(…)`, `as`, `satisfies`, `<T>…` and `!`. Each must be absent, a function or arrow expression, a primitive (number, boolean, null, undefined, regex, `-n`) or an object, array, string or template literal. An `export default` / `export =` value may also be a name or a class expression. This refuses `const e = this`, `const { exports: e } = module` and `const api = (() => …)()`.<br><br>**3. Runtime-export channels anywhere in the file, including elided bodies.** The refusal covers:<br>- the identifiers (and shorthand properties) `exports`, `module`, `globalThis`, `window`, `self` and `global`;<br>- any `prototype` / `__proto__` property;<br>- `Object`/`Reflect` `.assign`, `.defineProperty`, `.defineProperties`, `.setPrototypeOf` and `.set`;<br>- any `Object`/`Reflect` identifier that is not the object of a member access, i.e. an alias such as `const O = Object`.<br><br>Aliases of a channel are covered because the channel itself is referenced.<br><br>**4. No load-time code.** A call, `new`, `await`, spread, computed key or class static block is refused if it sits outside a function body, a parameter list, a decorator and an instance-field initialiser, because it could run an elided installer body. Examples: `{ ready: install() }`, `static shared = create()`, `[key()]() {}`, `class X extends mixin(Base)`. |
| R3-B2: large objects lose methods stored by reference                                                        | A variable or class-field initialiser literal over `LARGE_INITIALISER_CHARS` (400) is elided only when it is pure data. Pure data means:<br>- `key: value` pairs whose key is a property name, string or number;<br>- values and array elements that are literals;<br>- unary operators only on numbers;<br>- template literals without substitutions.<br><br>Anything else refuses the file: method shorthands, getters/setters, references (`publicMethod: externalFn`), shorthand properties, spreads, computed keys and wrapped members. A `dataShape` query finds the impure parts, and a binary search over their sorted offsets checks each literal. A literal of 400 characters or fewer is kept verbatim, with only its function bodies elided.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R3-S1: wrapped / mixed initialisers crowd the budget                                                         | Wrappers are now unwrapped recursively on the captured node, which carries three levels of children. A wrapper chain deeper than that is refused. The reviewer's `([…] as const) satisfies readonly string[]` now becomes `([ … ] as const) satisfies readonly string[]`: the summary is under 400 characters and keeps `tailApi`. The method-plus-data object is not pure data, so it is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R3-M1: the character gate lets the token count rise                                                          | The character comparison stays as an early rejection. When it passes, the service counts tokens and returns `full` / `summary-not-smaller` if `summaryTokens >= originalTokens`, reusing the original count. There is one branch with one fixed-text log, so the degradation audit stays at baseline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Unchanged:

- retained slices are byte-identical (`content.slice` between spans, and `trimEnd` only before a dropped body);
- rendering uses one shared cursor;
- TSX is unsupported;
- an explicit language wins;
- `mode`/`reason` come first and `content` last;
- logs are fixed text;
- the degradation audit baseline holds.

The `ptah_context_enrich_file` description now says that summaries are produced only for declaration-only TS/JS files. It lists what `unsupported-declarations` means and that `summary-not-smaller` is now based on tokens.

### Files (Decision 13)

- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/declaration-summary.ts`: adds the declaration-only gate, the file-wide runtime-export refusal, the load-time code refusal, recursive unwrapping and the pure-data rule for large literals. The verbatim and executed spans are removed.
- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts`: adds the token-based not-smaller gate after the character check and updates the reason JSDoc.
- MODIFIED `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.spec.ts`: adds the Decision 13 regressions and turns the round-2 "keeps load-time code" specs into refusals.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`: the description says summaries are for declaration-only files.

### Regression specs (real parser)

- `declaration-only gate (Decision 13, real parser)`:
  - `returns full content with reason 'unsupported-declarations' for %s` (JavaScript). Each case checks the whole service result with `toEqual` and checks that the log is fixed text. Cases:
    - every R3-B1 reproduction: an exports alias used in an installer, exports destructured from module, a CJS top-level `this` alias, a globalThis installer, a prototype installer and an IIFE initialiser;
    - the R3-B2 CommonJS reproduction (`publicMethod: externalFn` with a 450-character payload);
    - the round-2 fixtures, now refused: a conditional export, an `Object.defineProperty` export, a bracket `module['exports']` export, a prototype method on an exported class and CommonJS export assignments;
    - a top-level call, a top-level callback registration, a call in an initialiser, an initialiser that is another name, a call inside a small literal and a spread in a small literal;
    - a class static block, a static field initialised by a call and a computed class member key;
    - `Object.assign`, an `Object` alias and `window` inside an elided body, and a local variable named `module`.
  - `returns full content with reason 'unsupported-declarations' for %s` (TypeScript). Cases: the R3-B2 ESM exported object with a by-reference method, the R3-B2 large object with a spread and a computed key, a large object of methods, a large object with a getter, and a large template literal with a substitution.
  - `R3-S1 elides a pure-data literal under as const, parentheses and satisfies`: the result is structural, keeps `tailApi` and `function work(input);`, and is under 400 characters.
  - `R3-S1 refuses an object mixing a method with a large data array ('unsupported-declarations')`.
- `returns full content with reason 'summary-not-smaller' when fewer characters cost more tokens (R3-M1)`: the reviewer's 350-space fixture with a word-count tokenizer. The result is `full`, 7/7 tokens, `reductionPercentage` 0.
- Still passing:
  - `keeps every exported name of a normal .ts file and drops the bodies` (the fixture is now declaration-only: the static block and side-effect call were removed);
  - `returns a smaller structural summary through the service for a normal file`;
  - the .d.ts case (the writer keeps every line; the service returns `summary-not-smaller`);
  - interfaces, types, enums and namespaces; export default; JSX in .jsx;
  - TSX parsed as TypeScript and error recovery, both `parse-failed`;
  - the R2-B1 exports-in-body refusals;
  - the R2-B2 byte-identical template cases (the static block became a static template field);
  - the R2-S1 large-literal elisions: array, object, `as const`, template and class field;
  - the R2-M1 linear-render guard with 16,000 functions;
  - every fallback-reason and key-order case.
- Changed:
  - `no-declarations` now uses imports plus a comment, because a `console.log` script is `unsupported-declarations`;
  - `keeps a large object whose values are functions` is now a refusal case;
  - `keeps a small object of methods with their bodies elided` was added.

### Verification (Decision 13)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck for 2 projects` (56.8 s). The targeted run of `context-enrichment.service.spec.ts` passed 65/65 after prettier.
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`, `libs/backend/workspace-intelligence: 1 ok (baseline 1)`.
- `prettier --check` on the 4 changed files → clean.
- The same 5 files were re-measured with the real TypeScript grammar, the service (header included) and gpt-tokenizer. The measurement ran from a temporary spec file, which was deleted afterwards.

| File                                                                          | Mode       | Reason                   | Original tokens | Returned tokens | Reduction |
| ----------------------------------------------------------------------------- | ---------- | ------------------------ | --------------: | --------------: | --------: |
| workspace-intelligence/src/context-analysis/context-enrichment.service.ts     | structural | —                        |           2,567 |           1,343 |       48% |
| workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts | structural | —                        |           3,397 |           1,445 |       57% |
| workspace-intelligence/src/ast/tree-sitter-parser.service.ts                  | structural | —                        |           6,683 |           2,411 |       64% |
| vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts   | full       | unsupported-declarations |          16,366 |          16,366 |        0% |
| workspace-intelligence/src/context-analysis/declaration-summary.ts            | full       | unsupported-declarations |           5,852 |           5,852 |        0% |

The original token counts of `context-enrichment.service.ts` and `declaration-summary.ts` grew because this fix edited them. Both refusals are correct under the gate:

- `tool-description.builder.ts` has top-level initialisers that are not literals: `CARRIER_OWNERSHIP_NOTE = '…' + '…'` and `MAX_AGENT_MESSAGE_LENGTH = 100 * 1024`.
- `declaration-summary.ts` initialises constants with `new Set([...])`, which is a load-time `new`, not a literal. Its query templates are large template literals with substitutions.

No runtime export channel fired in any of the five files.

### Limits (Decision 13)

- The following all return full content, as the decision intends: constant expressions (`'a' + 'b'`, `100 * 1024`), `new Set([...])`, `Object.freeze({...})`, `require(...)`, identifier initialisers, and every CommonJS or browser-global file.
- Decorators are exempt from the load-time rule, because `@injectable()` and `@inject(...)` are everywhere. A decorator that calls a function declared in the same file therefore runs it at load time. If that function's elided body mutates an exported object without using a listed channel, the installed member is not shown. A decorator imported from another module does not define this file's API either way.
- A retained small literal (400 characters or fewer) is kept verbatim, so everything in it is visible. Implicit invocations it triggers, such as a getter read or coercion through `${x}`, are not treated as load-time calls.
- The rules are deliberately broad, so some refusals are false positives: any `prototype` or `Object.assign` use inside a body, a parameter named `self` or `global`, and a static field initialised by a call.
