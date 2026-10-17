# Parity Inventory - TASK_2026_679_45ff

Surface replaced: the session list sidebar of `AppShellComponent` (the `<aside>` at
`T/app-shell.component.html:99-547`, its `Sessions` vertical tab at `T/app-shell.component.html:550-556`, its state and
handlers in `T/app-shell.component.ts:247-279, 313-432, 498-653, 787-982`), plus the Electron between-sidebars divider
that resizes it (`T/electron-shell.component.ts:290-301, 377-419`).

Prefixes: T = `libs/frontend/chat/src/lib/components/templates`, M = `libs/frontend/chat/src/lib/components/molecules`,
A = `libs/frontend/chat/src/lib/components/atoms`, CS = `libs/frontend/chat/src/lib/services/chat-store`,
CV = `libs/frontend/canvas/src/lib`, CU = `libs/frontend/chat-ui/src/lib`, W = `apps/ptah-extension-webview/src`,
BE = `libs/backend/rpc-handlers/src/lib/handlers`. Line numbers are from direct reads of this worktree
(branch `feat/previous-sessions-modal`, base `851846797`, 2026-10-16).

## Where the sidebar renders, per host

| Host / variant | Renders? | Default | Evidence |
| --- | --- | --- | --- |
| Electron shell (workspace open) | Yes, inside `ptah-app-shell`, left of the canvas, right of the Workspaces sidebar/tab | Open (`signal(isElectron)`), not persisted | `T/app-shell.component.ts:247`; `T/electron-shell.component.ts:303-311` |
| Electron layout mode | Always `grid` (canvas Rail board). The app-shell navbar is hidden in Electron grid mode, so the sidebar sits beside the canvas only | — | `T/electron-shell.component.ts:439, 499`; `T/app-shell.component.html:561-563` |
| VS Code webview (sidebar view, ~400 px, and editor panel) | Yes, same component | Closed; tab uses `size="sm"` | `T/app-shell.component.ts:247`; `T/app-shell.component.html:554` |
| VS Code single layout / grid layout | Both: the aside is in the shell row above both layouts | — | `T/app-shell.component.html:88-92, 672-676, 806-840` |
| Canvas Rail / narrow Rail | No own session list. The Rail lists board tiles only; `orchestra-canvas` delegates session management to the app-shell sidebar | — | `CV/orchestra-canvas.component.ts:57-59`; `CV/canvas-rail/canvas-rail.component.ts` |
| Overlay / drawer variant of the sidebar | None exists. At narrow widths the aside pushes the main area and is capped (floor 224 px) | — | `T/session-sidebar-width.ts:12-24, 34-56` |
| Organization variant (`organizationAvailable`) | Electron and CLI only (SQLite store). VS Code gets `organizationAvailable: false` and today's plain rows | — | `BE/session-rpc.handlers.ts:208-214, 422-426, 516`; `T/app-shell.component.ts:322-327` |

## Decision rule

`keep` = unchanged component/behaviour, reused as is. `move` = the capability must exist in the modal (or at the
new button) with the same observable behaviour. `remove-proposed` = sidebar-only chrome or behaviour with no meaning
in a modal; listed again under `## Proposed Removals` for the user. D1 (decisions.md) already approves removing the
always-visible sidebar as a whole; each row that loses behaviour is still listed so the user sees exactly what goes.

## A. Entry point and sidebar chrome

| ID | Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| A-1 | `Sessions` vertical tab opens/closes the list (`ptah-sidebar-tab`, `aria-expanded` from `isOpen`) | `T/app-shell.component.html:549-556`; `T/app-shell.component.ts:500-502`; `CU/atoms/sidebar-tab.component.ts` | none (local signal) | move | "Previous sessions" button directly under the New session button (per host, see F) opens the modal. The shared `SidebarTabComponent` stays (Workspaces, Git and agent-panel tabs use it) | new test needed |
| A-2 | List visible at all times on Electron (open by default), closed by default on VS Code | `T/app-shell.component.ts:247` | none | remove-proposed | Modal is closed by default on every host (D1) | n/a |
| A-3 | Width drag on the right-edge handle (`role="separator"`, pointer capture), ArrowLeft/ArrowRight ±16 px, double-click resets to 272 px | `T/app-shell.component.html:523-546`; `T/app-shell.component.ts:505-575` | none | remove-proposed | — (modal size is defined per viewport in task-description) | `T/session-sidebar-width.spec.ts:44-66` to be removed with the code |
| A-4 | Persisted sidebar width (`localStorage` key `ptah.sessionSidebarWidth`) | `T/session-sidebar-width.ts:24, 81-87`; `T/app-shell.component.ts:631-653` | `localStorage` | remove-proposed | — | `T/session-sidebar-width.spec.ts:68-84` to be removed with the code |
| A-5 | Width cap relative to the shell row (min 200, max 480, default 272, floor 224, main keeps 320) and `ResizeObserver` on the row | `T/session-sidebar-width.ts:12-56`; `T/app-shell.component.ts:255-267, 604-619` | none | remove-proposed | — | `T/session-sidebar-width.spec.ts:17-42` to be removed with the code |
| A-6 | Electron divider between Workspaces sidebar and sessions sidebar resizes the sessions sidebar (workspace width untouched) | `T/electron-shell.component.ts:290-301, 377-419`; `T/app-shell.component.ts:577-602` | none | remove-proposed | — (the Workspaces sidebar keeps its own width; it never used this divider) | `T/electron-shell.activity-placement.spec.ts:188-215` to be updated/removed with the code |
| A-7 | Width transition (`transition-[width]`, `transition-none` while dragging) | `T/app-shell.component.html:99-104`; `T/app-shell.component.ts:268-274` | none | remove-proposed | — (modal open/close motion is a design decision) | n/a |
| A-8 | Ptah icon header at the top of the aside | `T/app-shell.component.html:105-118` | `vscodeService.getPtahIconUri()` | remove-proposed | — (the modal carries its own title) | n/a |
| A-9 | Thin list scrollbar, shown only while the aside is hovered | `T/app-shell.component.html:225`; `W/styles.css:2307-2335` | none | move | Scrollable list region inside the modal (scrollbar treatment is a design decision; the `aside:not(:hover)` rule no longer applies) | visual review |
| A-10 | One surface-1 panel; search, Filters, selects, Date range and row titles share one 26 px left edge | `T/app-shell.component.html:93-100, 121-124` | none | move | Modal body alignment per design spec | `T/app-shell.organization.spec.ts:414` (update to the modal) |
| A-11 | Filters, date range, loaded pages and scroll position survive closing and reopening the sidebar and visiting standalone surfaces (the aside stays mounted; shell row retained with `*ptahRetainWhile`) | `T/app-shell.component.html:88-104`; `T/app-shell.component.ts:313-320` | none | move (filters, date range, loaded pages); remove-proposed (scroll position) | Modal: query state survives close/reopen within the app session; list scroll position need not | new test needed |
| A-12 | Ambient live status: running / waiting / failed markers and the open-tab accents are visible at all times without any action | `T/app-shell.component.html:257-279` | `SessionLivenessRegistry` | remove-proposed | Visible only while the modal is open. Board sessions keep their status chips in the canvas Rail (`CV/canvas-rail/canvas-rail.component.ts` `CHIP_STATES`) | n/a |

## B. Search, filters, sort, grouping, date range

| ID | Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| B-1 | Local name search (`Search sessions...`, case-insensitive substring over loaded pages), non-organization hosts | `T/app-shell.component.html:134-163`; `T/app-shell.component.ts:313, 358-393, 826-828` | client-side over `chatStore.sessions()` | move | Modal | `T/app-shell.organization.spec.ts:487` (update) |
| B-2 | Clear-search `X` button (shown when text is present) | `T/app-shell.component.html:152-161`; `M/session-filter-bar/session-filter-bar.component.ts:128-137` | none | move | Modal | new test needed |
| B-3 | Server search text, debounced 250 ms, trailing space kept (organization hosts) | `M/session-filter-bar/session-filter-bar.component.ts:55-56, 85-97, 111-138` | `session:list` `text` | move (component kept) | Modal | `M/session-filter-bar/session-filter-bar.component.spec.ts:66, 79`; `T/app-shell.organization.spec.ts:527` |
| B-4 | `Filters` popover trigger with active-filter count badge and `aria-expanded` | `M/session-filter-bar/session-filter-bar.component.ts:141-171` | none | move (component kept) | Modal | `M/session-filter-bar/session-filter-bar.component.spec.ts:120` |
| B-5 | Filter: Status multi-select (workflow statuses) | `M/session-filter-bar/session-filter-bar.component.ts:180-196` | `session:list` `status` | move | Modal (Filters popover) | `M/session-filter-bar/session-filter-bar.component.spec.ts:120` |
| B-6 | Filter: Priority multi-select | `M/session-filter-bar/session-filter-bar.component.ts:198-216` | `session:list` `priority` | move | Modal (Filters popover) | `M/session-filter-bar/session-filter-bar.component.spec.ts:120` |
| B-7 | Filter: Task id text (debounced) | `M/session-filter-bar/session-filter-bar.component.ts:218-231` | `session:list` `taskId` | move | Modal (Filters popover) | new test needed |
| B-8 | Filter: Pinned only | `M/session-filter-bar/session-filter-bar.component.ts:233-245` | `session:list` `pinned` | move | Modal (Filters popover) | `M/session-filter-bar/session-filter-bar.component.spec.ts:144` |
| B-9 | Filter: Has PR | `M/session-filter-bar/session-filter-bar.component.ts:246-257` | `session:list` `hasPr` | move | Modal (Filters popover) | `M/session-filter-bar/session-filter-bar.component.spec.ts:144` |
| B-10 | `Clear filters` inside the Filters popover | `M/session-filter-bar/session-filter-bar.component.ts:261-268` | `session:list` | move | Modal (Filters popover) | `M/session-filter-bar/session-filter-bar.component.spec.ts:144` |
| B-11 | Sort select: Last active, Priority, Created, Name | `M/session-filter-bar/session-filter-bar.component.ts:58-63, 277-289` | `session:list` `sort`; `BE/session-list-query.ts:68` | move | Modal | `M/session-filter-bar/session-filter-bar.component.spec.ts:101` |
| B-12 | Group select: No grouping, By status, By task, By parent | `M/session-filter-bar/session-filter-bar.component.ts:65-70, 291-306`; `libs/shared/src/lib/types/session-organization.types.ts:67-73` | `session:list` `groupBy` | move | Modal | `M/session-filter-bar/session-filter-bar.component.spec.ts:101` |
| B-13 | Identical query is not re-sent; pending timer released on destroy | `M/session-filter-bar/session-filter-bar.component.ts:10-13`; `CS/session-loader.service.ts:475-489` | `session:list` | keep | Modal reuses the same component and store | `M/session-filter-bar/session-filter-bar.component.spec.ts:155, 168` |
| B-14 | `Date range` toggle (chevron) with From / To date inputs; client-side filter over loaded pages, inclusive whole days, on every host | `T/app-shell.component.html:165-221`; `T/app-shell.component.ts:314-320, 363-389, 823-836` | client-side | move | Modal | `T/app-shell.organization.spec.ts:553` (update) |
| B-15 | `Clear` (all filters) button, shown only when any filter is active; keeps the chosen sort and grouping; closes the date panel | `T/app-shell.component.html:181-190`; `T/app-shell.component.ts:331-356, 790-803` | `session:list` (server filters only) | move | Modal | `T/app-shell.organization.spec.ts:710` (update) |
| B-16 | Query state lives in the store (`listQuery`, default `DEFAULT_SESSION_LIST_QUERY`) and is not persisted across reloads; search/date are local to the shell | `CS/session-loader.service.ts:246-248, 357, 475-489`; `T/app-shell.component.ts:313-320` | none | keep | Unchanged; see A-11 for close/reopen | new test needed |

## C. Row content

| ID | Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| C-1 | Title: display name, one line truncated, full name in `title` | `T/app-shell.component.html:286-297`; `T/app-shell.component.ts:850-852` | `SessionDisplayUtils` | move | Modal row | `T/app-shell.organization.spec.ts:376` (update) |
| C-2 | Relative time of last activity | `T/app-shell.component.html:314`; `T/app-shell.component.ts:842-844` | `SessionDisplayUtils` | move | Modal row | `T/app-shell.organization.spec.ts:376` (update) |
| C-3 | Message count `N msgs` (when > 0) | `T/app-shell.component.html:315-319` | `session:list` row | move | Modal row | new test needed |
| C-4 | `transcript expired` marker with retention tooltip; title dimmed | `T/app-shell.component.html:292-293, 320-326`; `T/app-shell.component.ts:304-305` | `session:list` `hasTranscript` | move | Modal row | new test needed |
| C-5 | Active session accent (fill + 2 px inset primary bar) and `aria-current="true"` | `T/app-shell.component.html:257-266`; `W/styles.css:2289-2298` (dark), `W/styles.css:2268-2276` (light) | `chatStore.currentSession()` | move | Modal row (the `.sidebar-item-*` classes are design-owned) | new test needed |
| C-6 | Open-tab accent (30% inset bar) and title in primary colour for active or open sessions | `T/app-shell.component.html:260-263, 288-291`; `W/styles.css:2301-2304`, `2278-2281`; `T/app-shell.component.ts:871-873` | `tabManager.findTabBySessionId` | move | Modal row | new test needed |
| C-7 | Live-phase marker: running dot, waiting moon, failed alert; idle invisible; `aria-label` + `title` (organization hosts) | `T/app-shell.component.html:269-279`; `A/session-organization-chips/session-live-phase-indicator.component.ts:1-20, 85-88` | `SessionLivenessRegistry`, row `livePhase` | move (component kept) | Modal row | `A/session-organization-chips/session-live-phase-indicator.component.spec.ts` |
| C-8 | Workflow badge (TASK_2026_648) | `T/app-shell.component.html:298-305`; `A/workflow-badge.component.ts` | `tabManager.workflowForSession` | move (component kept) | Modal row | `T/app-shell.organization.spec.ts:298` (update); `A/workflow-badge.component.spec.ts` |
| C-9 | Organization chips: pinned, priority, status, started-by-agent, linked tasks (missing task struck through), PR count | `T/app-shell.component.html:377-390`; `A/session-organization-chips/session-organization-chips.component.ts:61-145` | `session:list` `organization` | move (component kept) | Modal row | `A/session-organization-chips/session-organization-chips.component.spec.ts`; `T/app-shell.organization.spec.ts:572` (update) |
| C-10 | Child nesting (depth 1-3 indent, `data-depth`, sr-only `Child session:`) when grouping by parent | `T/app-shell.component.html:226-235, 283-285`; `T/session-row-groups.ts:29-127` | `session:list` `groupBy=parent` | move | Modal list | `T/app-shell.organization.spec.ts:690, 797` |
| C-11 | Group headers (label + count; list `aria-labelledby` the header) | `T/app-shell.component.html:395-433` | `groupSessionRows` | move | Modal list | `T/app-shell.organization.spec.ts:667, 747` |
| C-12 | Unread marker | not present in today's row (checked `T/app-shell.component.html:228-393`); the dot in the user's screenshot is C-7 | — | n/a | — | — |

## D. Row actions and keyboard

| ID | Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| D-1 | Open a session by clicking the row; layout-aware: grid opens/focuses a canvas tile, single switches the tab | `T/app-shell.component.html:253-268`; `T/app-shell.component.ts:859-865` | `appState.requestCanvasSession`, `chatStore.switchSession` (`session:load`) | move | Modal row; the modal closes after the open request (user-requested) | new test needed |
| D-2 | Rename inline: pencil button (hover/focus reveal) swaps the row for an input (max 200 chars), Enter or blur saves, Escape cancels, empty or unchanged is a no-op, double-fire guarded; open tab name/title updated | `T/app-shell.component.html:236-251, 354-364`; `T/app-shell.component.ts:306-307, 882-935` | `session:rename` (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:298`) | move | Modal row | new test needed |
| D-3 | Delete with confirmation dialog (`Delete Session`, error style); on success forget workflow mapping, drop the row, clear current session, close its tab, close the organizer if it shows that row | `T/app-shell.component.html:365-375`; `T/app-shell.component.ts:937-982` | `session:delete` (`claude-rpc.service.ts:285`), `ConfirmDialogService` | move | Modal row | `T/app-shell.organization.spec.ts:322, 345` (update) |
| D-4 | Organize (tag) button, `aria-haspopup="dialog"`, only when the row has an organization record; opens the organization editor | `T/app-shell.component.html:339-353, 14-26`; `T/app-shell.component.ts:409-432, 811-818` | none (opens editor) | move | Modal row; editor opens from the modal | `T/app-shell.organization.spec.ts:572, 618, 623, 651` (update) |
| D-5 | Pin / unpin, set priority, set status (inside the organization editor) | `M/session-organization-editor/session-organization-editor.component.ts:161, 182, 201, 583-605` | `session:setOrganization` | keep (editor unchanged) | Reached from D-4 in the modal | `M/session-organization-editor/session-organization-editor.component.spec.ts:123` |
| D-6 | Link a task (with primary/related role), unlink a task | `M/session-organization-editor/session-organization-editor.component.ts:219-285, 612-631` | `session:linkTask`, `session:unlinkTask` | keep | Reached from D-4 | `M/session-organization-editor/session-organization-editor.component.spec.ts:151` |
| D-7 | Add PR link (https only, length cap), remove PR link; stored non-https shown as text | `M/session-organization-editor/session-organization-editor.component.ts:305-377, 637-655` | `session:addPrLink`, `session:removePrLink` | keep | Reached from D-4 | `M/session-organization-editor/session-organization-editor.component.spec.ts:200, 248, 356` |
| D-8 | Worktree: show path, open in a detected editor target, copy path, refusal notice | `M/session-organization-editor/session-organization-editor.component.ts:389-459, 660-745` | `editor:detectTargets`, `editor:openWorkspace` | keep | Reached from D-4 | `M/session-organization-editor/session-organization-editor.component.spec.ts:296, 324` |
| D-9 | Editor dialog: Escape and close button emit `closed`; focus moves in on open and returns to the opener on close; inline `ok:false` errors | `M/session-organization-editor/session-organization-editor.component.ts:112-128, 544-575, 755-770` | — | keep | Must still return focus correctly when opened from inside the modal | `M/session-organization-editor/session-organization-editor.component.spec.ts:269, 344` |
| D-10 | Row actions hidden until row hover or focus-within | `T/app-shell.component.html:330-338` | none | move | Modal row (reveal behaviour is a design decision; keyboard reachability must stay) | new test needed |
| D-11 | Keyboard: Tab reaches each row button, then its Organize / Rename / Delete buttons; rename input takes Enter/Escape; no arrow-key list navigation, no shortcut, no context menu, no multi-select | `T/app-shell.component.html:236-376`; `libs/frontend/chat/src/lib/services/keyboard-shortcuts.service.ts` (no session-list shortcut) | — | move | Modal (Tab order inside the focus trap) | new test needed |

## E. List states and pagination

| ID | Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| E-1 | Booting: 5 skeleton rows instead of "No sessions yet" | `T/app-shell.component.html:434-445` | `bootStatus.isBooting()` | move | Modal list | new test needed |
| E-2 | Empty: "No sessions yet / Create one to get started" | `T/app-shell.component.html:472-483` | — | move | Modal list | new test needed |
| E-3 | No match: "No matching sessions / Try adjusting your search or filters" + `Clear filters` (clears filters only) | `T/app-shell.component.html:447-471` | — | move | Modal list | `T/app-shell.organization.spec.ts:710` (update) |
| E-4 | Pagination: `Load More (remaining)`; `Load more to expand search` under client filters; spinner + disabled while loading; hidden when client filters leave zero rows; page size 30 | `T/app-shell.component.html:489-520`; `CS/session-loader.service.ts:294, 571-600` | `session:list` (offset/limit) | move | Modal list | new test needed |
| E-5 | List load error: no UI state; failures are logged and the list stays as it was | `CS/session-loader.service.ts:482-486, 557-565` | `session:list` | keep (no new error state) | — | n/a |
| E-6 | List refresh on organization push and on session events (store-level) | `CS/session-loader.service.ts:426-489`; `M/session-organization-editor/session-organization-editor.component.ts:10` | `session:organizationChanged` | keep | Modal reads the same store | existing store specs |

## F. New session buttons (where "Previous sessions" goes)

| ID | Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- | --- |
| F-1 | App-shell navbar `New` (gold) + session-name popover (Enter creates, Escape cancels); visible in VS Code (single and grid), hidden in Electron (grid pinned) | `T/app-shell.component.html:560-563, 711-775`; `T/app-shell.component.ts:757-785` | `tabManager.createTab` / `appState.requestNewCanvasSession` | keep | Unchanged; "Previous sessions" placed next to it in the same navbar row (D5, task-description Requirement 1) | new test needed |
| F-2 | Canvas dock `New Session` anchor + the one named popover (rendered only while `canAddTile()`; disabled at running cap) | `CV/orchestra-canvas.component.ts:53-55, 144-200, 580-590` | `appState.requestNewCanvasSession` | keep | Unchanged | existing canvas specs |
| F-3 | Canvas Rail footer `New session` (collapsed Rail shows `+`; `aria-disabled` + reason) | `CV/canvas-rail/canvas-rail.component.ts:231-251, 276, 319` | emits `newSession` | keep | Unchanged; "Previous sessions" placed directly below it per task-description | existing Rail specs |
| F-4 | Empty-board `New session` (zero tiles) | `CV/canvas-rail/canvas-rail-board.component.ts:120-150, 809-825` | emits `newSessionRequested` | keep | Unchanged | existing Rail board specs |

## Proposed Removals

**USER APPROVED 2026-10-16 (decisions.md D6): all removals below.**

D1 approves removing the always-visible sidebar. These rows lose behaviour as a consequence and are listed for
explicit confirmation; none of them is decided by the PM.

- A-2 Always-visible list / open-by-default on Electron: the list is visible only while the modal is open. Reason:
  this is the change the user asked for (D1).
- A-3 Width drag handle (pointer, Arrow keys, double-click reset): a modal has no resizable edge; its size is set
  per viewport.
- A-4 Persisted sidebar width (`ptah.sessionSidebarWidth`): nothing left to persist. A stale value stays in
  `localStorage` unless the architect clears it.
- A-5 Width cap against the shell row: no aside left to cap.
- A-6 Electron between-sidebars divider resizing the sessions sidebar: its only target is gone; the Workspaces
  sidebar width is unaffected.
- A-7 Width open/close transition: replaced by whatever open/close motion the design sets for the modal.
- A-8 Ptah icon at the top of the aside: decorative; the modal has its own title.
- A-11 (scroll position only) List scroll position surviving close/reopen: recommended to drop unless the design
  keeps the modal mounted; filters, date range and loaded pages still survive (moved).
- A-12 Ambient live status of every session without opening anything: after the change, running / waiting /
  failed markers and open-tab accents for sessions are seen only inside the modal. Sessions on the canvas board
  keep their Rail status chips. If the user wants an always-visible signal (for example a count on the
  "Previous sessions" button), that is a new requirement, not parity.

## E2E specs that target the sidebar

Search covered `apps/ptah-electron-e2e`, `apps/ptah-extension-vscode-e2e` (no hits) and
`libs/frontend/webview-e2e-harness`. No spec drives the Filters popover, the sort or group selects, the date inputs
or the resize handle. Every spec below must be updated to reach the list through the "Previous sessions" button and
modal; none may be deleted (user-requested). E = `apps/ptah-electron-e2e/src`, H =
`libs/frontend/webview-e2e-harness/src/lib/scenarios`.

### Shared helper (one change fixes most specs)

| File:line | Helper | Sidebar selector / behaviour | Used by |
| --- | --- | --- | --- |
| `E/support/perf-session-fixture.ts:433-441` | `sessionRowButton(page, name)` | `.sidebar-scroll li:not([data-testid="session-group"])` filtered by name, first `button` | every spec below in "Specs via the helper" |
| `E/support/perf-session-fixture.ts:443-460` | `prepareCanvasWithSessions(ui, sessions, opts)` | mocks `session:list` (`mockSessions` :373, fixture :405-417), `ui.goto('canvas')`, pushes `session:metadataChanged`, asserts every sidebar row visible (:457) | same |
| `E/support/perf-session-fixture.ts:475` | `resolveButtonHandles(page, sessions)` | element handle of each sidebar row button; throws if missing | `tile-open-longtask-budget.perf.spec.ts` |

### Specs via the helper (open a session from a sidebar row, then assert on the canvas tile)

| Spec | Lines that reach the sidebar | Tests |
| --- | --- | --- |
| `E/specs/chat/tile-load-older-history.spec.ts` | local `openSession` :37 clicks `sessionRowButton` :41; `prepareCanvasWithSessions` :70, :375, :391, :420 | :340, :355, :370, :387, :407 (describe :339) |
| `E/specs/chat/tile-open-longtask-budget.perf.spec.ts` (`test.skip`-gated :267) | :288/:293, :451/:452, :519/:526/:529, :605/:607/:610 | :273, :443, :511, :595 |
| `E/specs/git/change-set-card.spec.ts` | local `openSession` :132 clicks `sessionRowButton` :136; `prepareCanvasWithSessions` :192, :237, :270 | :171, :254 (describe :170) |
| `E/specs/git/visual-review.spec.ts` | `prepareCanvasWithSessions` :1068; `sessionRowButton(...).click()` :1072 | `mockedTest` "chat change-set card ${theme}" :951 |

### Docs-screenshot scripts (Playwright, Electron)

| File:line | Selector | What it does |
| --- | --- | --- |
| `E/docs-screenshots/sessions.shot.ts:19-20` | `getByPlaceholder('Search sessions...')` | asserts visible (test "sessions rail, history filters and the canvas tile strip" :12) |
| `E/docs-screenshots/sessions.shot.ts:25` | `locator('aside').filter({ has: search })` | crop target for shots `sessions-overview` and `sessions-history` |
| `E/docs-screenshots/sessions.shot.ts:28-30` | `[title="Toggle date filter"], [aria-label="Toggle date filter"]` | opens the date range if visible, re-shoots |
| `E/docs-screenshots/sessions.shot.ts:53` | `getByRole('button', { name: 'New Session' })` | clicks the header or canvas New Session (not the sidebar, but adjacent to the new button) |
| `E/docs-screenshots/editor-git.shot.ts:38-48, 89` | `[title="Toggle Sessions panel"], [aria-label="Toggle Sessions panel"]` (the `Sessions` sidebar tab) | `collapseRails` collapses the sidebar before git shots; the toggle no longer exists after the change |

### Webview e2e harness scenarios

These locate controls by role/name regex; DOM steps are skipped when the control is not found, so after the change
they can pass without exercising anything unless updated.

| File:line | Selector | Asserts |
| --- | --- | --- |
| `H/sessions/session-list.e2e.spec.ts:22-41` | injects `sessions:list:result` (fixture :30-31) | fixture root ready only |
| `H/sessions/session-list.e2e.spec.ts:43-55, 57-70` | injects switch / empty list | outbound buffer is an array; page alive |
| `H/sessions/session-create.e2e.spec.ts:12-41, 43-71` | `getByRole('button', { name: /new session\|create session\|\+ session/i })` (:20-21, :49-50) | create RPC; no empty-name create |
| `H/sessions/session-delete.e2e.spec.ts:11-26, 28-48, 50-68` | `/delete session/i` (:14-15, :34-35, :55-56) matches the row's `Delete session: <name>` label; then `getByRole('dialog')` | confirmation dialog; delete RPC on confirm; none on cancel |
| `H/sessions/session-delete.e2e.spec.ts:70-85, 87-` | injects delete/list results; `/undo\|restore/i` | sync, undo affordance |
| `H/plan-limits/plan-limits.fixtures.ts:617-629` | `session:list` mock (`Quota resets review`) | no sidebar interaction (its "sidebar tab" at `plan-limits-visual.e2e.spec.ts:127` is the agent panel) |

### Not the sessions sidebar (same words, no change needed)

- Canvas Rail (`ptah-canvas-rail`, `aria-label="Sessions"`): `E/specs/canvas/canvas.spec.ts:66-72` (empty board
  `New session`), `:218` (Rail footer button focus). The new button under the Rail footer may change Tab order here.
- Canvas new-session anchors: `E/support/ui-driver.ts:439-453` (`canvas-new-session-anchor`),
  `[title="Add new session tile"]` in `compaction-duplicate-session.spec.ts:173`,
  `task-370-concurrent-session-isolation.spec.ts:127`, showcase scenes.
- `session:list` at RPC level only: `E/specs/task-340-session-list-phantoms.spec.ts:57, 109`
  (`E/support/session-seed.ts`); empty mocks in `compaction-duplicate-session.spec.ts:75`,
  `task-370-concurrent-session-isolation.spec.ts:120`.
- Dashboard date filter: `sessions.shot.ts:83-84` ("session analytics dashboard"), `showcase/dashboard-tour.scene.ts:157`.

### Task evidence scripts under `.ptah/specs` (tracked, not run by any target)

- `.ptah/specs/TASK_2026_612_0332/evidence/{before,after}/harness/child-session-visibility.evidence.ts:98-103`
  (`Search sessions...`, `aside` filter, `transcript expired`).
- `.ptah/specs/TASK_2026_580_9f77/visual-c12/*.mjs` (`aside:has(.sidebar-scroll)`, `.sidebar-scroll button.w-full`,
  `session-filter-*`, `session-search-local`, `session-organize`).
  Historical evidence of closed tasks; recommended to leave unchanged (see task-description open questions).
