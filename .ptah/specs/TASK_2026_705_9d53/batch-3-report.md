# Batch 3 report — TASK_2026_705_9d53

Worktree: `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout` (branch `refactor/remove-single-layout`).
No checks run (orchestrator runs the scoped check). No git operations.

## Task 3.1: Delete LayoutMode and the layout API from AppStateManager — done

Removed from `app-state.service.ts`: `export type LayoutMode`, `_layoutMode` and its doc block,
public `layoutMode`, the `ptah-layout-mode` localStorage read in `initializeState`, `setLayoutMode`,
`toggleLayoutMode`. `normalizeView` is now `view === 'orchestra-canvas' ? 'chat' : view` (no grid
write). `normalizeInitialView` signature unchanged. Doc comments fixed at: the
`THOTH_FIRST_RUN_DISMISSED_KEY` doc (old 109-111), `SessionOpenRequest` (old 242-248),
`normalizeInitialView` (old 806-808), plus the `_configurationSurfaces` doc that referenced
`_layoutMode`, the `_thothFirstRunDismissed` doc ("same pattern as `ptah-layout-mode`"), the
`CanvasTabRequest` doc and `requestCanvasTab` doc ("single layout"), and the
`newCanvasSessionRequest` doc ("in grid mode").

Spec `app-state.service.spec.ts`: dropped `type LayoutMode` import, `layoutMode` from
`AppStoreState`, the `savedLayoutMode` option of `setupGlobals`, `layoutMode: 'grid'` from the
defaults case; deleted the restore-from-localStorage case, the "overrides a saved single" case, the
`describe('layout mode')` block and the "leaves layoutMode global" workspace case; file header
updated. ADDED regression case (initializeState block): `localStorage['ptah-layout-mode'] =
'single'` -> `currentView()` is `'chat'` and `'layoutMode' in service` is `false`.

`webview-routing.spec.ts`: the legacy case keeps only `post('orchestra-canvas')` ->
`currentView()` is `'chat'`; `setLayoutMode`/`layoutMode` lines removed, title updated.

`lazy-view-components.token.ts` (29-38) and `app.config.ts` (288-296): dropped the
"ElectronShellComponent calls setLayoutMode('grid') / forces grid mode" rationale and the
"single-chat view toggled with `[class.hidden]`" sentence; kept the eager rationale and the
retained-not-routed rationale (`AppShellComponent` retains the canvas with `*ptahRetainWhile`,
verified present in `app-shell.component.html/.ts` and `core/src/lib/routing/retained-view.directive.ts`).

## Task 3.2: harness-builder always requests a tile — done

`harness-builder-view.component.ts`: removed the `layoutMode() === 'grid'` guard; the
`requestCanvasTab(tabId, pinnedWorkspaceRoot(), title)` body runs unconditionally on each new
`root:tabId` init key. Spec: removed the `layoutMode` signal (96), the stub field (155), the
`beforeEach` reset (235), and the `layoutMode.set('grid')` in the case near 326, which is renamed
"always queues the pinned tab for canvas adoption" and still asserts the call. There was no
`'single'`-specific case to delete. No other spec asserted `canvasRequest` not called.

## Files changed (line ranges in the new file)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\libs\frontend\core\src\lib\services\app-state.service.ts` — 104-108, 216-219, 243-244, 389-394, 433, 483, 629-635, 655 (deletion), 755 (deletion), 780-781, 1178 (deletion), 1298
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\libs\frontend\core\src\lib\services\app-state.service.spec.ts` — 1-11 (header), 64, 80, 99-108, 149-154, 198-208 (regression case), 227-230, 647 (deletion), 972 (deletion)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\libs\frontend\core\src\lib\tokens\lazy-view-components.token.ts` — 30-39
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\apps\ptah-extension-webview\src\app\webview-routing.spec.ts` — 339-346
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\apps\ptah-extension-webview\src\app\app.config.ts` — 288-290
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\libs\frontend\harness-builder\src\lib\components\harness-builder-view.component.ts` — 436-440
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\libs\frontend\harness-builder\src\lib\components\harness-builder-view.component.spec.ts` — 95, 154, 233, 324-325

`git diff --stat` also lists `.gitignore` (+1 line); that change was already in the working tree
and was not touched by this batch.

## Risks and validation

- R3 (core deletion not typechecked in chat/canvas): grep
  `LayoutMode|layoutMode|setLayoutMode|toggleLayoutMode|ptah-layout-mode` over `WT/libs` and
  `WT/apps` returns only `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:58` and
  `app-state.service.spec.ts` lines 9, 198, 202, 207 (the regression case and its header note).
  Zero production hits — matches F7 (implementation-plan.md:380-387).
- R7 (stale `'single'` skipping the harness-builder tile): closed. The read and the guard are both
  gone in this batch; a stored `'single'` is ignored and the regression case pins it.
- F7 stored `'single'` lands on the grid: nothing reads the key, the chat surface is the canvas,
  and the regression spec asserts `currentView() === 'chat'`.
- Diagnostics: `ptah_get_diagnostics` (errors) on the five changed TS sources/specs other than
  comments-only files: "No diagnostics in the requested files". Sibling errors reported in
  `auth-state.service.spec.ts`, `electron-layout.service.spec.ts`, `zone-change-detection.spec.ts`,
  etc. are in files this batch did not touch.

## Decisions

- Kept the `normalizeInitialView('orchestra-canvas') -> 'chat'` unit case in
  `app-state.service.spec.ts` (minus its layout line) although batches.md lists 206-242 for
  deletion. Options: delete / keep. Evidence: it is the only core-level unit coverage of
  `normalizeView` after the change; the plan's intent is to drop layout assertions, and the
  equivalent webview-routing assertion is explicitly kept. Reversible: yes (delete 4 lines).
- Fixed four extra stale layout comments in `app-state.service.ts` beyond the three line ranges
  listed (same file, comment-only). Reversible: yes.

## Plan deviations

None beyond the Decisions above.

## Out-of-scope observations

None.
