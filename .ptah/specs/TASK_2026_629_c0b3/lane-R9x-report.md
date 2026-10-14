# Lane R9x report — TASK_2026_629_c0b3, batch R9x (writer handoff)

Writer: Claude frontend-developer (second writer). Base: HEAD 916c0685f, worktree
`D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.

## Who did what

- **First writer** (stopped at its context limit): all source and spec edits in the 8 files,
  including the e2e spec.
- **This writer**: checked `git status` (exactly the 8 R9x files, no other path under `libs`/`apps`);
  audited every diff against the R9x section (`batches-rail-r9.md:606-646`), decisions 105/106, C1-C3
  and NEW-3/NEW-6; confirmed the e2e spec is complete; ran `ptah_get_diagnostics` on the e2e spec,
  board and header (0 errors in those files; the 7 sibling errors are older and in files outside this
  batch: `orchestra-canvas.rail.spec.ts:274`, `core/src/testing/mock-rpc-service.ts:53-68`,
  `shared/.../capability-id-codec.ts:262-263`); ran the four specs under the lock; wrote this report.
  The audit found no missing named case and no defect, so **this writer made no code change**.

Paths below are relative to `libs/frontend/canvas/src/lib/canvas-rail/` unless they name another path.

## Contract table

| Contract point / named case | Source (file:line) | Spec case (file:line) | Result |
| --- | --- | --- | --- |
| Header void outputs `closeSplitRequested`, `closePaneRequested`, `swapPanesRequested` (+ `detailsRequested`) | `canvas-focus-header.component.ts:76-79`, menu items `:44-51` (split only), `choose()` `:105-109` | header spec `:72` "split actions are keyboard reachable right after the menu trigger and before Close session" | PASS |
| Keyboard reachable in the header menu: menu trigger, then actions, then Close session | header `:38-55` (trigger has `data-header-menu`; Close session comes after the menu in the DOM) | header spec `:72` | PASS |
| Focus area forwards each output with its stable pane id | `canvas-focus-area.component.ts:49-52`, outputs `:93-96` | focus-area spec `:264` (`it.each` left/right; also passes `splitDisplayed`/`detailsOpen` and checks `panelId`) | PASS |
| Board consumes all three; each header output wired through focus area to board state | `canvas-rail-board.component.ts:154-157`, `closeSplit` `:554`, `closePane` `:567`, `swapPanes` `:585`, `openSplitDetails` `:595` | board spec `:1102` "each header output reaches board state through the pane focus area" | PASS |
| Board owns the polite live region | board `:215` (`aria-live="polite"`); announcements in `closeSplit`/`closePane`/`swapPanes`/`openBeside` and `announceReplaced` | board spec `:1132`, `:1181`, `:1245` (announcement text) | PASS |
| Board owns focus return (survivor header when the control is removed) | `restoreHeaderFocus()` board `:760-766`; header `choose()` first focuses its own trigger | board spec `:1132`, `:1181` | PASS |
| Close active pane: releases that host, focuses the survivor | board `:567-583` | board spec `:1132` "close active pane releases that host, focuses the survivor in its own host and header" | PASS |
| Close inactive pane: store focus untouched | board `:567-583` (no `focusTile` when `!closingActive`) | board spec `:1156` "close inactive pane keeps store focus and the active host; NEW-6 ..." | PASS |
| Close split keeps the active tab | board `:554-560` | board spec `:1181` "close split from the active header keeps the active tab and the focus on that header" | PASS |
| Escape closes an open menu first and never closes a pane | header `:42` + `closeMenu` `:94` (stopPropagation); board has no pane-closing Escape handler (only the Details dialog `:160`) | header spec `:84` "Escape closes an open split menu first and never emits a close output"; board spec `:1199` "Escape inside a split pane never closes a pane" | PASS |
| Swap changes ONLY `visualOrder` (CSS `order` of stable wrappers); hosts, ids, panel ids, subtrees unchanged; <= 2 hosts; labels follow `visualOrder` | board `:585-592`, `[style.order]` `:142`, `paneLabel` `:500-505` | board spec `:1245` "stacked swap keeps hosts and top-before-bottom Tab order" (same wrappers, lane-view stand-ins, focus areas, stubs, pane ids, tab ids; 2 lane views, `data-canvas-live-views=2`; active tab `b`, Rail stub focus `b`; labels Top/Bottom) | PASS |
| "stacked swap keeps hosts and top-before-bottom Tab order" (handler `focus()` target from synthetic keydown) | `onTabKey` board `:775-803`, host listener `:70` | board spec `:1245` (Rail -> top, top end -> bottom, Shift reverse, bottom end -> after) | PASS |
| B3 handler: skips hidden elements, excludes open dock overlay / Details / menu; inert in default order | `isTabbable` board `:40-51`, `PANE_OVERLAYS` `:38`, guard `:777-778` | board spec `:1302` "stacked Tab handler skips hidden elements, leaves open overlays alone and is inert in the default order" | PASS |
| "side-by-side swap keeps DOM Tab order" (B3) | guard `!this.splitStacked()` board `:778` | board spec `:1329` | PASS |
| "collapse resets visualOrder" | `collapseSplit` board `:547-551` | board spec `:1217` (`it.each` per collapse path, new split starts in default order), `:1233` "collapse resets visualOrder after external removal" | PASS |
| Unique panel ids across panes | `panelId` = `rail-${paneId}-lane-panel` `canvas-focus-area.component.ts:88` | focus-area spec `:264` (per pane id); board spec `:757` (unique placement labels) | PASS |
| Drafts and docks unchanged after swap | Dock and composer live inside the lane-view/ChatView subtree, whose host identity the board spec pins | board spec `:1245` (subtree identity); chat-input spec `:420` (draft per tab after a pane swap) | PASS (see Decisions D3) |
| Contextual F5 drafts per `SESSION_CONTEXT` tab | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts:365` describe | chat-input spec `:384`, `:401`, `:420` | PASS |
| e2e split and reorder selectors and cases (never run) | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:1-125` helpers, `:127` describe | e2e `:128` Open beside + header Details clear of lane tabs; `:156` swap + Close split; `:186` stacked Tab after swap (skips if not stacked); `:200` Close pane; `:214` Move down | Complete; 0 TS diagnostics; not run (by rule) |
| C1: repair `focusTile` gated on canvas surface active; repair on activation | `surfaceActive` board `:247-253` (`SURFACE_ACTIVE` optional, default `signal(true)`); `writable` gates `:338`, `:361`, `:367`; effect rereads on activation | board spec `:1028` (SURFACE_ACTIVE false, removed focused tile: no `focusTile`; activation repairs once), `:1047` (hydration null focus), `:1058` (split survivor) | PASS |
| C2: hidden removal during split keeps the survivor as `lastFocusedId` | board `:349-353` | board spec `:1079` "C2: hidden removal during split keeps the survivor and the board shows it on return" | PASS |
| C3: delete unreachable reorder-specific failure branch and `reorderPending`; neutral message on a visible board | board `:390-393` (single neutral branch); `move()` no flag `:619-636` | board spec `:930` (renamed, also asserts `'reorderPending' in instance` is false `:943`), `:937` "C3: a write failure after a reorder reads the neutral layout message on a visible board, nothing while hidden" | PASS |
| NEW-3: Close split and Details in the pane header; no absolute control over header or lane-tab strip; Details opens/closes the split overlay (decision 83) | board absolute buttons removed (former `:124-129`); header Details `canvas-focus-header.component.ts:34-37`, Close split in menu `:49-50`; overlay still board-owned `:159-160`, focus return `closeSplitDetails` `:603-617` | header spec `:103` "NEW-3: split Details is an in-flow header control ..." (no `absolute` header button); board spec `:1102`, `:1302` (Details opens via header output); e2e `:128` (bounding box above lane tabs) | PASS (geometry only in e2e, not run) |
| NEW-6: no `left` assumption in single focus | `restoreHeaderFocus` and `closeSplitDetails` use `activeSide()` (board `:609`, `:764`); `onTabKey` uses `visualOrder()`; e2e helpers use `[data-pane-side]` and CSS order | board spec `:1156` (single focus on the right side); e2e helpers `:3-18` | PASS |
| Binding: decision 77 (no `HIDE_AGENT_SIDEBAR: true`) | not present in any R9x diff | — | Held |
| Binding: lane-tabs spec not modified | `git status` shows it unchanged | — | Held |
| Binding: <= 2 live hosts, one retention coordinator, never same tab in both panes | `assertDistinct()` kept in all split paths; swap mounts nothing | board spec `:1245` (2 lane views) | Held |

## Spec runs (each through `node .ptah/tmp/check-run.mjs`, one at a time, from W)

| Label | Command target | Result |
| --- | --- | --- |
| r9x-header | `@ptah-extension/canvas --testFile=canvas-focus-header.component.spec.ts` | `Test Suites: 1 passed, 1 total` / `Tests: 12 passed, 12 total` |
| r9x-board | `@ptah-extension/canvas --testFile=canvas-rail-board.component.spec.ts` | `Test Suites: 1 passed, 1 total` / `Tests: 66 passed, 66 total` |
| r9x-area | `@ptah-extension/canvas --testFile=canvas-focus-area.component.spec.ts` | `Test Suites: 1 passed, 1 total` / `Tests: 9 passed, 9 total` |
| r9x-chat | `@ptah-extension/chat --testFile=chat-input.component.spec.ts` | `Test Suites: 1 passed, 1 total` / `Tests: 78 passed, 78 total` |

All runs used `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`. No `●` failure lines in any
log. Not run (by rule, left to Mode 2): full canvas suite, typecheck, lint, e2e.

## Decisions

- D1 (first writer, kept): the header menu holds Swap panes, Close pane and Close split (split only).
  Details is an in-flow header icon button (`ⓘ`, `aria-label="Open details"`, `aria-haspopup="dialog"`,
  `aria-expanded`) shown only in split. In single focus, Details stays on its existing non-split path.
- D2 (first writer, kept): in split, `narrow()` is true, so header buttons drop their words (each pane
  is at most half the board). Every `aria-label` is kept (header spec `:115`).
- D3 (this writer): "drafts and docks unchanged after swap" is pinned by lane-view subtree identity in the
  board spec, because the dock and composer sit inside the stubbed lane view. The chat-input spec covers
  the per-tab draft behaviour, including after a pane swap. No separate dock assertion was added at board level.
- D4 (first writer, kept): `choose()` closes the menu and focuses its trigger before emitting.
  `restoreHeaderFocus()` then moves focus to the surviving pane's trigger only when focus was lost
  (the active element is body or disconnected).
- D5 (first writer, kept; recorded B3 trade-off): side by side, Tab follows DOM order after a swap.
  Only stacked mode with a swapped order intercepts Tab.
- D6 (first writer, kept; C3 option "delete"): there is no write-completion signal, so the
  reorder-specific failure message and `reorderPending` were deleted. A failure on a visible board reads
  "Layout changes could not be saved."

## Clarifications Needed

None.

## Proposed Removals

None. The C3 deletion removes dead code, not a capability: the specific message could not be reached in
production (decision 106).

## Changed files (all by the first writer; this writer changed none)

- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\apps\ptah-electron-e2e\src\specs\canvas\canvas.spec.ts

Report written by this writer:
D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\specs\TASK_2026_629_c0b3\lane-R9x-report.md

## Notes for the reviewer

- Header spec `:103` checks NEW-3 through class names, and e2e `:128` checks it by bounding box.
  The e2e is never run, so the Electron visual re-check is the only real geometry check.
- When the surface is visible but inactive, the effect still announces "Split closed because a session
  was removed." (board `:369`) even though it skips the store write. The live region is in a hidden
  surface, so nothing is spoken. Recorded, not changed.
