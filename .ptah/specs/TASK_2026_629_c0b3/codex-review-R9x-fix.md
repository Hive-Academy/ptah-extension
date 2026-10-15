**Score: 8/10. Verdict: APPROVE.**
Review family: codex; implementer family: Claude

## Original findings

| # | Status | Would the check catch a reverted fix? | Evidence and impact |
| --- | --- | --- | --- |
| 1 | FIXED | Yes. The trigger-focused assertion fails if Escape is handled only on the menu. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:19-20,99-105` handles bubbling Escape on the header only while the menu is open, prevents its default and stops propagation once, closes the menu, then focuses the trigger. `canvas-focus-header.component.spec.ts:96-118` opens from a focused trigger, verifies consumption, no close outputs and focus return, then sends Escape with the menu closed and verifies no close outputs and normal propagation. The earlier menu-descendant case remains at `:84-95`. The board's keydown listener is Tab-only (`canvas-rail-board.component.ts:70,775-779`), so neither Escape path closes a pane or split. |
| 2 | FIXED | Yes on a wide host: without the resize, the new stacked-class assertion fails instead of skipping. | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:186-202` sets the Electron window to 1280 px, contains no `test.skip`, asserts `flex-col`, then checks Rail-to-visual-top Tab. The board uses a 1440 px threshold and applies `flex-col` at `canvas-rail-board.component.ts:139,242`. The fixture owns an Electron app per test (`apps/ptah-electron-e2e/src/support/fixtures.ts:57-64`). E2E execution remains unverified because this round forbids it. |
| 3 | FIXED | Yes. Remounting either child or resetting either state breaks the new identity, lifecycle or value assertions. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:94-116,1380-1427` installs a stateful lane and ChatView stand-in for this case, enters drafts through textarea input, opens one dock, swaps, then checks both component and DOM identity, mount/destroy counters, drafts and dock state. The board changes only `visualOrder` at `canvas-rail-board.component.ts:585-591`; stable pane keys are at `:140-143`. This establishes preservation at the board boundary with a stateful child, as requested. It does not independently exercise real ChatView internals. |

## New findings

None in the changed keyboard handler and tests. The Escape handler's stopPropagation at `canvas-focus-header.component.ts:101-104` prevents the event reaching the pane and board when the menu is open; the closed-menu return at `:100` lets it bubble without emitting a close action. The E2E selectors `rail-pane-container`, `data-pane-side` and `flex-col` exist in the board template (`canvas-rail-board.component.ts:139-143`); `.rc-select` exists in the nested compact card template (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:185`). No bounded correction is needed.

## Five logic questions and verification

1. **Silent failure:** A self-skipped stacked check previously looked successful. The new class assertion at `canvas.spec.ts:196` turns a failure to enter stacked mode into a visible test failure.
2. **User action:** Escape immediately after keyboard activation of More session actions now closes the menu and returns focus to the trigger (`canvas-focus-header.component.ts:99-105`; `canvas-focus-header.component.spec.ts:96-111`).
3. **Wrong-answer input:** A wide Electron host no longer changes this test's outcome because the case sets 1280 px before navigation (`canvas.spec.ts:186-196`).
4. **Dependency failure or wrong shape:** If Electron window resizing fails or the expected board class is absent, the class assertion fails; there is no skip or success-looking fallback (`canvas.spec.ts:188-196`). The Electron path itself was not executed in this round.
5. **Unspecified case:** Real ChatView draft and dock behavior is beyond this board-level stub's proof (`canvas-rail-board.component.spec.ts:94-116,1380-1427`); the separate contextual draft test remains the relevant lower-level evidence cited by the fix report.

The fix report records 13/13 header and 67/67 board tests passing (`lane-R9x-fix-report.md`, Tests). Scoped `ptah_get_diagnostics` returned no errors in the four changed files; it reported seven errors in other project files, so it is not a clean project-wide typecheck. I did not rerun locked tests while the team-leader suite was active, and I did not run E2E. Score 8 reflects all three concrete fixes and regression checks, with the Electron behavior and real ChatView integration still unexecuted; this is stronger than a 7 with an unresolved original finding and short of a 9 with direct E2E evidence.
