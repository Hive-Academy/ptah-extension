# Lane R9v fix round: report

Scope: decisions row 102. This round fixes the codex-review-R9v Serious finding, Moderate 1 and Moderate 2. The Minor finding (hidden collapsed scrollbar) is not touched; row 102 leaves it for the user's manual test.
The uncommitted R9v change was the starting point and none of it was reverted. HIDE_AGENT_SIDEBAR and the display dock (row 77) were not touched.

## Finding -> fix -> spec

| Finding | Fix | file:line | Spec case | Result |
| --- | --- | --- | --- | --- |
| Serious: a rejected first position leaves the panel invisible behind its backdrop | `positionPanel` catches the rejection and returns `'failed'`. `openPopover` then shows the panel unpositioned (`visibility: visible`, at its static position under the trigger), focuses it, emits `opened`, and logs a dev-mode `console.error`. Escape and the backdrop still close it, and the close path restores focus to the trigger. | `ui/.../native-popover.component.ts:202-231` (fallback at :219-228), `:237-265` | `shows the panel unpositioned, focuses it and emits opened when positioning rejects; Escape still closes and restores focus` (`native-popover.component.spec.ts:280`) | PASS |
| Serious: a first position that never resolves (unbounded wait) | The first position races a `POPOVER_POSITION_TIMEOUT_MS` (1000 ms) timer. If the timer wins, the panel gets the same fallback. A position that arrives later is still applied by the service. The timer is cleared in `finally`. | `native-popover.component.ts:49-55`, `:237-265` | `shows the panel unpositioned once positioning overruns its bound` (`spec:310`, Jest fake timers) | PASS |
| Moderate 1: an open that finishes after close can focus the hidden panel and emit `opened` | Every open, close and destroy bumps `openGeneration`. An open that is still awaiting when the generation changes does not focus and does not emit `opened`. If the popover is closed by then, it also releases the late auto-update through `floatingUI.cleanup()`. `openPopover` also returns early when the popover was closed before the queued open ran. | `native-popover.component.ts:181-186`, `:204-218`, `:271`, `:301` | `does not focus or emit opened when closed before positioning resolves` (`spec:334`; also asserts that the late `autoUpdate` stop function is called) | PASS |
| Moderate 1, card side | The `(opened)` handler is now `onMenuOpened()`. It calls `focusMenuItem(0)` only while `menuOpen()` is true. | `canvas/.../canvas-rail-card.component.ts:158`, `:337-340` | `ignores a late opened after the menu closed (no focus pulled into the menu)` (`canvas-rail-card.component.spec.ts:488`): the menu is closed in the card with its items still in the DOM, then the popover emits `opened`, and focus stays on the trigger | PASS |
| Moderate 2: the N6(b) fit case tested a stub with a fixed `+2 more` | The N6(b) case swaps CardStub for `RealRailCardHost`. This stands in only for the smart chat wrapper: it has the same host classes and rail bindings and renders the REAL `CompactRailCardComponent` from `@ptah-extension/chat-ui` with 5 lanes (3 rows + 2 more). The case runs in both expanded densities and checks that the real overflow control renders with its density text: `+2 more` (`.rc-lane-overflow`) in comfortable and `+5` (`.rc-action`, no `rc-lane-overflow`) in dense. It also checks that the control is inside the card, closes its lane line (last child of `.rc-line`) and is tabbable. The gutter must be the card's next flex sibling (`w-7 shrink-0`), with no `absolute`, `fixed` or `sticky` class, it must hold the trigger, and the card must not contain the trigger. The previous arithmetic assertion was tautological, so it is now a comment. The comment says jsdom cannot measure pixels and that the 272 px fit stays with the Electron visual re-check (row 102). The other cases keep CardStub. | `canvas-rail-card.component.spec.ts:102-176` (fixtures and host), `:582-649` | `keeps 176/96/56 px heights with the action gutter and +N more still fitting (N6b)` | PASS |

## Spec commands (from W, through the lock, one at a time)

1. `node .ptah/tmp/check-run.mjs r9v-fix-1 -- npx nx test @ptah-extension/ui --testFile=native-popover.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
   `Tests: 1 failed, 18 passed, 19 total`. The failing case was the existing `should emit opened event after async positioning completes`. Its `flushAll` drained a fixed 3 microtask turns, and the bounded race adds a few promise hops. Fix: `flushAll` now drains 8 more turns (`spec:76-82`). The assertions did not change.
2. `node .ptah/tmp/check-run.mjs r9v-fix-2 -- npx nx test @ptah-extension/ui --testFile=native-popover.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
   `Test Suites: 1 passed, 1 total` / `Tests: 19 passed, 19 total` (16 existing + 3 new)
3. `node .ptah/tmp/check-run.mjs r9v-fix-3 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
   `Test Suites: 1 passed, 1 total` / `Tests: 19 passed, 19 total` (18 R9v cases + 1 new)

`canvas-rail.component.spec.ts` and `canvas-rail-keyboard.spec.ts` were not changed in this round, so they were not re-run. Per the brief, no typecheck, lint or full suite was run. Mode 2 still owns TC(ui) and LINT(ui) (row 102). Full logs are in `%TEMP%\629-check-r9v-fix-{1,2,3}.log`.

## Decisions

- **Fallback position, not close.** When positioning rejects or overruns, the popover shows the panel unpositioned. It does not close and emit `closed`. Every one of the 25 template files that use `<ptah-native-popover>` binds `(closed)`, so either option would reset the consumers. The fallback was chosen because it does not depend on any consumer's `closed` handler. It also keeps the user's action available instead of making the menu silently vanish. The panel stays dismissable in the normal way (Escape and backdrop emit `closed`, and the close path restores trigger focus). It also emits `opened` like a normal open, so consumers that focus an item on `opened` (the Rail card) still work. The unpositioned panel is `position: fixed` (set by the service before `computePosition`) at its static position, which is directly under the trigger. It has no flip or shift, so near a viewport edge it can be partly clipped. Keyboard focus, Escape and the backdrop still work there.
- **Bounded wait added.** `computePosition` on the DOM platform does no I/O and in practice cannot hang. The bound was still simple: one `setTimeout` per open, cleared in `finally`, raced with `Promise.race`, which also handles a late rejection from the losing promise. A Jest fake-timer case covers it, so it was added. 1000 ms is far above a normal one-frame position. A position that arrives late still corrects the panel through the service's `applyPosition`.
- **Logging.** The ui lib has no logger service. Its only existing diagnostic is the dev-mode `console.error` in `native-modal.component.ts:150-155`, and this fix follows that pattern (`isDevMode()` guard), so production builds stay silent. The specs spy on `console.error` and assert on it.
- **No visible failure announcement.** With the fallback, the menu opens and can be used, so there is no user-facing failure to announce.
- **N6(b) host double.** The smart `CompactSessionCardComponent` (chat) injects 8 store and services, so the case does not mount it. Its rail template is a straight pass-through to `ptah-compact-rail-card`. The case therefore mounts the real presentational card behind a thin host that has the wrapper's host classes, with the binding names verified against `compact-session-card.component.ts:85-116`.

## Changed files (this round)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\ui\src\lib\native\popover\native-popover.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\ui\src\lib\native\popover\native-popover.component.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.spec.ts`

`canvas-rail.component.ts`/`.spec.ts` and `canvas-rail-keyboard.ts`/`.spec.ts` were not changed in this round (they keep the R9v diff).

## Out-of-scope observations

- `floating-ui.service.ts:143-150` (not editable here): suppose a popover closes and reopens while the first `computePosition` is still pending. When the stale position resolves, it installs `autoUpdate` on the detached old panel and overwrites `cleanupFn`. That auto-update runs until the next `position()` or destroy. The popover releases the late auto-update when it is closed at settle time. It cannot release it in the close-then-reopen case without changing the service.
- Minor (collapsed scrollbar affordance) is unchanged, per row 102.
