# Phase E, batch E2b — scene plate priority

## Changes

- `libs/frontend/command-center/src/lib/scene/scene-layout.ts:273`: Prepare labels while retaining scene order for the returned nodes.
- `libs/frontend/command-center/src/lib/scene/scene-layout.ts:290`: Reserve plate space in stable priority order: root, selected, awaiting input, failed, then remaining nodes in scene order. Lower-priority plates give up space first.
- `libs/frontend/command-center/src/lib/scene/scene-layout.ts:361`: Attach the resulting rectangles to the original node order.

## Specs

- `libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts:200`: Added a crowded scene with important nodes late in scene order. It requires root, selected, awaiting, and failed plates while an ordinary plate is hidden.
- Both edited TypeScript files passed AST parsing. Scoped `ptah_get_diagnostics` was attempted twice but its TypeScript check remained unavailable after each 45-second timeout. The orchestrator owns test execution; no test command was run in this lane.

## Decisions

- Used the existing optional `selectedId` parameter and the existing component call at `command-scene.component.ts:160`; no component edit was needed. This is reversible.
- Kept sphere placement and returned node order intact, changing only plate reservation order. This preserves rendering and hit-testing order. This is reversible.

## Not done

- TypeScript diagnostics and the new spec could not be confirmed in this lane. The orchestrator should run its scoped verification.
