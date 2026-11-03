# A5 parity Round 2

| Finding | Fix                                                                                                                | file:line                                                                                                   | Covering spec                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1    | Cancelled and timed-out runs have distinct headers, warning, and Review link.                                      | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:130`, `:475`, `:483`                         | `shows a safe %s header and review link`                                                                                                                                                                       |
| R2-2    | Restored agent count, safe generation error list, workflow types, Pro Tips, and all example commands.              | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:201`, `:229`, `:319`, `:331`, `:356`, `:492` | `restores count and safe generation errors from the matching completion payload`; `renders safe bound-result errors when the host supplies them`; `restores workflow types, Pro Tips and all example commands` |
| R2-3    | Failed runs without facts show a generic reason; Enhanced and output directory render whenever result facts exist. | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:220`, `:265`                                 | `shows a safe failure reason with no outcome facts`; `shows Enhanced and output directory without outcome rows`                                                                                                |
| R2-4    | Page heading and subtitle reflect a run needing review.                                                            | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:84`, `:465`                                  | `shows a safe %s header and review link`; `shows a safe failure reason with no outcome facts`                                                                                                                  |
| R2-5    | Empty message uses visible rows, including all-skipped outcomes.                                                   | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:190`                                         | `shows the empty message when every outcome was skipped`                                                                                                                                                       |
| R2-6    | Subscribe to query parameter changes; clear old facts and ignore stale lookup responses using a version.           | `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:554`, `:564`, `:630`                         | `reloads changed query params and ignores stale lookups`                                                                                                                                                       |

## Wording changes

The empty-outcome second sentence now says “No agent files were written in this run” because skipped outcomes mean files were processed. Cancelled and timed-out runs get their own headers and “Review agent run” link copy. Unknown generation errors use safe generic wording; recognized kinds use `safeFailureCopy`. The restored workflow labels, tips, and example command wording match the deleted completion page.

## Decisions

The bound run contract does not declare `errors`. A legacy bound result with an `errors` array is validated at runtime; otherwise A5 reads `SetupWizardStateService.completionData().errors` only when its result facts match the bound run. A failed run without usable error detail shows a generic reason. The report and page changes stay within the requested scope. No CLI skill-loading mechanism was exposed; I read `.claude/skills/angular-frontend-patterns/SKILL.md` directly and applied its signal and OnPush guidance.

## Not fixed

No Round 2 finding remains open. A rendered UI or capture review was not run because this task forbids launching the app or Playwright.

## Verification

1. `npm run verify -- -p @ptah-extension/onboarding` — exit 0; exact Nx summary: `NX   3 tasks: 3 succeeded`.
2. `npm run verify -- -t typecheck -p ptah-extension-webview,ptah-electron` — exit 0; exact Nx summary: `NX   2 tasks: 2 succeeded`.

The first command waited 1,425 seconds for the shared verify lock before it acquired a slot. No capture or application target was run.
