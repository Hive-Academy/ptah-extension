# Batch R4a report

## Files changed

- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail.service.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-tabs.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-tabs.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-needs-you-queue.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-needs-you-queue.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts

## Check results

All commands ran from the worktree root, one heavy command at a time, with cache skipped.

| Command | Observed result |
| --- | --- |
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Test Suites: 1 passed, 1 total; Tests: 8 passed, 8 total |
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Test Suites: 1 passed, 1 total; Tests: 5 passed, 5 total |
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Test Suites: 1 passed, 1 total; Tests: 9 passed, 9 total |
| `npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Test Suites: 1 passed, 1 total; Tests: 34 passed, 34 total |
| `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Test Suites: 26 passed, 26 total; Tests: 344 passed, 344 total |
| `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | Passed: Nx successfully ran target typecheck |
| `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | Passed: 0 errors, 14 warnings |

Scoped `ptah_get_diagnostics` showed no errors in edited files; it reported 10 errors in untouched sibling or dependency files. `git diff --check` passed.

## K1 and K2 handling

- K1: In the detail-service spec fixture, added `CanvasStore.boardFor` and `activeWorkspacePath` with Grid state, plus `TabManagerService.onTabClosed`. Added fixture reset of the mutable mode and mock call history for new cases. These are the dependencies of mode-aware `open` and tab-close pruning. The three existing `it` bodies were untouched.
- K2: In the orchestra spec's `canvasStoreMock` fixture, added `boardFor` and `activeBoard` returning Grid. No existing `it` body changed. `CanvasDetailService` subscribes to `onTabClosed` only on the first lane-map write, so the orchestra subscription remains call 0; its full spec passed.
- No other existing `it` bodies or fixtures were changed.

## Edge cases handled

- Grid's `laneKey` derives from `laneKeyFor(detailTabId() ?? '')`; closing detail keeps each tab's lane. Unknown tabs and malformed lane keys are ignored. A real tab close prunes its entry; reset keeps it. Re-selecting an existing key retains map identity.
- Rail `open` focuses the tile and selects its lane without setting a Grid detail tab.
- The tab strip observes its own width with one `ResizeObserver`, reveals the selected tab with `scrollIntoView({ block: 'nearest', inline: 'nearest' })` after rendering, updates both fade edges, and disconnects on destruction. It works when `ResizeObserver` is unavailable, as in jsdom.
- Queue Escape closes the queue, prevents the document key's default action, and returns focus to its trigger after rendering while detail stays open.
- No state-ink colour was introduced.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Subscribe to tab-close events on the first map write | Constructor subscription; lazy subscription | K2 orchestra listener-order spec and plan Component 3 | Yes |
| Use the strip element's mask for the two 32 px fades | Mask; overlay elements | Component 4 requires cut-side fades and unchanged keyboard model; current strip already scrolls | Yes |
| Keep selection reveal scheduled with Angular `afterNextRender` | Immediate scroll; after-render scroll | Component 4 and queue Component 6 require after-render focus/reveal | Yes |

## Anything not done

None for Batch R4a. Other pre-existing worktree changes outside the listed R4a files were left untouched.
