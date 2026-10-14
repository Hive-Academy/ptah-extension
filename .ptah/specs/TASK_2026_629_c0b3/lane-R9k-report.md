# Lane report R9k

Status: complete. Rail width observation and the Tribunal `TileLayout` contract remain; Grid layout service code and its two UI components are removed.

## Changes

- `libs/frontend/canvas/src/lib/canvas-layout.service.ts:12`: retained exported `TileLayout`; `:20-81`: kept active-aware container width observation, frame cancellation, re-observation, and observer disconnect on destroy. Removed Grid geometry imports, constants, types, column calculation, cell sizing, and `computeLayout`.
- `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts:62-129`: replaced Grid geometry cases with five cases for width updates, latest valid frame, active re-observation, destroy release, and a compile-level `TileLayout` import through the canvas barrel.
- Deleted `libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts` and `canvas-layout-controls.component.spec.ts` (former selector at component line 52).
- Deleted `libs/frontend/canvas/src/lib/canvas-board-toggle.component.ts` and `canvas-board-toggle.component.spec.ts` (former selector at component line 5).

## Reference scan

Before deletion, `rg` across `libs apps` with `-g '*.ts' -g '*.html'` for both basenames, exported component symbols, and selectors found references only inside the four files being deleted, plus selector absence assertions in `orchestra-canvas.rail.spec.ts:297-298` and `orchestra-canvas.component.spec.ts:891`. There were no live external importers.

After deletion, `rg` for the two component basenames and exported symbols returned zero matches. The broader selector scan found only those three absence assertions. `TileLayout` remains exported by `libs/frontend/canvas/src/index.ts:5` and imported by Tribunal at `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:2`.

## Verification

- `node .ptah/tmp/check-run.mjs r9k-layout -- npx nx test @ptah-extension/canvas --testFile=canvas-layout.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: **Test Suites: 1 passed, 1 total; Tests: 5 passed, 5 total.** An initial run had 1 failing test due to a synchronous animation-frame stub during Angular scheduling; the stub was changed to queue the frame, and the required check then passed.
- `ptah_get_diagnostics` on the two edited files: no diagnostics in requested files. The tool reports eight errors in untouched sibling/dependency files (`canvas.store.spec.ts`, `orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, `capability-id-codec.ts`).

## Decisions

- Keep `TileLayout` as the sole layout geometry contract; options were retain all service geometry or retain only the Tribunal type. Evidence: Tribunal imports `TileLayout` through the canvas barrel, while live Rail consumers use `observe` and `containerWidth`. Reversible by restoring geometry if a future consumer needs it.
- Observe positive width independently of height; options were keep the old height gate or admit width-only measurements. Evidence: Rail reads only `containerWidth`, and the width test covers a zero-height entry. Reversible by restoring a height gate if required by a future view.
- Retain active-state frame cancellation and re-observation; options were reduce to a plain observer or preserve existing lifecycle handling. Evidence: the live canvas may hide and reactivate; the focused spec covers re-observation and cleanup. Reversible if surface lifecycle changes.
