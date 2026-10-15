# Phase C fix round 2 — canvas

| Finding | Status | File:line | Test |
|---|---|---|---|
| S2 forced-card actions | Fixed: both actions focus the tile; lane detail remains for B7a. | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:630` | `canvas-tile.component.spec.ts` (44 passed) |
| M1 hidden grids | Fixed: each grid caches its visible auto-card bindings and retains them while hidden. | `libs/frontend/canvas/src/lib/canvas-grid-items.ts:50` | `canvas-workspace-grid.component.spec.ts` (75 passed) |
| M3 one live tile | Fixed: layout focus wins, then this grid's focus, then its last valid focus, then first tile in order. | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:325` | Grid spec: null focus, outside focus, layout focus |
| Moderate stuck running cap | Fixed: a one-second interval exists only at the cap with a hidden running tab; it refreshes the computed and stops below cap or on store destroy. | `libs/frontend/canvas/src/lib/canvas.store.ts:159` | Store fake-timer spec (19 passed) |
| Minor switch-order undercount | Fixed: live tab ownership follows `TabManagerService.activeWorkspacePath$()` with the implicit `''` fallback. | `libs/frontend/canvas/src/lib/canvas.store.ts:164` | Store switch-order spec |
| Style M2 per-tile autoCard | Fixed: `items` carries `autoCard`; template binds `item.autoCard`; creation options and `track item.tabId` remain stable. | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:122`, `libs/frontend/canvas/src/lib/canvas-grid-items.ts:50` | Grid projection and geometry spec |
| Style M1 grid size | Fixed: item projection moved to `canvas-grid-items.ts`; grid has 881 physical lines and no max-lines lint warning. | `libs/frontend/canvas/src/lib/canvas-grid-items.ts:10` | Canvas lint |
| Canvas minors | Fixed: documented tile input and both live-budget exports. The optional budget parameter remains because its spec uses it. | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:440`, `libs/frontend/canvas/src/lib/canvas-live-budget.ts:1` | Tile and live-budget specs |

## Hidden-tab signal finding

No hidden-workspace tab-status signal is exposed by the existing partition. `tab-workspace-partition.service.ts:89` says background updates occur without signals; `:101` stores tabs in a plain `Map`, `:239-243` reads it, and `:366-374` mutates background tabs directly. `activeWorkspacePath$` at `:121` signals workspace changes, not hidden status changes. No chat-state, chat-streaming, or TASK_2026_628-owned file was edited.

## Checks

- `npx nx test @ptah-extension/canvas --testFile=canvas-tile.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 44 passed.
- Same command with `canvas-workspace-grid.component.spec.ts`: 75 passed after the final regression.
- Same command with `canvas.store.spec.ts`: 19 passed.
- `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 13 suites, 271 tests passed. This ran before the final grid regression, which passed in the subsequent focused run.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed; one existing NG8107 warning in chat peer-session-send.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed with three existing non-null-assertion warnings in the tile spec; no grid max-lines warning.

## Open items

- B7a still needs to open lane detail after `openLane`; this round focuses the tile as specified.
- Phase C review records transcript scroll reset on focus flips and the 2-to-3 tile remount as accepted limits.
