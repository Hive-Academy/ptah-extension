# Design elevation — Batch 1 (app shell + sidebars)

Canvas is `surface-0`. The Electron title bar, the app-shell navbar, and both sidebars are `surface-1`, each with one shared edge (`border-surface-border`). Active session and workspace rows use the existing inset accent on a `surface-3` fill. Hover is `surface-2`. Session-row geometry is unchanged: list gutter `pl-4`, row `px-2.5`, header `pl-[26px] pr-2`, text edge 26px, fonts `text-[13px]` / `text-[11px]` / chip `text-[10px]`.

Structural panels use `bg-surface-*` only. They do not also carry `bg-base-*` or the full `.surface-1` box (that class paints a four-sided border and would double the shared edge).

## Before → after

| Element                                      | File:line                                     | Before                                                                                                  | After                                                                                                                       |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Electron page root                           | `electron-shell.component.ts:103`             | `bg-base-100`                                                                                           | `bg-surface-0`                                                                                                              |
| Electron title bar                           | `electron-shell.component.ts:108`             | `bg-base-200 border-b border-base-content/10`                                                           | `bg-surface-1 border-b border-surface-border`                                                                               |
| Global-actions cluster                       | `electron-shell.component.ts:226-232`         | `flex items-center gap-0.5 no-drag`; back button in flow only when shown                                | `min-w-[13rem] shrink-0 justify-end` plus an always-present `h-8 w-8` back slot                                             |
| Git dock edge                                | `electron-shell.component.ts:319`             | `border-l border-base-content/10`                                                                       | `border-l border-surface-border`                                                                                            |
| Shell row (canvas behind the sessions panel) | `app-shell.component.html:72`                 | `flex h-full` (no surface)                                                                              | `flex h-full bg-surface-0`                                                                                                  |
| Sessions sidebar                             | `app-shell.component.html:80`                 | `bg-base-200`, no border                                                                                | `bg-surface-1`, still no border (the sessions tab is the one edge)                                                          |
| Sessions brand rule                          | `app-shell.component.html:88`                 | `border-b border-base-content/10`                                                                       | `border-b border-surface-border`                                                                                            |
| Sessions header block                        | `app-shell.component.html:105`                | `pl-[26px] pr-2 pt-1.5 pb-0.5 gap-1`                                                                    | `pl-[26px] pr-2 pt-3 pb-3 gap-2` (left/right edge unchanged; 12px vertical, 8px stack)                                      |
| Local session search                         | `app-shell.component.html:116`                | `input input-xs … bg-base-100 border-base-content/10`                                                   | `input input-sm rounded-lg h-8 min-h-8 … bg-surface-0 border-surface-border`                                                |
| Date-range toggle                            | `app-shell.component.html:148`                | `btn btn-ghost btn-xs`                                                                                  | `btn btn-ghost btn-sm h-8 min-h-8`                                                                                          |
| Date inputs                                  | `app-shell.component.html:183`, `:195`        | `input input-xs … bg-base-100 border-base-content/10`                                                   | `input input-sm rounded-lg h-8 min-h-8 … bg-surface-0 border-surface-border text-xs`                                        |
| Session list                                 | `app-shell.component.html:204`                | `pl-4 pr-2 py-1`                                                                                        | `pl-4 pr-2 py-3`                                                                                                            |
| Rename field                                 | `app-shell.component.html:221`                | `input input-xs … text-[13px] bg-base-100`                                                              | `input input-xs … rounded-md text-[13px] bg-surface-0` (stays xs so the row does not grow)                                  |
| Session row                                  | `app-shell.component.html:234`                | `py-1.5 px-2.5 rounded-md hover:bg-base-300/50`                                                         | same padding and radius, `hover:bg-surface-2`                                                                               |
| Active / open-tab hooks                      | `app-shell.component.html:236-238`            | `sidebar-item-active` / `sidebar-item-open-tab`                                                         | unchanged hooks                                                                                                             |
| Load more                                    | `app-shell.component.html:472`                | `hover:bg-base-300/30`                                                                                  | `hover:bg-surface-2`                                                                                                        |
| App-shell title bar                          | `app-shell.component.html:538`                | `navbar bg-base-100 border-b border-base-300`                                                           | `navbar bg-surface-1 border-b border-surface-border`                                                                        |
| Anubis-light navbar override                 | `styles.css:2083`                             | `background-color: oklch(var(--b1))` (flattened the title bar to the canvas)                            | `background-color: var(--surface-1)`; `border-bottom-color: var(--surface-border)`                                          |
| Active row, light                            | `styles.css:2177`                             | `background-color: oklch(var(--b2))`; inset `oklch(var(--n))`; radius `0.375rem`                        | `background-color: var(--surface-3)` with `oklch(var(--b3))` fallback; same inset accent and radius                         |
| Active row, default                          | `styles.css:2198`                             | `background-color: oklch(var(--b3) / 0.7)`; inset `oklch(var(--p))`                                     | `background-color: var(--surface-3)` with `oklch(var(--b3))` fallback; same inset accent and radius                         |
| Open-tab rows                                | `styles.css:2187`, `:2210`                    | lighter inset accent only (`--n / 0.3` light, `--p / 0.3` default), radius `0.375rem`                   | unchanged (no surface-3 fill)                                                                                               |
| Workspace panel                              | `workspace-sidebar.component.ts:43`           | `bg-base-200 border-r border-base-content/10`                                                           | `bg-surface-1 border-r border-surface-border`                                                                               |
| Workspace header / list / footer             | `:47`, `:56`, `:112`                          | header `px-3 pt-2.5 pb-1`; list `px-2`; footer `p-2 border-t border-base-content/10`                    | all three `px-3`; header `pt-3 pb-2`; list and footer `py-3`; footer `border-t border-surface-border`                       |
| Workspace row                                | `workspace-sidebar.component.ts:63-64`        | `rounded-md px-2 py-1.5 hover:bg-base-300` and `[class.bg-base-300]` when selected; `text-primary` kept | `hover:bg-surface-2`; selected adds `sidebar-item-active` (surface-3 + inset accent); `text-primary` and `text-[13px]` kept |
| Filter search                                | `session-filter-bar.component.ts:112`         | `input input-xs … bg-base-100 border-base-content/10`                                                   | `input input-sm rounded-lg h-8 min-h-8 … bg-surface-0 border-surface-border`                                                |
| Filters button                               | `session-filter-bar.component.ts:151`         | `btn btn-ghost btn-xs h-6 min-h-6`                                                                      | `btn btn-ghost btn-sm h-8 min-h-8`                                                                                          |
| Sort and group selects                       | `session-filter-bar.component.ts:280`, `:294` | `select select-xs h-6 min-h-6 … bg-base-100 border-base-content/10 text-xs`                             | `select select-sm rounded-lg h-8 min-h-8 … bg-surface-0 border-surface-border text-xs`                                      |
| Filter task-id field                         | `session-filter-bar.component.ts:225`         | `input input-xs … bg-base-100`                                                                          | `input input-sm rounded-lg h-8 min-h-8 … bg-surface-0 border-surface-border`                                                |

Header controls are 32px (`h-8` / `input-sm` / `select-sm` / `btn-sm`). Field radius is `rounded-lg`. Compact rows stay `rounded-md`.

## CLS fix

The measured cluster is `div.flex…no-drag` at `electron-shell.component.ts:226` (`data-testid="titlebar-global-actions"`).

- `min-w-[13rem]` (208px) and `shrink-0` hold the cluster at least as wide as the workspace-open set: the 32px back slot, three `btn-sm` squares, the theme button, and the `btn-xs` bell, plus `gap-0.5`. `justify-end` keeps the buttons on the window edge. Slack inside that minimum is about 14px, so a small in-flow badge does not grow the cluster.
- The back button always has a `h-8 w-8 shrink-0` slot (`data-testid="titlebar-back-slot"`). Showing it fills the slot instead of inserting a new flex item.
- The notification count stays `absolute`, so it does not change the cluster width.
- No `--ptah-activity-toast-inset` variable. The activity ticker stays out of this row.

While workspace folders are open the tab strip is visible and the back slot is empty, so the cluster is 32px wider than the buttons alone. That width is constant. The back button and the extra Setup hub icon only appear when there are no folders, which is also when the tab strip is not rendered; if that wider set exceeds 13rem the cluster may grow, and the tabs are not on screen.

## Specs

- `electron-shell.activity-placement.spec.ts` — still asserts no ticker and no toast-width variable. New case: root `bg-surface-0`, title bar `bg-surface-1` / `border-surface-border`, cluster `min-w-[13rem] shrink-0 justify-end`, empty `w-8` back slot while folders (and tabs) are showing.
- `app-shell.organization.spec.ts` — existing `pr-16`, meta, and chip assertions kept. New case: aside `bg-surface-1` with no side border, header `pl-[26px] pr-2`, list `pl-4 pr-2`, row `px-2.5 rounded-md hover:bg-surface-2`, title `text-[13px]`, local search `input-sm h-8 rounded-lg bg-surface-0`.
- `electron-shell.config-gate.spec.ts` and `session-filter-bar.component.spec.ts` were not edited. The back button is still inside the same `.no-drag` cluster, and the filter spec does not assert the old size classes. Both were run.
- `session-sidebar-width.spec.ts` was not edited and was run.

## Results

`npx jest -c libs/frontend/chat/jest.config.ts` on the five specs above, `--coverage=false --maxWorkers=2`: **5 suites, 57 tests, all passed** (about 29s). The filter-bar destroy test still logs `NG0953` (emit after destroy). The suite passed.

`npx nx typecheck @ptah-extension/chat --parallel=1`: **passed** (about 22s). Nx Cloud reported its free-plan 401; the typecheck itself succeeded.

PowerShell has no `grep` or `tail`. The Jest summary was filtered with `Select-String`, and the typecheck log was limited with `Select-Object -Last 15`.

No browser or Electron pass. This batch forbids build, serve, and e2e, so the Anubis / dark / light screenshot check from the audit was not done.

## Not done

- Quick win #4 (`chat-view.component.html` canvas `bg-base-200/30`) is batch 2. Not touched.
- Floating panels inside the app shell stay on the old fill for batch 6: the Thoth hint (`app-shell.component.html:577`) and the new-session popover (`:712`, including its `bg-base-100` name field). The filter popover chrome was not restyled; only its task-id control became a 32px field.
- `session-organization-chips` was reviewed and left as-is. Chip tints are status color, not elevation, and the `text-[10px]` size is part of the 26px row contract.
- `ptah-surface-tile` was not used. Its selected state is `surface-2` plus padding, which would move the session text edge. Active rows use `.sidebar-item-active` → `surface-3` instead.
- `electron-welcome` still paints `bg-base-100` on the welcome route. The shell behind it is `surface-0`.
- Anubis-light still forces `.input` / `.select` to `oklch(var(--b1))`, which is the same value as `--surface-0`. Other themes follow `bg-surface-0`.
- No commit, push, stash, or workspace-wide check.
