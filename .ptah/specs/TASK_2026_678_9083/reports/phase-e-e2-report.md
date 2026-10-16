# Phase E2 scene fixes

## Changes

- B2: `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts:258` draws each cached sprite at the padded 2.2× diameter around its node. Hit testing, status rings, selection halo and voice ring continue to use `node.radius`.
- S6 render: `libs/frontend/command-center/src/lib/scene/sprite-cache.ts:82` ignores the root provider slug, and `sprite-cache.ts:190` draws the Ptah `P` directly on its gold sphere with a dark mark in the light theme.
- S8 layout: `libs/frontend/command-center/src/lib/scene/scene-layout.ts:187` checks the root keep-out and pair spacing, then packs crowded stages at decreasing delegate radii with a 12px radius floor (`scene-layout.ts:206`). Tribunal lane envelopes are reserved during packing.

## Specs added or changed

- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts:144` asserts padded draw dimensions and unchanged hit radius.
- `libs/frontend/command-center/src/lib/scene/sprite-cache.spec.ts:95` asserts the root uses the `P` rather than a provider path and checks contrasting mark colors in dark and light themes.
- `libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts:89` checks 24 nodes at 600×460 and 600×320 for voice-ring clearance, nonoverlapping sphere bodies and the delegate radius floor.
- All six changed files passed Ptah AST parsing with zero error nodes. Scoped `ptah_get_diagnostics` was attempted twice but its TypeScript compiler check remained unavailable after each 45-second timeout. No tests or build commands were run, per batch instructions.

## Decisions

- Draw the full cached sprite at 2.2× the node diameter rather than crop the padding. The prototype uses that draw size, and the cached glow needs the padding. Reversible.
- Keep the root face independent of its provider and use the prototype's dark/light `P` colors (`#fff3ce` / `#2f241b`). The approved design specifies the Ptah mark while delegates retain provider marks. Reversible.
- Preserve the wide-stage orbital positions when clear; use deterministic compact packing only when the current positions violate the voice keep-out or sphere spacing. A 12px radius floor allows the required 600px stages to retain all 24 scene nodes. Reversible.

## Needed outside scope

- S6's missing first-run root is caused by the empty projection in `command-center-page.controller.ts`; the page lane must provide a root before a session exists.
- S8's 320px stage minimum is in `command-center-page.component.ts`; the later page lane owns its specified narrow-stage height. Label plates are owned by the overlay lane.

## Not done

- Jest, Nx, TypeScript CLI, build, serve and visual runtime checks were prohibited for this parallel batch. The orchestrator must run scoped checks and review the small-stage scene after integration.
