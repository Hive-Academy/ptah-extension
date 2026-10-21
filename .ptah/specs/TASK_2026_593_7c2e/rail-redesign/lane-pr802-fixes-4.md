# PR #802 attention rail fixes, round 2

## Changes and verification

1. Denial form Escape and Cancel now return focus to More, with a Deny fallback when More is unavailable (`libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:96-113`, `:147-150`). The focus assertions cover both close paths (`attention-permission-actions.component.spec.ts:67-87`). **Tests: 7 passed, 7 total.**
2. Bell actions for question, failure, and lane items now disable after the store records a stale outcome. `isStale` derives from the existing status signal and is used by both bell row layouts and the dispatch guard (`libs/frontend/notification-center/src/lib/notification-center.store.ts:80-82`, `:99`; `notification-center.component.ts:61`, `:85`). Parameterized stale outcome assertions cover all three kinds (`notification-center.component.spec.ts:196-225`). **Tests: 11 passed, 11 total.** The unchanged store regression spec also passes: **Tests: 7 passed, 7 total.**
3. Send denial now disables when `deny_with_message` has a disabled or unavailable reason, and direct form submission is guarded as well (`libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:55`, `:138`). The unavailable outcome spec checks the disabled button and blocked submit (`attention-permission-actions.component.spec.ts:90-112`). **Tests: 7 passed, 7 total.**
4. The snackbar host now uses the existing 900 px narrow signal to set `bottom: 9.5rem`; wide windows retain `bottom: 1rem` and `right: 1rem` (`libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:18-20`, `:105`). The narrow and desktop position assertions are in `notification-snackbar.component.spec.ts:130`, `:184-195`. **Tests: 12 passed, 12 total.**

## Decisions

- Reused the snackbar's existing width signal for position because it already tracks the 900 px breakpoint. CSS-only media rules could not be asserted reliably in this Jest DOM environment. Reversible.
- Kept stale status interpretation in the store, where the status signal and dispatch guard already live. Reversible.

## Not done

- No Electron visual capture was rerun; the allowed verification was limited to the named Jest specs. Scoped diagnostics found no errors in requested files; the compiler reported 103 errors in sibling files outside this batch.
