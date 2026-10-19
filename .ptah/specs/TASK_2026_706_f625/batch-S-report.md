# Batch S report

| Requirement | Result | File:line | Test |
| --- | --- | --- | --- |
| E1 real logo | Optional `VSCodeService` URI feeds one guarded image; root sprite clips loaded art and retains the `P` fallback. Logo readiness changes the cache signature and triggers a scene refresh. | `command-scene.component.ts:136`, `sprite-cache.ts:49`, `sprite-cache.ts:231` | `sprite-cache.spec.ts:4` covers fallback, load, error, and cache replacement. |
| E2 orbit cleanup | Root orbit guide count follows non-tethered delegate and tribunal nodes; many layouts get two guides, others one. Empty layout has a fainter guide. | `command-scene-renderer.ts:233`, `command-scene-decoration.ts:40` | `command-scene-decoration.spec.ts:8` counts ellipses for empty, single, and many layouts. `scene-contrast.spec.ts` was read; child ring and tether inks remain unchanged. |
| E3 glow | Warm theme-specific radial field appears before the root sprite; voice level changes radius by up to 25%, with a fixed base size under reduced motion. | `command-scene-decoration.ts:55`, `command-scene-renderer.ts:397` | `command-scene-renderer.spec.ts:148` checks size, draw order, and reduced motion. |
| E4 flowing links | Root-to-node curves and ownership tethers share a time-based dash offset toward the work; reduced motion uses zero offset. | `command-scene-renderer.ts:328` | `command-scene-renderer.spec.ts:166` checks moving and static offsets and a tether path. |
| E5 preservation | Status arcs, voice ring, child rings, monograms, plates, overflow, hit testing, inks and tether caching remain in their existing paths. Renderer is 610 lines. | `command-scene-renderer.ts:1` | Existing scene specs retained; no suite was run by this lane. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Count orbit nodes from rendered delegate and tribunal spheres, excluding tethered children. | Add layout metadata; derive count from rendered nodes. | `scene-layout.ts` builds orbit nodes as delegate/tribunal and child-owned work has ownership tethers. | Yes |
| Keep flowing dashes active whenever non-root work is visible. | Animate only during voice activity; animate while work is visible. | E4 calls for flowing links; the renderer already has one bounded animation frame loop. | Yes |
| Reuse the existing sprite cache and refresh it with a signal on image load. | New image layer; cache integration. | E1 requires a clipped root sprite and cache invalidation; `SpriteCache` already owns root art. | Yes |

## Not verified

No Nx, Jest, build, or test commands were run, by batch rule. A scoped `ptah_get_diagnostics` request returned unavailable after its 45-second timeout; it reported all seven changed TypeScript files unchecked. The orchestrator owns verification.
