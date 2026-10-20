# TASK_2026_707 PR 1 frontend logic review — round 2

**Verdict: APPROVE WITH FIXES.** The requested presentation fixes are in place and the three focused Jest suites pass (60 tests). One existing TypeScript error in the frontend model spec still needs correction before this area can pass a scoped type check. No new behavioral regression was found in the round-one fix.

## Original frontend items

1. **Defect 3 — FIXED.** `plan-tile-view.model.ts:89-107` maps exactly the 12 requested `PlanLimitStatusReason` keys; `:119-126` returns null for an unknown runtime value. For a windowless owner, `:544-553` selects the typed reason before generic provider text, `:583-586` leaves “Open Antigravity” as fallback, and `:639-647` gives the reason first place in the bar-slot pill. The Antigravity parse-failure and fallback tests are at `plan-tile-view.model.spec.ts:555-579`; the Grok API-key priority test is at `:508-540`. The stale branch at `plan-tile-view.model.ts:534-543` retains its documented freshness priority.
2. **Defect 6 — FIXED.** `plan-tile-view.model.ts:727-740` sorts per-model counts, renders the top five and “and N more”; `:781-785` adds them to the secondary tooltip and accessible text. `provider-account-tile.component.html:106-120` renders the total request count and a neighboring screen-reader detail. Model and DOM assertions are at `plan-tile-view.model.spec.ts:375-419` and `provider-account-tile.component.spec.ts:353-387`.
3. **Partial Ollama read — FIXED for the specified `balance-unavailable` and `balance-auth-rejected` snapshots with local usage.** The typed reason wins the empty bar slot at `plan-tile-view.model.ts:639-647,907-909`; the request count is retained at `:750-755`. `plan-tile-view.model.spec.ts:614-651` checks both pill strings, the absent bar, and the count. The generic “No plan limits reported” branch at `plan-tile-view.model.ts:594-595` cannot win these cases.

## Coverage loss

All five cases named in the prior review now have focused assertions:

| Prior case | Restored test and implementation |
| --- | --- |
| Reset passed versus next reset | `plan-tile-view.model.spec.ts:655-694`, “reports a passed reset and the next reset as separate facts”; `plan-tile-view.model.ts:280-338`. |
| Bar color, neutral states, 90% marker | `plan-tile-view.model.spec.ts:697-774`, “colours the primary bar…” and “keeps a neutral bar…”; DOM marker and fill in `provider-account-tile.component.spec.ts:308-351`. |
| Active, expired and estimated evidence | `plan-tile-view.model.spec.ts:776-835`, “separates active, expired and estimated owner evidence”; `plan-tile-view.model.ts:801-820`. |
| CLI range conversion and exact-range tooltip | `plan-tile-view.model.spec.ts:320-373`, “shows tokens and cost…” and “falls back to the raw string…”; `plan-tile-view.model.ts:705-716,762-770`. |
| Distinct Ollama key/source and Antigravity status sentences | `plan-tile-view.model.spec.ts:543-651`, typed-reason priority, app fallback, rejected sign-in, Ollama key/source, and partial-read tests; `plan-tile-view.model.ts:527-647`. |

## Newly observed issue and regression check

1. **Minor, existing test type error; fix required for a clean scoped type check.** `plan-tile-view.model.spec.ts:108-114` passes `percent: undefined` to the `win(Partial<PlanLimitWindow>)` fixture, but `PlanLimitWindow` has no `percent` property. `ptah_get_diagnostics` reports TS2353 on this fixture. Remove the stray property; `used: undefined` already expresses the test's unknown-usage case. This line was outside the round-one fix cases, so it is not attributed to the fix. The same diagnostic check also returned errors in sibling files, including `provider-account-card.component.spec.ts:310`; it is not evidence of a clean project-wide type check.

No regression introduced by the new reason precedence, model detail, or range tooltip was found in the reviewed paths. The model test checks the top-five bound, but no screen-reader integration test was run; the DOM test confirms that the accessible text is present beside the secondary line.

## Five logic questions

1. **Silent failure:** a balance failure with local usage now shows its typed cause in the pill (`plan-tile-view.model.ts:639-647`) while keeping request counts (`:750-755`); this path no longer looks like an ordinary no-limits result.
2. **Unexpected user action:** opening a failed Antigravity tile after malformed CLI output now sees “usage output not recognized,” rather than the generic app prompt (`plan-tile-view.model.ts:544-553,583-586`).
3. **Wrong answer from input:** more than five model entries produce five ranked details and a remainder count (`plan-tile-view.model.ts:730-740`); the exact CLI range remains in the tooltip (`:762-770`).
4. **Dependency failure:** a windowless owner with a typed status reason reaches the notice and bar-slot pill before provider fallback text (`plan-tile-view.model.ts:544-553,639-647`).
5. **Unspecified case:** a runtime reason newer than the frontend label map falls back to the status sentence (`plan-tile-view.model.ts:119-126,641-646`); the UI cannot give a precise remedy until a label is added.

## Verification

`npx jest -c libs/frontend/dashboard/jest.config.ts` on `provider-account-tile.component.spec.ts`, `plan-tile-view.model.spec.ts`, and `provider-account-card.component.spec.ts`, with `--coverage=false --maxWorkers=1`: **3 suites, 60 tests passed**. Scoped `ptah_get_diagnostics` found the test fixture TS2353 above; the HTML file was not recognized by that diagnostic tool. Backend and shared files were outside this review.

Review family: codex; implementer family: ptah-cli (Ollama Cloud).
