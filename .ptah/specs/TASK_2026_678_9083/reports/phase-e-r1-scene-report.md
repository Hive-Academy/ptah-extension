# Phase E revision 1 — scene lane

## Findings

- **S-1:** `scene/command-scene.component.ts:151-171` now keys measured plate sizes by node ID; `scene/scene-layout.ts:39-42,342` passes node ID and label text to the measure function. The overlay already supplies `data-node-id` and measured sizes, so no overlay edit was needed. `command-scene.component.ts:235-269,280-291` skips unchanged measurements, preserves last nonzero dimensions for hidden plates, and uses the existing shared `ResizeObserver` to relayout when a plate size changes. `scene/command-scene.component.spec.ts:199` checks measured root and child DOM plate sizes, unchanged-size stability, and changed-size relayout; existing `scene-layout.spec.ts` measure mock uses the new contract.
- **M-b:** `scene/scene-layout.ts:317-407` places the root first, searches further positions when its four nearby positions are blocked, and guarantees a root plate if no sphere-clear position exists. Collision checks use the measured dimensions from S-1. `scene/scene-layout.spec.ts:255` checks root visibility and pairwise plate separation with 24 nodes at 1440×600 and 600×600.
- **M-c:** `scene/sprite-cache.ts:204-220` renders light-theme delegate artwork and fallback marks in dark `#2f241b`; dark-theme palette colors remain. The cache already separates themes. `scene/sprite-cache.spec.ts:117` checks both colors and separate cached sprites.

## Files changed

- `libs/frontend/command-center/src/lib/scene/command-scene.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene.component.spec.ts`
- `libs/frontend/command-center/src/lib/scene/scene-layout.ts`
- `libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts`
- `libs/frontend/command-center/src/lib/scene/sprite-cache.ts`
- `libs/frontend/command-center/src/lib/scene/sprite-cache.spec.ts`

## Decisions

- Reuse the overlay's existing `data-node-id` and `SceneLabel.id` rather than altering its template. Source: `command-overlay.component.ts:42,192-212`. Reversible.
- Reuse the scene's single `ResizeObserver` for the stage and plates instead of adding an observer per node. The implementation plan requires one observer, and unchanged dimensions are ignored. Reversible.
- Keep the last nonzero dimensions when a renderer-hidden plate reports zero width or height. This prevents hidden plates from replacing accurate measurements with fallbacks. Reversible.
- Search the stage for a sphere-clear root position, then force a root plate if none exists. Root visibility is mandatory; other plates still avoid its reserved rectangle. Reversible.
- Use the root's light mark color for light delegate marks because the light sphere interior is pale; preserve dark-theme art colors. Reversible.

## Not done

- Nx, Jest, build, serve, e2e, and package commands were prohibited for this lane. Scoped `ptah_get_diagnostics` found no errors in the six changed files; it reported 17 errors in sibling files outside this lane's ownership.
- Runtime visual validation remains for the orchestrator's integration pass.
