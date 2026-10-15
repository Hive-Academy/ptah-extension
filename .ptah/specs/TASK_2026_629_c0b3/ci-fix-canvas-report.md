# Canvas CI and review fixes, round 2

| Item | Fix file:line | Test spec:line | Result |
| --- | --- | --- | --- |
| A: horizontal scroll guard | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.ts:75-78` | `canvas-rail/canvas-rail-keyboard.spec.ts:80` | Pass: 18/18 |
| B: reselect CLI lane | Existing behavior in `canvas-detail/canvas-lane-view.component.ts:294-300` | `canvas-detail/canvas-lane-view.component.spec.ts:168` | Pass: 18/18 |
| B: unmatched background lane | Existing fallback in `canvas-detail/canvas-lane-tabs.component.ts:164-173` | `canvas-detail/canvas-lane-tabs.component.spec.ts:135` | Pass: 9/9 |
| B: tile bound and normal request | Existing logic in `orchestra-canvas.component.ts:391-400` | `orchestra-canvas.rail.spec.ts:399,409` | Pass: 17/17 |
| C: project setup on empty board | `canvas-rail/canvas-rail-board.component.ts:16,62,140` | `canvas-rail/canvas-rail-board.component.spec.ts:703` | Pass: 78/78 |
| D: one focused-session label | `canvas-rail/canvas-focus-area.component.ts:30,72`; `canvas-rail/canvas-rail-board.component.ts:151-156` | `canvas-rail/canvas-focus-area.component.spec.ts:276`; `canvas-rail/canvas-rail-board.component.spec.ts:1291-1293` | Pass: 10/10 and 78/78 |
| E: display-only narrow Rail collapse | `canvas-rail/canvas-rail-board.component.ts:40,291-295` | `canvas-rail/canvas-rail-board.component.spec.ts:714` | Pass: 78/78 |

## Decisions

- The keyboard guard checks horizontal overflow only. A vertical transcript scroller leaves ArrowLeft/ArrowRight available to board navigation.
- The board uses the already measured `CanvasLayoutService.containerWidth` signal. Width 0 remains uncollapsed until measured; widths below 640 collapse the Rail visually without changing persisted `railCollapsed`.
- The empty-board card is imported from the chat barrel. The board spec uses a small card stub so it tests placement without requiring the card's service graph.
- The full canvas suite has one failure in untouched `canvas-detail-transcript.component.spec.ts:28`: its `ptah-display-panel` stub lacks the `summaryTurnKey` input used by `DisplayDockComponent`. This is outside the assigned files and unrelated to the canvas edits. No change was made there.
- Scoped compiler diagnostics reported no errors in the edited product files. They also reported errors in sibling test/core/shared files; the mandatory canvas library typecheck passed.

## Checks

Every command below ran through `node .ptah/tmp/check-run.mjs <label> -- <command>`, serially.

| Label | Exact command after `--` | Summary |
| --- | --- | --- |
| canvas-r2-canvas-rail-canvas-rail-keyboard-spec-ts | `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 18 tests passed |
| canvas-r2-canvas-detail-canvas-lane-view-component-spec-ts | `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 18 tests passed |
| canvas-r2-canvas-detail-canvas-lane-tabs-component-spec-ts | `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 9 tests passed |
| canvas-r2-canvas-rail-canvas-focus-area-component-spec-ts | `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 10 tests passed |
| canvas-r2-canvas-rail-canvas-rail-board-component-spec-ts | `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 78 tests passed |
| canvas-r2-orchestra-canvas-rail-spec-ts | `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 17 tests passed |
| canvas-r2-board-final | `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 78 tests passed after test-stub cleanup |
| canvas-r2-full | `npx nx test canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 failed, 22 passed suites; 1 failed, 359 passed tests. Failure: unknown `summaryTurnKey` binding in unrelated transcript spec |
| canvas-r2-typecheck | `npx nx typecheck canvas --parallel=1 --skip-nx-cache` | Successfully ran target typecheck |
| canvas-r2-lint | `npx nx lint canvas --parallel=1 --skip-nx-cache` | Successfully ran target lint; 0 errors, 31 warnings |

