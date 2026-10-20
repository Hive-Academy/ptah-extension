# Batch R report

## Files changed

- `libs/frontend/command-center/src/lib/scene/command-scene-ripples.ts` — added the pure voice ripple emitter and Canvas 2D drawing.
- `libs/frontend/command-center/src/lib/scene/command-scene-status.ts` — removed the old speaking ring loop.
- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts` — integrated ripple updates and drawing at the root, with synchronous lifecycle clears.
- `libs/frontend/command-center/src/lib/scene/command-scene-ripples.spec.ts` — added emitter behavior and drawing cases.
- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts` — added speaking, reduced motion, and synchronous state-change cases.

## Plan mapping

- Listening, speaking, and thinking sources, inks, gaps and first-frame emission: `command-scene-ripples.ts:30-68`.
- Finite level normalization, threshold, held-level rhythm, and one emission per update: `command-scene-ripples.ts:55-66`.
- Pruning by rAF time, four-ripple cap, and no catch-up after a pause: `command-scene-ripples.ts:46-68`.
- Ease-out radius, fading alpha, strength width, ink, and restored context state: `command-scene-ripples.ts:71-105`.
- Synchronous reset of list and last emission: `command-scene-ripples.ts:107-111`; setter and destruction calls: `command-scene-renderer.ts:112-117,142-143,203-205`.
- Placement after sprite and rim, immediately before the root voice ring: `command-scene-renderer.ts:567-571`.
- Old speaking loop removed while the static ring remains: `command-scene-status.ts:112-160`.

## Tests added

- Emitter: first eligible frame; below-threshold silence; held level and suppressed rising edge; louder rhythm; thinking interval and ignored levels; idle, muted, stopped, and error clears; reduced motion; cap and oldest drop; 1400 ms pruning; 60 s jump; invalid and clamped levels; ink and context restoration.
- Renderer: speaking arc at level one; no reduced-motion ripple; immediate `setVoice` state-change clear.

## Decisions

- Radius uses quadratic ease-out. The plan specified ease-out without a particular curve; quadratic is a simple monotonic curve using only the rAF time. Reversible by changing the curve expression in `draw`.
- Ripples are pruned at age 1400 ms, when their alpha reaches zero. The plan says life 1400 ms and prune older than that; this avoids retaining an invisible ripple for an extra frame. Reversible by changing the age comparison.
- The emitter also resets its own list on a direct voice-state change. The renderer already clears synchronously; this makes the pure emitter safe to use and test independently. Reversible by removing the internal state check.

## Verification and remaining work

- Reviewed the changed source and canvas mocks. No Nx, Jest, tsc, lint, build, serve, or e2e command was run, per batch instruction.
- Scoped `ptah_get_diagnostics` returned unavailable after 45 seconds with all five files unchecked; it reported that its TypeScript check remained in progress. The orchestrator owns typecheck, lint, tests, and visual verification.
