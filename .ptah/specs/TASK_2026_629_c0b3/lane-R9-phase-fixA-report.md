# R9 phase fix A — Rail split selection

| Finding | Fix | File:line | Spec case (file:line) | Result |
| --- | --- | --- | --- | --- |
| F1: card selection writes store focus before the board swaps panes, making both panes B | `activatePane` takes the outgoing tab from board-owned `lastFocusedId`; `focus` also uses that id for replacement announcements after a prior store write | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:506`, `:648` | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:769` — real card click, Enter, Space on select | Pass: A remains in the other pane, B becomes active, store focus is B, and two lane hosts remain |

## Tests

Command: `node .ptah/tmp/check-run.mjs phaseA-1 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`

`Test Suites: 1 passed, 1 total`
`Tests:       70 passed, 70 total`

`ptah_get_diagnostics` on the two changed files: no diagnostics in requested files. Seven existing sibling diagnostics were reported outside this scope (`orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, `capability-id-codec.ts`).

## Decisions

- Chose board-owned outgoing pane id because the same early store write occurs on lane actions through `CanvasDetailService.open` and on focus-area actions. Changing only card `openSession` would leave those routes vulnerable. The board now reads `lastFocusedId`, which its pane transitions and reconciliation effect update synchronously; no card or Rail production file changed.
- Checked all `openSession` and `focusRequested` callers in `libs/frontend/canvas/src/lib/canvas-rail`: expanded select, collapsed select, and card host click reach the card method; the Rail forwards `focusRequested` to the board; Rail keyboard navigation also emits focus. The card continues its store write, so any non-board card host keeps single-focus selection. The board retains its existing hidden-surface and active-surface repair gates, split host limit, and display dock behavior.
- The board harness replaces the Rail with `RailStub` and focus area with `FocusStub`. The regression therefore mounts the real `CanvasRailCardComponent` separately, with only its heavy compact child replaced by a select-button stub, and wires its real `focusRequested` output to the real board handler. This executes the real card `openSession()` path for click, Enter, and Space but does not assert the complete production Rail DOM chain.
- Source conventions checked: Angular 22 in `package.json`; standalone OnPush components, signal inputs/outputs, and existing Tailwind/DaisyUI classes in the canvas Rail components. The board uses only the existing CanvasStore boundary, and this fix renders no new content.

## Clarifications Needed

None.

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts`
