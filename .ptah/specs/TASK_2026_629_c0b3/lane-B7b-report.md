# B7b detail wiring report

## Files changed

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`
- `libs/frontend/canvas/src/lib/orchestra-canvas.detail.spec.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`
- `libs/frontend/canvas/src/lib/canvas-grid-items.ts`
- `libs/frontend/canvas/src/lib/canvas-grid-items.spec.ts` (new)
- `libs/frontend/canvas/src/lib/canvas-tile.component.ts`
- `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts`
- `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts`

## Decisions

- The canvas host provides one `CanvasDetailService`, projects the panel into the active grid, locks that grid while detail is open, and closes detail when the tile disappears or the count falls to the live budget. Esc closes from anywhere; arrows step with service wrap except in text fields.
- The existing grid items computation applies D1: above the live budget, every tile is a card while detail is open. Hidden grids keep their cached card states.
- Card actions use optional detail injection and retain tile focus as the fallback. The card-mode tile host supports click, Enter and Space, while nested interactive controls keep their own action.
- Queue “Open session” closes the popover and opens the detail on the requester lane for lane permissions; optional detail injection retains the old focus fallback.

## Checks

- Focused specs: `orchestra-canvas.detail.spec.ts` 2/2, `canvas-grid-items.spec.ts` 1/1, `canvas-tile.component.spec.ts` 45/45, `canvas-needs-you-queue.component.spec.ts` 6/6, `orchestra-canvas.component.spec.ts` 34/34. Each ran with `npx nx test @ptah-extension/canvas --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
- `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 19 suites, 285 tests passed.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed; one existing NG8107 warning in chat.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed, zero errors and four existing non-null assertion warnings in specs.
- `canvas-workspace-grid.component.ts`: 873 physical lines. The configured 700-line lint rule excludes blank and comment lines; lint reported no max-lines warning.
- Scoped `ptah_get_diagnostics`: no errors in changed production files. It reported 11 existing diagnostics in sibling specs and dependencies that are outside the B7b edit boundary.
- Prettier ran only on changed TypeScript files.

## Open items

- B8a still supplies projected lane tabs and lane views.
- The B6 sibling-overlay manual Electron geometry check remains pending as recorded in `decisions.md` row 22.
