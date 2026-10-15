# Code Logic Review - TASK_2026_629_c0b3 - Rail board phase (R0-R8)

Review family: Claude reviewing codex
Scope: `git diff fe9ab1c91..HEAD -- libs apps` (commits 6bf6073bb..a7a753eff), whole files read for every new or heavily changed source file. Paths below are relative to the worktree root.
Method: read-only static trace; no test, build or git-mutating command was run. Contrast ratios were computed once with `culori` from `apps/ptah-extension-webview/tailwind.config.js` (no Nx target).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Verdict | APPROVED WITH FIXES |
| Blocking issues | 0 |
| Serious issues | 3 |
| Moderate issues | 8 (plus the known alpha-class item) |
| Minor issues | 7 |
| TODO / PLACEHOLDER / STUB / empty bodies / mock data in source | none found (grep on the added non-spec lines hits only the word "todo" as the todo-list domain) |

Score reasoning. Data paths (v3 persistence, hydrate, board setters, terminal failure sequence, stale-id guard, lazy tab-closed subscription) are correct and well tied together; nothing loses data. It is not a 7 because three user-visible behaviours are wrong or unwired while their unit specs pass (collapsed rail shows frozen state, focus header never receives branch/model, "+N more lanes" appears to be clipped), and several specs prove contracts against stubs. It is not a 4 because every one of those is a local fix and none can corrupt state.

## Review checklist from batches-rail.md "## Review"

| Check | Result | Evidence |
| --- | --- | --- |
| K1 detail-service spec fixtures | OK. Fixture-only edit, existing `it` bodies unchanged | `canvas-detail.service.spec.ts` (+49), `canvas-detail.service.ts:48-54` mode-aware `open` |
| K2 lazy `onTabClosed` | OK. Not subscribed at construction; subscribed on the first lane-map write, released through `DestroyRef`. Orchestra's own listener stays call 0 | `canvas-detail.service.ts:21-39` (`listeningForClose`, `destroyRef.onDestroy(unsubscribe)`); `reset` kind is skipped (keeps the key, see M10) |
| K3 orchestra spec fixtures | OK. Fixture-only (+14 lines) | `orchestra-canvas.component.spec.ts` |
| K4 `onDetailKeydown` with fake `this` | OK. `orchestra-canvas.detail.spec.ts` is untouched. Grid branch keys off `detailTabId()`; Rail branch is `this.activeRailBoards?.().find(...)`, and optional chaining short-circuits the whole chain on the fake | `orchestra-canvas.component.ts:366-390` |
| K5 transcript spec providers | OK. `freezeSessionOverrides` extracted; transcript spec gained 134 lines | `canvas-session-overrides.ts`, `canvas-detail-transcript.component.ts:45-76` |
| K6 `CanvasLayoutLoadResult` shape | OK. Store reads `loaded.board ?? existing ?? DEFAULT_BOARD_STATE`, undefined-safe for old stubs | `canvas.store.ts:575` |
| R2-1 stale/replaced request never posts | OK. `respond`, `openRequest`, `answerQuestion`, `openLane(key, shownId)`, `openFullView(shownId)` all compare the shown id with the current `callout()`; stale emits `staleAction` | `compact-session-card.component.ts:448-529` |
| CLI Allow re-check | OK. Immediately before `responder.respondLane` the card re-checks that the agent is still owned and the request still queued | `compact-session-card.component.ts:462-475` |
| D10 error id | OK. `err:${tabId}:${terminalFailureSeq ?? 0}` | `compact-session-card.component.ts:277-282` |
| `terminalFailureSeq` advances exactly once per newly stamped reason, never reset | OK. Helper advances only when the update carries a truthy reason different from the stored one; duplicate stamp, `null`, `undefined` and absent key return the same object. Reset block clears the reason only. Both writers (active signal and background partition) are covered; the background path is not enriched twice because the active updater returns before reassigning when the tab is not found | `terminal-failure-seq.ts:4-18`, `tab-manager.service.ts:1359`, `tab-workspace-partition.service.ts:388`, reset block `tab-manager.service.ts:1279` |
| A4 draft safety on a mode switch | OK by reading, proven only on a stub. `ChatInputComponent` saves the draft from an effect on every change and again in `ngOnDestroy`; the `@if/@else` removes the old view before creating the new one. See M7 | `chat-input.component.ts:730-734,1536-1551,1572-1595` |
| One live view per visible Rail board | OK by construction: `@for (focused of focusedIds(); track focused)` with 0 or 1 entry, and the whole board body is inside `@if (visible())`. See M6 for the attribute that claims to measure it | `canvas-focus-area.component.ts:25-30,47-50`, `canvas-rail-board.component.ts:33,58` |
| Hidden Rail workspace mounts nothing (D4) | OK. No cards, no focus area, no document listeners while hidden | `canvas-rail-board.component.ts:33`, listener effect `:98-127` |
| `CanvasDetailService` lazy subscription release | OK (K2 above) | |
| v3 write -> load -> hydrate trace | OK. Key `ptah.canvas-layout.ws.{encodeURIComponent(path) with % -> _}.{panelId or primary}`, scope = per workspace per panel, value `{"version":3,"tiles":[...],"board":{mode,railCollapsed,railDensity,railScrollTop}}` (`canvas-layout-persistence.service.ts:128-133,255-270`). `load` parses v3 first, then v2 (board `null`, so Rail default, Grid layout intact), then v1 (migrated, `needsWrite: true`). A version above 3 or a non-integer version returns `newer-version`, `writable: false`, adds the path to `readOnlyPaths`, never writes (`:157-168`). `hydrateWorkspace` assigns `loaded.board` (`canvas.store.ts:562-575`), calls `markHydrated(path, loaded.writable)` (`:587`) and schedules a write when `needsWrite` or the tiles differ (`:588`). `schedulePersist` supplies `{tiles, board}` (`:698-706`). Round trip is consistent | |
| Board setters leave tile identity and `workspaceRevision` alone | OK. `updateBoard` writes `_workspaceBoard` and calls `schedulePersist` only; it does not touch `_workspaceTiles`, `_tilesForCache` or `_workspaceRevisions` | `canvas.store.ts:263-288` |
| ResizeObserver and listener cleanup | OK. Lane-tabs observer disconnects through `DestroyRef` and is guarded for jsdom (`canvas-lane-tabs.component.ts:179-188`); board document/host listeners are released in the effect cleanup on hide and destroy (`canvas-rail-board.component.ts:98-127`); queue Escape listener exists only while open (`canvas-needs-you-queue.component.ts:153-172`); container width is observed by the existing `layoutService.observe` on the session viewport (`orchestra-canvas.component.ts:437-441`), independent of mode | |
| Keyboard routing Grid vs Rail | OK. Queue Escape: document-level handler calls `preventDefault`, the window-level orchestra handler then sees `defaultPrevented` (test at `orchestra-canvas.rail.spec.ts` "keeps the Grid detail open when queue Escape is consumed"). Detail Escape only acts when `detailTabId()` is set, which is now gated on Grid mode. List-level Rail handler runs before the window handler and `preventDefault`s, so no double action | `orchestra-canvas.component.ts:366-390`, `canvas-rail-keyboard.ts:14-56`, `canvas-detail-keyboard.ts:3-34` |

## Five logic questions

### 1. How does this fail silently?

- A collapsed rail shows frozen state dots and drops the needs/error announcements (S1). The only producer of `railStates` is the mounted smart card; in collapsed mode it is not mounted.
- The focus header silently omits branch and model because the focus area never passes them (S2).
- A `+N more` lanes button is likely clipped inside the 70 px lanes zone (S3), so the control exists in the DOM and in the tab order but is mostly invisible.
- `setBoardMode` returns without a trace when the active path is the implicit `''` partition (M1).
- `data-canvas-live-views` is computed from the same condition that mounts the view, so it can never report a second view (M6).

### 2. What user action produces unexpected behaviour?

- Collapse the rail (or open the details strip below 1120 px, which auto-collapses it): dots stop tracking sessions (S1).
- Open the overflow menu with the mouse, then press Escape: nothing closes, because the handler is on the menu element and focus stays on the `...` button; clicking outside does not close it either (M4).
- Click a card: the collapsed caret selection can anchor inside the card, so the "text hold" latches that card's title, Now line and metrics until the user clicks elsewhere (M3).
- Switch to another workspace and back: the rail list is rebuilt at scrollTop 0 and the focused card may be off screen (M2).
- Toggle Rail/Grid in a window with no folder open: nothing happens (M1).

### 3. What input data produces a wrong answer?

- A session with more than three lanes (comfortable density): the `+N more` entry point is clipped (S3).
- Sessions with idle/err/run state text on `base-300` surfaces (focused card background, dark theme): state ink used as 10-12 px text is 3.17-4.17:1 against a 3:1 spec, so text contrast fails AA 4.5:1 (M5).
- Tile added or closed by something other than the rail footer: the geometry baseline is not refreshed, so every later check counts the order difference as a shift (m3). Diagnostic only.
- A stored board with an extra unknown key fails the strict v3 schema and the whole record, tiles included, is dropped and later overwritten (m6). Same-version forward additions are not a supported case, so recorded only.

### 4. What happens when a dependency fails?

- localStorage write failure: `writeFailed` flips, the dock shows "Board layout could not be saved", in-memory state stays authoritative, the flag clears on the next successful write (`canvas-layout-persistence.service.ts:272-279`). Good.
- localStorage read failure or corrupt JSON: defaults, warn once, and `writable` is false on read failure (no overwrite) but true on parse failure (overwrite of a corrupt record, pre-existing behaviour). Acceptable.
- `closeRequested` with a cancelled confirm: the tile is kept and focus is not moved (`canvas-rail-board.component.ts:178-186`). Good.
- `chatStore.abortWithConfirmation` rejects: logged, tab state stays authoritative (`canvas-focus-area.component.ts:66-70`). Good.
- `ResizeObserver` missing: guarded. `scrollIntoView` missing: optional call.
- A removed lane: the lane tab strip emits `orchestrator` through `selectLaneFor`, and the lane view independently falls back to Orchestrator through `selectedKind` (`canvas-lane-view.component.ts` `selectedKind`), so there is no blank frame.
- Permission request replaced between render and click: refused and announced (R2-1 above).

### 5. What is missing that the requirements never mentioned?

- A state source for a collapsed rail (S1).
- Scroll restore on every return to a workspace, not only on first mount (M2).
- A way to close the overflow menu by pointer-outside or by Escape from the opener (M4).
- A repeat-announcement strategy for identical stale messages: the live regions are set to the same string, which a screen reader does not re-announce (m4).
- Text-contrast thresholds for state ink used as text (M5).

## Failure modes

### Collapsed rail has no live state source

- Trigger: user collapses the rail, or the details strip is opened below 1120 px (auto-collapse, `canvas-rail-board.component.ts:92-93`).
- Symptom: collapsed dots keep their last colour; a session that starts needing a permission or fails shows an old dot; no "needs you" live-region message; sessions added while collapsed read `idle`.
- Evidence: `canvas-rail-card.component.ts:38-46` renders the plain button for `collapsed()` and `ptah-compact-session-card` only in the `@else`; `railState` is emitted by an effect inside that smart card (`compact-session-card.component.ts:431`); `railStates` is filled only by `onRailState` (`canvas-rail-board.component.ts:213-222`). No spec covers collapsed (`grep collaps` hits only the stubbed board spec and the density toggle in the rail spec).
- Current handling: none; map retains stale entries until expand.
- Recommendation: derive the state without the visual card. Either keep a hidden (not rendered) smart card per tile in collapsed mode that only emits `railState`, or lift the state derivation into a pure function of the tab plus stores that the wrapper can call, and feed the collapsed dot and the announcements from it.

### Focus header branch and model never populated

- Trigger: any focused session.
- Symptom: header shows only title, state, buttons; branch chip and model chip never appear (plan Component 11 requires both).
- Evidence: `canvas-focus-area.component.ts:20-22` binds `[tabId] [title] [state] [running] [viewMode] [band]` and nothing for `branch` or `model`; header inputs default to `null` (`canvas-focus-header.component.ts:54-55`). The header spec drives the inputs directly, so it cannot see the gap.
- Recommendation: bind `[branch]="tab()?.agentOrigin?.branch ?? null"` and `[model]="tab()?.liveModelStats?.model ?? tab()?.sessionModel ?? null"` (same sources the smart card uses, `compact-session-card.component.ts:194,381`) and add a focus-area spec case that asserts the chips.

### "+N more" lanes button clipped

- Trigger: comfortable density, three lane rows shown and `moreCount > 0`.
- Symptom: the button is mostly cut off by `overflow: hidden`.
- Evidence (CSS arithmetic, not rendered): lanes zone is a 70 px grid row (`compact-rail-card.component.ts:51,63`). Inside it the template stacks a 16 px counts line (`:106`), up to three 16 px lane rows (`:108-110`; `rc-line` has no fixed height, `text-[11px]` sets no line-height, inherited 1rem) and then the 18 px `rc-action` button (`:111-113`) = 82 px or more. The approved prototype puts `+N more` on the 16 px header line (`prototypes/02-focus-rail.html:106,409-410`, rows fixed at 18 px in a 54 px row), so the implementation diverged from it. Confirm in the Electron re-check.
- Recommendation: move the `+N more` button into the header line (right aligned) as in the prototype and fix lane row height to 18 px so 16 + 54 = 70.

### Hold latch after a plain click

- Trigger: mouse click on a card; Chromium places a collapsed caret whose `anchorNode` is inside the card.
- Symptom: `holdTabId` stays set, so `shownTitle`, `shownNow`, `shownMetrics` are latched (`compact-rail-card.component.ts:153-156`) until the selection moves outside a card.
- Evidence: `canvas-rail-board.component.ts:101-106` never checks `selection.isCollapsed`; `up()` re-runs it at pointerup (`:114-118`). Plan text says "the card containing the selection anchor or the press", so this is as specified, but a caret is not a selection worth protecting.
- Recommendation: set the hold from `selectionchange` only when the selection is non-collapsed and its text is non-empty; keep the pointer-press hold only while pressed.

### Stale scroll on workspace return

- Trigger: switch away from a Rail workspace and back.
- Symptom: the list is rebuilt at scrollTop 0 although `railScrollTop` is stored; the focused card can be off screen.
- Evidence: `restoredScroll` is set once per component instance (`canvas-rail-board.component.ts:95,155-160`) while the list lives inside `@if (visible())` (`:33`).
- Recommendation: reset `restoredScroll` (and call `anchor()`) when `visible()` turns true.

## Blocking issues

None found. Searched for: data loss on persistence (round trip, read-only, failed write), identity corruption (board setters, implicit-path move), actions posting to the wrong request (R2-1), live-view duplication (one lane view per board), unreleased listeners.

## Serious issues

### S1. Collapsed rail has no live state source

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:38-46` (collapsed branch), `canvas-rail-board.component.ts:213-222` (`onRailState`)
- Scenario: rail collapsed (user toggle, or details strip open below 1120 px); a session asks for permission or fails.
- Impact: the collapsed dot is stale and no live-region message is produced, so the main purpose of the Rail (at-a-glance attention) is lost exactly in the compact layouts. The dock needs-you queue still shows the count, which is why this is not Blocking.
- Fix: keep a state producer alive in collapsed mode (see Failure modes). Add a wrapper spec for collapsed that changes the tab state and expects the dot colour and the board live region to update.

### S2. Focus header never receives branch and model

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts:20-22`
- Scenario: any focused session.
- Impact: plan Component 11 and parity capability "branch chip, model chip" are missing from the header while every spec passes.
- Fix: bind both inputs and add a spec on the focus area (not only the header).

### S3. "+N more lanes" button is clipped in comfortable cards

- File: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:51,63,106-114`
- Scenario: session with more than three lanes, comfortable density.
- Impact: the entry point to the full lane list from the card is not usable by pointer and focuses an invisible element by keyboard. The lanes stay reachable from the lane strip after selecting the card, so it is not a dead end.
- Fix: as in Failure modes. Add a jsdom-independent assertion on the zone arithmetic (for example constants for header 16 + 3 x 18 = 70 shared with `COMPACT_RAIL_CARD_HEIGHT`) or cover it in the Electron re-check list explicitly.

## Moderate and minor issues

Moderate (recorded; none loses data or breaks a lane config, so per policy they are not fix-round items except where noted):

- M1. `setBoardMode` is a silent no-op for the implicit `''` path: `orchestra-canvas.component.ts:389-392` (`if (path)`), and the read-only/persistence notes use the same truthy test (`:149-153`). The toggle renders but does nothing in a window with no workspace folder. Use `activeWorkspacePath() ?? ''` semantics.
- M2. Scroll restore only once per component instance: `canvas-rail-board.component.ts:95,155-160`.
- M3. Text hold latches on a collapsed caret: `canvas-rail-board.component.ts:101-106`. Medium confidence (Chromium behaviour, verify in Electron).
- M4. Focus header overflow menu: Escape only handled when focus is inside the menu (`canvas-focus-header.component.ts:40`) but focus stays on the opener after click (`:35`), and there is no outside-click close. While open, the window Rail Escape handler instead moves focus to the card and leaves the menu open.
- M5. State ink contrast: spec asserts 3:1 (`state-ink-contrast.spec.ts:33-36`), but the tokens are used as 10-12 px text (`.rc-pill` in `compact-rail-card.component.ts:62,75`, `.state-*` in `canvas-focus-header.component.ts:12-16` and `canvas-rail.component.ts:23-28`). Computed ratios: anubis idle 3.83/3.58/3.17 (base-100/200/300), anubis run 4.17 and err 4.07 on base-300 (the focused-card background `bg-base-300`), anubis-light idle 4.39 and run/need/err/done 4.74-5.08 on base-300. Idle in dark fails 4.5:1 on every surface. Either lift `--state-ink-idle` (and err/run for the dark `base-300` case) to 4.5:1 or colour the pill text with `base-content` and keep the ink for the dot and bar.
- M6. `data-canvas-live-views` is asserted, not measured: `canvas-rail-board.component.ts:27` (`visible() && focusedId() ? 1 : 0`). It cannot detect a second mounted lane view, so it is useless as the Electron probe the plan describes. Count `ptah-canvas-lane-view` elements (or increment on lane-view init and decrement on destroy).
- M7. Integration proof gap (team-leader items 5 and A4): `orchestra-canvas.rail.spec.ts` stubs the Rail board and uses a fake draft input (`[aria-label="Rail draft"]`), so "one transcript in the DOM in total" and the draft restore through the real `ChatInput` are not proven by unit tests. Reading the code supports both claims; the Electron re-check (`s-draft3.mjs`, DOM count of `ptah-canvas-lane-view`) should carry them.
- M8. Lane strip reveal re-fires on every `groups()` recompute: `canvas-lane-tabs.component.ts:174-178`. `groups` has no equality and is rebuilt on every sub-agent store update, so `scrollIntoView` runs repeatedly and snaps the strip back to the selected tab while the user scrolls it at 920 px. Compare group keys before revealing, or reveal only when `selectedKey` or the tab count changes.

Minor:

- m1. Rail `openSession` calls `focusTile` and emits `focusRequested`, and the board's `focus()` calls `focusTile` again (`canvas-rail-card.component.ts:68`, `canvas-rail-board.component.ts:171`); `switchTab` saves state each time (`tab-manager.service.ts:1304-1313`). Harmless double work, not a double action; `+N more` adds a third `focus` through `onLanesRequested`.
- m2. `setRailScrollTop` is not throttled (`canvas.store.ts:279-281`), so each scroll event replaces `_workspaceBoard`; `activeBoard`/`board` produce new objects, which re-run the board's `afterRenderEffect` (N `getBoundingClientRect` reads) and the orchestra bindings per event. Bounded by tile count; throttle with rAF or compare fields in `board`/`activeBoard` with an `equal`.
- m3. Geometry baseline is reset only by rail-initiated add/close/toggles (`canvas-rail-board.component.ts:178-195`); an external tile change makes `checkRailGeometry` count `reordered` on every later pass (`canvas-rail-geometry.ts:33-39`). Metric noise only.
- m4. Identical stale messages are not re-announced: the wrapper and the board both `set` the same string (`canvas-rail-card.component.ts:75-77`, `canvas-rail-board.component.ts:35-36`), and both live regions announce, so the first is spoken twice and later ones not at all. Clear before set, or announce from one place.
- m5. Lane keys are kept on a tab `reset` (`canvas-detail.service.ts:28`) and when a tile is removed without a tab close; the focused tab's strip heals it, other tabs keep a dead key until focused. Tiny leak, no effect.
- m6. Strict v3 board schema drops a whole record on any extra board key (`canvas-layout-persistence.service.ts:46-57`); fine while the version number gates additions.
- m7. Spec gaps (team-leader item 4): focus-area plan cases (2) buildTree per snapshot, (3) lane restored on swap back, (4) removed lane fallback; board (6) "writes once" and hold clear, (8) tile count after 5 swaps and 1 close; D9 asserts `expect.any(String)` while the code does call `defaultSessionName()` (`canvas-rail-board.component.ts:176`). Logic reads correct for (3), (4), (6), (8); (2) has no code to read in the focus area (cost is in the existing transcript).

Known, already scheduled (not re-derived): `no-alpha-base-content.spec.ts` fails on ten `text-base-content/60|70` uses in libs/frontend/canvas (lane-tabs x2 including the `[class.text-base-content/60]` binding at `canvas-lane-tabs.component.ts:63`, lane-view x1, needs-you-queue x2, focus-area `:32` x1, rail `:38,48,63,78` x4). Fix with `text-base-content-muted`.

## Team-leader items, rated

1. R2 `respond` refuses any callout that is not the current one, also on the tile path. Rating: Minor, accept. Only the shown callout can be clicked in either variant, so the stricter rule only blocks a click on a replaced request, which is the intent of R2-1. The tile branch has no `staleAction` listener, so the refusal there is silent; the tile re-renders with the new callout on the same tick, so no user-visible gap.
2. R3 moved implicit board not saved until the next change. Rating: Minor. The write is triggered at `canvas.store.ts:588` by `needsWrite` or by tiles differing; the board-only case needs an empty or identical tile set and a toggle made before any workspace path existed. In-memory state is correct and the next change or any tile change writes the v3 record. No data lost.
3. R5 stale click not covered end to end, and `openSession` doing two things. Rating: Minor. Traced by reading: card `respond` -> `staleAction` -> wrapper `onStaleAction` -> board `announce` (works, with the duplicate-announcement caveat m4). `openSession` doing `focusTile` plus `focusRequested` is consolidation (the click path and the select-button path both need the scroll anchor), not a double user action; the redundant `focusTile` is m1.
4. R6 below-1120 collapse and spec gaps. Rating: the baseline restart is Minor and correct (key `density|collapsed` uses the effective collapse, so heights are compared against the right expected value, `canvas-rail-board.component.ts:92-93,146`); the real problem it exposes is S1, because that auto-collapse makes the stale-dot case routine below 1120 px. Spec gaps are m7 (Minor).
5. R7 stubbed integration. Rating: Moderate (M7), no defect found in the code; carry to the Electron re-check.
6. Known alpha-class spec: Serious for the gate (the spec is red), mechanical fix.

## Data flow

1. Tab state stamped (`setLastTerminalReason`, `setTurnEndedFields`, `applyTurnState`): OK, `withTerminalFailureSeq` in both writers.
2. Smart card derives `callout` (oldest request first, permission wins a tie, error id from the sequence): OK.
3. Smart card derives `railStateValue` and emits it from an effect: OK while mounted; GAP when the rail is collapsed (S1).
4. Wrapper forwards `railState` to rail, board stores in `railStates`, prunes on tile removal: OK, stale in collapsed.
5. Card actions: Allow/Deny/Open/Answer carry the shown id; stale refused: OK.
6. Card select / lane click: wrapper -> `canvasStore.focusTile` / `detail.open(tabId, key)` -> lane key stored per tab; Rail mode does not set `_detailTabId`: OK.
7. Board derives effective focus (store focus if present, else first tile): OK, never written.
8. Focus area mounts exactly one `ptah-canvas-lane-view` keyed by tab id: OK. Header gets title/state/running/viewMode only: GAP (S2).
9. Persistence: `setBoardMode/Collapsed/Density/ScrollTop` -> `updateBoard` -> `schedulePersist` -> debounced `write` v3 -> `localStorage`: OK. Load -> `hydrateWorkspace` -> `_workspaceBoard`: OK.
10. Mode switch: orchestra `@for path` + `boardFor(path).mode` mounts Rail board or Grid; Grid detail closed by effect when leaving Grid: OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Two board modes, Rail default, Grid kept behind a toggle | COMPLETE | Toggle dead for the implicit path (M1) |
| Rail from the first session | COMPLETE | |
| No layout shift on focus change (stable order, fixed card height) | COMPLETE | Metric noise on external tile changes (m3); `+N more` geometry (S3) |
| One live view per visible board; hidden Rail workspace mounts nothing (D4) | COMPLETE | Attribute not measured (M6); proof is stub-level (M7) |
| Card shows state, lanes, callout, metrics; Allow/Deny/Open/Answer | PARTIAL | Collapsed state frozen (S1); lane overflow clipped (S3) |
| Focus header: title, branch, model, state, Stop, Compact, overflow, Close | PARTIAL | Branch and model missing (S2); menu close behaviour (M4) |
| Stale-request protection (R2-1) and error id (D10) | COMPLETE | Announcement duplicates (m4) |
| v3 persistence with v1/v2 read, newer-version read-only | COMPLETE | |
| Per-tab lane choice, lazy `onTabClosed` | COMPLETE | Strip reveal churn (M8) |
| Keyboard: roving list, window Left/Right, Esc rules | COMPLETE | Esc with menu open (M4) |
| Dark and light state-ink tokens with contrast spec | PARTIAL | 3:1 threshold used for text (M5) |

Implicit requirements not addressed: live state while collapsed; text-contrast for state labels; scroll restore on workspace return; announcement of repeated identical stale events.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Two equal-text errors | YES | Sequence advances on the empty -> reason edge | None |
| Duplicate failed stamp | YES | Same reason returns same update object | None |
| Reset | YES | Sequence kept | None |
| Replacement permission / question | YES | Shown-id guard + keyed rebuild | None |
| Dense `+N` with 0, 1, 4 lanes | YES | `+N` only when `total >= 1` | None |
| Comfortable with more than 3 lanes | NO | `+N more` below rows | S3 |
| v2 record opens Rail with Grid layout intact | YES | `board: null` -> default | None |
| `[99, 2.5, 3.5]` versions read-only | YES | `version > 3 or non-integer` | None |
| Board setters vs tile identity/revision | YES | Separate map | None |
| Queue Esc closes only the queue | YES | Document handler `preventDefault` | None |
| Hidden Rail workspace | YES | `@if (visible())` | None |
| Draft survives a mode switch | YES (by reading) | Continuous save + destroy save | Stub-level proof (M7) |
| Collapsed rail | NO | No state producer | S1 |
| No workspace folder open | NO | Toggle no-op | M1 |
| Workspace return scroll | NO | Restore once | M2 |

## Verdict

- Recommendation: APPROVED WITH FIXES (one fix round, then a re-review scoped to the fixes)
- Confidence: HIGH on persistence, identity and stale-id logic; MEDIUM on S3 and M3 (derived from CSS and browser behaviour, not rendered)
- Top risk: the collapsed rail (including the routine auto-collapse below 1120 px) silently shows stale session state.
- What a robust implementation would add: a state producer independent of the visual card; header inputs wired and asserted; lane zone sized from shared constants; a measured live-view count; a non-stubbed Rail integration smoke in the Electron list.

## Fix list for the one fix round

Blocking and Serious (must fix):

1. S1: keep the Rail state alive while collapsed and while the details strip auto-collapses; add a collapsed-mode wrapper/board spec.
2. S2: bind `branch` and `model` into `ptah-canvas-focus-header`; add a focus-area spec case.
3. S3: put `+N more` on the 16 px counts line and fix lane rows to 18 px (16 + 54 = 70); list it in the Electron re-check.
4. Known: replace the ten `text-base-content/60|70` uses (files listed above) so `no-alpha-base-content.spec.ts` passes.

Moderate items that are one-line and in files the fix round already touches (recommended, not required by policy): M2 (reset `restoredScroll` on show), M3 (`isCollapsed` check), M5 (lift `--state-ink-idle`, or use `base-content` for pill text), M6 (measure the live-view count), M1 (`activeWorkspacePath() ?? ''`).

Recorded only: M4, M7, M8, m1-m7.
