# Batch 1A report

## Files changed

- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene.component.spec.ts`
- `libs/frontend/command-center/src/lib/scene/scene-contrast.spec.ts` (new)

## Acceptance evidence

- V01: The component resolves all five `--state-ink-*` properties in a theme-dependent computed palette (`command-scene.component.ts:121-136`) and passes it through the snapshot (`:191,223`). Status arcs and glyphs use the palette (`command-scene-renderer.ts:369-435`); the voice ring uses it (`:449-465`). `draw` does not read CSS variables.
- V02: Light guide ellipses use the planned quiet `#aaa1b1` (`command-scene-renderer.ts:209`), while the dark guide remains `#504b68`.
- V03: The existing hover handler sends changed IDs directly to the renderer (`command-scene.component.ts:383-387`), where one snapshot field update invalidates one frame (`command-scene-renderer.ts:111-115`). A thin solid idle-ink ring surrounds only the hovered sphere (`:312-326`).
- Reduced motion keeps the static state and voice arcs (`command-scene-renderer.ts:382-395,472-490`) and disables the active frame loop through the existing `recomputeActive` gate (`:177-190`). The existing DPR cap and radial layout were retained.
- Contrast guard reads the `anubis` and `anubis-light` token values from the webview Tailwind config and requires each state ink to reach 3:1 against `base-200` (`scene-contrast.spec.ts:1-22`).

## Tests added

- `command-scene-renderer.spec.ts:260-302`: hover ring and single invalidation, static reduced-motion status, and resolved ink use for arcs, glyph, and voice ring.
- `command-scene.component.spec.ts:104-170`: existing hover output now checks renderer forwarding; theme changes read computed inks once, while a voice-level change does not read them again.
- `scene-contrast.spec.ts:12-22`: both themes and all five state inks.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Map listening to done, thinking to run, speaking to need, errors to err, and idle/muted/stopped to idle | The approved plan requires the voice ring to use theme state inks; these are the closest existing state meanings in `command-scene-renderer.ts:449-465`. | Yes |
| Keep hover as a lightweight renderer update instead of rebuilding the layout snapshot | Existing `updateHover` emits only when the ID changes, and `setSnapshot` rebuilds maps and sprite lists. `setHoveredId` changes only the snapshot field and invalidates one frame. | Yes |
| Use plan hexes only as fallback when computed CSS variables are unavailable | Runtime colors come from the stage's computed theme tokens; test DOM may not load the webview theme CSS. | Yes |

## Not done

- Jest, Nx, TypeScript, lint, build, and visual checks were not run, per the parallel-lane instruction. Scoped `ptah_get_diagnostics` found no errors in the five owned files; it reported 29 errors in unrelated sibling specs, which were left untouched.
