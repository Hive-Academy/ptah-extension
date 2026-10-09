# Sidebar resizer, alignment, and type size

## Divider binding

The grip between the workspace sidebar and the sessions sidebar is still `ptah-electron-resize-handle` in `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (lines 270–281). It was not replaced.

Before: `(dragMoved)="layout.setWorkspaceSidebarWidth($event)"` with `(dragStarted)` / `(dragEnded)` calling `layout.setSidebarDragging`. `direction="left"` emits viewport X, and the workspace pane starts at the window's left edge, so that X was the workspace sidebar width (`ElectronLayoutService.setWorkspaceSidebarWidth`, clamp 160–400, persisted with the electron layout state).

Now: `(mousedown)="onSessionsDividerMouseDown($event)"`, `(dragMoved)="onSessionsDividerDrag($event)"`, `(dragEnded)="onSessionsDividerDragEnd()"` (handlers at lines 371–399). The drag records the sessions width at pointer-down and adds the pointer delta (`sessionSidebarWidthFromDividerDrag` in `session-sidebar-width.ts` lines 48–64). Dragging right widens the sessions sidebar. `setWorkspaceSidebarWidth` is not called, so the workspace sidebar keeps `workspaceSidebarWidth`.

The sessions width goes through `AppShellComponent.beginExternalSidebarResize` / `applyExternalSidebarResize` / `commitExternalSidebarResize` (`app-shell.component.ts` lines 555–576). That is the same path as the sessions pane's own right-edge handle: `nextChosenSessionSidebarWidth` (min 200, cap from `sessionSidebarWidthCap`, max 480), `transition-none` while the pointer is down, and `localStorage` key `ptah.sessionSidebarWidth` on release. Escape on the electron handle re-emits the pointer-down X, so the delta is 0 and the start width is what gets stored. The in-pane handle (keyboard, double-click reset to 272) is unchanged.

The grip stays in document flow after the Workspaces tab, so it does not slide with the pointer. The workspace width is what used to move it. The sessions pane's right edge is what moves now.

## Alignment

Session rows in `app-shell.component.html`:

- Header block (search, Filters, both selects, Date range) and the list use the same left inset, `pl-5` (header line 103, list line 202).
- The row button is `relative block w-full py-1.5 pl-0` (line 232). `border-l-2` is gone, so the accent is not in the border box.
- Active and open-tab accents are an inset box-shadow in `apps/ptah-extension-webview/src/styles.css` (light theme lines 2118–2125, default lines 2133–2142).
- The live-phase dot is `absolute -left-5 top-1/2 -translate-y-1/2` on the indicator (line 250), in the list padding, out of flow. Title, time, and organization chips (`pl-0` on the chips wrapper) share the button's left edge. Nested child rows still use `ml-3` / `ml-6` / `ml-9` on the whole row, so a child title and its chips still share one edge.
- Group labels dropped `px-3` so they sit on that same edge. They stay `text-[10px]` uppercase.

## Type size

- Session title: `text-[13px] font-medium leading-tight` (line 262). Row padding `py-2.5` → `py-1.5`.
- Time line: `text-[11px]` (line 275), `data-testid="session-row-meta"`.
- Organization chips: `text-[10px] h-4` (`session-organization-chips.component.ts` line 36).
- Header controls: search already `text-xs`; Filters, both selects (`session-filter-bar.component.ts` lines 163, 280, 294), Date range, Clear, and From/To are `text-xs`. Focus rings on the filter bar are unchanged.
- Workspace rows: `text-[13px] font-medium`, `py-1.5`, icon `w-3.5` (`workspace-sidebar.component.ts` lines 59, 67, 71). "Workspaces" stays `text-[10px]` uppercase. "Add Folder" stays `text-xs`.

## Specs updated

- `session-sidebar-width.spec.ts` — divider delta is added to the sessions width, not used as an absolute X.
- `electron-shell.activity-placement.spec.ts` — divider drag calls `applyExternalSidebarResize(312)` from a 272 start and a +40 pointer move, and does not call `setWorkspaceSidebarWidth`.
- `app-shell.organization.spec.ts` — metadata assertions use `[data-testid="session-row-meta"]` instead of `span.text-xs`.
- `session-live-phase-indicator.component.spec.ts` — comment only; idle still expects the `invisible` host.

## Not done

- No Jest, Nx, lint, typecheck, or browser pass. Another lane owns test runs, and this session was edit-only.
- `ptah_agent_report` is not in the MCP tool list here (`search_tool` returned no match), so it was not called.
- The workspace sidebar no longer has a drag handle. Its width stays on the persisted electron layout value.
- The between-sidebars grip does not follow the pointer; the sessions pane's right edge does.
