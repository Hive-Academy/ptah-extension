Author: orchestrator (Claude, in-process)
Reviewer: codex lane
Revision reviewed: 2
Verdict: APPROVED

## Findings

1. **Blocking — §3 transition detection and renderer wiring.** The plan calls `update` only in `draw`, so two `setSnapshot` calls before the next rAF can collapse `idle → starting → idle` into `idle → idle`; the handoff pulse is lost. The first paint can also seed from the later snapshot and suppress a real transition. Evidence: `implementation-plan.md:83-100,128-132`; `command-scene-renderer.ts:112-140,184-187,321-335`. **Change:** observe every layout snapshot synchronously in `setSnapshot` without assigning a time, queue genuine state transitions, and emit at most one queued pulse during each painted frame using that frame's rAF timestamp. Seed from the first snapshot, including before its first paint. Specify how repeated transitions for one child are coalesced and bounded.

2. **Serious — §3 layout membership and overflow.** Step 3 prunes missing nodes, then step 4 can immediately queue and emit a `starting`/`running` child whose `parentId` is absent from the layout. The renderer draws no link in that case. The `lastStates` retention rule also treats a never-seen node arriving already `running` as a transition, while an earlier visible node returning from overflow is treated differently; the latter part is deliberate, but the former is not necessarily a handoff. Evidence: `implementation-plan.md:87-99,102-107,179-181`; `command-scene-renderer.ts:355-360,466-469`; `scene-layout.ts:17-33`. **Change:** require both endpoints and an actually drawn link when queuing/emitting, drop queued and live pulses synchronously when either endpoint leaves in `setSnapshot`, and define entering-layout behavior explicitly: seed an already-live newly visible node without a pulse unless an observed snapshot transition occurred. Add tests for missing owner and overflow exit/reentry.

3. **Serious — §3 pulse geometry and drawing state.** The renderer suppresses the Bézier for `tetheredIds` and draws a line from `tether.toX/toY` to `tether.fromX/fromY`. The plan says to use tether coordinates, but does not specify matching by `fromId` and `toId`, nor what to do if the tether is missing; a fallback Bézier would put a pulse on an undrawn link. The proposed `setLineDash([])` and `globalAlpha = 1` cleanup does not restore a caller's prior dash or alpha; the twinkle has the same alpha issue. Evidence: `implementation-plan.md:45-48,102-115`; `command-scene-renderer.ts:130-137,355-371,408-416`; `scene-layout.ts:43-50,554-571`; `command-scene-ripples.ts:79-105`. **Change:** resolve a tether by `fromId === childId` and `toId === parentId`, use its exact endpoints, and skip the pulse if a tethered link has no matching tether. Use `context.save()/restore()` around both overlays, including dash state. Test exact straight/Bézier coordinates, missing tether, and preservation of nondefault canvas state.

4. **Moderate — §4 test coverage.** The renderer tests cover idle and reduced-motion output, but do not assert the 33 ms ambient cap, backdrop reuse, snapshot changes before a frame, clearing on the reverse reduced-motion transition, or a hidden pause with state changes during the pause. These are binding behaviors. Evidence: `implementation-plan.md:139-157`; `context.md:20-30`; `command-scene-renderer.ts:176-187,237-275,321-347,635`. **Change:** add focused renderer tests for those cases, especially no extra idle frame, capped active paints, unchanged cached backdrop, synchronous clear on both reduced-motion transitions, and silent reseeding after resume. No broad suite is needed.

## Decisions

- The verified-facts table's factual claims match the cited code. Its renderer line references in rows 1, 3, 4, and 5 are stale: the corresponding code is now at `command-scene-renderer.ts:222-235`, `:321-335,635`, `:176-182`, and `:237-275,346-347`. Correct the references in revision 2.
- The existing 16 ambient particles follow the Bézier even for tethered nodes (`command-scene-renderer.ts:460-487`). That is existing behavior; the new delegation pulse should follow the link actually drawn at `:355-415`.
- The proposed twinkle overlay after cached-backdrop `drawImage`, guarded by `active`, meets the no-new-frames and reduced-motion requirements (`implementation-plan.md:50-59`; `command-scene-renderer.ts:231-235,321-347,635`).

## Round 1 re-review (revision 2)

Verdict: APPROVED

| Finding | Status | Reason |
| --- | --- | --- |
| 1 | Resolved | `observe` runs synchronously for every snapshot, seeds before the first paint, coalesces by child, and `update` emits at most one pulse per painted frame (`implementation-plan.md:113-149,169-181`). |
| 2 | Resolved | Both endpoints and a drawn link are required; missing links synchronously clear pending and live pulses. Decision 9 explicitly accepts one possible first-entry overflow pulse because the renderer receives only the visible layout (`implementation-plan.md:98-129`; `decisions.md:13`). |
| 3 | Resolved | Tethers match `fromId` and `toId`, use the rendered endpoints, and unmatched tethered links get no pulse; both overlays use canvas `save`/`restore` (`implementation-plan.md:51-54,98-111,151-162,209-211`). |
| 4 | Resolved | Focused renderer tests now cover the ambient cap, backdrop reuse, pre-paint snapshots, both reduced-motion transitions, and hidden resume (`implementation-plan.md:212-224`). |

New findings: None.
