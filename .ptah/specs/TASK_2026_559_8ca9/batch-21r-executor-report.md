# Batch 21r — executor report (Lane A, backend-developer)

Defect: with a ~20 KB result (below `markdown.reducer.ts`'s 262,144-char outline cap), 13 HTTP tools lost
their planted marker because the budget layer accepted a Markdown outline that kept only a short header and
omission notes (review r3 finding R3-01). Fixed with one general rule in the budget layer; no tool names added.

## Design and rationale

`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts`:
after `reduceOutput`, `isSparseOutline(result, window)` refuses a `markdown-outline` result that fills less
than `MIN_OUTLINE_SHARE = 0.5` of the window by chars AND by tokens. The refused result is replaced with the raw
text and reducer `none`, so the existing prefix cut (which fills at least 80% of the window) and the spool apply.
The trailer then reads `[reduced: none — partial, …]`.

Why this rule:

- **The outline only fills the window when there is structure.** It keeps every heading and the head of each
  section, round-robin. With many sections it fills the window. When a section's first block is one long
  paragraph, table or list (the shape of most tool answers: a short header over the payload), it keeps nothing
  of the body. Measured window share of the outline, before the fix (probe, since removed): the 13 tools
  34–264 chars of ~7,725 (0.4–3.4%). `ptah_search_files` (1,000 files) 130 chars. `ptah_web_search` 277 chars.
  The `ptah_browser_content` fallbacks 100 and 189 chars of 33,528. A real 60-section document gave 6,098 chars
  (79%), and `ptah_workspace_analyze` gave 1,053 of 1,899 tokens (55%). The gap between the two groups is wide,
  so a 50% cut-off separates them cleanly.
- **Scoped to the outline, by design.** Other reducers change the text instead of dropping blocks, so a
  small result from them is not a loss. `json-compact` only drops empty fields. `html-extract` (Batch 21p's
  `browser_content` path) keeps the article and removes markup by design. `log-reduced` fills the window
  itself. A reducer-agnostic share rule would wrongly replace a small lossless JSON compaction, or a short
  extracted article, with a raw prefix. A spec pins this.
- **Budget layer, not the reducer lib.** The choice between an outline and a prefix cut belongs to the
  caller that owns the cut (`reduce-output.ts` is documented as "never cut"). `tool-output-reducers` is
  therefore unchanged, and none of its specs changed.
- **Hints kept.** Batch 21q's `preformatted` hints for `ptah_agent_*` (and the diagnostics, symbol-index and
  task_list hints) are unchanged and still pinned. They skip the reducer altogether, which is still right for
  formatter-owned text.

## Files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts` — adds
  `OUTLINE_REDUCER`, `MIN_OUTLINE_SHARE`, `isSparseOutline`; `budgetText` uses the raw text when the outline is
  sparse; header doc step 2 updated. No new casts, catches or `as any`.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.spec.ts` — new
  `describe('sparse Markdown outlines (Batch 21r, review r3: R3-01)')` with 4 tests. Prettier `--write` also
  reformatted pre-existing lines of this file: it was not prettier-clean at HEAD. This is formatting only.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts` — 3
  expectations updated (see below).
- Not touched: `mcp-contract.sweep.spec.ts`, `mcp-mandate-manifest.spec.ts`, `apps/ptah-cli` specs,
  `libs/backend/tool-output-reducers/**`.

## Fails-before evidence

To get these results, I switched the rule off temporarily (`false && isSparseOutline(...)`, since reverted)
and ran jest on the budget, sweep and dispatcher specs: **15 failed**, 358 passed. The failures were the 13
sweep tests and the 2 new loss specs:

- `below the outline cap (~20 KB real prose/table): <tool> keeps its marker inline and passes the full budget
contract` for ptah_count_tokens, ptah_git_worktree_list, ptah_git_worktree_add, ptah_git_worktree_remove,
  ptah_json_validate, ptah_browser_navigate, ptah_browser_click, ptah_browser_type, ptah_browser_network,
  ptah_browser_close, ptah_browser_status, ptah_browser_record_start, ptah_browser_record_stop.
- `sparse Markdown outlines › cuts a short header over one long paragraph to a prefix instead of dropping the
paragraph`
- `sparse Markdown outlines › cuts a header over one long table or list to a prefix, keeping the first rows`

Two guard specs passed both before and after the fix:

- `still outlines a document with many sections: the outline fills the window`: the rule does not fire on real
  multi-section Markdown.
- `leaves the non-outline reducers alone however little they return`: a small `json-compact` result is kept.

With the rule on, the same three suites give 373 passed, 0 failed, 1 todo (pre-existing).

## Spec expectation changes (all in `protocol-dispatcher.spec.ts`)

All three changes come from the same defect: each pinned an outline that had dropped the body.

1. `ptah_browser_content over its budget (Batch 21p) › falls back to the formatted page … when the extractor
refuses the HTML`. The outline kept 100 chars of a 33,528-char window, and the page text was gone. The test
   now expects a `none — partial` prefix cut. It checks that the body is a prefix of `formatBrowserContent(page)`,
   holds the page text (`NAV-NOISE 0`) and is over 8 KiB, and that there is still exactly one spool file equal to
   the formatted page. The `### HTML (code block … omitted)` assertion was removed, because that note came only
   from the outline. The html-extract test (the actual 21p path) is unchanged and passes.
2. `… falls back to the formatted page when the HTML alone is within the budget (large text only)`. The outline
   kept 189 chars. The test now expects `[reduced: none — partial` and that the page text is kept
   (`'T'.repeat(1000)`). The one-spool assertion is unchanged.
3. `keeps the search_files truncation notice through %s` with 1,000 files. The outline kept 130 of ~7,739 chars
   and the whole file list was dropped. The row is renamed to "a prefix cut below the outline cap" and expects
   `[reduced: none — partial, cut`. The notice is still asserted, the 10,000-file row is unchanged, and the
   spool is still byte-equal.

## Verification

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/tool-output-reducers
ptah-cli --skip-nx-cache` → "Successfully ran targets test, lint, typecheck for 3 projects and 33 tasks they
  depend on".
- `nx run-many -t=typecheck -p ptah-electron --skip-nx-cache` → Successfully ran target typecheck.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → Successfully ran target validate-deps.
- `nx run degradation-audit:lint --skip-nx-cache` → `degradation-audit: TOTAL 300 unsuppressed site(s)`.
- After formatting, `prettier --check` on the 3 files: clean. Targeted jest on the 3 suites: 373 passed, 1 todo.
- `eslint` on the 3 files shows one warning, and it is pre-existing: `no-useless-assignment` at
  protocol-dispatcher.spec.ts:5443. I did not change that code.

## Out-of-scope observations

- `ptah_web_search` (outline 277 chars of 106 KB) and other Markdown tools now take the prefix cut in the same
  way. No spec pinned an outline for them.
- With this rule, the `ptah_agent_*` preformatted hints from 21q are redundant for the loss. I kept them: they
  are pinned, and skipping the reducer is still the intended behaviour for formatter-owned text.
