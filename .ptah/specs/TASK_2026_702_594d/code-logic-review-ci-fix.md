# Code Logic Review - CI fix lanes (PR #783 and PR #785)

Scope: uncommitted diffs in `attention-notifications` (Lane A import merge + stale-history alert, Lane C bell empty state) and `chat-needs-you-removal` (Lane B e2e helper). No checks were run (orchestrator owns the queue). Reading was by diff plus the surrounding code cited below.

| Item | Verdict | Score |
| --- | --- | --- |
| a) Lane A import merge and stale-history inline alert | APPROVED (one Serious follow-up, see A1) | 7/10 |
| b) Lane C bell empty state and header "Clear all notices" | APPROVED (two Minor) | 8/10 |
| c) Lane B `closeOpenPopover` | APPROVED (one Moderate, pre-existing weak assertions) | 7/10 |

## a) Lane A

Import merge: `apps/ptah-extension-webview/src/app/app.config.ts:107-114` now has a single `@ptah-extension/git-ui/services` import containing `provideGitStatusAttention`. This is behaviour-neutral and satisfies the spec that reads the first import. OK.

Inline alert (`chat-view.component.ts:263,278-290`, `.html:84-90`):

- A1 (Serious, `chat-view.component.ts:279-284`): the alert only clears at the start of the next `onOlderHistoryRequested`. After a stale result `history-paging.service.ts:88` nulls the cursor, so the "Load earlier messages" button is hidden and nothing can ever call `onOlderHistoryRequested` again for that tab. The message stays visible until the component is destroyed, even after the user does exactly what it says ("Reopen the session") and the tab gets a fresh cursor. A reopened session in the same tab shows a stale "Earlier history changed" error beside a healthy transcript. Fix: clear the signal when the tab's `olderHistoryCursor` becomes a string again, or when the tab's sessionId changes (an `effect`/`computed` keyed on the cursor), or make the alert a derived value (`alert.tabId === resolvedTabId() && !hasOlderCursor`).
- Races: concurrent `loadOlder` calls are de-duplicated per tab by `inFlight` (`history-paging.service.ts:62-71`), so two callers share one outcome and both set the same alert; a "late stale after a newer attempt" cannot occur because stale clears the cursor and hides the trigger. Tab switching is handled by the `alert.tabId === resolvedTabId()` guard in the template. Each tile is its own component instance with its own signal, so multiple tiles do not cross-show. OK.
- E2E: `tile-load-older-history.spec.ts:370-384` does `tile.getByRole('alert')` with `toContainText(/reopen the session/i)`. The alert renders inside the chat view (the `sessionControls` slot), so it is inside the tile and the text matches. Residual risk: `getByRole('alert')` is strict-mode; if any other `role="alert"` renders in the same tile at that moment (the template has the new one at html:86 only per grep, so currently one) it passes. OK.
- Duplication with the attention notice (Minor): the same message is raised as an inline `role="alert"` and via `showActionError` (a bell/snackbar notice with its own announcement), so assistive tech may announce it twice. Consistent with the "in-context errors" intent in context.md (inline plus notice), but worth confirming decision #8 allows both; the failed branch (`:287-290`) has no inline counterpart, so the two outcomes are inconsistent (Minor).
- Formatting: `showActionError(\n message,\n tabId,\n)` is left in a multi-line form; style only.
- Spec: asserts alert set, `showErrorMock` called, no session switch, and cleared on a following request (`chat-view.component.spec.ts`). The "cleared" assertion exercises only the start-of-request path, which is the very behaviour A1 shows is insufficient.

## b) Lane C

- Matches design-spec "Layout and anatomy": sticky header holds Notifications, sound toggle and Clear all notices; empty copy is exactly "All clear / Nothing needs your attention."; Needs you gets a count.
- Focus: `#panelHeading` is in the `<header>` (`notification-center.component.ts:43`), outside the new `@if/@else`, so it exists in both branches. `viewChild` at `:148` resolves, and `:183` still falls back to it. OK.
- Decisions #15/#16: the button calls `store.clearAll()` which is guarded by `canClearAll()` (`notification-center.store.ts:60-61`) and delegates to the existing service, unchanged, so semantics (Recent notices plus transient failure/warning snackbars, never Needs you) are preserved. The button is `disabled` when nothing is clearable. OK.
- Accessibility: the button has `aria-label="Clear all notices"` and also visible text "Clear all notices", the same name, so no label-in-name mismatch. The Check icon is `aria-hidden`; the empty-state `h3` follows the `h2`. OK.
- B1 (Minor): the empty state gates on `needsYou().length === 0 && recentNotices().length === 0`, but `canClearAll()` also counts transient snackbars. With only a transient snackbar present, the panel shows "All clear" while "Clear all notices" is enabled. This is consistent with the spec ("enabled when ... transient snackbar present") but looks odd; acceptable.
- B2 (Minor): when only Needs you rows exist, the "Recent notices" section still renders its heading with no rows and no empty text; not part of this change.
- Spec (`notification-center.component.spec.ts`): now clicks the header button, spies on `store.clearAll`, asserts the Needs you row survives and the button disables afterwards. This tests real behaviour (not just rendering).

## c) Lane B

- Escape reaches the handler: `native-popover.component.ts:80` binds host `(keydown)`; `handleHostKeyDown` (`:331`) emits `closed` when open; `openPopover` focuses the floating panel (`:228,249`), so a document-level `keyboard.press('Escape')` bubbles to the host. The canvas also registers an anchor Escape fallback and `handleCancelSession` (orchestra-canvas.component.ts ~:600) closes it. The test-id sits on content inside the floating panel (`orchestra-canvas.component.ts:118`), and the panel is `visibility:hidden` until positioned, so `isVisible()` true implies the panel is shown; the focus call follows within one microtask continuation of the visibility change, so a press on a just-shown panel is a very small window (Minor flake risk; consider `await expect(popover).toBeFocused()`-free approach: `toBeVisible` then press is fine).
- Root cause plausibility: the old locator `div.fixed.inset-0[role=presentation]` matched the document-wide transparent backdrop, which the popover recreates on open/position cycles (`@if (hasBackdrop)`), so a click-retry against a re-rendering element is plausible. `git diff origin/main...HEAD -- orchestra-canvas.component.ts` shows only the removal of the needs-you queue (deferred component, import, and its header row); it adds no re-render logic around the popover, so the change does not introduce a production render loop here. A "detaching backdrop" in production is not evidenced by this diff, but also not disproven; the earlier failure may be timing-based around the removed `@defer` header shifting layout. Residual uncertainty: MEDIUM.
- C1 (Moderate, pre-existing, `session-create.e2e.spec.ts:25-95`): both tests are guarded by `if (await createBtn.count())` / `if (await nameInput.count())`, and the final assertions (`Array.isArray(all)`, no outbound `sessions:create` with empty name) pass vacuously when the button is absent or nothing is sent. They never assert that `sessions:create` was emitted with "Investigate cache bug". The Lane B change did not weaken them (the helper only closes the popover) but the helper is now stricter (`toBeHidden` fails if Escape did not close it), which is an improvement. Recommend a follow-up that asserts the outbound message, since the CI incident shows the scenario is otherwise lightly guarded.
- Behavioural change to note: in test 1 the popover is already closed by the create click, so `isVisible()` is false and only `toBeHidden` runs; it will not press Escape. Fine.

## Five questions (brief)

1. Silent failure: A1 (stale error persists after recovery). C1 (vacuous e2e).
2. Unexpected user action: reopening a stale session in the same tab still shows the stale alert (A1).
3. Wrong-answer input: none beyond A1.
4. Dependency failure: `chat:history-page` failure leaves no inline alert, only a notice (inconsistent with stale branch; Minor).
5. Missing: a regression test that the alert clears once a fresh cursor is set (A1); an outbound-message assertion in the e2e (C1).
