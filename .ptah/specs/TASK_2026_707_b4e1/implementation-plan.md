# Implementation plan - TASK_2026_707_b4e1 Voice ripples

Binding decisions R1-R7 are in `context.md`.

## Behaviour

| Voice state | Ripple rule |
| --- | --- |
| listening | Level = `inputLevel`. Emit rule below, gap `520 - level * 260` ms (520 ms quiet, 260 ms loud). Ink `inks.done`. |
| speaking | Level = `outputLevel`. Same emit rule, gap `640 - level * 220` ms. Ink `inks.need`. |
| thinking | One "breath" ripple on the first painted frame in thinking, then one every 2400 ms. Fixed strength 0.35, ink `inks.run`. Levels ignored. |
| idle, muted, stopped, error | No ripples; list cleared. |
| reduced motion | No ripples in any state. |

Each ripple: `{ born: number; strength: 0..1; ink: string }`. Life 1400 ms. Radius grows with
ease-out from `rootRadius + 18` to `rootRadius + 18 + 70 * (0.6 + 0.4 * strength)`. Alpha
`(1 - p)^1.6 * (0.10 + 0.30 * strength)`, line width `1 + 1.2 * strength`. At most 4 live
ripples; when full, drop the oldest. Non-finite levels count as 0.

Level normalisation (before threshold, gap and strength):
`Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0`. Strength = normalised level.

Emit rule (listening and speaking, one rule): emit when `level >= 0.18` AND
`now - lastEmit >= gap(level)`. This covers both the rising edge and a held level (a steady
rhythm while above threshold). A new rising edge before the gap has passed is suppressed.
`lastEmit` starts at, and resets to, `Number.NEGATIVE_INFINITY`, so the first eligible frame
emits at once. A level below threshold never emits.

`update()` order: prune ripples older than 1400 ms (by age against `now`), then emit at most
one ripple (no catch-up loop), then drop the oldest while more than 4. Only the rAF `time`
passed into the draw loop is used for `born`, age and gap; no other clock. After a long
hidden/off-screen pause, the first frame prunes everything and emits at most one ripple.

Synchronous clear (not deferred to the next paint): `clear()` empties the list and resets
`lastEmit`. The renderer calls it in `setVoice` and `setSnapshot` when the voice state
changes, when `reducedMotion` becomes true, or when `theme` changes. This holds while the
renderer is hidden too; the first visible frame repaints the whole canvas.

## Files

1. **New** `libs/frontend/command-center/src/lib/scene/command-scene-ripples.ts`
   - `export class VoiceRippleEmitter` (pure, no DOM): `update(voice: SceneVoiceSnapshot,
     inks: SceneInks, reducedMotion: boolean, now: number): void`,
     `draw(context, x, y, rootRadius, now): void`, `clear(): void`, `get count(): number`.
   - Constants for the numbers above at the top of the file.
   - Restores `globalAlpha = 1` and `lineWidth` it changed; draws with `setLineDash([])`.
2. **Edit** `scene/command-scene-status.ts`: delete the speaking ring loop in `drawVoiceRing`
   (lines 161-179). Nothing else in that function changes.
3. **Edit** `scene/command-scene-renderer.ts`:
   - A private `readonly ripples = new VoiceRippleEmitter()`.
   - In the second node loop (`:479-559`), immediately before
     `drawVoiceRing(context, this.voice, node, time, snapshot)` for the root (`:558-559`): call
     `this.ripples.update(this.voice, snapshot.inks, snapshot.reducedMotion, time)` then
     `this.ripples.draw(context, node.x, node.y, node.radius, time)`. Placement decision: after
     the sprite and root rim, because the sprite is blitted as a padded square of
     `2.2 * radius` half-width (`:516`), which could hide the inner arcs if ripples were drawn
     under it. Ripples start at `radius + 18`, outside the voice ring at `radius + 16`.
   - Synchronous `clear()` calls in `setVoice` / `setSnapshot` per the rule above (compare the
     previous voice state, reducedMotion and theme before overwriting them).
   - `destroy()` calls `this.ripples.clear()`.
   - No change to `LIVE_VOICE_STATES`, `recomputeActive`, the frame cap or the off-screen pause.
     Live voice states paint every frame when reduced motion is off (`:213-225`); with reduced
     motion `active` is false and ripples are disabled anyway.
4. **New** `scene/command-scene-ripples.spec.ts` covering:
   - first eligible frame emits; a level held under threshold never emits;
   - a held level emits at the gap; a rising edge inside the gap is suppressed;
   - gap shrinks with level (loud emits more often than quiet over the same window);
   - thinking emits on its first frame, then one breath per 2400 ms regardless of level;
   - idle / muted / stopped / error emit nothing and clear existing ripples;
   - reduced motion emits nothing;
   - cap of 4 (oldest dropped); ripples older than 1400 ms are removed;
   - a long time jump (e.g. 60 s) prunes all and emits at most one (no burst);
   - NaN, Infinity, negative and >1 levels are normalised (no throw; NaN never emits);
   - `draw` restores `globalAlpha` to 1 and uses the given ink.
5. **Edit** `scene/command-scene-renderer.spec.ts`: no existing assertion depends on the
   removed speaking loop (plan review finding 7). Add tests: speaking with a level above
   threshold draws ripple arcs; reduced motion draws none; a `setVoice` state change clears
   ripples synchronously (before the next frame).

## Out of scope

Link pulses on delegation (later, needs paid turns to verify). Background dot twinkle. Any
change outside `libs/frontend/command-center/src/lib/scene/`.

## Verification (memory-safe, one at a time, from the worktree)

```bash
npx nx typecheck command-center --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed"
npx nx lint command-center --parallel=1 --output-style=static 2>&1 | grep -E "error|warning|Successfully ran|failed"
npx nx test command-center --parallel=1 --output-style=static --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|FAIL"
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must not exceed the main baseline
npx nx typecheck ptah-extension-webview --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed"
```

Then Electron check on port 9334 (dark + light): listening while talking, speaking, thinking,
and reduced motion. Confirm both inner and outer parts of each arc are visible. Before/after
screenshots in `visual-check/`.

## Plan review

`implementation-plan-review.md` (codex, REVISE): all 7 findings applied in this revision —
F1 synchronous clear, F2 one emit rule, F3 initial/resume timing, F4 normalisation, F5 draw
placement after the sprite, F6 reduced-motion qualifier, F7 line count and spec impact.

## Execution and cost

| Step | Executor | Calls |
| --- | --- | --- |
| Plan review | one codex lane (opposite side of the in-process author) | 1 (+1 revise max) |
| Implement | one codex lane, 40 tool-call ceiling | 1 |
| Logic review | Anthropic `code-logic-reviewer` (different family from codex) | 1 |
| Fix round | resume the codex lane | at most 1 |
| Electron check | orchestrator | - |

Total: 4-6 paid lane/agent calls.
