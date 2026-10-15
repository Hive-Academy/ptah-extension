# B5b canvas live budget report

## Files changed

- `libs/frontend/canvas/src/lib/canvas-live-budget.ts` and `.spec.ts`: budget constant and pure auto-card rule with default and custom-budget coverage.
- `libs/frontend/canvas/src/lib/canvas-tile.component.ts` and `.spec.ts`: signal input and live `SESSION_FORCED_CARD` child-injector provider.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` and `.spec.ts`: per-tile binding and focus/geometry/view-mode regression coverage.
- `.ptah/specs/TASK_2026_629_c0b3/lane-B5b-report.md`: this report.

## A2 finding and decisions

- The grid renders `@for (item of items(); track item.tabId)` at `canvas-workspace-grid.component.ts:122`. Its own rendered item collection is the `items` computed at `:331`, derived from this workspace's `tiles()` at `:239`. The binding at `:132` uses `items().length`, so it counts exactly the grid's items rather than the canvas-wide store.
- `isAutoCardTile` returns true only when the tile count exceeds the budget and the tile is unfocused. No `detailOpen` term is present in step 1.
- The binding changes the tile's view through a signal token. It does not write the stored view mode or feed focus into grid geometry. No chat, 628-owned, or other restricted files changed.
- Existing Angular 22 standalone, OnPush, `inject()`, signal-input, and typed chat-token patterns were followed. No markup, HTML rendering, external service access, styling, or new state API was needed.

## Checks

- `npx nx test @ptah-extension/canvas --testFile=canvas-live-budget.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 4 tests.
- `npx nx test @ptah-extension/canvas --testFile=canvas-tile.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 43 tests.
- `npx nx test @ptah-extension/canvas --testFile=canvas-workspace-grid.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 71 tests. The new cases assert per-tile auto-card bindings at 1, 2, and 3 tiles; identical `{x,y,w,h}` for every engine node across focus changes; and unchanged stored view modes.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed; one NG8107 warning in untouched `peer-session-send-dialog.component.ts`.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed with 4 warnings: 3 existing non-null assertions in the tile spec and a 703-line grid file against its 700-line limit.
- `npx prettier --write` ran on every changed TypeScript file.

## Open items

- None for this batch. Rendered-browser verification was outside the requested check set; the grid spec uses the repository's Gridstack stub.
- The `ptah_agent_report` tool was not exposed in this session, so delivery must use this report path and the final message.
