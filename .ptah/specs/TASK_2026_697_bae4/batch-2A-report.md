# Batch 2A report

## Files changed

- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts`
- `libs/frontend/command-center/src/lib/scene/sprite-cache.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts`
- `libs/frontend/command-center/src/lib/scene/sprite-cache.spec.ts` (new)
- `libs/frontend/command-center/src/lib/scene/command-scene.component.spec.ts`

## Acceptance evidence

- V11: `command-scene.component.ts:207` supplies provider rim colours; `command-scene-renderer.ts:232-249` caches per-link gradients by geometry, theme, palette and backdrop signature. The curve, opaque idle-ink chevron and 2px active state stroke are at `command-scene-renderer.ts:265-316`. `setVoice` does not prepare paints. Tests: `command-scene-renderer.spec.ts:323,352`.
- V12: `command-scene-renderer.ts:566-578` draws two low-alpha level-driven speaking ripples; reduced motion skips them and retains the existing voice ring. Test: `command-scene-renderer.spec.ts:364`.
- V13: `sprite-cache.ts:232-252` prebakes the halo with theme, palette and capped DPR in its key, without a level; `command-scene.component.ts:219-232` supplies it, and `command-scene-renderer.ts:350-356` blits once with clamped level and a static reduced-motion treatment. Tests: `sprite-cache.spec.ts:4`, `command-scene.component.spec.ts:215`, `command-scene-renderer.spec.ts:364`.
- V14: `command-scene-renderer.ts:200-229` prebakes the original 48 dots and three guides with the Phase 1 light colour, keyed by size, theme and capped DPR; `:265` blits it once per frame. Test: `command-scene-renderer.spec.ts:323`.
- The existing renderer owns one rAF loop (`command-scene-renderer.ts:153-156,252-258,432`); no timers or layout changes were added. Canvas remains `aria-hidden` in `command-scene.component.ts:83`.

## Verification

- Ptah AST parsing reported zero syntax errors in all six changed TypeScript files.
- Scoped `ptah_get_diagnostics` was attempted three times but the TypeScript service timed out after 45 seconds each time and returned all six files unchecked.
- No Nx, Jest, tsc, lint or build command was run, per batch instruction. The orchestrator must run the changed specs and typecheck.

## Decisions

- Use the existing sprite's provider `rim` colour for decorative link endpoints. The opaque idle chevron and active state stroke carry the direction and activity cues; this follows the plan's measured contrast finding. Reversible.
- Use the existing `SpriteCache` canvas factory for the root halo and a renderer-owned canvas factory for the backdrop. Both are prepared outside draw, matching the current offscreen sprite pattern. Reversible.
- Treat running and starting child edges as active for the 2px run-ink stroke, matching the renderer's existing particle condition. Reversible.
