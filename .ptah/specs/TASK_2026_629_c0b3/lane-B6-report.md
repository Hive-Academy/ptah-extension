# B6 frontend report

## Files changed

- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`: detail input, computed overlay placement, sibling projection slot, lower-row class and host height variable. No detail node enters Gridstack.
- `libs/frontend/canvas/src/lib/canvas-detail-geometry.ts`: placement calculation and grid CSS extracted to keep the component below the 700-line lint threshold.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.detail.spec.ts`: six-tile overlay regression, including opening, forced apply and closing.
- `.ptah/specs/TASK_2026_629_c0b3/spike-detail-row.md`: gate and Gridstack observations.
- `.ptah/specs/TASK_2026_629_c0b3/lane-B6-report.md`: this report.

## Checks

- `npx nx test @ptah-extension/canvas --testFile=canvas-workspace-grid.detail.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 1 test.
- `npx nx test @ptah-extension/canvas --testFile=canvas-workspace-grid.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: passed, 75 tests.
- `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed; one warning in unchanged chat code.
- `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`: passed, 0 errors; 4 non-null assertion warnings (3 in unchanged tile spec, 1 in the spike spec). No max-lines warning for the grid component.
- `ptah_get_diagnostics` on changed TypeScript files: no diagnostics in requested files; its broader sibling scan reports 7 errors in unchanged test/shared files. The scoped Nx typecheck passed.

## Gridstack and open items

Gridstack `load(positioned, false)` re-adds matching engine nodes but does not remove absent nodes (`node_modules/gridstack/dist/gridstack.js:658-704`). Engine `locked: true` skips top-gravity packing (`node_modules/gridstack/dist/gridstack-engine.js:448-453`), while programmatic `moveNode` does not enforce the lock (`:935-938`). These details matter for BL; the overlay creates no Gridstack node.

The jsdom criterion passes provisionally for option (b). The final GO/NO-GO decision awaits the user's Electron check: alignment within 8 px, lower rows visible and hit-testable, and scroll height increased by panel height. B7 should use option (b) only after that check passes; a failure selects option (c), the fixed bottom panel, and requires removal of the provisional grid hunks. No Electron instance was started.
