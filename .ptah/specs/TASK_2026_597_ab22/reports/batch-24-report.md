# Batch 24 report — output budget engine moves to tool-output-reducers (S4 wave A)

Executor: backend-developer. No git commands run. The worktree is left dirty.

## Files

- CREATED `libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts`: spool location, file naming, exclusive write, 24 h pruning, `spoolToolText`, `relativeSpoolLocator`, and errno/error-name classification. Moved verbatim from `tool-result-budget.ts`.
- CREATED `libs/backend/tool-output-reducers/src/lib/output-budget/apply-output-budget.ts`: `applyOutputBudget`, the generic engine (identity path, reduce, outline+prefix, fit, spool, trailer, plain-cut fallback; never throws). Moved verbatim apart from the input shape.
- CREATED `libs/backend/tool-output-reducers/src/lib/output-budget/spool.spec.ts` (8 tests) and `apply-output-budget.spec.ts` (7 tests).
- MODIFIED `libs/backend/tool-output-reducers/src/index.ts`: exports `applyOutputBudget`, `ApplyOutputBudgetInput`, `OutputBudgetOutcome`, `OutputReduction`, `spoolToolText`, `relativeSpoolLocator`, `SpoolOutcome` and `SpoolRequestId`. The barrel is 48 lines (limit 150).
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`: now a thin wrapper (891 → 208 lines). It keeps `DEFAULT_TOOL_RESULT_BUDGET_*`, `TOOL_RESULT_BUDGET_OVERRIDES`, `TOOL_CONTENT_HINTS`, `PRESERVED_RESULT_KEYS`, `getToolResultBudget` and `ApplyToolResultBudgetInput` unchanged. `applyToolResultBudget` resolves the budget and hint, then calls `applyOutputBudget` with a `reduce` closure over `reduceOutput` (hint, preserved keys, language, outliner). `ToolResultBudgetOutcome` is now an alias of `OutputBudgetOutcome`. The file also re-exports `spoolToolText`, `relativeSpoolLocator` and `SpoolOutcome` under their old names, so its 6 in-library importers compile unchanged.
- UNCHANGED: `tool-result-budget.spec.ts` (git shows no diff).

## Task 24.1: `applyOutputBudget` and `spool`

- The engine depends only on `platform-core` (an `IOutputChannel` type) and its own library (`token-measure`, the `reduce-output` type).
- Output is identical byte for byte: same trailer format, spool directory (`.ptah/tmp/mcp-out`), name pattern, prune rules, locator rules and fallback text.
- The input is `{ text, budget, requestId, spoolRoot, reduce, logLabel, output? }`.
  - `reduce(limit)` is the caller's content policy (hint tables, preserved keys, language, outliner).
  - `logLabel` prefixes the one failure log line. The wrapper passes `[tool-result-budget] <tool>`, so the old log text is unchanged.

## Task 24.2: thin wrapper

- The Ptah override tables stay in `vscode-lm-tools`, and behaviour is unchanged.
- The existing spec passes with no edits: it ran as part of the vscode-lm-tools suite below, 81/81 suites green.

## Verification

| Command | Result |
| ------- | ------ |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools` | PASS, 4/4 tasks |
| `npx nx run-many -t test -p … --maxWorkers=2` | Every suite that loads `marked` FAILS TO RUN, from an environment cause (see below). 0 test failures; 336 tests passed in the suites that could load. |
| Same jest configs, run directly with `marked` mapped to the main checkout (see below) | tool-output-reducers: 11/11 suites, 508/508 tests PASS. vscode-lm-tools: 81/81 suites, 2677/2677 tests PASS (includes `tool-result-budget.spec.ts`). |
| `npx nx run-many -t typecheck -p @ptah-extension/workspace-intelligence ptah-extension-vscode ptah-electron ptah-cli @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/gateway-chat-bridge` | PASS, 7/7 |
| `npx nx run di-lint:lint` | PASS (1719 sites, 754 tokens) |
| `npx nx run degradation-audit:lint` | FAILS on `libs/backend/cli-agent-runtime: 1 FAIL (baseline 0)`, at `codex-rollout-usage.reader.ts:167`. That is a Batch 32 file, not Batch 24. `vscode-lm-tools`: 2 ok (baseline 2). `tool-output-reducers`: no unsuppressed site. |

Environment cause of the nx test failures:

- This worktree has no `node_modules`; modules resolve from `D:/projects/ptah-extension/node_modules`.
- `jest.preset.js` maps `^marked$` to `<worktree>/node_modules/marked/lib/marked.umd.js`. That path does not exist, so every suite that loads `marked` fails with "Could not locate module marked". The untouched `reduce-output.spec.ts` fails the same way.
- The direct runs used `npx jest -c <project>/jest.config.ts --maxWorkers=2 --moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js", …}'`. For vscode-lm-tools the override also repeats that project's own `vscode` and `wasm-bundle-dir` mappers.
- No repository file was changed for this.
- The team-leader should run the nx test target from a checkout that has `node_modules`, or link one into the worktree.

## Plan deviations

- The engine takes a caller-supplied `reduce(limit)` step instead of calling `reduceOutput` itself. The existing `tool-result-budget.spec.ts` mocks `reduceOutput` on the `@ptah-extension/tool-output-reducers` barrel and must stay unchanged. An engine-internal import would bypass that mock, and 3 of its tests (plain-cut fallback, M2, M3) would fail. It also puts content policy (hints, preserved keys) with the caller, which suits the Batch 25 capper's Read/outline rules.
- The spool file is still named `spoolToolText`, not renamed, so the vscode-lm-tools re-export keeps the same name.

## Out-of-scope observations

- Six vscode-lm-tools files still import `spoolToolText`, `relativeSpoolLocator` and `SpoolOutcome` through `tool-result-budget.ts`: `protocol-dispatcher.ts`, `agent-tool.dispatcher.ts`, `bounded-structured-content.ts`, `agent-read.view.ts`, `mcp-response-formatter.ts` and `mcp-response-formatter-extra.spec.ts`. They could import from `@ptah-extension/tool-output-reducers` directly, and then the re-export could go. Those files are outside this batch.
- The degradation-audit failure in `cli-agent-runtime` (`codex-rollout-usage.reader.ts:167`) belongs to the in-flight Batch 32.
