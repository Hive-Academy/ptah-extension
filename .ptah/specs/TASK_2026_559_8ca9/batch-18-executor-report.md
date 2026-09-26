# Batch 18 executor report — `ptah_browser_evaluate` value cap

Executor: backend-developer (Claude subagent), Lane A worktree, HEAD 54b7af920. Nothing staged or committed.

## Task 18.1 — Budgeted `formatBrowserEvaluate` — done

### Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
  - imports `DEFAULT_TOOL_RESULT_BUDGET_CHARS` (8000) from `./tool-result-budget` (no import cycle: that module does not import the formatter)
  - new private `capEvaluateValue(valueStr)`: a value of `<= 8000` UTF-16 units is returned unchanged. A longer value is cut to 8000 units, or 7999 when unit 7999 is a high surrogate, so a pair is never split. Then it appends
    `\n\n[...truncated: N more chars — for page content use ptah_browser_content with a selector]`, where N = the original length minus the kept length
  - `formatBrowserEvaluate` applies it only in the code-block branch. The inline `**Value:**` branch is reached only at `<= 100` chars. The branch decision still uses the uncapped length, which gives the same outcome because the cap is above 100. Type line, error branch, fence language and the `catch → fallbackJson` path are unchanged
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter-extra.spec.ts`
  - the 150-char pinning test is rewritten to assert the exact fenced block and that there is no `[...truncated`
  - new `describe('formatBrowserEvaluate value cap')` with 10 cases (listed below)

### Specs and fails-before evidence

Method: with the specs in place, the call site was temporarily set back to `content: valueStr` (the old code) and
`jest -c libs/backend/vscode-lm-tools/jest.config.ts …mcp-response-formatter-extra.spec.ts -t formatBrowserEvaluate --maxWorkers=2`
was run. Result: `Tests: 7 failed, 7 passed`. After the fix: `14 passed`.

| Spec                                                                                                  | Before       | After |
| ----------------------------------------------------------------------------------------------------- | ------------ | ----- |
| cuts a value one char over the cap and reports 1 more char                                            | FAIL         | pass  |
| cuts a 100 KB value: trailer present, raw tail (`TAIL-MARKER`, `bb`) absent, output < cap+300         | FAIL         | pass  |
| never splits a surrogate pair straddling the cut (7999 kept, "12 more chars", no lone high surrogate) | FAIL         | pass  |
| keeps a surrogate pair that ends exactly at the cap                                                   | FAIL         | pass  |
| caps a JSON-looking string (type `string`) the same way as any string                                 | FAIL         | pass  |
| caps a large object after pretty-printing it (type `object`)                                          | FAIL         | pass  |
| through the tool-result budget: spools the capped formatter output, never the raw tail                | FAIL         | pass  |
| 150-char value whole, no trailer (rewritten pin)                                                      | pass (guard) | pass  |
| exactly-at-cap value whole, no trailer                                                                | pass (guard) | pass  |
| cap constant is 8000                                                                                  | pass (guard) | pass  |
| small object / null / undefined / circular render as before                                           | pass (guard) | pass  |

The guards pin behaviour that must not change, so passing before the fix is expected. `null` still renders as a
`null` json block. `undefined` still renders `**Value:** undefined`. A circular value still ends at
`[Unable to serialize result]`, because `JSON.stringify` throws, then `fallbackJson` throws, and the placeholder is returned.

### How the cap interacts with the Batch 2e/2f result budget (no false claim)

- `ptah_browser_evaluate` has no override, so its budget is the default 8000 chars / 2000 tokens. The header, fence and trailer push an over-cap value's formatted output above 8000 chars, so `applyToolResultBudget` still reduces or cuts the response and spools the **formatter output**.
- The full raw value is **not** spooled anywhere. The spool file holds the capped value plus the evaluate trailer. The "through the tool-result budget" spec pins this: the spooled text equals `formatted`, it contains the trailer, and it does not contain `TAIL-MARKER`. The response itself also stays within 8000 chars.
- The evaluate trailer makes no claim about a saved copy. It only states the dropped count and points to `ptah_browser_content`. The budget trailer's "full output: <path>" refers to the formatter output, which is its existing meaning for every formatter-capped tool (for example `ptah_browser_content`). No wording claims that the raw value can be recovered.
- Observation, not changed (the batch fixes the value cap at 8000): for an over-cap value, the budget cut usually removes the evaluate trailer from the inline response. The model then sees the budget trailer and has to open the spool file to read the hint. A value cap of about 7,800 would keep the whole response under the budget and the hint inline. This is for the reviewer or team-leader to decide.

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → typecheck, lint and test all passed ("Successfully ran targets test, lint, typecheck")
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` → both passed
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies." (the trailer uses `for page content use …`, with no `from "<word>"`)
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300 unsuppressed site(s)`, passed. The new code adds no catch sites
- `prettier --check` on the 2 changed files → clean
- `git status --short` → ` M mcp-response-formatter.ts`, ` M mcp-response-formatter-extra.spec.ts`. Also present and not created by this batch: `?? .ptah/specs/TASK_2026_559_8ca9/code-logic-review.md` and `?? .ptah/specs/TASK_2026_559_8ca9/research/diagnostics-worktree-repro.ts`

## Plan deviations

None. The existing `blocks: any[]` in `formatBrowserEvaluate` was already there. No new `any` or `@ts-ignore` was added. The frozen prompt constants and tool descriptions were not touched.

## Orchestrator correction (Decision 7 spool + visible trailer)

The round-1 design above (a fixed 8,000-char value cap, with nothing spooled) is replaced as follows.

### Change

- `mcp-response-formatter.ts`: `formatBrowserEvaluate(result, budget: TextBudget, spool: EvaluateValueSpool): Promise<string>`. This follows the Batch 9 `renderSymbolIndexPage` pattern, where the dispatcher passes the budget and a spool callback, so there is no second spool writer.
  - If the whole answer fits `budget` by `fitsBudget`, it is rendered exactly as before and nothing is spooled. This is the same test the dispatcher's fast path (`tokensWithinBudget`) applies.
  - Otherwise, `spool(valueStr)` saves the **full** stringified value: the string itself, or the pretty JSON for an object. The value is then cut to the longest prefix for which header + prefix + trailer + fence still fit **both** limits. This is found by binary search (`largestFittingLength`, bounded by `budget.chars`) and moved back one unit off a high surrogate (`surrogateSafeEnd`).
  - The trailer is `[...truncated: N more chars; full value: <spool path> — for page content use ptah_browser_content with a selector]`. When the save failed it reads `full value could not be saved: <errno/name>`. There is no `from "<word>"` in it.
  - The round-1 `DEFAULT_TOOL_RESULT_BUDGET_CHARS` import and `capEvaluateValue` are removed, and the old `blocks: any[]` is gone.
- `protocol-dispatcher.ts` (evaluate case): passes `getToolResultBudget(name)` and `async (text) => spoolToolText(text, await resolveSpoolRoot(deps), request.id)`. These are the same host-owned spool-root rules (Batch 2f / review F1) as `ptah_get_symbol_index`.
- Because the answer already fits, the budget step returns it unchanged. It does not cut again and does not spool again, so the evaluate trailer is inline.

### Specs and fails-before

Before = the cut bypassed (`if (whole.length >= 0 || fitsBudget(...))`, which gives HEAD's uncapped and unspooled output). After = the fix.

`mcp-response-formatter-extra.spec.ts` (`-t formatBrowserEvaluate`): **7 failed / 7 passed before → 14 passed after.** The 7 that fail before:

- one char over a chars-bound budget: whole value spooled, maximal cut, exact dropped count, path named
- surrogate pairs at 12 different cut points: no lone high surrogate, even dropped count
- 100 KB value: within 8,000 chars and 2,000 tokens (independent `countTokens` oracle), trailer with path, raw tail absent
- spool failure named in the trailer
- JSON-looking string: cut as text, the string itself spooled
- large object: cut, pretty JSON spooled
- real `spoolToolText` + `applyToolResultBudget`: `outcome.text === formatted`, `truncated: false`, within the budget, the spool file **byte-equal** to `Buffer.from(value, 'utf8')` (value includes é and emoji), and the trailer names that file

The guards that must pass before and after: error branch; small object; short primitive; the 150-char pin (rewritten: whole, no trailer); exactly-at-budget value (whole, spool not called); small object / null / undefined / circular unchanged and unspooled.

`protocol-dispatcher.spec.ts` (new, in the 2f.1 describe): `ptah_browser_evaluate` through `handleMCPRequest` with a known-folder spool root. **Fails before, passes after.** It asserts that the answer is within the default budget, that there is no `[reduced:` budget trailer, that the raw tail is absent, that the one spool file equals the value, and that the inline trailer names that file's absolute path.

The round-1 implementation would also fail the 100 KB, spool-failure, real-spool and dispatcher specs, because it wrote no spool and printed no path, and its answer went over the budget.

### Verification (after the correction)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → all 3 targets passed
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` → passed
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`, passed. No catch sites were added
- `prettier --check` on the 4 changed source/spec files → clean
- `git status --short` → the 4 files above are modified, plus this report. Not created by this batch: ` M implementation-plan-languages.md`, `?? code-logic-review.md`, `?? o2-go-vet-consent-surface.md`, `?? o3-kotlin-grammar-provenance.md`, `?? research/diagnostics-worktree-repro.ts`

### Notes

- A value that is one long pre-token (for example 8,000 `x` chars) is limited by the upper-bound token count, not by chars, so fewer than about 2,000 chars of it stay inline. The dropped count and the spool path are always stated.
- If even header + trailer cannot fit (a pathological budget or path), the kept prefix is 0. The answer then goes to the budget step's normal cut, and the value is still spooled.
- `largestFittingLength` in the formatter repeats the dispatcher's private `largestFitting` (two uses, so they are kept separate under the "third use" rule).
- The dispatcher files (`protocol-dispatcher.ts` call site and one spec) were touched as the correction allowed. The batch's file list names only the formatter and its spec.
