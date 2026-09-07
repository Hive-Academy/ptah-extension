# Context

## User report

With the editor panel closed, three tiles fit in one canvas row. With the editor
open, the canvas is about 1180 px wide and still gets three columns, so each chat
tile is about 380 px and too narrow. Two columns is correct there.

Drag and resize do not allocate space. Gridstack runs with `float: true`, so a
dropped tile sits where dropped and the auto-layout effect snaps every tile back
to its algorithmic slot on the next container resize. The lock button freezes
both drag/resize and the auto-layout, which is the only way to keep a manual
arrangement today.

## Goal

A canvas that behaves like a true fluid grid:

1. Columns derive from a minimum tile width (about 480 px), clamped 1..3, not
   from the 500/900 px breakpoints.
2. A row with fewer tiles than columns fills the full width.
3. Tiles compact up and left after a drag, a close, or an add.
4. Tile state is intent (order + weight), not x/y/w/h. Layout derives positions
   from intent each time the width, height, or tile count changes. Drag reorders.
   Resize changes weight. Manual intent survives a container resize.
5. Keep Gridstack (v12.5, `gridstack/dist/angular`). Keep the lock button
   semantics: locked disables drag/resize and freezes layout.

## Key files

- `libs/frontend/canvas/src/lib/canvas-layout.service.ts` — breakpoints, `computeLayout`
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` — Gridstack options, auto-layout effect, `onGridChange`
- `libs/frontend/canvas/src/lib/canvas.store.ts` — `CanvasTile.position`, `appendTile`, `updateTilePosition`, `switchWorkspaceTiles`
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` — lock toggle, `layoutService.observe`
- Specs: `canvas.store.spec.ts`, `orchestra-canvas.component.spec.ts`
