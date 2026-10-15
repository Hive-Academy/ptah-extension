# Code Logic Review — R9 phase (Rail board), TASK_2026_629_c0b3

Review family: Claude; implementer families: codex, opencode

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | APPROVE-WITH-FIXES |
| Blocking | 0 |
| Serious | 2 (F1, F2) |
| Moderate | 1 (F3) |
| Minor | 5 (F4-F8) |

Phase diff `5a86ca72b..HEAD` (libs, apps). The diff was not read line by line. I read in full: `canvas-rail-board.component.ts`, `canvas-rail-card.component.ts`, `canvas-focus-area.component.ts`, `canvas-focus-header.component.ts`, `canvas-detail-transcript.component.ts`, `canvas-detail.service.ts`, `rail-transcript-retention-coordinator.service.ts`, `transcript-retention.service.ts`, `canvas-layout-persistence.service.ts` (load and write paths), `canvas.store.ts` (hydrate, focus, reorder, persist), `canvas-layout.service.ts`, `canvas-board-mode.ts`. I read the diffs of `chat-view.component.ts/.html`, `chat-transcript.component.*`, `native-popover.component.ts`, `floating-ui.service.ts`, `tab-persistence.ts`, `chat-types.ts` and `compact-session-card`. No test, typecheck or lint was run. Spec claims below are from reading only.

Why 6 and not 7: the retention coordinator, persistence normalization, deletions (no live-code dangling references) and the dock invariants hold, and the split state machine handles external focus changes correctly. But the Rail card's own `focusTile` write breaks the split state machine on the most common gesture, and no spec covers it, because the board spec replaces the Rail with a stub. Why not 5: it is recoverable ("Close split"), non-destructive (no data lost), and one line-level fix removes it.

## Findings

### F1 (Serious) Rail card click on the session in the inactive split pane collapses the active pane and leaves a ghost split

- Files: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:273-276` (`openSession`), `canvas-rail-board.component.ts:507-517` (`activatePane`), `:639-649` (`focus`), `:473-477` (`assertDistinct`), `:803` (`onLanesRequested`), `canvas-detail/canvas-detail.service.ts:42-48` (`open`).
- Scenario: split is on, left is A (active), right is B (`otherTabId`). The user clicks, or presses Enter/Space on, the Rail card of B (card `onClick` or `.rc-select` -> `expandToFull`, or the `.rail-collapsed` click). All of these call `CanvasRailCardComponent.openSession()`, which first runs `canvasStore.focusTile(B)` (line 274). That sets the store focus to B synchronously. It then emits `focusRequested`, and the board runs `focus(B)`. Because `B === otherTabId`, `focus` calls `activatePane(opposite)`. `activatePane` reads `current = this.activeId()`. `activeId()` returns the store focus, which is now B. So `otherTabId.set(B)`, `activeSide` flips, and `lastFocusedId = B`: both panes now resolve to B. `paneTab(inactive)` returns null (`fallback !== other` is false), so A's pane and its host are destroyed while `splitDisplayed()` stays true (`otherTabId` is set). The effect at `:344-361` does not repair it: `other` and `focused` are both in `ids`, and `focused === lastFocusedId` returns early. The user sees one pane with split chrome (Swap, Close pane, Details-as-overlay, 360 px minimums), and A has silently left the screen. In dev mode `assertDistinct()` throws inside the click handler instead.
- The same root cause hits a lane-row click on the card of the inactive-pane session (`card.openLane` -> `detail.open` -> `focusTile(B)`, then `lanesRequested` -> `onLanesRequested` -> `focus(B)`). For a card of a third session T it costs the "T replaced the active pane" announcement: `focus` sees `id === activeId()` and skips `announceReplaced`, and the effect skips it because `focused === lastFocusedId`.
- Why it was missed: `canvas-rail-board.component.spec.ts:71` and `:319-320` replace the Rail with `RailStub`, whose `focusRequested` does not write the store. No spec runs real card, real board and a stateful store together.
- Impact: the primary way to switch the active pane (click the other session in the Rail) corrupts pane ownership. Drafts live in tab state, so no data is lost, but the user loses the view of a running session and must use "Close split".
- Fix (both parts):
  1. Single owner of focus. Make `CanvasRailCardComponent.openSession()` only emit `focusRequested` (drop line 274); `board.focus()` already writes the store. Make `CanvasDetailService.open()` stop calling `canvasStore.focusTile` (line 45), or have the card route lane opens through the board (`lanesRequested` already does `focus`).
  2. Harden `activatePane`: do not derive the outgoing pane tab from the store focus. Use the tab the current active pane displays (track it in the board, for example `paneTabOf(activeSide)` backed by a private field set in `focus`, `openBeside` and the effect), and return early if `id === current`.
- Tests to add: one board spec with the real `CanvasRailComponent`, real `CanvasRailCardComponent` and a stateful store (not `RailStub`): split A|B, click B's card, expect `otherTabId === A`, both panes mounted and `assertDistinct` silent. Add the same for a lane-row click, and a third-session card click that expects the "replaced the active pane" announcement.
- Touches: `canvas-rail-card.component.ts` + `.spec.ts`, `canvas-detail.service.ts` + `.spec.ts`, `canvas-rail-board.component.ts` + `.spec.ts`.

### F2 (Serious) Tribunal conductor tile hides the display dock on a host that shows a transcript (decision 77(d))

See the section "Row 77(d) conductor tile" below. The fix touches `chat-view.component.ts`, `chat-view.dock.spec.ts`, `session-context.token.ts` (doc), `conductor-tile.component.ts` (comment), plus a conductor-tile spec.

### F3 (Moderate) The Grid projection and drag engine is still in the tree, unreferenced by production code

- Files and lines:
  - `canvas-layout-intent.ts`: `viewConstraintsFingerprint`, `sameViewConstraints`, `compactResizeBounds` (`:78-126`), `firstTileIdByOrder`, `PackedTile`, `TilePositionObservation`, `ProjectedTileGeometry`, `clampCapacity` through `projectDragIntent` (`:239-770`: `minimumUnitsFor`, `effectiveUnits`, `snapSpan`, `packRows`, `apportion`, `resolvePreferredWidths`, `projectTileGeometry`, `totalExtentOf`, `projectDragIntent`), and `FULL_TILE_HEIGHT_UNITS`, `MIN_/MAX_COMPACT_TILE_HEIGHT_UNITS`, `SPAN_UNITS`, `GRID_COLUMNS`.
  - `canvas.store.ts`: `commitDragIntent` (`:386-405`), `toggleLayoutFocus` (`:411`), `layoutFocusTabIdFor` (`:275`), `_workspaceLayoutFocus` (`:112` and its `moveIn`, `setIn`, `deleteIn` uses), and `workspaceRevision` plus `_workspaceRevisions`, whose only consumer is `commitDragIntent`.
- Evidence: Grep over `libs` and `apps` for each name returns only the defining file and specs. The production users of the file are `DEFAULT_TILE_WIDTH`, `MAX_CANVAS_TILES`, `TILE_SPANS` (persistence schema), `sameWidth`, `logicalRows`, `reconcileIntent`, `retainTilesInLogicalRows`.
- Impact: about 650 lines of untouched Grid logic with specs that make it look maintained, in a phase whose goal is the Grid removal. The specs also give false confidence in coverage numbers. No runtime effect.
- Fix: delete the unreferenced functions, types and constants above, `commitDragIntent`, `toggleLayoutFocus`, `layoutFocusTabIdFor`, the layout-focus and revision signals, and their spec cases. Keep the production list above. A stray `canvasStore.layoutFocusTabIdFor` reader would fail the typecheck.
- Touches: `canvas-layout-intent.ts` + `.spec.ts`, `canvas.store.ts` + `.spec.ts`.

### F4 (Minor) `close()` acts after an await without re-checking that the board is still on screen

`canvas-rail-board.component.ts:694-714`. After `await this.store.removeTile(id)` (which can wait on the confirm dialog), the code calls `store.focusTile(...)` for the survivor or neighbour. `focusTile` resolves the store's active workspace and calls `switchTab`. If the active workspace changed during the wait, a tab of the old workspace becomes the focused and active one in the new workspace. The C1 guard (`surfaceActive`) covers only the repair effect. Fix: after the await, return when `!this.surfaceActive()`, or when `this.workspacePath() !== store.activeWorkspacePath()`. Touches the board + spec.

### F5 (Minor) The focus-repair effect can change the user's active chat tab

`canvas-rail-board.component.ts:358-363`. When the store focus is null (hydrate leaves it null if the active tab is not a tile, for example above the 20 tile bound), the effect calls `store.focusTile(ids[0])`, which calls `switchTab`. Before R9w the board only rendered `tiles[0]`. Low probability. Fix: set the focus without `switchTab` when the active TabManager tab is not on this board, or accept and record it.

### F6 (Minor) `focus-area.stop()` relies on `focusin` running before `click`

`canvas-focus-area.component.ts:122`. `stop(id)` writes `focusTile(id)` for an inactive pane, then the click bubbles to the section's `(click)="activatePane(side)"`, which is the F1 pattern. It is harmless in Chromium/Electron only because the button's mousedown focus triggers `focusin` first. A programmatic `.click()` or an assistive-technology activation without focus would reproduce F1. Closing F1 part 2 closes this.

### F7 (Minor) `assertDistinct` throws after the state was mutated

`canvas-rail-board.component.ts:473-477`, called from `activatePane`, `openBeside`, the effect. In dev mode the throw leaves the half-applied split in place and breaks the click handler. It is a debug aid, but make it log instead of throw, or validate before mutating.

### F8 (Minor) Stale references to deleted Grid code

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:118` and `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts:38`: comments say the "gridstack instance" of the canvas survives navigation.
- `apps/ptah-electron-e2e/src/docs-screenshots/sessions.shot.ts:68`: locator `[data-testid="canvas-grid"] .grid-stack-item` now always counts 0 (console log only, not an assertion). It is not in the row 99 list.
- `board.announce()` is a signal, so repeating the same text (for example "This session cannot move in that direction.") is not re-announced by the live region.

Already recorded, not re-reported: row 99 e2e `canvas-tile` locators, `tile-agent-indicator` showcase locators, R9f/R9l/R9u/R9v items in handoff-10 §6.

## Invariant audit (item 2)

| Invariant | Result | Evidence |
| --- | --- | --- |
| At most 1 live ChatView in single focus, exactly 2 in split | Holds | One `ptah-canvas-lane-view` per mounted pane host (`board:130-160`, `paneTab`, `:486-499`), `liveViews` counts them (`afterRenderEffect`). One `ptah-canvas-detail-transcript` per lane view (`canvas-lane-view.component.ts` template). Rail cards render `ptah-compact-session-card`, not ChatView. F1 breaks the state that guarantees "2": the second host is lost while `splitDisplayed` stays true. |
| Frozen transcripts are `ptah-chat-transcript` subtrees, one shared cap of 4 per board | Holds | `chat-view.component.ts` `transcriptTabIds` Rail branch. `RailTranscriptRetentionCoordinator` is provided on the board (`board:53`), `evict()` caps `owners` at 4 and skips each host's live tab (soft above two hosts, already recorded). |
| No duplicate transcript per tab id | Holds | `liveElsewhere` filter in `transcriptTabIds`, and `touch()` transfers ownership with `releaseForTransfer` (keeps the tree cache). `register()` runs in the retention constructor, so host 1 drops its frozen copy as soon as host 2 exists. |
| Tree-cache refcount | Holds | `TranscriptRetentionService.owners` is a per-builder refcount, increments only when a tab enters a host's retained set, decrements only when it leaves, `clearForTab` at zero. Closed-tab cleanup is unchanged (`clearForClosedTab`). |
| Split never persisted (86) | Holds | `otherTabId`, `activeSide`, `visualOrder`, `detailsOpen` are board signals only. `CanvasBoardState`/v3 schema carry no split field. Hidden board collapses the split (`board:328-335`). |
| Display dock never degraded (77) | Holds in Rail and single chat; fails in the conductor | Grep: `HIDE_AGENT_SIDEBAR` provided only at `conductor-tile.component.ts:221`. `canvas-detail-transcript.component.ts` provides no such token and its spec asserts null (`.spec.ts:122,174,489`). Dock factory (`chat-view.component.ts:259-266`) is unchanged for the Rail and the single chat view. See F2. |
| Width-based dock per pane (82) | Holds | `RAIL_MIN_CONTENT_WIDTH` = 360 only when `splitDisplayed` (`canvas-detail-transcript.component.ts:68`). `shouldOverlayDock` and `dockMaxWidth` clamp by `host - 360`. 804 px pane -> side dock; 644 px -> overlay. |
| Stack below 1440 (85) | Holds | `splitStacked = containerWidth < 1440` (`board:242`); both panes stay mounted (CSS flex direction and `order` only). `containerWidth` is 0 until the first measure, so the first frame is stacked: harmless. |
| Details overlay in split (83) | Holds | `board:150-155` overlay on the active pane; column kept only when `!splitDisplayed()`. `collapseSplit()` closes it. |

Seam checks that passed: R9u coordinator with R9w board (host teardown calls `releaseHost`, idempotent with the board-level destroy); R9h `sessionAgents` strict scope with R9e Agents group (`agentsOwnedBySession` keyed on SESSION_CONTEXT); R9g/R9n tile with the Rail (the transcript's `SESSION_CARD_ACTIONS` provider uses `skipSelf`, so the Rail's provider wins; single chat opens in place); R9l `CanvasBoardMode = 'rail'` with the board and detail service (no `grid` branches left in canvas, chat, chat-state, core non-spec code; `layoutMode() === 'grid'` hits are the unrelated app layout); R9k slim `CanvasLayoutService` (observer cancelled on destroy and when inactive); R9v popover (per-component `FloatingUIService`, stale-request token plus generation, timer cleared in `finally`).

## Persistence write-path trace (item 4)

| Write | Writer | Key / scope / format | Reader | Old data |
| --- | --- | --- | --- | --- |
| Board mode normalized to rail | `canvas-layout-persistence.service.ts` `write()` (`board: { ...snapshot.board, mode: 'rail' }`) | localStorage, key `storageKey(workspacePath)`, JSON `{version:3, tiles:[{tabId,order,width,rowBreakBefore}], board:{mode,railCollapsed,railDensity,railScrollTop}}` | `load()` v3: `mode` is `enum(['rail','grid']).catch('rail').transform(() => 'rail')` -> `CanvasStore.hydrateWorkspace` -> `boardFor()` | Stored `grid` loads as rail. v2 (no board) and v1 migrate as before. A raw `grid` blob is not rewritten until a mutation, and keeps loading. OK |
| Tile order after reorder | `board.move()` -> `store.reorderTiles` (`canvas.store.ts:364`) -> `setWorkspaceTiles` -> `schedulePersist(path)` -> debounced `write()` | same record, `order` dense | `load()` -> `normalize()` -> `logicalRows` (sorted by `order`) -> `reconcileIntent` (`densify`) | OK. `width` and `rowBreakBefore` stay in the strict schema as unused legacy data; order is unaffected. If the path is read-only (newer-version record) the move applies in memory only, no `writeFailed`; the dock banner (`orchestra-canvas`) already says changes are not saved. Quota failure sets `writeFailed` (dock text plus board announcement). |
| TabState without `compactHeightUnits` | `projectTabForPersist` spreads the live tab | tab blob (tab-manager and workspace partition stores) | both restore paths call `sanitizeRestoredTab(s)` (`tab-manager.service.ts:2799`, `tab-workspace-partition.service.ts:585`), which deletes the key and maps `compact-tall` -> `compact` (`tab-persistence.ts:170-269`) | Old blobs load; the retired key cannot re-enter memory or a later save. A downgrade loses the stored heights (accepted). |
| Split state | none | n/a | n/a | Not written (decision 86). |

## Row 77(d) conductor tile

Decision: the conductor tile shows a chat transcript, so `HIDE_AGENT_SIDEBAR: true` at `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts:221` is not correct for the display dock. Row 77(d) applies. The token is correct for the Agents list only.

Evidence:
- `conductor-tile.component.ts:112-119` mounts `ChatViewComponent` (transcript plus composer) through `NgComponentOutlet`, with `SESSION_CONTEXT` (`:218`). Models, effort and view-mode controls in the same file confirm it is a working conversation.
- `chat-view.component.ts:259-266`: `DisplayDockState` is provided only when `isElectron && !HIDE_AGENT_SIDEBAR`. With the token it resolves to null, so `dockEnabled` is false (`:454`), the `ptah-display-dock` branch of `chat-view.component.html` (`:293`) never renders, and `ptah-ui display` chips in the conductor transcript are inert (comment at `:255-257`). The user cannot open `ptah-ui display [id]`, `$diff`, `$tests`, `$usage` in the conductor.
- The reason for the token (`conductor-tile.component.ts:216-217`: panelists already render as tiles) concerns only the per-session Agents group, which `sessionAgents` (`chat-view.component.ts:571-580`) feeds.

Fix (recommended): narrow the token to "hide the Agents list".
1. `chat-view.component.ts`: the `DisplayDockState` factory keeps only the `isElectron` condition. `sessionAgents` returns `[]` when `hideAgentSidebar` is set, so the dock's Agents tab reads "Agents (0)", the badge and the running auto-open (`:1390`) stay inert.
2. Update the token doc (`session-context.token.ts:20`) and the comment at `conductor-tile.component.ts:216-217`. Update `chat-view.dock.spec.ts:506` ("no store, no toggle, no dock") to the new contract: dock present, no agents. Add a conductor-tile spec that a fenced display opens in the conductor.
3. Alternative (not recommended): remove the token from the conductor and accept the strict-owned Agents list, which would duplicate the panelist tiles.

Files: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`, `chat-view.dock.spec.ts`, `libs/frontend/chat/src/lib/tokens/session-context.token.ts`, `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts` + spec.

## Leaks (item 6)

No leak found. Board: document and host listeners are removed in the effect's `onCleanup` (`board:290-326`), `afterNextRender` calls are tied to the board injector. `CanvasDetailTranscriptComponent`: `registerVisibleTab` is undone in effect cleanup, `childInjector` destroyed in `ngOnDestroy`. `CanvasDetailService`: `onTabClosed` unsubscribed in `destroyRef`. Retention: host destroy calls `releaseHost`; workspace switch removes the board content (`@if (visible())`) so ChatViews, frozen trees and their refcounts go with it. `CanvasLayoutService`: observer disconnected and RAF cancelled on destroy and when inactive. Popover: timer cleared in `finally`, stale position requests install no auto-update.

## Verdict

APPROVE-WITH-FIXES. Fix F1 and F2 in the one fix round, with F3 (deletion, low risk). F4-F8 may be recorded for the PR body. Confidence: medium-high. Residual uncertainty: I did not run any spec, and the F1 trace is by code reading (every call in the chain was read: card -> Rail output -> board.focus -> activatePane -> activeId -> store). Mode 3 can confirm it with a board spec that uses the real card.
