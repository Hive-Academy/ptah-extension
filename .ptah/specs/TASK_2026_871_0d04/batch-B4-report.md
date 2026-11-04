# Batch B4 report — Board and parity controls (TASK_2026_871_0d04)

Executor: frontend-developer (Claude subagent). Worktree: `.claude-worktrees/tasks-ui-revamp`. No git commands were run. All paths below are under `libs/frontend/tasks-ui/src/lib/components/` unless stated otherwise.

## Files changed

| Status | File | Change |
| --- | --- | --- |
| CREATED | `task-board-header.component.ts` | Header: `h1` Tasks with counts, board/list switch (`aria-pressed`), Commands, a Manage `<details>` menu (Reindex, Generate registry, Tidy finished…, Excluded folders (n)), and New Task (`btn-primary btn-sm h-9`). Presentational: inputs and outputs only. Escape closes Manage and puts focus back on its summary. |
| CREATED | `task-board-header.component.spec.ts` | 8 tests: heading and counts, `aria-pressed`, tokens, no-workspace gating, every action output, in-flight disabling, Escape/focus. |
| CREATED | `task-board-states.component.ts` | Loading (`role=status`, `aria-busy`), no-workspace (only "Check again"), empty (first-task CTA), filtered-empty (only "Clear the filter"). Uses `text-base-content-muted`; glyphs have `aria-hidden`. |
| CREATED | `task-board-states.component.spec.ts` | 7 tests covering every state, its single recovery action, and that no text uses an alpha modifier. |
| CREATED | `task-create-dialog.component.ts` | New Task modal: title, type, status, description; inline "A task needs a title." with `aria-invalid`; Tab trap; Escape cancels unless a create is running; focus goes to the title on open and back to the opener on close. Emits a `TaskCreateDraft`; the parent does the write. |
| CREATED | `task-create-dialog.component.spec.ts` | 8 tests: lane status preset, autofocus, validation, trimmed draft, Escape/Cancel, in-flight lock, Tab wrap, tokens. |
| CREATED | `task-maintenance-dialog.component.ts` | `TaskSweepDialogComponent` (preview/report, committed-only confirm count, Escape, Tab trap, focus restore) and `TaskMaintenanceDialogComponent` (the sweep dialog plus the excluded-folders drawer, listed by name with the typed reason). |
| CREATED | `task-maintenance-dialog.component.spec.ts` | 8 tests: no plan, candidate rows and committed count, empty preview, confirm/close/Escape, sweeping lock, report and skipped list, excluded rows, unnamed host. |
| CREATED | `bulk/task-bulk-bar.component.spec.ts` | 6 tests: region tokens, select-all-matching shown only when it adds tasks, status and label outputs, hidden count, polite progress with Cancel, alertdialog containment. |
| MODIFIED | `tasks-view.component.ts` | 1,423 → about 670 lines. Now composes header, banners (`role=status` / `role=alert` with Retry), one toolbar holding saved views and filters, a status rail (`From disk · .ptah/specs/ · N excluded folder(s) — see why · Refreshing…/Updated just now`), states, board or list, the unchanged `ptah-task-detail` binding, a bulk region docked at the bottom, the palette, and the create and maintenance dialogs. Root keeps `bg-base-100`. |
| MODIFIED | `tasks-view.component.spec.ts` | Error-banner selector changed to `[data-testid="tasks-error"]`. Header text now expects "Generate registry", "Tidy finished" and "Commands". New `board shell composition` block (6 tests): create flow with validation and status, board/list switch, six lanes with only an empty Cancelled lane collapsed, status rail, excluded folders from Manage, reindex from Manage. |
| MODIFIED | `board/task-board.component.ts` | Lane container `flex gap-3 overflow-auto p-4`, now a labelled group. |
| MODIFIED | `board/task-column.component.ts` | Lanes are `bg-surface-1 border-surface-border rounded-box p-3`, `w-[242px] min-[1100px]:w-[220px]`. Each lane shows a status-ink dot (`TASK_STATUS_INK`) and an `h2` label with a mono count. An empty, unfiltered Cancelled lane becomes a `w-[58px]` vertical rail that still shows its name and count 0. |
| MODIFIED | `board/task-column.component.spec.ts` | +4 lane layout tests (widths, rail, rail expands, other statuses never collapse). |
| MODIFIED | `board/task-card.component.ts` | Card is a non-interactive `<article>`: `bg-surface-2 border-surface-border rounded-box p-3 shadow-[var(--elev-shadow)] hover:bg-surface-3`. The title is a `<button data-task-id>`: it is the roving focus root, handles Enter/Space/click, and its `::after` overlay stretches over the card. The checkbox, status menu, rollup, crumb, PR link, isolate toggle and Start are siblings raised above the overlay. The mono `folderName/` sits under the title. The selected card uses `ring-2 ring-primary outline outline-2 outline-offset-2 outline-base-content`; a checked card uses `bg-surface-3`. The status trigger is now 32px. Menus use the surface tokens. The footer uses `text-base-content-muted`, so `text-opacity-50` is gone. |
| MODIFIED | `board/task-card.component.spec.ts` | `[role="button"]` → `[data-task-id]`, `.card-body` → `[data-testid="task-card-body"]`, focus token is now `outline-base-content`. +5 tests: siblings and no nesting, folder ID, rest tokens, selected ring and outline, checked surface. |
| MODIFIED | `board/task-board.component.spec.ts` | Added a `cardSurface()` helper. The roving-descendant and tab-stop assertions now scope to the card surface, because the focus root is the title button. |
| MODIFIED | `board/task-list.component.ts` | Restyled only: `surface-1` sticky group header with `border-surface-border`, rows `bg-surface-1 px-4 py-3 hover:bg-surface-3`, open/checked row `bg-surface-3` plus the primary left accent, `divide-surface-border`, raised surface-2 menus, base-content focus. |
| MODIFIED | `filter/task-filter-bar.component.ts` | No border of its own; it sits in the toolbar. Search is `input input-bordered input-sm h-8`, sort is `select select-bordered select-sm h-8`, facets/Clear/direction are `btn btn-ghost btn-sm`, chips are `h-8` with a 32px remove, menus are surface-2 raised. Fixed a pre-existing bug: facet summary and chip remove had `focus-visible outline …` with spaces, so an outline drew all the time. |
| MODIFIED | `filter/task-filter-bar.component.spec.ts` | Chip-remove target pin changed from 24px to 32px (`h-8`/`w-8`). |
| MODIFIED | `filter/task-view-menu.component.ts` | Trigger is `btn-sm` with a surface border. Panel is `bg-surface-2 border-surface-border rounded-box shadow-raised`. Row controls are 32px, the active row is `bg-surface-3`, and inputs/buttons are `-sm`. |
| MODIFIED | `filter/task-view-menu.component.spec.ts` | Row-control target pin changed from 24px to 32px. |
| MODIFIED | `bulk/task-bulk-bar.component.ts` | Region is `bg-surface-2 border-surface-border rounded-box p-3 shadow-raised`. Controls are `btn-sm` / `select-sm` / `input-sm`; confirm is `btn btn-primary btn-sm h-9`. |
| MODIFIED | `bulk/task-bulk-summary.component.ts` | Summary is a surface-2 card; Retry and dismiss are `btn-sm`. |
| MODIFIED | `bulk/task-bulk-summary.component.spec.ts` | The commit-button test now asserts `btn-primary btn-sm` (see Deviations). |
| MODIFIED | `palette/task-command-palette.component.ts` | Dialog is `bg-surface-2 border-surface-border rounded-box shadow-raised`, the active and hover row is `bg-surface-3`, and the footer hint is muted. |

Not touched: `tasks-store.service.ts` (B3), the `components/detail/*` files (B5; `ptah-task-detail` inputs and outputs are bound exactly as before), the shared/backend files, and `palette-entries.spec.ts` (it needed no change).

## Parity rows covered (B4: 1–9, 12, 18, 21–23)

| Row | Capability | Where now | Spec that proves it |
| --- | --- | --- | --- |
| 1 | Board/list switch, remembered mode | `task-board-header` switch → `TaskViewModeService.setMode` (service unchanged) | header spec "aria-pressed…"; tasks-view "switches between board and list" |
| 2 | Six status columns, counts, cards, grouped list | `task-column`, `task-card`, `task-list` | tasks-view "renders all six statuses…"; column spec counts and lane layout; list spec (unchanged, passing) |
| 3 | Keyboard navigation, focus, Escape | `task-board` host keydown (unchanged); roving root is the card title button | board spec roving/tab-stop/arrow/Escape tests (all passing) |
| 4 | Selection, range, select-all matching | card checkbox (sibling), Ctrl/Shift-click on the title; bulk bar | card spec ctrl/shift click; bulk-bar spec "select-all-matching"; tasks-view bulk tests |
| 5 | Search, facets, label mode, chips, sort | `task-filter-bar` | filter-bar spec (all passing) |
| 6 | Saved views lifecycle and skipped notice | `task-view-menu` in the toolbar | view-menu spec; tasks-view saved-view tests |
| 7 | Palette, Ctrl/Cmd+K, actions | header Commands; host keydown; `onPaletteRun` | palette spec; tasks-view palette tests (incl. bulk through confirmation, no-workspace gating) |
| 8 | New task: title, type, status, description | `task-create-dialog` | create-dialog spec; tasks-view "creates a task in the status…" |
| 9 | Single status change and refresh | card/list status menus → `store.updateStatus` | card and list spec status-menu tests |
| 12 | Bulk status/label, confirm, progress, cancel, summary, retry | `task-bulk-bar` (docked), `task-bulk-summary` | bulk-bar spec; bulk-summary spec; tasks-view bulk tests |
| 18 | Start via chat prefill, agent target, isolation | card footer, unchanged logic → `TaskStartService` | card spec Start/agent tests; `task-start` guard spec |
| 21 | Reindex and registry | Manage menu | header spec "emits each maintenance action"; tasks-view "reindexes from the Manage menu" |
| 22 | Finished sweep preview/confirm | Manage → `ptah-task-sweep-dialog` | maintenance-dialog spec; tasks-view retention-sweep tests |
| 23 | Excluded, validation, no-workspace, empty, filtered-empty | status-rail trigger and Manage item → drawer; `task-board-states` | states spec; maintenance spec; tasks-view exclusions, no-workspace and filtered-empty tests |

## Verification

- `npm run verify -- -t typecheck,lint -p @ptah-extension/tasks-ui` → `NX 2 tasks: 2 succeeded`, exit code 0. Lint reports 0 errors. The 4 warnings were there before this batch: `max-lines` on card and list, and `no-useless-assignment` in board and list.
- `npm run verify -- -t test -p @ptah-extension/tasks-ui -- --testPathPatterns="components/(tasks-view|task-board|task-create|task-maintenance|board|filter|bulk|palette)"` → `Test Suites: 16 passed, 16 total` / `Tests: 416 passed, 416 total`, exit code 0. The pattern adds `task-create|task-maintenance` to the one given in the brief, so the two new dialog specs are included.
- Parity guards: `npm run verify -- -t test -p @ptah-extension/tasks-ui -- --testPathPatterns="services/(task-start|task-prompt-context|task-views)"` → `Test Suites: 3 passed`, `Tests: 56 passed`.
- Prettier was then run on the owned files (formatting only). Tests were not re-run after it; lint passed afterwards.
- Not run, as instructed: the full `@ptah-extension/tasks-ui` suite, `ptah-extension-webview`, and build/e2e. No Electron screenshots were taken (jsdom cannot prove widths, contrast or focus clipping).

## Deviations

1. **Bulk confirm uses `btn-primary`.** The previous code deliberately avoided it (4.144:1 on anubis). The approved design spec names `btn btn-primary btn-sm` for confirm and measured primary-content on primary at 4.82 (dark) and 6.81 (light). I followed the design and rewrote the pinning test. Reversible.
2. **Card footer does not show "stage · N files".** `TaskSpecSummary` has no artifacts or stage, and the board payload belongs to B1/B3. The footer keeps the existing status/Start line. Adding it needs a summary field.
3. **Root keeps `bg-base-100`, not `bg-surface-0`.** They are the same colour (`--surface-0: oklch(var(--b1))`), and the glass theme in `apps/ptah-extension-webview/src/styles.css` clears `ptah-tasks-view > .bg-base-100`, which `glass-scrim.spec.ts` pins.
4. **Layout label stays "Kanban" / "List".** It comes from `TASK_VIEW_MODE_LABELS` in `services/task-view-mode.service.ts`, which this batch does not own; the prototype says "Board".
5. **Saved views and the filter bar share one toolbar row.** This follows the prototype; the old view had two rows.
6. **Raised controls to the 32px design target.** Facet summaries, chip remove, saved-view row controls and the card status trigger were 20–24px; the matching spec pins moved from `h-6` to `h-8`.
7. **Two classes in one file.** `task-maintenance-dialog.component.ts` holds both the sweep dialog and the maintenance host, so no file outside B4's ownership was needed.

## Open issues

1. **`apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts` will fail (not B4-owned).** Its `DECORATIVE_EXCEPTIONS` and `ARIA_HIDDEN_PREMISE` expect exactly two `text-base-content/20` glyphs with `aria-hidden` in `tasks-view.component.ts`. Those glyphs moved to `task-board-states.component.ts` and now use `text-base-content-muted`, so there are zero alpha classes anywhere. The two `tasks-view.component.ts` entries (lines ~78 and ~154) need removing by whoever owns that file. Not run here: `ptah-extension-webview` was outside the requested checks.
2. **The list row is still a focusable `role=listitem` that contains controls.** It was restyled only; the sibling-control rule was applied to the board card. Restructuring the list (and its 764-line spec) is follow-up work.
3. **The palette has no group headings.** Rows keep the existing kind hints and active-row treatment. Grouped headings depend on `palette-entries.ts`, which is not in the B4 rows.
4. **Electron screenshots at 1280 and 760, dark and light, are still needed.** They must confirm that six lanes fit at 1280, the 242px scroll below 1100, the wrapping toolbar at 760, the title overlay behaviour, and that focus outlines are not clipped.
5. **Status-rail freshness is approximate.** It shows "Refreshing…" while `store.loading()` or `store.busy()` is true, otherwise "Updated just now". There is no last-refresh timestamp, because the store has no public field for one.
