## Changes

- S5 identity: `libs/frontend/command-center/src/lib/model/work-projection.ts:33` caps agent labels at 28 characters and chooses display name, task, then capitalized provider; `:242` uses the result. `libs/frontend/command-center/src/lib/components/command-work-list.component.ts:64` and `components/command-overlay.component.ts:64` show compact provider and state text; the list adds a state icon at `:70`.
- S5 delegated work: `components/command-work-list.component.ts:31` counts only non-root nodes, `:37` lists them, and `:74` shows the prototype empty state. `:91` preserves focus requests that arrive as indices into the full projection.
- m3: `components/command-work-list.component.ts:128` and `components/command-overlay.component.ts:223` omit a missing or `unknown` provider instead of exposing an Unknown placeholder.
- M5: `components/command-overlay.component.ts:41` marks the selected plate, `:59` supports Space, and `:266` calls the page-provided `CommandCenterStore.select` for click, Enter and Space. `components/command-overlay-positioner.ts:95` tries four clamped card positions away from neighbouring visible plates, hiding the card if none is clear.

## Specs added or changed

- `model/work-projection.spec.ts:33`: name precedence, truncation and provider fallback.
- `components/command-work-list.component.spec.ts:23`: root exclusion, compact state, icons and keyboard selection; `:52` full-projection focus index; `:102` root-only empty state; unknown provider omission.
- `components/command-overlay.component.spec.ts:162`: click, Enter and Space selection through the store; compact plate/card text; `:231` neighbour avoidance.
- No test command was run, as directed. Scoped AST analysis parsed all seven changed TypeScript files with zero errors. `ptah_get_diagnostics` was attempted twice with exactly those seven files; both calls reported the TypeScript check still running after 45 seconds and returned no diagnostics.

## Decisions

- **Selection:** inject the ancestor-provided store into the plate component instead of adding a new output that the out-of-scope page would need to bind. The page already provides `CommandCenterStore` and uses its `select` method for list and scene selection. Reversible by wiring an output in the page later.
- **Unknown provider:** omit its name from secondary text while retaining the state and monogram. The visual review flags the internal Unknown placeholder; the provider mark already has a fallback. Reversible.
- **Crowded tooltip:** retain Floating UI's viewport flip and shift, then try collision-free positions against visible neighbouring plates; hide the card when none fits. This avoids covering another plate. Reversible.

## Needed outside scope

- `components/command-center-projection.source.ts` must forward `MonitoredAgent.displayName` and `task` into `OwnedAgent`; it currently forwards neither. Until then, live agents use the new provider fallback even though projection tests prove name precedence.
- `scene/scene-layout.ts` owns `labelRect` assignment and reserves collisions in scene order. It must place Ptah, selected, awaiting-input and failed plates before ordinary plates, with priority-order specs in `scene-layout.spec.ts`. Overlay code cannot recover a label already hidden by scene layout. This S8 plate-priority requirement remains open for the scene lane.

## Not done

- S8 plate priority and its specs, because both belong to scene files outside E3 ownership.
- Runtime tests and TypeScript diagnostics: tests were prohibited; scoped diagnostics were unavailable after two attempts.
