# Code Logic Review - TASK_2026_708_bff3

Review family: anthropic (reviewer) vs codex (implementer)

Scope: static read of `command-scene-twinkle.ts`, `command-scene-pulses.ts`, the diffs of
`command-scene-decoration.ts`, `command-scene-renderer.ts`, `command-scene-renderer.spec.ts`, and
the four spec files, against `implementation-plan.md` sections 2-4 and the `context.md` binding
decisions. No checks were run (per instruction).

Score: 8/10. Verdict: APPROVED. There are no Blocking or Serious findings. Two Moderate findings
are test-strength gaps that can be fixed in the one codex fix round.

## Verified correct (with evidence)

- Seeding: first `observe` after construction or `clear()` only records states
  (`command-scene-pulses.ts` observe, `this.seeded &&` guard, `seeded = true` at the end).
- Silent observe: the renderer passes `this.hidden || snapshot.reducedMotion`
  (`command-scene-renderer.ts:125`). States are still recorded, so there is no replay on resume.
- Idle -> starting -> idle between paints: `observe` runs synchronously in `setSnapshot` and the
  handoff stays in `pending`. The link is still present, so the next painted `update` emits it.
  Coalescing is per child (`pending.includes`). Covered by pulses spec "retains a handoff ...".
- Overflow re-entry: `lastStates` is not pruned by layout, so a node that returns still live
  does not re-queue. A node first seen already live queues once, which the plan accepted.
- One pulse per link and the global cap: `update` emits at most one per call, skips children that
  already have a live pulse, and requires `pulses.length < MAX_PULSES` (6). `MAX_PENDING` (12)
  drops the oldest entry.
- Clear paths: theme or reducedMotion change clears (`renderer.ts:121-124`), `setHidden(true)`
  clears and then silently re-seeds (`:186-189`), and `destroy` clears (`:218`). After a clear
  `seeded` is false, so the following non-silent `observe` only seeds. There is no burst after a
  hidden pause. `lastUpdate` is reset, so there is no stale-time emission.
- Twinkle gating: drawn only under `if (this.active)` (`renderer.ts:361`), inside `draw`, which is
  after the ambient 33 ms early return (`:338-346`). An idle single-root scene has `active` false
  (`recomputeActive`), so it gets no twinkle and no new frames.
- Pulses are updated and drawn only under `if (this.active)` (`:502-505`). Time is the rAF
  `time` argument only.
- Geometry: the bezier in `pointOn` matches the renderer link
  (`renderer.ts:376-384`: control points `(parent.x, midY)` and `(node.x, midY)`). The tether line
  runs `to` (owner) -> `from` (worker), matching `:424-428`. `linkFor` returns null for a tethered
  worker without a matching owner tether, which matches `tetheredIds` skipping the bezier
  (`:371`).
- Canvas state: both overlays wrap their drawing in `save()/restore()`
  (twinkle `:19,:36`; pulses `draw`). Twinkle's dot positions use the same `width`/`height` as the
  backdrop (`drawSceneDecoration(context, width, height, ...)`, `renderer.ts:279-286`).
- Strict TS: no `any`, `@ts-ignore`, `as unknown as` or `console.*` in the new files. Pulses use
  `import type` from the renderer, so the circular reference is erased. No lib index export was
  added.

## Findings

1. Moderate - Reduced-motion pulse tests do not exercise the guards they are named for.
   - Evidence: `command-scene-renderer.spec.ts`, "suppresses both overlays with reduced motion":
     the first snapshot is the seed, so no pulse is ever queued and the assertion holds even
     with the `active` guard and the silent flag removed. The `it.each([false, true])` case with
     `initial=false` asserts no pulse is drawn at 1032, but `active` is already false under
     reduced motion, so nothing is drawn whether or not `pulses.clear()` ran
     (`renderer.ts:121-124`). Only the `initial=true` direction discriminates.
   - Fix: in the `initial=false` case, after the reduced-motion snapshot call
     `renderer.setSnapshot({ ...snapshot('starting'), reducedMotion: false })`, paint at 1048, and
     assert no `arc` with radius 2.6 or 7 (a live, uncleared pulse born at 1016 would still draw).
     Make the "suppresses" test start from an idle non-reduced snapshot, then send
     `{ ...snapshot('starting'), reducedMotion: true }`, so it covers the silent path.

2. Moderate - The hidden-pause test does not prove the in-flight clear on `setHidden(true)`.
   - Evidence: "does not replay a hidden delegation on resume" hides before any pulse exists. If
     `this.pulses.clear()` at `renderer.ts:187` were removed, the test would still pass, because
     the silent re-observe alone prevents a queue.
   - Fix: add a case where a pulse is live (snapshot idle, paint, `snapshot('starting')`, paint
     at 1016), then `setHidden(true)`, `setHidden(false)`, paint at 1100, and assert no arc with
     radius 2.6. Without the clear, the pulse (age 84 ms) would still draw.

3. Minor - `observe` does repeated linear scans on every `setSnapshot`.
   - Evidence: `linkFor` runs `tethers.find` and `tethers.some` for each node
     (`command-scene-pulses.ts:30,38`), and `pending.includes` runs per live transition. That is
     O(nodes x tethers) on a hot path, since `setSnapshot` fires on every store tick.
   - Fix: build `const tetherByFrom = new Map<string, SceneTether[]>()` once per `observe` and
     pass it to `linkFor`. Behaviour is unchanged.

4. Minor - Pulses can play for a node that is already idle again, and for a node that started
   while off-layout.
   - Evidence: `update` emits any `pending` id that still has a link, without re-checking state.
     The plan accepts both cases (idle -> starting -> idle between paints; overflow re-entry).
     This is a note, not a defect. Do not change it unless the user wants stricter semantics.

5. Minor - Formatting.
   - Evidence: `command-scene-pulses.ts` draw loop packs several statements per line
     (`context.beginPath(); context.arc(...); context.fill();`) and has lines over 80 columns.
     `command-scene-renderer.spec.ts` also has long lines (the save/restore mock, the
     `renderer.setSnapshot({ ...data, ... })` line). Prettier lint will likely flag these.
   - Fix: run `npx prettier --write` on the changed files. This is a style item for the style
     reviewer, so it is not scored here.

6. Minor - Test coverage gaps.
   - Evidence: no renderer-level test that the twinkle uses the light-theme ink. This is covered
     at unit level only (`twinkle.spec` light alpha ceiling). There is no tether-path pulse test
     at renderer level. The pulses spec has a "requires both endpoints and a drawn link" test,
     but I did not see assertions on `pointOn` bezier mid-points.
   - Fix (optional): assert one mid-flight `arc` position on the bezier at t=0.5 (x between the
     owner and the worker, y = midY).

## Five logic questions

1. Silent failure: none found. A skipped canvas context (`Canvas 2D context unavailable`) is
   existing behaviour. `observe` mutates state before `prepareBackdrop` may throw, which is
   benign.
2. User action: toggling theme or reduced motion clears pulses and re-seeds, so there is no
   replay. Hide/show makes no burst. A tab throttled by rAF but not `hidden` resumes with at most
   one pulse per pending child, bounded by `MAX_PENDING` and `MAX_PULSES`.
3. Input data: a first-seen live child pulses once (accepted by the plan). A node that starts
   while off-layout and later returns live pulses once. Non-finite `time` is guarded in
   the twinkle.
4. Dependency failure: time going backwards clears live pulses (`update`). Nodes leaving the
   layout prune pulses and pending synchronously in `observe`.
5. Missing: nothing required. See findings 1 and 2 for test strength.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Twinkle only while active, inside the 33 ms cap, 8-16 dots, backdrop cached | COMPLETE | none (12 dots) |
| Idle single-root gets no new frames | COMPLETE | none |
| Reduced motion: no twinkle, no pulses | COMPLETE | test strength (finding 1) |
| One pulse per link, global cap, age pruning | COMPLETE | none |
| Clear on theme and reducedMotion both ways, hide, leave-layout | COMPLETE | hide-clear test (finding 2) |
| rAF time only, emitter pattern, new logic in new files, strict TS | COMPLETE | none |

## Verdict

Recommendation: APPROVE. Fold findings 1 and 2 (and the finding 5 Prettier pass) into the one
codex fix round. Confidence: HIGH on the runtime logic (static only), MEDIUM on test and lint
outcomes, which were not run.
Top risk: tests that would still pass if the reduced-motion or hide clears regressed.

## Re-review (fix round)

Static only; nothing was run. Scope: `batch-fix-report.md`, `command-scene-pulses.ts`,
`command-scene-pulses.spec.ts`, `command-scene-renderer.spec.ts`.

| Finding | Result | Evidence |
| --- | --- | --- |
| 1 | Resolved | `it.each` false case now calls `setSnapshot({ ...snapshot('starting'), reducedMotion: false })` and paints at 1048, asserting no 2.6 or 7 arc. With the reducedMotion `pulses.clear()` removed, the pulse born at 1016 would still draw at 1048, so the test fails. The "suppresses" test now sends a live transition after an idle seed. It still passes without the silent flag (the clear re-seeds anyway), but the twinkle assertion exercises the `active` guard. |
| 2 | Resolved | New "clears an in-flight pulse when hidden" asserts a 2.6 arc exists at 1016, then hide/show, then none at 1100. Without the clear at `renderer.ts:187` the pulse (age 84 ms) would still draw, so it fails. |
| 3 | Resolved, behaviour unchanged | `linkFor` now takes a `tetherByFrom` map built once per `observe`. Matching tether by `toId` gives a line. A worker with any tether and no owner match gives null (`if (workerTethers) return null`), because the map entry only exists with at least one tether. Otherwise a bezier. This is equivalent to the old `find` / `some` logic. |
| 5 | Resolved | No multi-statement lines in `command-scene-pulses.ts`; no lines over 100 columns in the new files. |
| 6 | Resolved, weak (Minor) | The midpoint test expects `(60, 50)` at 360 ms. At t=0.5 a symmetric cubic bezier equals the straight-line midpoint, so a regression from bezier to line geometry would not be caught. Optional fix: draw at 180 ms (progress 0.25, eased t=0.125) and assert the bezier x (about 10 + 100 * 0.0 variance from the control points) differs from the linear x. |

New Minor note (not blocking): finding 6's test should use a non-symmetric sample point as above.

Final verdict: APPROVED. Score 8.5/10. No Blocking or Serious issues remain. The orchestrator
should still run the project checks.
