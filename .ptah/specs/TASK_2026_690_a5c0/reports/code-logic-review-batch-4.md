# Code Logic Review, Batch 4 (Sheet and migration), TASK_2026_690_a5c0

Review family: Claude reviewer, codex implementer.

Score: 6/10. Verdict: REVISE. Source reading plus the orchestrator's check results (3 projects PASS, eager gate 24/24). No rendered verification exists, and two findings below are layout bugs that jsdom cannot catch.

## Blocking
None.

## Serious

### S1. `container-type: size` on the session layout host breaks fixed-position composer popovers
- File: `chat-session-layout.component.ts` (`:host { container-type: size; }`, added in this batch).
- Why: size containment also applies layout containment, which makes the host the containing block for `position: fixed` descendants. The composer menus (model, effort, autopilot, MCP, attach, slash and @ suggestions) are in-place descendants positioned with Floating UI `strategy: 'fixed'` (`libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:148-153`). Floating UI's `isContainingBlock` (installed `@floating-ui/utils` 0.2.12) checks transform, filter, will-change and the `contain` property only; `container-type` leaves computed `contain: none`, so it does not compensate. Panels would be offset by the host's viewport origin (rail width, header height) in Electron and in Canvas panes. This is the same class of problem the Batch 1 fix round avoided by removing `overflow-hidden`.
- Fix: do not put `container-type` on an ancestor of the composer. Size the sheet with flex instead (see S2), or put the container on a wrapper holding only transcript and sheet. Either way, check every composer menu in a rendered pass.

### S2. Full-height mode ignores the composer and controls
- File: `display-sheet.component.ts:21-22`: `.sheet-body.full { height: calc(100cqh - var(--sheet-bar-height)); }`, where the container is the whole layout.
- Impact: the sheet region alone fills the layout minus the 36px bar, so the transcript shrinks to 0 (it is `min-h-0`) and the controls and composer (`flex-shrink-0`) are pushed past the bottom edge by their own height. With the Batch 1 fix there is no `overflow-hidden` to clip them, so the composer runs off the chat column and the user cannot type while the sheet is full. The batch report itself says full-height sizing "needs measurement against a tall composer".
- Fix: make the body a flex item (`flex: 1 1 auto; min-height: 0`) in the layout column so the transcript, not the composer, gives way; cap peek with a max-height relative to the layout without a size container. This also resolves S1.

### S3. Summary-action error message regressed, and the moved roles lost their tests
- Message: `display-sheet.component.ts:128` always sets "The review action failed.", whereas the deleted `display-dock.component.ts` used `error instanceof Error && error.message ? error.message : ACTION_FAILED_TEXT`. The actions service rejects with user-facing messages, and the plan required summary action failures to "retain the existing message" (plan section 4). The real reason is now discarded.
- Coverage: the deleted `display-dock.component.spec.ts` (308 lines) covered roles that moved into the sheet, but `display-sheet.component.spec.ts` has two tests (`:35`, `:59`). Dropped with no new home: surface, pin, view-state and summary binding; selection-to-strip-key mapping both ways; view-state write; openFile and review on the shown change set; rejection shown inline; the no-change-set message; per-tab restore of count and pin; the axe check. The removed rail-only tests (separator, width, overlay breakpoint, dock toggle) are legitimately gone; these are not.
- Fix: restore the `Error.message` passthrough and port the binding, action and axe tests to the sheet spec.

## Moderate

- M1. Opening via the inline action may not scroll the strip. `display-panel.component.ts:334-343` skips the first read (`previousExternalSelection !== undefined`). `openSurface` sets `open` and `selection` together while the panel sits under `@if (state().open)` and `@defer`, so the panel mounts already selected and never scrolls to that item; with the sheet already open it does scroll. The mount guard is a correct component fix (not a test edit) and keeps the four pin and scroll tests valid, but it leaves the primary Open in display path unscrolled when the sheet starts collapsed. The effect also fires on the user's own strip clicks and on unpinned auto-selection (selection echoes back as input); probably harmless duplicates, worth a look for double-scroll.
- M2. Collapse unmounts the panel (`display-sheet.component.ts:49`, `@if (state().open)`), whereas the old dock stayed mounted but hidden. Strip scroll, the panel's `newestSeq` baseline and renderer-local state reset on every collapse and reopen, and `@defer` shows "Loading display…" each time. View states persist through the dock store, so data is safe. Prefer keeping the region mounted (hidden and inert) after first open.
- M3. Spurious pulse on tab switch: `display-sheet.component.ts:88-101` compares the revision with a per-tab map defaulting to 0, so switching to a tab that already has `surfaceRevision > 0` pulses the bar with no new content. Seed the map with the current revision the first time a tab is seen.
- M4. The region's `(keydown.escape)` (`:51`) collapses on any Escape that bubbles up from the panel, including one meant to close an inner menu or renderer dropdown. Check `defaultPrevented` first.
- M5. The Canvas overlay selector `ptah-display-sheet [role="region"].full` (`canvas-rail-board.component.ts:40`) matches only full mode, which matches the plan (peek does not cover the pane). Correct.
- M6. The bar renders "Display · 0" in every Electron session even with no surfaces (`chat-view.component.html:271-273`). Consistent with the plan's thin bar; confirm with design whether to hide it until the first surface.

## Minor
- `aria-controls` points at an id that exists only while open (`display-sheet.component.ts:36`); set it only when open.
- Dense one-line templates (about 200 columns) will be reformatted by prettier.
- `execution-node.component.ts:460-468` puts new members before the inputs; style only.

## Focus checks

1. Binding answers: PASS for rail removal. The toggle, separator, width persistence, overlay mode and the dock component are gone (`chat-view.component.html` diff), and the VS Code Agents branch is preserved as `@if (!dockEnabled && !hideAgentSidebar && !showCompactCard())`. Electron agent auto-open still returns early on `dockEnabled` (`chat-view.component.ts:1460,1497`). Open in display: the inline output reaches `ExecutionNodeComponent.openInDisplay`, which checks the surface exists in the owning tab before `openSurface` (open plus select); a missing or evicted surface is a correct no-op. Pin keeps `setPinned` semantics with a visible button. Parity: every table row has a home except the items in S3 and M1.
2. N1: PASS. `DisplaySheetState` stores only peek or full per tab (`display-sheet.state.ts`); expansion is `DisplayDockState.open`; `forgetTab` is called at `chat-view.component.ts:1393`.
3. Sheet behaviour: the bar sits between the controls and the composer inside the layout's `sessionSheet` slot, PASS. Auto-open follows the existing close-suppression rules and moves no focus (the only focus call is in `collapse()`). Keyboard: aria-expanded, Escape returns focus to the bar, ArrowUp/End go full and ArrowDown/Home go peek, PASS. Reduced motion, PASS. Own bounded scroller by source, PASS, but see S1 and S2 for sizing.
4. display-panel guard: correct fix, see M1.
5. Spec migration: the removed tests in `chat-view.dock.spec.ts` (toggle, separator width, overlay, restore) and `chat-view.keepalive.spec.ts` (breakpoint tests) were rail-only. The retained or renamed tests (chunk failure, agent isolation, same-instance update, coordinator keeps mounted) still cover non-rail behaviour. `canvas-detail-transcript.component.spec.ts` is a rename to the sheet. The only real loss is the deleted dock-component spec (S3).
6. Eager gate: the sheet bar and state are eager and `DisplayPanelComponent` is deferred (`@defer (on immediate)`); the orchestrator's 24/24 gate run covers it. The PANE_OVERLAYS edit is correct (M5).
7. `chat-view.component.ts` is 2041 lines (was 2082): accepted; the drop is the removed width persistence and rail wiring.

## Required to approve
1. S1 and S2 (drop `container-type: size`, make full height respect the composer), with a rendered check of composer menus and full mode at 1440 and 760.
2. S3 (restore the `Error.message` passthrough; port the dock-component binding, action and axe tests).
3. Fix or consciously accept M1 to M3.

## Re-review

Review family: Claude reviewer, codex implementer. Score: 8/10. Verdict: APPROVED (last round; follow-ups below are non-blocking).

### Findings verified

- S1 container-type: fixed for what this task introduced. `chat-session-layout.component.ts` no longer sets `container-type` (the file now has only the max-width token and the `.hidden` rule). `chat-view.component.css:14` (`.cs-shell { container-type: inline-size; }`) is NOT new: it exists in HEAD at the same line (it backs the inspector shell band logic), so Batch 4 did not add any containment ancestor to the composer. Whether that pre-existing inline-size container already shifts the `strategy: 'fixed'` Floating UI menus (layout containment makes it the containing block) is unchanged by 690; if menus looked right before, they still do. Left as a verify item, not a regression.
- S2 full height: fixed by source. Peek is `flex: 0 1 40%`, full is `flex: 1 1 100%` on the host (`display-sheet.component.ts:22-24`), the transcript wrapper is `flex-1 min-h-0` (basis 0) and the controls and composer are `flex-shrink-0`, so in full mode the sheet is the item that shrinks (to the layout height minus controls and composer, floor 2.25rem) and the composer stays visible; the transcript yields to zero height, which matches "full available chat height". Closed is `flex: 0 0 auto` (bar only).
- S3: fixed. `runAction` shows `error.message` when it is an `Error` with text, else the generic fallback (`:145`). The sheet spec now lists surface, pin, view-state, summary, selection mapping, file/review, missing change set, service error, per-tab restore and axe cases (fix report cites `display-sheet.component.spec.ts:95,125,193,228`); the orchestrator's 3-project run passes.
- M1 scroll on open: fixed. `scrollToSelectedOnMount` lets the first mount scroll when a surface is selected (`display-panel.component.ts` effect), and for an already-mounted panel the selection change scrolls through `afterNextRender`, which runs after the same change-detection pass that clears `display: none`, so the element is laid out when `scrollIntoView` runs. Both the first-open and the reopen paths work by reasoning. The default stays no-scroll, so the mount tests remain valid.
- M2: fixed. The region mounts on first open (`everOpened`), then is hidden, `inert` and `display: none` while closed (`:50-53`), so the panel instance and its state persist.
- M3: fixed. The effect seeds the revision and cancels any pulse timer when the visible tab changes (`:92-101`), and the queued microtask checks `visibleTabId` (`:107`).
- M4: fixed. `onRegionEscape` ignores `defaultPrevented` events and non-keyboard events (`:124-128`).

### The "four test-premise problems" claim
Verified, no component bug hidden:
- The TS2345 was a real component typing issue (Angular types `(keydown.escape)` as `Event`) and was fixed in the component, not the test.
- Three specs queried the `@defer (on immediate)` panel synchronously; the deferred block renders asynchronously, so awaiting `whenStable()` is the correct fix and the assertions on mount identity, restored selection and action errors remain.
- The full-mode spec could not read `flex-basis` because jsdom does not compute component styles (the same limit as in Batch 1). The component CSS was unchanged by that edit, and I confirmed the flex declarations by reading them.

### Follow-ups (still open, none blocking)
1. Two layout specs cannot fail in jsdom: `chat-session-layout.component.spec.ts:88-99` reads `container-type` from computed style (always empty for component CSS, so it passes regardless), and the full-mode test checks classes only. Real protection needs a rendered check or a stylesheet-text assertion.
2. Rendered pass at 1440 and 760 in Electron and a Canvas pane: peek 40%, full mode with a multi-line composer, composer menus, and the pre-existing `.cs-shell` inline-size container against the Floating UI fixed menus.
3. `aria-controls` references the region id, which now exists after first open (improved); before first open it still points at nothing. Minor.
4. The "Display · 0" bar shows in every Electron session (design call, from the first review).
