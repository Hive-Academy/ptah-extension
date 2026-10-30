# Batch 11 report: Display right sidebar, auto-open consumer, detach wiring

## Files

- MODIFIED `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts`
  - The sheet is now a right sidebar. When `dock.open` is false it shows a
    `ptah-sidebar-tab` labelled "Display · N" (with `newCount`, `aria-expanded=false`), and only when
    the tab has content (the `visible()` rule is unchanged). When open it shows a header
    ("Display · N", Pin, optional Detach, Collapse) above the region.
  - Collapse carries `aria-expanded=true` and `aria-controls` for the region. Escape in the region
    (dialogs and inner handlers excluded, as before) or Collapse closes the dock and moves focus to
    the sidebar tab button (`afterNextRender`).
  - New inputs: `detachable` (default false), `overlay` (host class `sheet-overlay`, an absolute
    right drawer; region class `.overlay`; glass role `overlay`) and `detachError`. New output:
    `detachRequested`.
  - The height modes (`peek`/`full`, Expand/Reduce, ArrowUp/Down on the bar) are removed. The
    panel's own full screen (`dock.fullscreenArtifact`) is unchanged.
  - Artifacts come from `ArtifactStore.panelArtifacts(tabId, selectedArtifactId)` (the A fix:
    a selected artifact from another bucket is listed). The private key helpers are replaced by
    `selectionKey`/`selectionForKey` from `display-window-wire.ts`.
- DELETED `.../display-sheet/display-sheet.state.ts`
- MODIFIED `.../display-sheet/display-sheet.component.spec.ts`: rewritten for the sidebar (tab,
  header, Escape focus return, Detach plus error, overlay, cross-bucket artifact, axe). 22 tests.
- CREATED `libs/frontend/chat/src/lib/components/templates/display-sidebar-wiring.ts`:
  `connectDisplaySidebar({ dock, tabId, main, resize })`. It is kept out of the 1900-line ChatView.
  - Auto-open: one effect over `ArtifactStore.autoOpenRequest()`, tracking `seq`. A request made
    before the view existed is not replayed. In the main view the target is any tab that
    `findTabByIdAcrossWorkspaces(record.sessionId)` finds. In any other view (a tile or a host-dock
    embed) the target is only its own tab. Unknown tabs get no open. The call is
    `dock.requestArtifactAutoOpen(tabId, record.id)`.
  - Main view only: it seeds `PanelResizeService` from `ElectronLayoutService.displaySidebarWidth()`
    (`null` resets to the default, which `dockWidth` clamps with `clampDockWidth`). It does not
    re-seed during a drag. It returns `commitWidth`, which calls `setDisplaySidebarWidth`, and binds
    `DisplayWindowSync.bindSource({ tabId, dock })`, unbinding on destroy.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
  - Removed `DisplaySheetState` (import, provider, inject, `forgetTab`).
  - Calls `connectDisplaySidebar` in the constructor when a dock exists, with
    `main = displaySheetEnabled && !SESSION_CONTEXT`.
  - Adds the `displayDetachable`, `displayDetached`, `displayWindowError` and `displayWindowCount`
    computeds and the `detachDisplay`, `focusDisplayWindow` and `attachDisplayWindow` handlers.
  - Commits the width only on a key step (`onDockSeparatorKeydown`), on reset (`onResizeReset`,
    `null`) and on drag end (`_endResize`, only when a drag was active and not cancelled). Drag
    frames never commit.
- MODIFIED `.../templates/chat-view.component.html`
  - The sheet left `ptah-chat-session-layout` and now sits in the `cs-shell` row on the right,
    hidden while the compact card shows.
  - While attached: a `role="separator"` (tabindex 0, `aria-valuenow/min/max`, pointer, keyboard
    and double-click reset), shown only when open and not overlay. Then
    `<ptah-display-sheet [style.width.px]="panelOpen() ? dockWidth() : null" [overlay]="isOverlay()">`.
  - While detached: a narrow rail with "Display · N (separate window)", Focus and Re-attach
    buttons, and the sync error as `role="alert"`.
- MODIFIED `.../templates/chat-session-layout.component.ts`: removed the `[sessionSheet]` slot.
- MODIFIED `.../templates/chat-session-layout.component.spec.ts`: removed the full-height sheet
  case, which tested the deleted mode.
- MODIFIED `.../templates/chat-view.component.spec.ts`
  - Stubs for `ElectronLayoutService` and `DisplayWindowSync` in the harness.
  - New describe "Display sidebar (Electron)" with 10 tests:
    - bind and unbind in the main view; none from a tile or in VS Code
    - main-view auto-open, once per `seq`; unknown tab gets nothing; no replay
    - tile auto-open for its own tab only
    - width seed from the stored value; key and reset commits; drag commits once on release,
      never per frame, never on Escape cancel
    - detached rail with Focus, Re-attach and error
    - separator ARIA
- MODIFIED `.../templates/chat-view.dock.spec.ts`, `.../templates/chat-view.keepalive.spec.ts`
  - ArtifactStore stubs gain `autoOpenRequest` and `panelArtifacts`. Layout and sync stubs are
    added.
  - The toggle selector moves from the bar to the sidebar tab and Collapse.
  - The two bar tests are rewritten for the sidebar: it renders outside the session layout, shows
    a separator when wide, and Escape returns focus to the tab.
- MODIFIED `.../molecules/agent-card/cli-agent-output.component.spec.ts`,
  `.../organisms/transcript/single-chat-subagent-view.component.spec.ts`: dropped the
  `DisplaySheetState` provider. `lane-transcript.component.spec.ts`: comment only.
- MODIFIED `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`:
  `PANE_OVERLAYS` now uses `ptah-display-sheet [role="region"].overlay` (was `.full`). No canvas
  spec pinned the old selector.

## Verification

- `npm run verify -- -p @ptah-extension/chat,@ptah-extension/canvas,@ptah-extension/command-center`
  (lint, test, typecheck; 9 tasks): "Successfully ran targets lint, test, typecheck for 3
  projects", exit 0.
  - chat: `Test Suites: 305 passed, 305 total`, `Tests: 2 skipped, 5393 passed, 5395 total`.
  - canvas: 50 suites, 563 tests passed.
  - command-center: 26 suites, 508 tests passed.
  - Lint: 0 errors in all three projects; only warnings. The touched files have the existing
    `max-lines` warning on `chat-view.component.ts` and `canvas-rail-board.component.ts`, and
    non-null-assertion warnings in specs, the same pattern as the existing tests.
- The first full run failed 21 tests in `chat-view.dock.spec.ts` and `chat-view.keepalive.spec.ts`.
  Their `ArtifactStore` stubs had no `autoOpenRequest`, and they used the removed bar. Both are
  fixed above. A re-run of the `chat-view` specs passed 6 suites and 144 tests, and the final full
  run is green.
- Not run (out of batch scope): `ptah-electron`, `ptah-extension-webview`, `ptah-extension-vscode`
  and `ptah-tui`. No file in those apps changed. The final affected gate covers them.

## Decisions

- **Wiring lives in `display-sidebar-wiring.ts`, not in ChatView.** ChatView was already over the
  lint `max-lines` limit, and the architecture rule says not to grow large components. Reversible.
- **Width persistence and Detach are main-view only.** Canvas tiles keep a local
  `PanelResizeService` width and never write the single persisted `displaySidebarWidth`. One
  stored value cannot serve N tiles of different widths. Reversible.
- **Seeding keeps the raw stored width** (`setCustomWidth(stored, Infinity)` applies only the
  300 px floor). `dockWidth` clamps it against the measured host on every read, so a narrow first
  measurement does not shrink the stored preference.
- **Host-dock embeds (command center) apply auto-open to their own tab** through the host dock,
  per plan B ("consumer in ChatView, dock present; tile: own tab only"). Their rail Display tab
  is otherwise unchanged.
- **The sheet emits `detachRequested`; ChatView owns `DisplayWindowSync`.** This keeps the sheet
  free of the root sync service, so tiles never construct or bind it.

## Deviations

- Plan D1 lists "header (Display · N, Pin, Detach, Collapse)". The header has no "n new" badge
  while open, because opening resets `newCount`. The collapsed sidebar tab shows "n new" through
  `SidebarTabComponent.newCount`.
- The collapsed tab's accessible name comes from `SidebarTabComponent`: "Toggle Display · N panel"
  (plus ", n new").
- Batch 11 touched more than 8 files. Deleting `display-sheet.state.ts` forced spec updates in
  five other chat specs. They are spec-only edits.

## Open gaps / for the final gate

- `apps/ptah-electron/src/config/eager-closure-gate.spec.ts:131` still lists the deleted
  `display-sheet.state.ts` as an allowed eager input. This is harmless (an allowlist entry), but it
  is stale. It is outside this batch's files, so it was left for the final gate.
- The cancel path of a drag that started from the default width (`_startWidth === null`) keeps
  the pre-existing behaviour: it applies the last frame instead of reverting. It does not
  persist, because cancel never commits. It was not changed, because the existing resize specs'
  stub has no `resetWidth`.
- The detached-window theme follow-up from batch 10 (deferred themes in the child) is still open.
- No Electron visual review has been run yet. Overlay drawer width, separator focus ring and rail
  layout need the planned visual review.
