# Batch R fix report

## Changes by defect

1. `command-scene-renderer.spec.ts:201-280` — the existing synchronous `setVoice` test now also checks the next frame has no radius-48 ripple. Added tests for a snapshot voice change after `setVoice`, reduced motion false to true, a theme change, and a hidden speaking to listening to speaking sequence; each checks the next frame has no radius-48 arc. The reduced motion case also checks the setter clears synchronously.
2. `command-scene-ripples.spec.ts:49-67` — asserts exact quiet and loud emission boundaries at 468 ms and 260 ms within a 936 ms window, before pruning or the four-ripple cap can mask timing.
3. `command-scene-ripples.spec.ts:168-202` — captures ink, alpha, width, and radius during each stroke at progress zero and one-half; checks the specified formulas and that alpha resets to one after drawing. Renamed the test accordingly.
4. `command-scene-ripples.spec.ts:69-91` — draws the first thinking ripple and checks `inks.run` and width `1 + 1.2 * 0.35`.
5. `command-scene-ripples.ts:44`, `command-scene-ripples.spec.ts:136-151` — clears old timing and ripples when time moves backward, with a regression case for fresh emission at the new time.
7. `command-scene-ripples.ts:107-111` — `clear()` replaces the ripple array only when nonempty; emission timing and voice state still reset on every call.

## Decisions

- The no-ripple renderer assertions repaint at the same rAF timestamp as the original emission. A stale ripple would still have radius 48, so the assertion detects a missed clear directly. This is a test choice and is reversible.
- Deferred visual findings 6 and 8 were left unchanged as requested.

## Verification

- Ptah AST analysis parsed all three changed TypeScript files with zero syntax errors.
- No Nx, Jest, tsc, ESLint, or build command was run, as instructed. Runtime and type verification remain with the orchestrator.
