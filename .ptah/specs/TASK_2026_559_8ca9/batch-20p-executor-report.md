# Batch 20.2p executor report — ptah_ast_analyze output size (Lane A)

Task: TASK_2026_559_8ca9. Worktree `task-559-mcp-tool-contract`, HEAD e10c03a2d. No git operations. Source: review `reviews/batch-20b-code-logic-review-r1.md`, defect 2.

## The claim (quoted, not edited)

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:48`: `| Reading a full file to inspect structure | ptah_ast_analyze { file } | Functions/classes/imports/exports with line ranges; 40-60% fewer tokens than Read |`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:1665`: `... return its structure — functions, classes, imports, and exports with line ranges — WITHOUT reading the full file (40-60% fewer tokens). ...`

Neither was edited. The per-tool description does not describe the output format, so it has not become false (Decision 4). It stays unchanged.

## Choice: MCP rendering only

`ptah.ast.analyze` is a typed public API: `AstNamespace.analyze(): Promise<AstCodeInsights>` in `code-execution/types.ts:1046,1106`. Its callers include execute_code and `system-namespace.builders.ts`. It is **unchanged**. Only the text that the `ptah_ast_analyze` MCP tool returns changed. `protocol-dispatcher.ts` (the `ptah_ast_analyze` case) now calls `formatAstAnalysisResult(result)` where it used to call `JSON.stringify(result)`. The reviewer's 26.10% number measured this same namespace object serialized to JSON, and the MCP path is the one the prompt promises.

The formatter is `libs/backend/workspace-intelligence/src/ast/ast-result-format.ts`. It is exported from the workspace-intelligence barrel. That keeps it inside the allowed dependency direction for vscode-lm-tools, and the Task 20.2 bench (in workspace-intelligence) can size the real production representation.

## Representation

The output is still valid JSON, with the same top-level keys in the same order. `parseStatus`, `errorNodeCount`, `errorNodeCountCapped` and `coverage` stay first, followed by `file` and `language` (Batch 24a order). Each list of records is written as a header row plus one row per record:

```
{"parseStatus":"ok",...,"coverage":{...},"file":"...","language":"typescript",
 "functions":[["name","parameters","startLine","endLine"],["load",["id"],1,4],...],
 "classes":[],"imports":[["source","importedSymbols"],["node:path",["join"]]],
 "exports":[["name","kind"],["load","function"]]}
```

Rules:

- **Header:** the header is the union of the record fields, in the order they first appear.
- **Absent fields:** a `null` cell, or a row shorter than the header, means the field is absent. This is the same thing `JSON.stringify` expresses by dropping an `undefined` field. Trailing absent cells are trimmed.
- **Fallback:** a list whose records are not plain objects, or that holds a real `null` value, is written unchanged. This keeps the format unambiguous.
- **Unchanged values:** empty lists stay `[]`. Nested values (parameters, importedSymbols, coverage, class methods) are written exactly as JSON writes them.

## Before and after tokens

Measured with gpt-tokenizer `countTokens` from `@ptah-extension/tool-output-reducers` (o200k_base, the budget layer's counter). The full source file is the baseline. The output is the full namespace result including parse metadata, coverage, file and language, measured through the real `buildAstNamespace` + `AstAnalysisService` + `TreeSitterParserService`. The measurement came from a throwaway spec, which was deleted afterwards.

| File                                                                                                    | Lines | parse | fn/cls/imp/exp | Source tok | Old JSON tok (saving) |  New tok (saving) | chars src/old/new |
| ------------------------------------------------------------------------------------------------------- | ----: | ----- | -------------- | ---------: | --------------------: | ----------------: | ----------------- |
| Task 20.1 fixture `apps/api-service/src/data-processor.service.ts`                                      |   300 | ok    | 42/1/3/40      |       2184 |         1617 (25.96%) | **1131 (48.21%)** | 10003/6653/4357   |
| `libs/backend/agent-sdk/src/lib/helpers/attachment-processor.service.ts` (service class)                |   301 | ok    | 8/1/16/1       |       2119 |          578 (72.72%) |  **466 (78.01%)** | 9185/2277/1680    |
| `libs/backend/agent-generation/src/lib/services/file-writer.service.ts` (service class)                 |   400 | ok    | 10/1/23/1      |       2812 |          690 (75.46%) |  **544 (80.65%)** | 12791/2769/1967   |
| `libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts` (module of functions)              |   416 | ok    | 22/0/3/1       |       3277 |          644 (80.35%) |  **454 (86.15%)** | 12386/2419/1507   |
| `libs/backend/tool-output-reducers/src/lib/token-measure.ts` (module of functions)                      |   286 | ok    | 11/0/2/5       |       2820 |          459 (83.72%) |  **360 (87.23%)** | 10312/1742/1263   |
| `libs/frontend/chat-ui/src/lib/molecules/question-card.component.ts` (Angular component)                |   479 | ok    | 16/1/22/1      |       3544 |          776 (78.10%) |  **560 (84.20%)** | 16233/3116/1999   |
| `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts` (Angular component) |   347 | ok    | 2/1/20/1       |       2896 |          460 (84.12%) |  **383 (86.77%)** | 13578/1878/1439   |

Every measured file is at least 40% smaller, and none was left out. The fixture was measured with a short root (`D:/fx`). The bench's mkdtemp root makes the `file` value longer by roughly 20–30 tokens, which leaves the saving at about 47%.

## Lossless proof

- **Real parser:** `ast-analyze-result.spec.ts`, test "is lossless". A decoder written only from the documented rules turns the tables back into records. Its output `toEqual`s `JSON.parse(JSON.stringify(result))` for the full namespace result of the generated 300-line file (more than 40 functions, a class, imports and exports). The same check runs on the syntax-error file.
- **Format rules:** `ast-result-format.spec.ts` pins them on hand-built records: interior absent field → `null`, trailing absent fields trimmed, a real `null` → list left unchanged, nested method records and non-record lists unchanged, key order kept.
- **Dispatcher wiring:** `protocol-dispatcher.spec.ts` checks the exact text that `ptah_ast_analyze` returns.

## Specs and fails-before

Fails-before method: the formatter body was temporarily replaced with the old `return JSON.stringify(result);`, the three spec files were run, and the body was restored (confirmed by grep, count 0).

| Spec                                                                     | Test                                                                          | Old code                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| vscode-lm-tools `mcp-core/ast-analyze-result.spec.ts` (new, real parser) | is lossless: every field of the JSON result is recovered from the tables      | FAIL                                                                          |
|                                                                          | is at least 40% smaller in tokens than reading the 300-line file              | FAIL                                                                          |
|                                                                          | keeps parse status and coverage ahead of the tables                           | FAIL                                                                          |
|                                                                          | still reports a recovered parse, with coverage, for a file with syntax errors | FAIL                                                                          |
| vscode-lm-tools `mcp-core/protocol-dispatcher.spec.ts` (+1)              | writes ptah_ast_analyze records as tables behind parse status and coverage    | FAIL                                                                          |
| workspace-intelligence `ast/ast-result-format.spec.ts` (new)             | header row + rows; key order; absent → null/trim; nested/non-record/empty     | FAIL (4)                                                                      |
|                                                                          | leaves a list unchanged when a real null would be ambiguous                   | passes on old code, by design (it pins the fallback, which equals plain JSON) |

Old-code result: `Tests: 5 failed, 265 passed, 270 total` (vscode-lm-tools pair) and `Tests: 4 failed, 1 passed, 5 total` (workspace-intelligence). New code: all pass.

## Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck for 2 projects` (6 tasks).
  - A first attempt forwarded `-- --maxWorkers=2` to every target. tsc rejected it (`TS5023`), so the run was repeated without it.
- `nx run-many "-t=typecheck" -p ptah-cli ptah-electron --parallel=2 --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → `✅ All external imports are covered by package.json dependencies.` / `Successfully ran target validate-deps`.
- `nx run degradation-audit:lint --skip-nx-cache` → `degradation-audit: TOTAL 300 unsuppressed site(s)` / `Successfully ran target lint`.
- Prettier was run only on the changed files.
- `git status --short`:
  - Modified: `protocol-dispatcher.spec.ts`, `protocol-dispatcher.ts`, `workspace-intelligence/src/index.ts`.
  - New: `ast-analyze-result.spec.ts`, `ast-result-format.spec.ts`, `ast-result-format.ts`.
  - Also untracked and not mine: the task docs and `mcp-contract.bench.spec.ts`.

## Files

- CREATED `libs/backend/workspace-intelligence/src/ast/ast-result-format.ts`
- CREATED `libs/backend/workspace-intelligence/src/ast/ast-result-format.spec.ts`
- CREATED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/ast-analyze-result.spec.ts`
- MODIFIED `libs/backend/workspace-intelligence/src/index.ts` (barrel export)
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (`ptah_ast_analyze` uses the formatter)
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts` (+1 wiring test)

## Notes for the senior-tester and out of scope

- **Bench update needed:** `mcp-contract.bench.spec.ts` still sizes `JSON.stringify(insights)` in characters against a 0.35 threshold. To size the shipped representation, it should use `formatAstAnalysisResult` (from `@ptah-extension/workspace-intelligence` or `../../index`) on the namespace-shaped result with `countTokens`. It was not edited, as instructed.
- **execute_code path:** `return await ptah.ast.analyze(f)` still serializes the typed object as plain JSON (about 26% saving on the fixture). The prompt's claim is about the `ptah_ast_analyze` tool. Changing the namespace's return type would break a typed public API, so it was not changed.
