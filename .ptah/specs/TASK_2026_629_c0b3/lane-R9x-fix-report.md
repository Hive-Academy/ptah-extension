# Lane R9x fix report (writer: Claude, the only fix round)

Started from the uncommitted R9x tree. Nothing reverted. Source: `codex-review-R9x.md` findings 1-3 and decisions row 107.

| Finding | Fix | File:line | Spec case (file:line) | Result |
| --- | --- | --- | --- | --- |
| 1 Serious: Escape on the still-focused menu trigger leaves the menu open | Moved the Escape handler from the `role="menu"` div to the `<header>`, so it covers the trigger, menu items and other header controls. The new `escape()` method acts only while `menuOpen()` is true. It calls preventDefault and stopPropagation once, so no pane or board handler sees the event, then closes the menu and focuses the trigger. With the menu closed, Escape passes through. The old menu-only `closeMenu()` was folded into it (no other callers). | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:19-20` (header binding), `:94-106` (`escape`) | New `canvas-focus-header.component.spec.ts:96` "R9x-fix: Escape from the still-focused trigger closes a keyboard-opened menu once and closes no pane". It focuses and activates the trigger, sends Escape from the trigger, and expects: `defaultPrevented`, host listener not called, menu gone, `aria-expanded=false`, focus on trigger, no output emitted. A second Escape is not consumed and nothing is emitted. The existing item-focused case at `:84-95` and the menu-dispatch case at `:32-42` are unchanged and pass. | pass |
| 2 Moderate: stacked e2e self-skips on a wide viewport | Before `ui.goto`, the test sets the Electron window to 1280 x 900 through `electronApp.evaluate` + `BrowserWindow.setBounds`. This follows the precedent in `specs/chat/tile-load-older-history.spec.ts:409-416` and `specs/git/visual-review.spec.ts:85-90` (`setMinimumSize`). It then asserts `toHaveClass(/\bflex-col\b/)` on the pane container before the swap and Tab assertions. `test.skip` was removed. The `electronApp` fixture is test-scoped (`support/fixtures.ts:57-64`), so other tests are not affected. | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:186-203` | Same case, `canvas.spec.ts:186` "stacked split after a swap tabs from the Rail into the visual top pane first" | Not run: e2e is forbidden in this round. Edited by reading only. |
| 3 Moderate: swap preservation shown only through an empty stub | Added stateful children used only in this case: `StatefulLaneStub` (`ptah-canvas-lane-view`) holding `StatefulChatViewStub` (`ptah-chat-view`). The ChatView stub has a draft signal bound to a real `<textarea>` and a `dockOpen` signal mirrored to `[data-dock][data-open]`. Mount and destroy counters cover both. They are injected with `TestBed.overrideComponent(FocusStub, { set: { imports: [StatefulLaneStub] } })`. The shared `LaneStub` is unchanged, so the other Tab-order cases are not affected. No board source change was needed. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:96-122` (stubs), `:1380-1427` (case) | New `canvas-rail-board.component.spec.ts:1380` "R9x-fix: swap keeps each pane lane, ChatView, typed draft and dock state (stateful child)". It types a draft per pane through DOM input events and opens the dock in the right pane, then calls `swapPanes()`. After the swap: `visualOrder` is `['right','left']`; zero lane or ChatView mounts or destroys; the same lane instance, ChatView instance, host node and textarea node per pane; the drafts `draft left` and `draft right` are kept in both DOM value and signal; dock is `[false,true]` in signal and DOM; there are 2 `ptah-chat-view`. The per-tab F5 draft test in `chat-input.component.spec.ts` is untouched. | pass |

## Tests

- `node .ptah/tmp/check-run.mjs r9x-fix-1 -- npx nx test @ptah-extension/canvas --testFile=canvas-focus-header.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       13 passed, 13 total` (12 before, plus 1 new)
- `node .ptah/tmp/check-run.mjs r9x-fix-2 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       67 passed, 67 total`
- Not run, per the round's rules: e2e, full canvas suite, typecheck, lint.

## Decisions

- Finding 1: Escape is handled on the header element rather than on the trigger alone. One handler then covers the trigger, menu items and other header controls whenever the menu is open, which matches the contract that Escape closes an open menu first. With the menu closed the handler returns without consuming the event, so header behaviour without a menu is unchanged. Escape still never maps to a close-pane or close-split output.
- Finding 1 spec: jsdom does not turn Enter on a button into a click. "Open by keyboard" is therefore modelled as focusing the trigger and activating it with `click()`, which is the browser's Enter/Space activation. Focus stays on the trigger, as in production.
- Finding 2: the window is resized from the main process (`BrowserWindow.setBounds`), not with `page.setViewportSize`, to follow the repository's Electron e2e precedent. 1280 px stays below the 1440 px `splitStacked` threshold (`canvas-rail-board.component.ts:242`) even before sidebars are subtracted.
- Finding 3: a stateful stand-in was used instead of the real `CanvasLaneViewComponent`, because the real ChatView needs the full chat DI graph, which this harness stubs. The stand-in is scoped to the one case so the existing stubbed Tab-order cases keep their exact focusable set.
- Binding rules kept: display dock untouched (no `HIDE_AGENT_SIDEBAR`), and split rules (decisions 80, 82, 83, 85 and 86) untouched. No capability was removed, and all R9w and R9x specs in both touched suites pass.

## Clarifications Needed

None.

## Changed files

- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\apps\ptah-electron-e2e\src\specs\canvas\canvas.spec.ts
