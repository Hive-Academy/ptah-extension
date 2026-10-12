# Code Logic Re-review, Phase C fixes — TASK_2026_629_c0b3

Scope: `2d9da4357` (Fix-C1, chat) and `b65fdd59e` (Fix-C2, canvas). Read-only; no tests, typecheck or lint run.

## Status of claimed fixes

| Finding | Status | Evidence |
|---|---|---|
| logic S1 draft lost on card flip | FIXED | `chat-input.component.ts` ctor effect (+1535-1551), `saveDraft`/`restoreDraft` (+1573-1600), `ngOnDestroy` save (+720), `composer-draft.store.ts` (text, files, images keyed by tabId, cleared by `onTabClosed`) |
| logic S2 forced card toggles stored mode | FIXED | `compact-session-card.component.ts:~324-338`: forced -> `cardActions.openSession()/openLane()`, never `expandToFull`; tile provides actions at `canvas-tile.component.ts:~629-636` -> `canvasStore.focusTile` |
| logic S3 dock/sidebar gate regression | FIXED | `chat-view.component.html:268,340` gate on `_forcedCard?.()` only; user-compact keeps the dock |
| logic M1 hidden grid compares wrong focus | FIXED (with caveat, N4) | `canvas-workspace-grid.component.ts` `effectiveFocusedTabId` uses `focusedTabIdFor(workspacePath())`; `canvas-grid-items.ts:48-51` keeps cached `autoCard` while `!visible` |
| logic M3 null focus / layout focus | FIXED | `effectiveFocusedTabId`: layout focus first, then workspace focus, then last focused, then first tile by order; always one live tile |
| logic M2 / M4 (scroll loss, 2->3 flip) | NOT FIXED (not claimed; accepted rule) | unchanged |
| logic 0ce422101 Moderate, stuck cap | FIXED (with caveats, N2) | `canvas.store.ts` `runningSnapshot` polls at 1 s while `count >= MAX && hiddenRunning`; stops when false; cleared on destroy (`:95`) |
| logic 0ce422101 Minor, switch order | FIXED | active path now from `tabManager.activeWorkspacePath$()`; it is set before `tabs` in `switchWorkspace` but both are read in one synchronous computed pass, so no observable window |
| style M1 grid over 700-line limit | FIXED (probable; lint not run) | file 896 -> 881 physical lines; `items` body moved to `canvas-grid-items.ts` and a new `effectiveFocusedTabId` added. Estimated ~688 counted lines. Needs one lint confirmation |
| style M2 template function call per pass | FIXED | `[autoCard]="item.autoCard"`; `isAutoCardTile` re-export removed |
| style m1 `autoCard` doc, m2 budget docs, m3 token doc, m5 `protected`, m6 stale comments | FIXED | `canvas-tile.component.ts:~440`, `canvas-live-budget.ts:1-6`, `session-context.token.ts:46-50`, `chat-view.component.ts:~922`, comments at `:841,:907` (reworded to `showCompactCard()`) |
| style m4 merge exports, m7 optional budget param | NOT FIXED (both optional) | `libs/frontend/chat/src/index.ts` not touched |
| style: unrelated Prettier noise | NOT FIXED, slightly worse | B5a noise kept; `chat-input.component.ts` ~+1197 reformats an unrelated `command.description` chain |

## Draft effect: specific checks

- Saves on every keystroke: yes, one `Map` copy per change. It is O(open drafts), cheap. No loop: `saveDraft` never reads `drafts()` (the `get()` read is inside `untracked`). OK.
- Tab switch saving old text into new tab: no. The save runs with the old `draftTabId` before it is reassigned, in `untracked`. OK.
- Draft restored after send: no. Send clears locals and the store, then the effect saves an empty state (which clears). OK.
- Closed tab: `saveDraft` is guarded by `findTabByIdAcrossWorkspaces`, so a close does not resurrect the draft. OK.
- Tab moved workspace: keyed by tabId and the lookup is cross-workspace, so the draft survives. OK.
- Pasted image data in memory: see N3.

## New findings (from these diffs only)

### N1. Moderate: tile-provided `SESSION_CARD_ACTIONS` changes behaviour for user-compact tiles, and a forced card with no actions is dead
- `canvas-tile.component.ts:~629-636` provides actions for every tile. `compact-session-card.component.ts:~324-330`: when not forced and actions exist, `openLane` calls the action (focus only) and never `expandToFull`. Before, a lane click on a user-compact canvas tile expanded it to full. Now it only focuses and the tile stays compact, with no path from the lane to the full view. The code comment says B7a will add lane detail.
- When forced and `cardActions` is null (a forced-card host that does not provide actions), `openFullView`/`openLane` use `cardActions?.` and do nothing. Canvas has the `CanvasStore` fallback via `focusRequested`, so canvas is fine; any other host that sets `SESSION_FORCED_CARD` gets a dead button.
- Fix: for a non-forced card keep `expandToFull` for lanes (or have `openLane` expand a user-compact tile), and fall back to `expandToFull` only when neither forced nor actions exist.

### N2. Moderate: side-effectful timer inside `computed`
- `canvas.store.ts` `runningSnapshot` (`~:202-211`).
  - A read after `destroyRef.onDestroy` (a late consumer) can start a new interval that is never cleared.
  - Once started, the interval itself calls `runningSnapshot()` every second. That keeps the computed live with no consumers, until the hidden turn ends.
  - A single interval is guaranteed by `??=`. The interval only starts when something reads the computed, which is the right laziness.
  - The poll runs only while the cap is already reached. A hidden turn that starts is still not noticed (not a signal), so the cap can be exceeded until another dependency changes. This is the mirror of the stuck-cap issue and is not covered.
- Fix: guard with a `destroyed` flag; ideally have the tab manager expose a hidden-status signal so no timer is needed.

### N3. Moderate: draft store retention
- `composer-draft.store.ts`: entries are cleared only on `onTabClosed`. `removeWorkspaceState` (`tab-manager.service.ts:~795`) does not go through `emitTabClosed` (only 3 emit sites, none there), so drafts, including base64 pasted images, for tabs of a removed workspace stay in memory for the session.
- Two live `ChatInput`s on one tab (main panel and a tile) would each overwrite the other's draft on destroy (last writer wins, no sync). Unlikely, noted for awareness.
- Fix: also clear drafts for a removed workspace's tabs (or prune ids not found by `findTabByIdAcrossWorkspaces` on a sweep).

### N4. Moderate-low: hidden-grid cache gaps and widened `focused`
- `canvas-grid-items.ts:48-51`: the cache only holds values from a prior visible pass. A tile added to a grid while hidden has no entry and gets `autoCard=false` (live), even when the grid has more than 2 tiles. A grid that is mounted but never yet visible mounts every tile live, so the budget does not apply. Removal while hidden leaves stale values until the grid is shown again, when they are recomputed (so that case is harmless).
- `effectiveFocusedTabId` now feeds `[focused]` (`SESSION_FOCUSED`) as well. A hidden grid, or one with null canvas focus, now has one tile marked focused where it used to have none. `chat-transcript.component.ts` reads `SESSION_FOCUSED`; I did not verify what it gates, so this is unconfirmed.
- Fix: when `!visible` and there is no cache entry, derive from the same rule instead of defaulting to false; bind `[focused]` to the real canvas focus and use the effective id only for `autoCard`.

## Verdict: REVISE (narrow)

All named Serious and Moderate findings are fixed with the intended mechanism. None of the new items is Serious. N1 and N2 are the ones worth fixing before merge: N1 is a behaviour change for user-compact tiles, and N2 can leak a timer. N3 and N4 can be deferred.
