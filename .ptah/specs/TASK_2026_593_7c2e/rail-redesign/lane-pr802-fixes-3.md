# PR #802 revision, round 1

## Review defects

1. **Snackbar preview:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:37,50-51,68` now uses `permissionPreview` in second-row metadata, keeps the full text in `title`, and attaches a screen-reader description. Verified by `notification-snackbar.component.spec.ts:35-43`.
2. **Bell unavailable actions:** `libs/frontend/notification-center/src/lib/notification-center.store.ts:85-88,95` exposes stored reasons and blocks repeated dispatch; `notification-center.component.ts:56,84` passes reasons and stale busy state to the shared control. Verified by `notification-center.component.spec.ts:173-198` and `notification-center.store.spec.ts:116-134`.
3. **Snackbar stale:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:96,113-116,153,207,220-224` latches stale by key and generation, disables every action, and guards the dispatcher. `notification-snackbar.component.spec.ts:74-91` asserts a second click makes no second `dispatchOutcome` call.
4. **Clipped More:** `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:23-37` places extra actions in an inline disclosure below the action row, with stable `aria-expanded` and `aria-controls`; the rail and bell scroll containers now contain the expanded row. Verified by `attention-permission-actions.component.spec.ts:80-103` and `canvas-rail.component.spec.ts:178-194`.
5. **Focus:** `attention-permission-actions.component.ts:73-74,85-87,90-93,105-118` focuses the first enabled extra action on opening and returns focus to More on Escape or selection. Assertions: `attention-permission-actions.component.spec.ts:80-119`.
6. **Unique IDs:** `attention-permission-actions.component.ts:4,20,25,28,33,40,45-52,63` uses a per-instance suffix for disclosure, reason, field, and error IDs. Verified with simultaneous duplicate-key mounts in `attention-permission-actions.component.spec.ts:120-131`.

## Visual items

- **Bottom-right stack and width:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` fixes the stack at `right: 1rem; bottom: 1rem` with a 20rem maximum width. Existing 2-card desktop and 1-card narrow limit remains at `:97-105`.
- **Overflow count:** `notification-snackbar.component.ts:28-33` places `+N more` first inside the stack and uses the existing `openNotifications` output. Verified by `notification-snackbar.component.spec.ts:108-135`.
- **Compact height:** `notification-snackbar.component.ts:35,45,50,57` tightens padding, row gap, close button, and action buttons; `attention-permission-actions.component.ts:15-25` uses 28px buttons in compact mode. Target is approximately 64-72px in the ordinary closed state; no screenshot or pixel measurement was permitted in this lane.
- **Visible permission controls:** `attention-permission-actions.component.ts:76-79` keeps the primary, Deny, and More visible; Show in canvas, Always allow, and Deny with message are disclosed when they are not primary. This shared control serves rail, bell, and snackbar. Verified by `attention-permission-actions.component.spec.ts:104-119` and `canvas-rail.component.spec.ts:178-194`. The session card chip was not changed.

## Specs and verification

- `libs/frontend/core/src/lib/components/attention-permission-actions.component.spec.ts` — `Tests:       6 passed, 6 total`
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.spec.ts` — `Tests:       12 passed, 12 total`
- `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts` — `Tests:       8 passed, 8 total`
- `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts` — `Tests:       7 passed, 7 total`
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts` — `Tests:       30 passed, 30 total`

`git diff --check` passed. Scoped `ptah_get_diagnostics` reported no errors in requested core and snackbar files or the changed core spec. It also reported existing errors in unrelated sibling specs; a broader scoped request timed out and returned unchecked coverage.

## Decisions

- **Inline disclosure:** Options were an overlay or an in-flow row. The rail and bell both scroll and clip an overlay; the requested in-flow row fits their cards. Reversible: yes.
- **Stale generation latch:** Options were disabling only the clicked action or the whole item. A stale generation makes every action obsolete; the snackbar and bell now block the item until generation changes. Reversible: yes.
- **Preview placement:** Options were an added row or replacing the workspace chip. The compact height target and explicit request support replacement, with a full title and accessible description. Reversible: yes.

## Not done

- No Electron visual capture or pixel measurement; the allowed verification commands were limited to the five Jest specs above. No files outside the assigned frontend paths were changed, apart from this required handoff.
