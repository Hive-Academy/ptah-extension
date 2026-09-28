# Batch 11 executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent), Lane A worktree `task-559-mcp-tool-contract`. No git operations were run.

## Task 11.1 — `limit+1` probe, truncation notice, pattern/limit validation: COMPLETE

### What changed

- `vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `case 'ptah_search_files'` (:896-925)
  - `pattern` must be a string with a non-whitespace character. If it isn't, the tool returns `missingStringArgResponse(request, 'pattern')` (a tool error with `isError: true`) and never calls the provider. Before this change, an empty pattern reached the provider and came back as the provider's thrown "Patterns must be a string (non empty)". A valid pattern is still passed through without trimming, so the glob means what it did before.
  - `limit` of `undefined` or `null` becomes `SEARCH_FILES_DEFAULT_LIMIT` (50, :2347, matching the schema's "default: 50"). Anything that is not a safe integer ≥ 1 gets `toolErrorResponse('Error: "limit" must be a positive integer.')` (the same shape as the `parseSymbolIndexQuery` precedent). That covers 0, negatives, fractions, NaN and numeric strings. No upper bound was added: the schema has none, and adding one would be a new contract.
  - The dispatcher asks the provider for `limit + 1` files (:919). It formats `files.slice(0, limit)` and passes `files.length > limit` as `moreAvailable`. The slice also caps a provider that ignores the maximum it was given.
- `vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`, `formatSearchFiles(files, moreAvailable = false)` (:422)
  - When `moreAvailable` is true, the header line reads `Found: more than N file(s) (showing first N; narrow the pattern or raise limit)`. Otherwise it is `Found: N file(s)` exactly as before. The existing single-argument callers and specs are unchanged.

### Specs (fail before / pass after)

- `mcp-response-formatter-extra.spec.ts:32` `formatSearchFiles truncation notice` (5 cases): the notice, the notice placed before the list, exactly-at-limit with no notice, the default with no notice, and the singular form. **Before the fix:** the suite failed to compile, with `TS2554: Expected 1 arguments, but got 2` ×4. **After:** it passes.
- `protocol-dispatcher.spec.ts:869` `ptah_search_files limit probe and argument validation` (15 cases):
  - more than the limit matched, so the list is sliced and the notice shown
  - the default of 50 goes through the probe (provider asked for 51)
  - exactly `limit` results: no notice
  - under the limit: no notice
  - a provider that over-returns is capped
  - a `null` limit gets the default
  - the pattern is empty, whitespace-only, a number or missing: tool error, provider not called
  - the limit is 0, negative, 2.5, NaN or `'10'`: tool error, provider not called

  **Before the fix:** 13 of the 15 cases failed. The two under-limit and exactly-at-limit "no notice" cases passed, which is the correct behaviour on old code; they guard against over-reporting.

- The existing routing spec (`protocol-dispatcher.spec.ts:836`) now expects `findFiles('**/*.ts', 11)` instead of `10`, because of the intended probe. It failed before the fix.

## Task 11.2 — Dedupe matched terms in relevance reasons: COMPLETE

The reasons are built in this file, as the plan said: `FileRelevanceScorerService.scoreFile`, `file-relevance-scorer.service.ts`. The namespace (`analysis-namespace.builders.ts:365`) passes `r.reasons` through unchanged.

- `scoreFile` returns `[...new Set(reasons)]` (:139), which keeps the original order. Scoring is not touched. This one dedupe covers:
  - repeated query words, including words that differ only in case, because `normalizedQuery` is lowercased first
  - path matches
  - an export matched by two different query words, which also produced duplicate `Export symbol 'X' matches query` reasons without any repeated word
- Prettier was run on this changed file and reformatted pre-existing drift (trailing commas, `} else if`). About 20 lines of the diff are whitespace only.

### Specs (fail before / pass after)

`file-relevance-scorer.service.spec.ts:549` `Reason dedupe` (5 cases):

- "auth auth token" lists each term once
- "Auth AUTH auth token" (case variants) lists `auth` once
- "guards guards" lists its path match once
- an export matched by "auth token" is listed once, and its score is pinned at 60
- the scores of "auth auth token" (40) and "auth token" (30) are pinned

**Before the fix:** 4 failed. The score-pinning case passed, as intended: it proves the scores are unchanged. **After:** 32/32.

## Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache` (header: 2 projects):
  - vscode-lm-tools: test, lint and typecheck all passed.
  - workspace-intelligence: lint and typecheck passed. Test failed on the first run: `1 failed, 1238 passed, 1239 total`. The one failure was in `src/project-analysis/project-detector.service.spec.ts`, a file this batch did not touch; the tail showed only its location, `:504:1`. Other lanes were running Nx on this machine at the same time.
  - Re-running that spec file alone gave `Tests: 57 passed, 57 total`.
  - Re-running `nx run @ptah-extension/workspace-intelligence:test --skip-nx-cache` gave `Test Suites: 45 passed, 45 total; Tests: 1239 passed, 1239 total; Successfully ran target test`.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: `Successfully ran target typecheck for 2 projects`.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: `Successfully ran target validate-deps for project ptah-electron and 1 task it depends on`.
- `nx run degradation-audit:lint --skip-nx-cache`: `degradation-audit: TOTAL 300 unsuppressed site(s)`, success. No new catch was added.
- `prettier --check` on the 6 changed files: `All matched files use Prettier code style!`
- `git status --short`: the 6 files above are modified. The pre-existing untracked `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` were not touched.

## Deviations

1. Notice placement. The plan says to "append" the notice. It is appended to the `Found:` header line rather than after the list, so a result-budget tail cut cannot drop it (the Decision 15 lesson). The count text also changes to "more than N" so the header does not claim an exact total.
2. Limit validation (not in the plan's text; the brief asked for it): an invalid `limit` is a tool error, following the `parseSymbolIndexQuery` precedent. The alternative would have been clamping.
3. The formatter flag is named `moreAvailable` (the plan says `atLimit`). The value is the same: `files.length > limit` before the slice.

## Out-of-scope observations

- **Repeated words still count twice in the score.** "auth auth token" scores 40 while "auth token" scores 30, because `extractKeywords` does not dedupe. Batch 11 required the scores to stay unchanged, so this was left alone. Deduping the keywords would change ranking; that decision belongs to the planner.
- **Other callers skip the validation.** `ptahAPI.search.findFiles` (`core-namespace.builders.ts:149`, default limit 20) does not validate its pattern or limit. `execute_code` callers still get the provider's own error for an empty pattern.
- **Tool description.** The description for `ptah_search_files` (`tool-description.builder.ts:338`) makes no false claim, so it was left unchanged under Decision 4. It does not mention the truncation notice or the positive-integer `limit` rule.
