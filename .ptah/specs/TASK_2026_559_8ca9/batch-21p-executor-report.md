# Batch 21p executor report: `ptah_browser_content` goes through the HTML extractor over budget

Lane A, TASK_2026_559_8ca9. This fixes review r1 finding 5 (`reviews/batch-21-code-logic-review-r1.md`) and the second finding in `batch-21-executor-report.md`. Worktree HEAD is ec6ad9bc8. Nothing was staged or committed.

## The fix

The dispatcher now tells the budget step that the page's HTML is HTML, and the budget step reduces that uncut HTML (not the Markdown wrapper). This is the smallest correct fix.

- **`tool-result-budget.ts`**
  - `ApplyToolResultBudgetInput` gets an optional `hint?: ContentKind`.
  - When the caller passes a hint, it takes priority over `TOOL_CONTENT_HINTS` and over content sniffing.
  - No other behaviour changed.
- **`protocol-dispatcher.ts`**
  - The `ptah_browser_content` case now calls the new `createBrowserContentResponse`.
  - `createToolSuccessResponse` and `budgetToolText` pass the optional hint through.
  - `createBrowserContentResponse` works like this:
    1. **Error result, or the formatted page is within budget:** unchanged path, same output as before.
    2. **Over budget:** it runs `reduceOutput(html, {hint:'html'})` as a check first. The check writes no spool file.
       - If the reducer reports `html-extract`, the raw HTML (uncut, not the 32 KiB formatter copy) goes through `createToolSuccessResponse(…, 'html')`. The agent sees the extracted main content, cut to the 32 KiB + 1 KiB budget. The raw HTML is spooled byte-equal (Decision 7), and the trailer reads `[reduced: html-extract … full output: <spool path>]`.
       - Otherwise the old path runs on the formatted page: Markdown outline, cut and spool. This covers the extractor's refusal cases (Batch 2c "refuse when unsure", input over 2 MiB) and pages where the HTML alone fits the budget.
  - **Cost:** the accepted case extracts twice (once for the check, once in the budget step). Both passes are linear, bounded by `MAX_REDUCER_INPUT_CHARS` (2 MiB), and run only over budget.
- **Tool description:** unchanged (Decision 4). It already did not return the HTML block over budget: Batch 2f dropped it. It still returns both HTML and text within budget, and over budget the HTML is in the spool file.

## Specs (`protocol-dispatcher.spec.ts`, spool root created with `mkdtempSync`)

The Batch 2f test that pinned the old behaviour ("loses its HTML block…") is replaced on purpose, as Batch 2f planned. The new `describe('ptah_browser_content over its budget (Batch 21p)')` runs each case through `handleMCPRequest`.

| Spec                                                                                                                                                                                                                                    | Before the fix                                                                                                                             | After |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| ~200 KB page (nav, article, footer): output starts with the title, keeps paragraph 0, has no NAV-NOISE, FOOTER-NOISE or `<p>`, fits both budget limits, spool equals `page.html`, trailer names `html-extract` and the exact spool path | **FAIL** (`Expected: true, Received: false`: the title is not at the start, because the old output was a Markdown outline of the nav text) | PASS  |
| Extractor refuses (`<xmp>` in the article): falls back to the formatted page with `markdown-outline` and `### HTML (code block … omitted)`, exactly one spool file equal to `formatBrowserContent(page)`                                | pass (checks the old path is kept)                                                                                                         | PASS  |
| HTML alone within budget, large text: falls back, `markdown-outline`, spool equals the formatted page                                                                                                                                   | pass (checks the old path is kept)                                                                                                         | PASS  |
| Page within budget: output equals `formatBrowserContent(page)`, no spool directory                                                                                                                                                      | pass (checks the old path is kept)                                                                                                         | PASS  |

The three fallback and unchanged specs pass on the old code by design: they check that those paths still behave as before. Only the article spec can be a failing-then-passing regression test.

Command used for fails-before and after: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts …/protocol-dispatcher.spec.ts -t "Batch 21p" --maxWorkers=2`. Before the fix: 1 failed, 3 passed. After: 4 passed.

## Verification

All checks passed (tailed output):

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers --skip-nx-cache --parallel=2`: all targets succeeded.
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache`: succeeded.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: succeeded.
- `nx run degradation-audit:lint --skip-nx-cache`: **TOTAL 300**, succeeded.
- Prettier was run only on the three changed source and spec files.
- `git status --short`: I modified `protocol-dispatcher.ts`, `protocol-dispatcher.spec.ts` and `tool-result-budget.ts`. Everything else listed was already there before this batch. The two Batch 21 spec files and the task documents were not touched.

## Notes for the senior-tester

These are in `mcp-contract.sweep.spec.ts`, which I did not edit.

- **`ptah_browser_content` sweep driver:** its formatted page stays within budget (60 KB of HTML capped to 32 KiB, plus a 200-char text, is below 33,792 chars), so it is unaffected.
- **"HTML shape" test comment (around line 997):** it says a dispatcher-level HTML path "does not exist". That is now stale.
- **How to cover the new path in the sweep:** use a page with more than 33 KiB of text, or HTML of about 200 KB, through `handleMCPRequest`.
