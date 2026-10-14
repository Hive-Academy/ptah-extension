# R9l lane report

## Changes and evidence

- `libs/frontend/canvas/src/lib/canvas-board-mode.ts:1`: `CanvasBoardMode` is now `'rail'`. Historical Grid input remains in `canvas-layout-persistence.service.ts:47`, where Zod accepts `grid` and normalizes it to Rail. Gridstack was untouched.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts:22-47`: `open` focuses the tile and remembers its lane without the dead Grid branch. `selectLaneFor` and the per-tab lane map remain. `rg 'detail\.(toggle|next|prev)\(' libs apps` found no production callers; `toggle`, `next`, `prev`, and their stepping helper were removed. `canvas-detail.service.spec.ts:35-80` now tests Rail focus, lane memory, close pruning, and same-lane identity without deleted actions.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:238-241,725-728`: layout mocks now provide only `observe` and `containerWidth`, matching `canvas-layout.service.ts:29-64`; removed `containerHeight`, `columnsFor`, and `computeLayout`.
- `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts:50-51`: removed the impossible typed Grid snapshot case. The raw JSON Grid fixture still exercises migration. This edit was necessary because the narrowed `CanvasBoardMode` makes `schedule(... mode: 'grid')` invalid.
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:4-82`: replaced deleted Grid controls and selectors with Rail board, empty board, card, focused session, and density checks. Template evidence: `canvas-rail-board.component.ts:80-99` defines the painted empty-board section, heading and New session button; `canvas-rail-card.component.ts:43` defines `[data-rail-card]`; `canvas-rail.component.ts:66,84,155` defines the Sessions region, Dense cards button and list; `canvas-focus-area.component.ts:30-32` defines the Focused session region; `orchestra-canvas.component.ts:177` defines Add new session tile. The canvas spec uses the existing create-dialog controls from the earlier spec.
- `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts:57-58,197`: the agent bubble is now located inside the Rail focused-session section. Template evidence: `canvas-focus-area.component.ts:30-55` renders the labelled section and `ptah-canvas-lane-view`; the existing bubble selector remains the transcript component's element.
- `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:189-196`: the modal collision probe uses the painted Rail empty-board section and heading. Template evidence: `canvas-rail-board.component.ts:78-99`; the section fills the flex remainder behind the dialog.

The Grid-only e2e scenarios for Gridstack drag, resize, compact-height, lock, and presets were removed because Rail has no matching geometry controls. The settings and workspace round-trip checks remain in Rail form. The workspace case now checks session restoration because Rail does not promise retained card DOM identity across workspace visibility changes.

## Verification

- `node .ptah/tmp/check-run.mjs r9l-1 -- npx nx test @ptah-extension/canvas --testFile=canvas-detail.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Test Suites: 1 passed, 1 total; Tests: 6 passed, 6 total.
- `node .ptah/tmp/check-run.mjs r9l-2 -- npx nx test @ptah-extension/canvas --testFile=orchestra-canvas.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Test Suites: 1 passed, 1 total; Tests: 30 passed, 30 total.
- `node .ptah/tmp/check-run.mjs r9l-3 -- npx nx test @ptah-extension/canvas --testFile=canvas-layout-persistence.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Test Suites: 1 passed, 1 total; Tests: 25 passed, 25 total.

E2e was not run, per contract. Typecheck and lint remain for Mode 2. `ptah_get_diagnostics` was not listed, so scoped diagnostics were unavailable.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Remove unused detail navigation actions | Keep dead API or remove | `rg` found no `detail.toggle/next/prev` production caller in `libs` or `apps`; Rail has focused session | Yes |
| Remove Grid-only e2e cases | Simulate nonexistent controls or remove | Current Rail templates above have cards, focus and density, with no Gridstack geometry, preset or lock controls | Yes, if a corresponding Rail capability is added |
| Check workspace restoration instead of DOM identity | Assert old DOM node or assert returned session | `canvas-rail-board.component.ts:51` gates visible content; card identity across workspace changes is not a Rail contract | Yes |
| Keep historical Grid as raw stored data | Typed live Grid snapshot or raw JSON input | `canvas-layout-persistence.service.ts:47` normalizes raw `grid`; `canvas-layout-persistence.service.spec.ts:50-51` covers it | Yes |

## Proposed Removals

None beyond the contracted Grid and dead API cleanup.

## Changed files

1. `libs/frontend/canvas/src/lib/canvas-board-mode.ts`
2. `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts`
3. `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts`
4. `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`
5. `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts`
6. `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
7. `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts`
8. `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts`
