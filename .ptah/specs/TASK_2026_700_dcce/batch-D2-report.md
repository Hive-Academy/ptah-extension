# Batch D2 report

## Files changed

- `libs/frontend/command-center/src/lib/scene/command-scene.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene.component.spec.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts`
- `libs/frontend/command-center/src/lib/scene/scene-contrast.spec.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene-decoration.ts` (new)

## Acceptance work

- Added `reservedTop = input<number>(72)`. The observed stage size now produces one `sceneRect`: top is `reservedTop() + 10`, bottom is stage height minus 62, and width is the observed stage width. The same rect goes to D1 `layoutScene` and the renderer's decoration cache. No canvas-width band breakpoint was added.
- Guarded the existing `ResizeObserver` construction with `typeof ResizeObserver !== 'undefined'`; initial sizing still runs without it. Existing teardown disconnects observers and releases media, visibility, pointer and animation callbacks.
- Moved backdrop dots, root-centred orbital curves and cached edge glow to `command-scene-decoration.ts`. The cache invalidates for theme, size, DPR or scene-rectangle changes.
- Kept the existing sprites, state rings, running elapsed arcs, hover/selection hit testing and hidden-tab/reduced-motion frame gates. Added the gold root outline and dotted voice ring. D1 `SceneTether` coordinates now draw a thin silver owned-work-to-child line; child-owned work skips the ordinary parent curve. Child-owned work also gives its child a dashed 70px orbit.
- A live child gets a second thin silver ring. A projected child with no tab and `unknown` state gets a dimmed sphere, dashed silver ring and `CS` monogram. Child selection remains display-only per D9.

## Tests added or extended

- Component spec explicitly supplies `reservedTop`, checks the measured rectangle and root centre after input changes, and checks teardown when `ResizeObserver` is absent.
- Renderer spec checks live and persisted child variants, sprite dimming, exact tether endpoint, child hit testing, scene-rectangle cache invalidation, and the new cached glow. Existing specs cover theme cache invalidation, idle and reduced-motion frame stopping, hover and selection hit tests, state arcs and elapsed arcs.
- Contrast spec checks silver child rings/tethers against both stage themes at 3:1, alongside the existing state-ink checks.

## Verification

- Scoped `ptah_get_diagnostics` completed with **no diagnostics in the six D2 files**. It reported 29 TypeScript errors in sibling specs outside D2 ownership, including integration voice specs and tribunal coordinator specs.
- Nx, Jest, builds and other heavy checks were not run because this lane shares the worktree with D3; the orchestrator runs them after both lanes finish.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat a child as persisted only when it has no `tabId` and state `unknown` | All children without a tab / projected persisted children only | D2 contract and `work-projection.ts` distinguish live children by `tabId` and persisted children by `unknown` | Yes |
| Key the static decoration cache by the supplied scene rectangle | Stage size alone / scene rectangle too | D1 centres the root inside `SceneViewport.sceneRect`; the band can change without a stage resize | Yes |
| Draw D1 ownership tethers as direct silver lines and skip duplicate generic curves | Draw both / dedicated tether only | `SceneTether` gives final owned-work and child centres; D2 asks for a thin silver tether ending at the child | Yes |
