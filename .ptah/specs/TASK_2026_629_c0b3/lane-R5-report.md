# Batch R5 report

## Files changed

- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-keyboard.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-keyboard.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.spec.ts

No other files were edited by this lane. The worktree already contained unrelated changes in two .claude/commands files and batches-rail.md; this lane did not touch them.

## Check results

The four changed specs were run one at a time with --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache.

| Command | Exact Jest summary |
| --- | --- |
| npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache | Test Suites: 1 passed, 1 total; Tests: 6 passed, 6 total |
| npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache | Test Suites: 1 passed, 1 total; Tests: 4 passed, 4 total |
| npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache | Test Suites: 1 passed, 1 total; Tests: 4 passed, 4 total |
| npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache | Test Suites: 1 passed, 1 total; Tests: 4 passed, 4 total |
| npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache | Test Suites: 30 passed, 30 total; Tests: 365 passed, 365 total |

The first rail spec run failed on a self-closing li; the corrected spec passed. The full project test passed again after final edits. The first typecheck found an Event/KeyboardEvent mismatch, then npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache passed after correction. Lint first found selector/output naming errors; npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache passed after correction. Scoped diagnostics found no errors in new component files.

## A2 result

Passed. canvas-rail-card.component.spec.ts resolves SESSION_CARD_ACTIONS from the child stub and asserts it is the CanvasRailCardComponent instance. Clicking the child lane button calls detail.open('a', 'orchestrator'). The forwardRef self-provider works; the actions-adapter fallback was not needed.

## State ink usage

Every state colour in the new component styles uses one of these fallback forms:

- var(--state-ink-run, oklch(var(--in)))
- var(--state-ink-need, oklch(var(--wa)))
- var(--state-ink-err, oklch(var(--er)))
- var(--state-ink-done, oklch(var(--su)))
- var(--state-ink-idle, oklch(var(--bc)))

## Edge cases handled

- The wrapper forwards staleAction and announces changed requests. Enter on the native card host focuses the session. The existing smart card rejects replaced question IDs; its committed spec covers that guard. The wrapper spec checks forwarding and announcement with a child stub.
- The wrapper forwards +N as lanesRequested(tabId), and the smart card's forced-card action focuses the tile. The wrapper spec checks forwarding and heights 176/96 px. The committed chat-ui rail-card spec covers dense totals 0, 1, 4: zero has no +N button; one and four show the matching button.
- The running cap uses RUNNING_CAP_MESSAGE. The tile bound says "The board holds 20 sessions. Close one to add another." Both keep a focusable aria-disabled button and refuse clicks.
- Overflow-menu Escape is consumed, closes its own menu, and returns focus to its trigger. If focused Stop disappears, focus moves to Compact.
- Rail Up/Down/Home/End move and activate from card buttons. Window-level Left/Right wraps. Escape returns focus to the selected card without changing selection. Inputs, menus, dialogs, tablists, and prevented events are ignored.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep a native li host with a narrow selector lint exception. | Native li host; custom element inside li. | Plan Component 10 requires the li host; the rail uses role=list, and the repository's selector rule rejects attribute selectors. | Yes, if list semantics remain intact. |
| Name the header output closeRequested. | close; closeRequested. | Project lint rejects close through @angular-eslint/no-output-native. | Yes, if the lint rule changes. |
| Reuse the committed smart card's request-id guard and dense lane view. | Reuse R1/R2; duplicate their logic in canvas. | The smart card validates shown IDs; the chat-ui spec covers dense 0/1/4. | Yes. |

## Anything not done

- No browser screenshot or served render: the batch prohibits serve/dev/e2e. Jest checks rendered markup and focus behavior.
- The wrapper spec does not independently repeat the full smart-card replaced-question flow; the committed smart-card spec covers it. The wrapper spec checks its stale event forwarding and announcement.
- R6 owns mounting these R5 components into the board and focus area. Nothing was exported from canvas/src/index.ts.
