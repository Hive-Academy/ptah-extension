# Code logic review — PR #802 attention-rail fixes, round 2

**Verdict: APPROVED**
**Score: 7/10**
**Review family: grok (implementer: codex)**

Uncommitted diff on `feat/attention-rail-redesign`. Read in full: `attention-permission-actions.component.ts`, `notification-snackbar.component.ts`, `notification-center.component.ts`, `notification-center.store.ts` (`activate` through `focus`), and the permission-action, snackbar, bell, and store specs that cover this round. Rail `activate` / `isBlocked` / the needs-you row (`canvas-rail.component.ts:181-215`, `:397-438`) and `snackbars` ordering (`notification.service.ts:48-53`) read for the decision and overflow paths. `app-shell.component.ts:181-188` and `electron-shell.component.ts:406-413` read for the `+N more` bell path. No nx, Jest, tsc, lint, or build was run. Lane-reported Jest passes were not re-executed.

This is 7, not 8: three user-visible holes remain, and none of them send a second decision. It is not 5–6: defects 1–6 from `code-logic-review-pr802-fixes.md` are fixed in the code those findings cited, and Allow, Always allow, Deny, Deny with message, and Show in canvas still reach the dispatcher.

## Decisions

- Prior defects 1–6 are closed. The new holes do not resend a permission decision, so they stay minor and do not force REVISE.
- A disabled Allow ghost next to a promoted Show in canvas stays accepted. Round 1 already treated that ghost as correct, and `visibleActions` still implements it (`attention-permission-actions.component.ts:78`).
- Rail still blocks the whole card on any status, including per-action `unavailable`. That contract was already accepted and was not reopened.

## Prior defects

1. **Fixed.** Compact snackbar shows `permissionPreview` in the second-row span (`notification-snackbar.component.ts:51`, `title` is the full string) and points the card at `snackbar-preview-<key>-<generation>` (`:37`, `:68`). The shared control still hides its own preview when `compact()` is true (`attention-permission-actions.component.ts:12-13`); the snackbar host is the surface that shows it. Spec asserts the visible text, the `title` span, and that `aria-describedby` matches that sr-only id (`notification-snackbar.component.spec.ts:35-44`).

2. **Fixed for permission rows.** `unavailableFor` returns the store map filtered to `key:generation:` (`notification-center.store.ts:85-88`). Both permission mounts pass it and treat status `Already answered` as busy (`notification-center.component.ts:56`, `:84`). `activate` returns before dispatch when `disabledReason` or that status is set (`notification-center.store.ts:95`). The bell spec disables Allow, keeps Deny, and asserts one `dispatchOutcome` (`notification-center.component.spec.ts:173-193`). The store spec asserts a later Deny is not dispatched after stale (`notification-center.store.spec.ts:116-124`). Non-permission bell buttons are new defect 2, not a reopen of this one.

3. **Fixed.** Stale stores `key:generation` and the status string (`notification-snackbar.component.ts:220-222`). `dispatch` returns when that set, `pending`, or `actionReason` is set (`:207`). Permission `busy` includes the same set (`:53`), and non-permission buttons use `actionReason`, which returns `Already answered` (`:153-155`). The spec's second click leaves `dispatchOutcome` at one call (`notification-snackbar.component.spec.ts:74-90`).

4. **Fixed.** Extra actions are an in-flow disclosure (`attention-permission-actions.component.ts:23-37`), not `absolute` / `top-full`. The rail list scrolls (`canvas-rail.component.ts:191`, `overflow-y-auto`) and the bell panel scrolls (`notification-center.component.ts:33`). Opening More grows the card inside the scroller; focusing the first extra button (`attention-permission-actions.component.ts:85-87`) is what scrolls it into view. The snackbar stack is `bottom: 1rem; right: 1rem` with a 20rem cap (`notification-snackbar.component.ts:20`), so the row grows upward from that corner.

5. **Fixed for More.** Opening focuses the first enabled extra button (`attention-permission-actions.component.ts:85-87`). Escape and choosing an extra action call `closeMenu`, which stops the event and focuses the More trigger (`:111-117`). Specs assert both (`attention-permission-actions.component.spec.ts:93-102`, `:105-117`). Denial-form Escape is new defect 1.

6. **Fixed.** Reason, disclosure, field, and error ids include `instanceId` (`attention-permission-actions.component.ts:4`, `:20`, `:25`, `:28`, `:33`, `:40`, `:45-52`, `:63`). Two mounts of the same key get different `aria-describedby` values (`attention-permission-actions.component.spec.ts:120-131`). Snackbar preview ids also include key and generation (`notification-snackbar.component.ts:37`, `:68`). The module counter only increments; the resize listener is removed on destroy (`notification-snackbar.component.ts:103-107`). No new document listener is registered in the permission control.

## New defects

1. **Minor** — Escape or Cancel on Deny with message drops focus. `cancel` stops the event and clears `expanded` (`attention-permission-actions.component.ts:131-135`). The Cancel button calls `toggleMessage` (`:55`, `:95-98`), which does not focus anything. `choose('deny_with_message')` has already closed More (`:105-107`), so the field that held focus is removed and focus falls to `document.body`. More is still in the document. The spec only asserts the form node is gone (`attention-permission-actions.component.spec.ts:67-78`). More's own Escape path still returns focus (defect 5).

2. **Minor** — Bell question, failure, and lane buttons stay enabled after a stale outcome. Needs-you disables those buttons only for `disabledReason` or `isSubmitting` (`notification-center.component.ts:61`). The recent-notices branch does the same (`:85`). `activate` still writes `Already answered` (`notification-center.store.ts:109`) and returns false on the next call (`:95`), so a second click does not dispatch. The status line is visible (`notification-center.component.ts:70`, `:88`), and the control still looks live. Permission rows on the same card do latch, via `busy`.

3. **Minor** — Send denial stays enabled after `unavailable`. The submit button checks `busy()` only (`attention-permission-actions.component.ts:55`, `:122`). Snackbar `busy` is pending or stale (`notification-snackbar.component.ts:53`), not the unavailable map. Bell `busy` is submitting or status `Already answered` (`notification-center.component.ts:56`, `:84`), while `unavailable` stores a different status string (`notification-center.store.ts:110-112`). `submit` emits again (`attention-permission-actions.component.ts:128`). Snackbar `dispatch` and bell `activate` then return because `actionReason` / `disabledReason` is set (`notification-snackbar.component.ts:207`, `notification-center.store.ts:95`). The click does not send a second denial. Rail does disable the form, because any status sets `isBlocked` (`canvas-rail.component.ts:201`, `:401`).

## Check 1 — Defects 1–6

All six are fixed on the paths cited above. Preview text is in the compact card and in the accessible description. Bell permission actions take stale and unavailable from the store. Snackbar stale latches before a second `dispatchOutcome`. The disclosure is in flow, so the rail and bell scrollports include it. More moves focus in and back. Ids differ per instance.

## Check 2 — Decisions and one primary

`visibleActions` is Allow, Deny, and the primary (`attention-permission-actions.component.ts:75-79`). Everything else is in the disclosure. `primaryAction` is enabled Allow, else enabled Show in canvas (`open`), else the first enabled action that is not `deny_with_message` (`:75-77`). Only that id gets `btn-primary` (`:18`). Disclosure buttons are `btn-ghost` (`:31`).

- Allow, Deny, and a promoted Show in canvas emit `{ actionId }` from `choose` (`:105-108`).
- Always allow is in the disclosure and uses the same emit. The spec clicks it (`attention-permission-actions.component.spec.ts:114-116`).
- Deny with message opens the form and emits only from `submit`, with a trimmed reason (`:120-128`). Whitespace sets `reasonError` and does not emit (`:123-125`).
- Bell `activate` (`notification-center.component.ts:180-182`), snackbar `dispatch` (`notification-snackbar.component.ts:206-219`), and rail `activate` (`canvas-rail.component.ts:405-419`) forward `actionId` and `reason`.
- In-flight clicks are dropped by snackbar `pending` (`:207-208`), bell `submitting` (`notification-center.store.ts:97-98`), and rail `submitting` (`canvas-rail.component.ts:407-411`). After stale or unavailable, the guards in check 1 and new defects 2–3 block another send. `choose` has no guard of its own; the hosts do.

## Check 3 — `+N more`, timers, dismiss

`snackbars` is newest-first (`notification.service.ts:48-53`). `visible` is `slice(0, limit).reverse()` and `overflow` is `max(0, length - limit)` (`notification-snackbar.component.ts:97-99`). Desktop limit 2 and narrow limit 1 are set from `innerWidth <= 900` (`:104`). Four items at 1200px render two cards and `+2 more`, with the overflow button first in the column and card text `failure-2` (`notification-snackbar.component.spec.ts:121-135`), which is the older of the two newest. The click stops propagation (`notification-snackbar.component.ts:32`) and emits `openNotifications`. App shell and Electron shell both call `bell.openPanel()`, or remember the open if the bell is not mounted yet (`app-shell.component.ts:181-188`, `electron-shell.component.ts:406-413`). Hidden snackbars are the older entries; the bell lists needs-you and recent notices.

Hover, focus, and dismiss still call `pauseSnackbar`, `resumeSnackbar`, and `dismissPresentation` (`notification-snackbar.component.ts:171-204`). The pause effect still resumes keys that leave the visible set (`:119-125`). The hover spec still expects the card to survive a paused gap and then expire (`notification-snackbar.component.spec.ts:140-153`).

## Check 4 — Regressions

No `any`, no new cast, no `text-base-content/NN`, and no `[innerHTML]` in the permission control, snackbar, bell component, or store. Existing `catch` blocks still replace the failure with `Action unavailable` (`notification-snackbar.component.ts:232-233`, `notification-center.store.ts:123-127`, `canvas-rail.component.ts:429-430`). The snackbar rejection spec still requires the private error text to be absent (`notification-snackbar.component.spec.ts:93-104`). The store still logs the rejection (`notification-center.store.ts:125`). The instance counter and the resize listener are not leaks (defect 6).

## Check 5 — Specs

The new assertions follow clicks and outcomes: denial payload and whitespace rejection, More focus in and back, distinct reason ids, snackbar preview id, one stale `dispatchOutcome`, overflow count and stack order, bell unavailable without a second call, and the store stale latch. They are not tautologies. Gaps that match the new defects: denial Escape does not assert `document.activeElement`, the bell component spec never clicks after stale, and no spec asserts that Send denial disables after `unavailable`.

## Five logic questions

1. **Silent success.** A second click after stale or unavailable does not dispatch (checks 1–2). Send denial after `unavailable` looks enabled and then does nothing (new defect 3). A non-permission bell button does the same after stale (new defect 2).
2. **User action.** Escape or Cancel from the denial field leaves focus on `document.body` (new defect 1). Click Answer on a stale bell question (new defect 2).
3. **Wrong answer without an error.** Whitespace-only denial still does not submit (`attention-permission-actions.component.ts:123-125`). No new path submits a different action id than the one the user chose.
4. **Dependency failure.** `unavailable` disables that action on the shared control via `reasonFor` (`attention-permission-actions.component.ts:100-102`) and blocks a second host dispatch. It does not disable Send denial (new defect 3). A thrown dispatch becomes the fixed string `Action unavailable` and does not render the error. A generation change drops rail status (`canvas-rail.component.ts:397-400`) and filters snackbar stale and unavailable keys (`notification-snackbar.component.ts:115-118`).
5. **Missing from the requirements.** The denial form's focus return and the non-permission bell latch were not in the fix list. They are the minors above. Nothing in the requested decision set is unreachable.

## Remaining uncertainty

Lane Jest results were not re-run. Focus timing is taken from the spec expectations and from `effect` plus `closeMenu`, not from a browser. Scroll-into-view on a bottom rail card was not measured; the disclosure is in the scrollable list, which is the clipping fix. Electron placement at 1440×900 and 800×900 was not captured.
