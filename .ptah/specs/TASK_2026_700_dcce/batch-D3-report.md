# Batch D3 report

## Files changed

- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.css` (new)
- `libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts`

## Acceptance items

- Restyled the measured DOM plates that the scene positions from `labelRect`. Plates show a Lucide kind glyph, provider artwork or raw-ID monogram, state glyph, and visible selected edge. The root shows its label, `HEAD OF ENGINEERING`, and a context row. The plate measurements continue through `getOverlayLabels()`; no scene files changed.
- The root context ring appears only with a verified percentage. The existing page passes null for unknown and supplies `normal` below 70% or `warning` at 70% and above. The overlay forwards that tone to `ptah-context-ring`; its CSS does not force orange on the ring.
- Child plates show their own provider and state, a silver `GitBranch`, and full-opacity metadata. Missing provider and unknown state display as `Child session / Provider unknown · unknown` across the plate's two text rows. Unregistered provider IDs stay raw.
- Retained 150ms/200ms hover timing, card bridge, pin, Escape, keyboard activation, focus restoration, hidden-plate handoff, and the reduced-motion transition gate. The pinned card still uses the read-only `ptah-command-node-detail` component.

## Tests added or updated

- Context ring assertions now cover 62%, 70%, and unknown, including normal/warning ring tones.
- Added child kind-glyph, provider fallback, exact unknown child wording, and raw provider-ID assertions.
- Kept the existing keyboard, timing, focus, reduced-motion, and escaped `<b>Review</b>` detail tests; extended reduced-motion coverage to the plate state icon.

## N1 wording conflict

The previous overlay spec asserted that its child plate did **not** contain `Unknown`. That contradicts D3's required `Provider unknown` fallback. I replaced that negative assertion with the required fallback text. The existing root `Codex · running` string remains present for the spec and assistive text, while the visible root plate follows the approved `HEAD OF ENGINEERING` layout. No integration spec text was edited.

## Verification

- `ptah_ast_analyze` parsed the edited component and spec with zero error nodes.
- `ptah_get_diagnostics` was requested for the two edited TypeScript files, but its TypeScript compiler remained unavailable after the tool's 45-second limit. It reported both files unchecked, not clean diagnostics.
- Nx, Jest, build, and other heavy checks were not run because D3 executes beside another lane; the orchestrator owns those checks.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the existing scene placement contract and restyle the DOM plates in place | Add plate positioning to the overlay; keep scene-owned `labelRect` placement | D1 exported `labelRect`; the scene already measures `getOverlayLabels()` and positions plates | Yes |
| Show unknown child provider explicitly | Preserve old absent-placeholder text; use D3's `Provider unknown` wording | D3 and the approved child screenshots require the fallback; the old negative spec conflicted | Yes |
| Use the page's context tone without a CSS color override | Compute a second tone in the overlay; forward `rootContextTone` | The page already derives its warning cue at 70%, and `ContextRingComponent` accepts `normal`/`warning` | Yes |
