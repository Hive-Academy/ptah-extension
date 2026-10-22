# Code logic review — PR #802 attention-rail fixes, round 3

**Verdict: APPROVED**
**Score: 8/10**
**Review family: grok (implementer: codex)**

Confirmation pass on the uncommitted round-2 edits. Read `attention-permission-actions.component.ts` (template through `cancel`), bell template rows and `isStale` / `activate` guard, snackbar host styles and the 900px `limit` setter, and the new spec cases. No nx, Jest, tsc, lint, or build was run. Lane-reported Jest passes were not re-executed. Accepted behavior from rounds 1–2 was not reopened.

This is 8, not 9: the three minors and the offset are fixed in source, and the specs follow clicks and outcomes, but this pass did not re-run those specs or capture the narrow snackbar in Electron. It is not 7: nothing in this round leaves a decision enabled after stale or unavailable, and Escape/Cancel now has a live focus target.

## Minors 1–3

1. **Fixed.** Escape calls `cancel`, which calls `toggleMessage` (`attention-permission-actions.component.ts:147-150`). Cancel uses the same method (`:56`). Closing the form calls `returnFocus` (`:96-100`). That focuses More when it is present and not disabled, otherwise the visible Deny button (`:106-113`). More is `#moreButton` (`:24`) and Deny is `#visibleButton` (`:17`). The spec asserts `document.activeElement` is More after Escape and after Cancel (`attention-permission-actions.component.spec.ts:67-87`).

2. **Fixed.** `isStale` is status `Already answered` (`notification-center.store.ts:80-82`). Needs-you and recent-notice buttons include it in `[disabled]` (`notification-center.component.ts:61`, `:85`). `activate` returns before dispatch when `isStale` is set (`notification-center.store.ts:99`). The parameterized spec covers question/Answer, failure/Retry, and lane-permission/Deny: the button starts enabled, is disabled after the stale outcome, the row shows `Already answered`, and a second click does not call `dispatchOutcome` again (`notification-center.component.spec.ts:196-220`).

3. **Fixed.** Send denial is disabled when `busy()` or `reasonFor('deny_with_message')` (`attention-permission-actions.component.ts:55`). `submit` returns on the same condition before emit (`:138`). `reasonFor` reads `disabledReason` or the unavailable map (`:116-118`). The spec sets that map entry, expects the button disabled, and expects `selected` not to fire on submit (`attention-permission-actions.component.spec.ts:90-112`).

## Narrow offset

**Fixed as specified.** `bottom` is `9.5rem` only when `limit() === 1`, otherwise `1rem` (`notification-snackbar.component.ts:18`). `right: 1rem` stays on `:host` with no narrow override (`:20`). `limit` is 1 only when `innerWidth <= 900`, otherwise 2 (`:104`). The desktop spec expects `host.style.bottom === '1rem'` at width 1200 (`notification-snackbar.component.spec.ts:130`). The narrow spec expects one card, `+1 more`, and `bottom === '9.5rem'` at width 900 (`:184-195`).

## Regressions

No `any`, no new cast, no `text-base-content/NN`, and no `[innerHTML]` in the permission control, bell component, store, or snackbar. `cancel` still stops the event (`attention-permission-actions.component.ts:148-149`). Store and snackbar `catch` paths were not changed this round. The focus target for the denial form is the More button, which is in the document whenever Deny with message is in the disclosure.

## New defects

None.

## Remaining uncertainty

Lane Jest results were not re-run. `right: 1rem` is stylesheet text; the specs assert the bound `bottom` only. Electron placement of the 9.5rem offset above the composer was not captured.
