# Batch 1 report - TASK_2026_705_9d53

Batch 1: chat shell, routing services and SurfaceActiveDirective (projects `@ptah-extension/core`,
`@ptah-extension/chat`). Worktree `D:/projects/ptah-extension/.claude-worktrees/remove-single-layout`
(`WT` below). All paths are under `WT`. Line ranges are new-file lines (from `git diff -U0`).

**Tasks completed**: 1.1, 1.2, 1.3, 1.4, 1.5. Their status lines in `batches.md` now say IMPLEMENTED.
No other line of `batches.md` changed.

## Files

### Task 1.1

- MODIFIED `libs/frontend/core/src/lib/routing/surface-active.directive.ts` (whole file, 1-20).
  The input and the `AppStateManager` inject are gone. `active = surfaceActiveFor('chat')()`. The
  selector `[ptahSurfaceActive]` and the `SURFACE_ACTIVE` provider did not change.
- MODIFIED `libs/frontend/core/src/lib/routing/surface-active.spec.ts` (whole file, 1-58).
  Dropped the `LayoutMode` import and the `AppStateManager` stub. It now mounts one bare
  `ptahSurfaceActive` host and follows the settled route only (chat -> settings -> chat). It
  also checks that the child instance is kept.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`:
  - 7-8: modal comment. The modal opens from the Rail footer.
  - 54: layout comment.
  - 111-114: header comment, and `[class.hidden]="isElectron"`.
  - 207-216: removed the Canvas toggle and the tab-bar branch. The "Orchestra Canvas" label now
    always shows.
  - 309: removed the navbar Previous sessions button.
  - 333-338: content-area comment. The canvas div is a bare `ptahSurfaceActive` with no
    `[class.hidden]`.
  - 362: removed the single-chat `<ptah-chat-view>` div.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`:
  - 19, 27: removed the `History`/`LayoutGrid` imports, `ChatViewComponent` and `TabBarComponent`.
  - 67-110: removed the `TitleOrigin` import. Class doc rewritten: navbar plus canvas, Rail opener,
    no `@see ChatViewComponent`. Removed `ChatViewComponent` and `TabBarComponent` from `imports`.
  - 149-150: comment on `previousSessions`.
  - 176: removed `layoutMode`.
  - 198-200: canvas eager-token comment no longer says Electron forces grid.
  - 213, 218: removed `HistoryIcon` and `LayoutGridIcon`.
  - 287: removed `openPreviousSessions`.
  - 336: removed `toggleLayoutMode`.
  - 388-392: `handleCreateSession` only calls `requestNewCanvasSession(name || defaultSessionName())`.
  - `previousSessions` and `tabManager` (still used by `openInEditor`) stay.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/app-shell.previous-sessions.spec.ts`:
  - 1-25: header doc.
  - 77-85: `CANVAS_CONTAINER` selector. `Host` lost `layout`.
  - 99-131: removed the `layoutMode` and `toggleLayoutMode` stubs. `requestNewCanvasSession` is
    now a captured mock.
  - 244-273: new `railTrigger()` / `openFromRail()`. They place a stand-in trigger in the canvas
    container and open the modal through `PreviousSessionsDialogService.open()`.
  - 310-373: removed the navbar-button placement and opening cases. Added a new "VS Code shell"
    describe:
    - The navbar is visible. The canvas container is visible, there is only one, and it holds
      the unbound-canvas spinner fallback.
    - No `PTAH-TAB-BAR` or `PTAH-CHAT-VIEW` tag, no canvas-grid toggle, and no navbar Previous
      sessions button.
    - The "Orchestra Canvas" label is present.
    - Create calls `requestNewCanvasSession`.
  - Added an "Electron shell" case: the header is hidden and the canvas container is visible.
  - 376-610: the while-open, chunk-loading and organizer cases now open through the Rail
    stand-in. Their navbar-only `aria-expanded`/`aria-controls` assertions were dropped. The Rail
    button owns those, and `canvas-rail.component.spec.ts` covers it.
- MODIFIED `libs/frontend/chat/src/lib/components/index.ts` (106). `TabItemComponent` is out of the
  deprecated re-export. `SessionCostSummaryComponent` and `SessionStatsSummaryComponent` stay.
- DELETED `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`
- DELETED `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.spec.ts`

### Task 1.2

- MODIFIED `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`:
  - 421: removed the constructor boot pin and its comment.
  - 496: removed the `setLayoutMode` line from `onCanvasTab`. `setCurrentView('chat')` stays.
  - No imports changed; `LayoutGridIcon` is still the Canvas tab icon.
- MODIFIED, removing the `setLayoutMode: jest.fn()` stubs:
  - `electron-shell.activity-placement.spec.ts` (93)
  - `electron-shell.command-center-tab.spec.ts` (60)
  - `electron-shell.review-dock.spec.ts` (106)
  - `electron-shell.view-transition.spec.ts` (62)
- MODIFIED `electron-shell.config-gate.spec.ts` (76, 128): removed the stub and its `mockReset`.
- MODIFIED `electron-shell.apps-tab.spec.ts` (67, 96, 128, 182): removed the stub, two
  `mockReset` calls and the `setLayoutMode` not-called assertion.

### Task 1.3

- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts`
  (2, 11-21, 34). It always calls `requestCanvasSession`. Dropped the `SessionLoaderService`
  inject and import, and rewrote the doc.
- MODIFIED `.../chat-store/session-open-bridge.service.spec.ts` (whole file).
  - Removed the `LayoutMode`/`SessionLoaderService` stubs and the single-layout and failed-switch
    cases.
  - Kept the canvas-open case, the handle-once case and the reopen case.
  - Added "a dropped canvas request still clears the request".
- MODIFIED `.../chat-store/task-prompt-bridge.service.ts` (18-22, 66-85). It always calls
  `requestCanvasTab(tabId, activeWorkspacePath, name)`, and the prefill is scoped to `tabId`.
- MODIFIED `.../chat-store/task-prompt-bridge.service.spec.ts` (4-15, 31-46, 85-135).
  - Removed the `layoutMode` stub. The default case now expects prefill scope `'tab-1'`.
  - The tile-request cases no longer set the layout.
  - The single/grid `it.each` became "scopes the composer prefill to the created tab".
  - Deleted "does NOT request ... in single layout".
- MODIFIED `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts` (45-51). It always
  calls `requestCanvasTab` and the prefill uses `tabId`. No claim filter was added.
- MODIFIED `.../workflow-tab-launcher.service.spec.ts` (1-33, 51-72). Removed the layout signal.
  - Decision-7 case: a launched workflow tab requests a canvas tile with
    `('tab-1', '/work', 'Harness')` and is prefilled with `'tab-1'`.
  - Added a case: tile requested, no prefill without `visiblePrompt`.
- MODIFIED `libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.ts`
  (45-62). Canvas path only. The warn and `'failed'` path is kept.
  - `ChatStore` stays: rename and delete still use it.
- MODIFIED `.../session-list/session-row-actions.service.spec.ts` (48-151).
  - Removed the `layoutMode` and `switchSession` stubs and the three single-layout cases.
  - Kept the canvas-opened case and the canvas-dropped (warn, `'failed'`) case.
- MODIFIED `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts`
  (306-307, 327-334, 351).
  - Deleted the `layoutMode() !== 'grid'` guard.
  - Fixed the comments at the old lines 335-341, plus the handoff comment that pointed at the
    tab bar.
- MODIFIED `.../agent-session-adoption.service.spec.ts` (48, 87, 242, 253, 374, 510).
  - Removed the `layoutMode` stubs (both describes) and the "single layout: never touches tile
    logic" case.
  - Renamed the grid case. Changed the "tab bar" wording in one title.
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.spec.ts`
  (107-216 stubs; 708-834 cases).
  - Removed the `layoutMode` and `store.switchSession` stubs, and eight `layoutMode.set('grid')`
    lines.
  - Deleted the three single-layout cases: switch tab and close; notice on a failed switch;
    close after the switch settles.
  - Every canvas case is kept, including the failed-open notice, the pending guard and the
    late result.

### Task 1.4

- MODIFIED `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts`
  (13, 19, 41-47).
  - Removed `setLayoutMode('grid')`, the cap-reached fallback, the `ChatStore` import and inject,
    and the `openSessionTab`/`switchTab` calls.
  - It returns `requestCanvasFocus(...)` directly. `resolve` stays.
- MODIFIED `.../notification-focus-coordinator.service.spec.ts` (3-125).
  - Removed the `ChatStore` provider and the `setLayoutMode` order entries.
  - The "falls back to the full single view" case became "returns cap-reached and switches no
    tab". It expects `{ success: false, outcome: 'cap-reached' }`, order `['workspace', 'view']`,
    and neither `switchTab` nor `openSessionTab` called.
  - `notification-center.component.ts` was not edited.

### Task 1.5 sweep

- `grep -rnE "setLayoutMode|toggleLayoutMode|ptah-tab-bar|TabBarComponent|Toggle canvas grid" WT/libs/frontend/chat WT/libs/frontend/core/src/lib/routing`
  returns **0** lines.
- `layoutMode` remains in chat only in the Batch 2 files: `chat-view.component.ts`,
  `chat-view.component.spec.ts`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts` and
  `chat-view.session-enter.spec.ts`.
- No "single chat", "single layout", "single-layout" or "single-chat" wording was added in any
  diff line.

## Parity-inventory rows touched

| Row (parity-inventory.md line) | How it is handled |
| --- | --- |
| 44 mount point | Removed with `tab-bar.component.ts`; app-shell renders no `ptah-tab-bar` (new spec case) |
| 45-56 tab bar capabilities (switch, close, view mode, liveness, workflow badge, claim filter, agent-origin badge, tooltip, awaiting indicator, scroll) | Removed with the component per decisions 2, 5, 7. No code was added: the Rail and focus header already cover the kept ones |
| 57 `TabItemComponent` | Removed only from the chat re-export (`components/index.ts`); the chat-ui file and its export are Batch 4 |
| 59 TabManager APIs | Kept; none touched |
| 68 `setLayoutMode` callers | Electron boot and Canvas tab, and the notification coordinator (both calls), no longer call it. The API itself is Batch 3 |
| 69 `toggleLayoutMode` and Canvas toggle | Toggle markup and `AppShellComponent.toggleLayoutMode` deleted; the API is Batch 3 |
| 70 single-chat content area | `<ptah-chat-view>` div removed from app-shell; `ChatViewComponent` out of `imports` |
| 71 "Orchestra Canvas" label | Kept, now unconditional; asserted in the new VS Code shell case |
| 72 header hidden in Electron | Kept; condition is `isElectron`; asserted in the new Electron shell case |
| 73 new-session popover | Canvas path only (`requestNewCanvasSession`); asserted by the new Create case |
| 74 navbar Previous sessions button | Removed (button, `openPreviousSessions`, `HistoryIcon`). The Rail footer opener and `PreviousSessionsDialogService` are unchanged. The modal host specs open through `open()` |
| 75 `SurfaceActiveDirective` | `'chat'`/`'canvas'` input and the layout read removed. It is still the `SURFACE_ACTIVE` provider for the canvas tree |
| 76 `*ptahRetainWhile` retention | Unchanged (template row untouched) |
| 79 Electron grid pin | Both calls removed; `onCanvasTab` still navigates to chat |
| 80-84 session-open bridge, task-prompt bridge, workflow launcher, row actions, adoption | Each keeps only its canvas body |
| 89 notification cap fallback | Returns the canvas `cap-reached` result unchanged (decision 4) |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The new spec asserts absence by upper-case tag names (`PTAH-TAB-BAR`, `PTAH-CHAT-VIEW`) and `[aria-label*="canvas grid" i]` | literal `ptah-tab-bar` / `Toggle canvas grid` selectors (break the Task 1.5 zero-hit sweep) / drop the assertions (break the Task 1.1 validation note) | batches.md Task 1.1 validation notes and Task 1.5 sweep pattern | yes |
| The modal opener in the app-shell spec is a stand-in `data-previous-sessions-trigger` button inside the canvas container | mount the real canvas Rail (pulls in the canvas lib, outside the NO_ERRORS_SCHEMA harness) / no opener (focus-return cases lose their target) | `PreviousSessionsDialogService.open()` records the focused element (`previous-sessions-dialog.service.ts:43-48`); the real Rail button lives inside the canvas in the retained row | yes |
| Comments were updated in edited files beyond the listed lines: the app-shell canvas eager-token doc, and the adoption handoff comment that named the tab bar | leave stale wording | Task 1.1 implementation details: no single-layout wording in edited files | yes |

## Verification

- No jest, nx, typecheck, lint or build was run, per the orchestrator's instruction.
- `npx prettier --write` ran on the changed files. Its one unrelated reflow (the `router-outlet`
  line in `electron-shell.component.ts`) was reverted.
- `mcp__ptah__ptah_get_diagnostics` (errors, scoped to the core directive and spec, app-shell
  class and spec, coordinator, row-actions spec and bridge):
  - No error in the core routing files or in any edited production file.
  - One error appears in an edited spec: `app-shell.previous-sessions.spec.ts:492`,
    `focus.mock.instances.some((element) => element.matches(CLOSE))`. That line is unchanged
    from main; it was old line 518. The same checker reports ~340 errors in untouched sibling
    specs (for example `chat-transcript.ptah-ui.spec.ts` and `compact-session-card.component.spec.ts`),
    so the tool's strictness differs from the project's `tsconfig.spec`.
  - This is not a pass. The orchestrator's scoped check is the gate:
    `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat --parallel=1 -- --maxWorkers=2 2>&1 | tail -60`.
- `git status --short`: only the Batch 1 files, plus the pre-existing `.gitignore` change and the
  untracked task folder. No Batch 2-4 file, `chat-transcript.*`, `message-bubble.*` or
  `chat-input.component.ts` was touched.

## Not done / out of scope

- Batch 2-4 work was not started: the core layout API, `chat-view.*`, chat-ui, harness-builder,
  e2e and the comments in `app.config.ts`, `lazy-view-components.token.ts` and
  `canvas-rail-board.component.ts`.
- Risk R7, an accepted intermediate state: until Batch 3, `AppStateManager` still reads a
  persisted `ptah-layout-mode`. A stored `'single'` no longer has a visible effect on the canvas
  (the directive and template ignore it). `ChatViewComponent` can still read it in Batch 2's
  files.

## Clarifications Needed

None.
