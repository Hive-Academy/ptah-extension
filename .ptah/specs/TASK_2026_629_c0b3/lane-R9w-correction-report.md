# R9w bounded correction report

| Finding | Fix | File:line | Spec case (file:line) | Result |
| --- | --- | --- | --- | --- |
| NEW-1 | Preserve the prior-order neighbour while hidden; on visible single-pane recovery, focus that neighbour or the first ordered tile in the store. | `canvas-rail-board.component.ts:314-330` | `canvas-rail-board.component.spec.ts:325`, `:336` | Pass: one focus area; no hidden focus write; one focus write on return. |
| NEW-2 | Use the same store-focus repair to align the pane, Rail, and Details with the chosen tile. | `canvas-rail-board.component.ts:327-331` | `canvas-rail-board.component.spec.ts:355` | Pass: all three show `c` after focused `b` is removed externally. |
| NEW-4 | Clear the reorder marker on the next microtask when the write has not failed; report later or uncertain failures with the neutral layout message. | `canvas-rail-board.component.ts:358-364`, `:562-566` | `canvas-rail-board.component.spec.ts:910`, `:917` | Pass: later failure says “Layout changes could not be saved.”; immediate reorder failure remains covered by `:874`. |

## Verification

Command: `node .ptah/tmp/check-run.mjs r9w-corr-2 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`

Test Suites: 1 passed, 1 total
Tests:       51 passed, 51 total

Scoped `ptah_get_diagnostics` after edits: no diagnostics in either edited file. Seven diagnostics remain in sibling files outside this correction's scope.

## Decisions

- Kept the hidden board free of focus writes and announcements; retained its last focused id so the prior-order neighbour can be recovered on return.
- Kept the specific reorder failure message for a failure observed before the marker clears. Later failures use a neutral message because the failing write cannot be identified from the board's signal.
- Left NEW-3, NEW-5, NEW-6, NEW-7 and all other files untouched as requested.

## Clarifications Needed

None.

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\specs\TASK_2026_629_c0b3\lane-R9w-correction-report.md`
