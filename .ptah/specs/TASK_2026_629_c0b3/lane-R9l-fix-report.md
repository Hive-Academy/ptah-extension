# R9l fix round report

| Finding | Change | Spec location | Template/source evidence |
| --- | --- | --- | --- |
| S1: deleted `Create new session` button | Click the dock popover anchor in all three creation cases; retain the exact `Create` click. | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:26-27,43-44,74-75` | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:161-182` renders the `canvas-new-session-anchor` button; `:214-221` renders `Create`. |
| Moderate 4: `Dense cards` disappears on collapse | Assert the `Sessions` complementary region after focusing a card. | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:32-33` | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts:30-32` renders the Focused session region; `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:64-72` renders the `Sessions` aside outside the `@if (!collapsed())` block at `:75-93`. |
| Moderate 3: duplicate and trivial service assertions | Remove the duplicate focus/lane case and the always-true `laneKey()` check. Keep the per-tab lane assertion after `close`, lane restoration, `selectLaneFor` close/reset, and map identity cases. | `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts:35-73` (remaining cases); `:53-57` (close case) | `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts:18-39` stores lanes per tab and prunes on close; `:42-47` focuses and selects a lane; `:55-57` closes detail. |

Locator check against current source: `ptah-canvas-rail-board` is declared at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:34`, and its empty-board test id, heading, and `New session` button are at `:80-101`. `ptah-canvas-rail` is declared at `canvas-rail.component.ts:33`; cards expose `data-rail-card` at `canvas-rail-card.component.ts:43`. `ptah-tab-bar` is declared at `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:65`. The changed anchor, `Create`, Focused session, and Sessions locators are mapped above.

Spec Tests: `node .ptah/tmp/check-run.mjs r9l-fix-1 -- npx nx test @ptah-extension/canvas --testFile=canvas-detail.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` exited 0: **1 suite passed, 5 tests passed**. E2E was not run as instructed. Scoped diagnostics found no errors in the two changed files; seven errors were reported in other project files.

## Decisions

- Used the always-rendered `Sessions` aside to preserve a second UI assertion while allowing a collapsed Rail.
- Removed the duplicate case instead of folding it: the existing known-tab case already checks focus, lane choice, and null detail state.
- Kept the close case because its `laneKeyFor('a')` assertion checks that the remembered lane survives `close()`; removed only the computed default-lane assertion.
