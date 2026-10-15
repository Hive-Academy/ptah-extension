# R7 frontend lane report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-board-toggle.component.ts` — created the accessible Board segmented control.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-board-toggle.component.spec.ts` — created toggle coverage.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\orchestra-canvas.rail.spec.ts` — created mode, workspace, dock, detail, persistence, cap, and draft integration coverage.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts` — mounted Rail or Grid per path, routed keys, gated Grid detail and controls, and showed persistence notes.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts` — fixture edits only.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\specs\TASK_2026_629_c0b3\lane-R7-report.md` — this report.

## Check results

Commands used `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` for tests. Each changed spec ran separately before the canvas project run.

| Command | Observed result |
|---|---|
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-board-toggle.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | `Test Suites: 1 passed, 1 total`; `Tests: 1 passed, 1 total` |
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | `Test Suites: 1 passed, 1 total`; `Tests: 10 passed, 10 total` |
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | `Test Suites: 1 passed, 1 total`; `Tests: 34 passed, 34 total` |
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/orchestra-canvas.detail.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | `Test Suites: 1 passed, 1 total`; `Tests: 3 passed, 3 total` |
| `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | `Test Suites: 35 passed, 35 total`; `Tests: 398 passed, 398 total` |
| `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | Passed |
| `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | Passed, 0 errors and 20 existing warnings |
| `npx nx test @ptah-extension/chat --testFile=libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | `Test Suites: 1 passed, 1 total`; `Tests: 75 passed, 75 total` |

Scoped `ptah_get_diagnostics` found no diagnostics in the five changed source/spec files. It reported 16 errors in unchanged sibling files; the project typecheck target passed.

## K3 fixture edits

- The store fixture already had `boardFor` and `activeBoard` returning Grid from R4a; retained these so its existing tests continue on Grid.
- Both persistence `load` stubs now return a complete Grid board and `readOnlyReason: null`, so real-store hydration selects Grid and conforms to the v3 load result.
- Both persistence stubs now expose `writeFailed: signal(false)` and `readOnlyPaths: signal(new Set<string>())`, which the dock reads.
- The full-template fixture imports the new toggle and Rail board so Angular can compile the actual template. No existing `it` body or assertion changed.

## K4 result

`orchestra-canvas.detail.spec.ts` is unedited and passes. A non-null `detailTabId()` takes the existing Grid keyboard path without reading new fixture members. Otherwise the handler uses an optional `viewChildren` signal to find the visible Rail board and returns when absent. The Rail keyboard helper ignores already consumed queue events.

## A4 result

The Rail spec types a draft, switches to Grid, observes the Rail input removed, switches back, observes a new input instance and the restored text. The child fixture saves on destroy to isolate the `@if/@else` lifecycle guarantee. The real chat-input destroy-save backstop passed, 75/75 tests; its file was not edited.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Keep the dock visible for an empty Rail board and put its New Session action in the Rail footer | Hide the dock at zero tiles; show it in Rail | Without the dock, the user could not switch an empty Rail board to Grid. The new empty-mode test passes. | Yes |
| Select the visible Rail board from `viewChildren` | Use a single `viewChild` | Retained workspaces can mount multiple Rail boards. A single child can be hidden after a workspace switch. | Yes |
| Keep the integration fixture's heavy child views stubbed, while mounting the real `CanvasRailComponent` footer | Mount all smart children; stub the heavy views | The orchestra template is exercised without Gridstack or chat host services. The real Rail footer exposes the running-cap reason; existing Rail board and chat tests cover their own behavior. | Yes |

## Anything not done

The Rail integration spec uses a child stub to check that hidden workspaces have no live draft input; it does not count real transcript nodes. The existing Rail board spec verifies hidden content separately. No production files outside the R7 list were changed, and `canvas/src/index.ts` was not changed.
