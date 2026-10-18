# Code Logic Review, Phase 3 (V15, V17, V18) - TASK_2026_697_bae4

Review family: reviewer: Anthropic Claude; implementer: codex

Score: 8/10
Verdict: NEEDS_REVISION (no blocking or serious defects; two moderate items should be fixed or consciously accepted before commit)

Scope: uncommitted diff in `libs/frontend/command-center/src/lib/` (13 files), read against implementation-plan.md (Current contracts bullet on lane timestamps, Conflicts resolved item 3, V15/V17/V18 rows, 3A/3B phase rows) and batch-3A/3B reports. Orchestrator-verified suites were not re-run. Checked by reading code, not by executing a frame measurement.

## Check results

3A
- startedAt source: only `agent.startedAt` of a bound `MonitoredAgent` (`command-center-projection.source.ts:205`, `laneStartedAt`) reaches a lane node; manifest `startedAt` still feeds only `runState`/`updatedAt` (`:230-232`). `updatedAt`/`lastActivityAt` never used. PASS.
- Lane/agent mapping: `laneStartedAt` is keyed by `lane.laneId` in the same `.map` that fills `bound` with the same `agent`, and `work-projection.ts:204-220` reads it only when `bound.get(laneId)` is truthy. Claim set prevents two lanes taking one agent. No cross-wiring found. PASS.
- Missing/invalid/future omitted: `validStart` (`work-projection.ts:94-101`) drops undefined, non-finite, and `> now`. PASS (but see finding 1 for the `now` source).
- Arc only for running, clamped at 5 min: `command-scene-renderer.ts:551-569` (`state === 'running'`, `Math.min(1, Math.max(0, ...))/300_000`). `starting` excluded. PASS.
- rAF: no new timer or loop. `recomputeActive` (`:191-203`) already keeps rAF alive for any `running`/`starting` node because of the rotating state arc (`:538-541`). The elapsed arc is drawn inside the existing frame and does not change `active`; a timed running lane adds one stroke per frame. It does not by itself cause continuous animation; it rides on animation that already existed. Under reduced motion `active` is false, so no frames are scheduled and the arc is static at the last snapshot. PASS against "rAF only while something animates".
- Opaque ink, no getComputedStyle: uses `snapshot.inks.run`; no style reads in draw. PASS.
- Clock conversion `performance.timeOrigin + time` is correct for rAF DOMHighResTimeStamp.

3B
- `currentStats` (`command-center-page.component.ts:453-459`) looks up only the tab matching `coordinator.currentTabId()`; null when none. No per-card lookup. PASS.
- Null shows no fake zero: cost `formatCost(null)` gives an em dash; `knownSubtotalOf` handles partial pricing; tokens fall to an em dash when not a finite number; `~` only when `provisional` (cost also requires non-null). PASS.
- Speaker meter rendered only when `voiceState() === 'speaking'`, `role="meter"`, `aria-label="Speaker"`, min 0, max 100, `aria-valuenow` from `outputPercent` clamped 0..1 and NaN-safe. `[outputLevel]="page.store.outputLevel()"` binds the existing signal; no polling. PASS.

## Findings

1. Moderate - Future-start guard uses a clock that is up to 30 s stale.
   Evidence: `command-center-clock.ts` (30 000 ms interval); `command-center-page.controller.ts:150-153` passes `this.now()` into `input(root, now)`; `command-center-projection.source.ts:242` forwards it as `now`; `work-projection.ts:94-97` rejects `startedAt > now`.
   Scenario: a lane/agent starts after the last 30 s tick. The projection recomputes immediately (monitor signal changes) but with the old `now`, so its real `startedAt` is "in the future" and is dropped. The arc appears only after the next tick, up to 30 s (10% of the 5-minute scale) late, and is silently absent meanwhile.
   Fix: validate against a fresh clock, e.g. in the source `now: Math.max(now, Date.now())` for the field handed to projection (keep the coarse `now` for `runState`), or tolerate skew in `validStart` (`startedAt <= now + 30_000`, then let the renderer clamp negative elapsed to 0, which it already does at `command-scene-renderer.ts:553-557`). Add a spec with `now` older than `startedAt` by less than one tick.

2. Moderate - V15 "text gives actual elapsed time" is not delivered; the arc has no non-visual equivalent.
   Evidence: plan V15 row ("text gives actual elapsed time"); batch-3A-report Decisions row 3 defers DOM text; the canvas is `aria-hidden`.
   Impact: the only elapsed-runtime signal is a 1.5 px canvas arc. Assistive tech and reduced-motion users get nothing, and under reduced motion the arc is also frozen at the last snapshot time (can look stale/wrong).
   Fix: either land the elapsed text in the node detail panel (`command-node-detail.component.ts`) using the new `node.startedAt` in the same phase, or record explicitly in the plan that it moves to a named later batch. Do not close V15 without one of these.

3. Minor - `startedAt` of `0` or a negative finite value passes validation (`work-projection.ts:95-98`) and draws a full-circle arc. Require `startedAt > 0`.

4. Minor - Arcs also appear on standalone CLI agent nodes (`work-projection.ts:284` `startField(agent.startedAt)`), beyond the plan's "running lanes" scope. Behaviour is consistent and harmless, but SDK agents (no `startedAt` at `command-center-projection.source.ts` sdk mapping) will not show one, so equivalent running nodes look different. Confirm intent or document it.

5. Minor - The current-card figures row renders whenever `currentStats()` is non-null (`command-center-start.component.ts` template `@if (currentStats())`), so a tab with stats but neither cost nor tokens shows "Cost - Tokens -". Hide the row when both values are unavailable.

6. Minor - Speaker meter has no `aria-valuetext` and sits at all-empty bars if `outputLevel` stays 0 during `speaking` (e.g. a host that does not feed levels). Consider `aria-valuetext` and treating a flat-zero meter as decorative only if that case is real.

## Counts

Blocking 0, Serious 0, Moderate 2, Minor 4.
