# PR #802 follow-up

## Failures and changes

1. **Bell title missing — code regression.** The Needs you row displayed the session name as its heading and omitted `item.title`. `libs/frontend/notification-center/src/lib/notification-center.component.ts:52` now displays the request title and keeps the session name in metadata. The no-session-title assertion in `notification-center.component.spec.ts:113-114` now selects that metadata span and also checks the request title.
2. **Whitespace denial selector — stale spec.** The test treated the entire space-separated `aria-describedby` value as one CSS id. `libs/frontend/core/src/lib/components/attention-permission-actions.component.spec.ts:57-59` checks that the error id is in the attribute and resolves it with `getElementById`.
3. **Unavailable Allow button order — code and spec.** The shared control hid disabled Allow when Show in canvas became primary. `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:73` retains Allow as a visible disabled secondary action. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts:119-125` selects Allow and Show in canvas by their labels and checks exactly one primary.
4. **Stale and unavailable outcomes — code and spec.** The More trigger remained enabled while the rail blocked a request, and the test counted buttons by position. `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:23` disables More while busy; its menu items already bind to `busy()`. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts:176-191` checks named actions and More are disabled, dispatch is not repeated, and a generation change clears the status and re-enables controls.

## Decisions

- Keep disabled Allow visible when Show in canvas is the fallback primary. This preserves the reason for the disabled decision and still fits the rail's three-button row. Reversible.
- Keep the request title as the bell card heading and move the session title to metadata. The bell needs both values, and the existing fixture requires the request title. Reversible.

## Verification

Only the four permitted spec files were run, one Jest process at a time:

- `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts` — `Tests:       7 passed, 7 total`
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.spec.ts` — `Tests:       12 passed, 12 total`
- `libs/frontend/core/src/lib/components/attention-permission-actions.component.spec.ts` — `Tests:       4 passed, 4 total`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts` — `Tests:       30 passed, 30 total`

Scoped `ptah_get_diagnostics` reported no diagnostics in requested files. It also reported 103 errors in sibling files, including existing core service specs outside this lane's ownership.

## Not done

- No Electron visual review was run in this follow-up.
