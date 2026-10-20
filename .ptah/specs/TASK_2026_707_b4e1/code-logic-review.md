# Code Logic Review - TASK_2026_707_b4e1 (voice ripples)

Static review only (no nx/jest/tsc run, per machine rule). Scope read in full: `command-scene-ripples.ts`,
`command-scene-ripples.spec.ts`, the renderer and status diffs, the `draw` loop and `setSnapshot`/`setVoice`
in `command-scene-renderer.ts`, and the added renderer specs.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED (no blocking or serious defects; defects below are moderate/minor) |

## Plan-rule conformance

| Rule | Result |
| --- | --- |
| One emit rule, `level >= 0.18 && now - lastEmit >= gap`, first frame emits | Met (`ripples.ts:64`, `lastEmit` starts at -Infinity `:23`) |
| Order prune -> emit <=1 -> cap 4 | Met (`:46-68`), no catch-up loop |
| Gaps 520-260*l / 640-220*l, thinking 2400 ms at 0.35, ink `done/need/run` | Met (`:50-65`) |
| Normalisation `isFinite ? clamp : 0` (undefined, NaN, +-Infinity -> 0) | Met (`:57-59`) |
| Life 1400, radius `+18 + 70*(0.6+0.4s)` ease-out, alpha `(1-p)^1.6*(0.1+0.3s)`, width `1+1.2s` | Met (`:81-96`) |
| Sync clear on voice-state change, reducedMotion->true, theme change | Met in `setVoice` (`renderer.ts:143`) and `setSnapshot` (`:113-117`); comparison is against the previous `this.voice`, so a snapshot whose voice differs from an earlier `setVoice` clears correctly |
| Clear in `destroy` | Met (`:205`) |
| rAF time only | Met: `time` from `draw` is the only clock (`:567-568`) |
| Draw after sprite/rim, before `drawVoiceRing` | Met (`:567-569`) |
| `LIVE_VOICE_STATES`, `recomputeActive`, frame cap, off-screen pause untouched | Met; diff does not touch them |

## Findings on the focus items

- Stale ripples after transitions: no stale path found. `update()` additionally self-clears when `state !== lastState`
  (`ripples.ts:44`), and the renderer clears synchronously. Hidden A->B->A (where `lastState` would still equal A) is covered
  because `setVoice` clears regardless of paint. Reduced-motion true->false: `update` cleared on the way in, so nothing leaks.
- Hidden/off-screen resume and long pauses: first frame prunes by age and emits at most one ripple; `lastEmit` is old so the
  single emit is immediate, no burst.
- NaN/out-of-range: handled; Infinity maps to 0 (plan says non-finite = 0), consistent with spec.
- Canvas state: after `draw` the context has `globalAlpha = 1` (equal to the value set at `renderer.ts:534`), the previous
  `lineWidth` and dash `[]`. `strokeStyle` is left as the last ripple ink, but `drawVoiceRing` (`status.ts:~121`),
  the selected/hover ring and the child ring all set their own `strokeStyle`/`lineWidth` before stroking, so no leak is
  observable. `drawVoiceRing` has no early return for idle, so ordering is safe.
- Frame cap / LIVE_VOICE_STATES / reduced motion: unchanged. Under reduced motion `active` is false and `update` clears each
  paint, so no ripples. Removed speaking loop in `status.ts` leaves `time`, `voiceSnapshot`, `snapshot` still used; no dangling
  state (the old loop ended with `globalAlpha = 1`, now unnecessary).
- Spec traces (mentally executed): every ripples.spec case passes against this code (checked boundary arithmetic:
  0.18 floats exactly, 520-0.5*260 = 390 exactly, thinking prune at 2399 gives 0, cap test yields ink-1..ink-4, post-2440
  prune gives 0). The renderer mock implements `arc`, `stroke`, `beginPath`, `setLineDash`; `lineWidth`, `strokeStyle` and
  `globalAlpha` are plain property writes, so nothing throws. The three renderer specs pass: root radius 30 + 18 = 48 is
  unique to the ripple (voice ring is 46/50, rim 38, dots 54); the clear-spy test would fail if `setVoice` did not clear
  (no `update` runs between).

## Defects

1. Moderate - untested synchronous-clear paths. `command-scene-renderer.spec.ts:~195-212` covers only `setVoice`. The
   `setSnapshot` clear (`renderer.ts:113-117`: voice-state mismatch vs earlier `setVoice`, reducedMotion false->true, theme
   change) and the hidden A->B->A case have no test, and the one test asserts a spy call count, not that no ripple is drawn
   afterwards. Fix: add tests that (a) `setVoice(speaking)` then `setSnapshot({voiceState:'listening'})` clears, (b) theme and
   reducedMotion flips clear, (c) after clear a frame with level below threshold draws no radius-48 arc.
2. Minor - weak "loud emits more often" test (`ripples.spec.ts:~41-49`). Loud saturates the cap (count 4) while quiet is 3, so
   the assertion proves little about the gap formula. Fix: count emissions (spy on emitted `born` via draw arc calls over a
   window shorter than life, e.g. 0-1000 ms with a 1300 ms life check) or assert the exact emit times (468 ms vs 260 ms).
3. Minor - draw test is thin (`ripples.spec.ts:~118-135`). It never asserts the in-flight `globalAlpha`, `lineWidth`,
   radius growth or strength dependence, and the title says "restores alpha" while the code (and the assertion) set it to 1,
   not the prior 0.4. Fix: record `globalAlpha`/`lineWidth` inside the `stroke` mock at progress 0 and 0.5 and assert the plan
   formulas; rename the test to "resets alpha to 1".
4. Minor - thinking test does not check fixed strength 0.35 / ink `inks.run` (`ripples.spec.ts:~58-66`); add a draw at t=0
   asserting width `1 + 1.2*0.35` and `#blue`.
5. Minor - non-monotonic time is unguarded (`ripples.ts:46-51,64`). If `now < lastEmit` or `now < born` (e.g. a caller or test
   feeding a smaller timestamp after a renderer restart), emission is blocked and ripples never age out until time catches up.
   rAF time is monotonic in production so this is latent. Fix: in `update`, `if (now < this.lastEmit) this.clear();` (then
   continue).
6. Minor - when 5 ripples would be live (loud, 260 ms gap vs 1400 ms life), the cap drops the oldest at progress ~0.74
   (`ripples.ts:68`), a small alpha pop (~0.05). Matches the plan; consider reducing life or raising the cap only if the
   Electron visual check shows it.
7. Minor - per-frame allocation in non-ripple states: `update` calls `clear()` which allocates a new array every paint while
   idle/muted (`ripples.ts:41,108`); `filter` allocates every live frame (`:46`). Negligible, but fix cheaply with
   `if (this.ripples.length) this.ripples = []` and in-place pruning.
8. Note (behaviour, per spec) - speaking with `outputLevel < 0.18` now shows no ambient rings, unlike the removed always-on
   two-ring loop. Confirm in the Electron check that this reads as intended. Also ripples reach radius +88 and are drawn inside
   the node loop, so any node later in the layout array can paint over them; root-first ordering makes this unlikely.

## Five logic questions

1. Silent failure: none found; invalid levels degrade to "no ripple", which is the specified behaviour.
2. Unexpected user action: rapid mute/unmute or theme toggle - handled by synchronous clears.
3. Wrong-answer input: Infinity output level shows nothing instead of full strength (spec-defined).
4. Dependency failure: none (pure, no DOM). A context missing `setLineDash` would throw, but the real canvas and both
   spec mocks have it.
5. Missing: no test for the snapshot clear path (defect 1).
