# Batch O12 fix

## Change

- Chose the O12 CSS clipping option. The existing Angular `animate.enter` class marks the pane only while its 180 ms entrance runs, so the selector needs no timer or component state.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:87`: while a direct pane child has `.rail-pane-enter`, clip the pane container's overflow. This prevents the translated pane from creating a transient horizontal scrollbar and changing the container's height. The 8 px translation, opacity fade, duration and easing remain. The rule stays inside the existing `prefers-reduced-motion: no-preference` gate.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:459`: assert the container clipping selector alongside the existing enter binding assertion.

## Checks

- `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2`: passed, 1 suite and 92 tests.
- `npx nx lint @ptah-extension/canvas --parallel=1`: passed, 0 errors and 38 warnings. Nx Cloud reported a disabled organization after the local lint target succeeded.
- `ptah_get_diagnostics` was scoped to the two edited TypeScript files but returned unavailable after its 45 second check timeout. No typecheck was required because edits are CSS and a spec assertion only.
- No Electron visual run was performed, per task verification limits. The spec checks source structure; it cannot simulate browser overflow in jsdom.

## Decisions

- **Decision:** Clip both overflow axes with `overflow: clip` while the direct pane child carries `.rail-pane-enter`.
- **Options:** Clip during entrance; use an opacity-only fade.
- **Evidence:** O12 authorizes both; B6 review identifies transformed scrollable overflow at the `overflow-x-auto` parent; M1 Electron frames show a transient scrollbar and layout shift. `overflow: clip` prevents that scrollbar while preserving the planned motion. The existing animation class supplies a CSS-only lifetime.
- **Reversible:** Yes. The one CSS rule can be removed if a future browser visual check finds a conflict with scrolling during the 180 ms entrance.
