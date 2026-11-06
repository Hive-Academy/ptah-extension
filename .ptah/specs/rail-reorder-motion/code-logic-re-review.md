# Code logic re-review: rail reorder motion

## Verdict

**REVISE.** Defects 1, 2, 3, 5, and 6 are fixed. Defect 4 remains for an interrupted entry fade at exactly zero opacity. No additional logic defect was established in the bounded correction.

## Defects 1–6

| Defect | Fixed? | Evidence |
| --- | --- | --- |
| 1. Scroll clamping or anchoring gives wrong slide delta | **Yes** | `canvas-rail-flip.ts:38,49-54` stores and compares viewport `rect.top`, without `scrollTop`; `canvas-rail-flip.spec.ts:18-33` checks the viewport delta. |
| 2. Equal layouts restart slides | **Yes** | `canvas-rail.component.ts:519-521,531-533` derives a string from group keys, ordered tab IDs, and finished expansion. Angular's computed signal uses value equality for strings, so a new input identity yielding the same string does not rerun the effect. |
| 3. Detached or overwritten animations escape cleanup; stale callbacks play | **Yes** | `canvas-rail-flip.ts:33-41,70-78,82-85` cancels and clears all tracked animations, including detached targets, and cancels the previous animation before replacement. `canvas-rail.component.ts:542-548` rejects playback from older generations. |
| 4. Interrupted fade snaps to full opacity | **No** | `canvas-rail-flip.ts:35-38` reads computed opacity only for a running animation, but `Number.parseFloat(...opacity) || 1` converts valid `0` to `1`. `canvas-rail-flip.ts:64-69` then omits opacity keyframes, so a fade cancelled at its starting frame jumps to full opacity. Use `Number.isNaN(parsed) ? 1 : parsed` to preserve zero; add an interruption test at opacity zero. |
| 5. Async initial restore fades every card | **Yes** | `canvas-rail.component.ts:546-549` skips playback when `first.size === 0`, even if the initial render callback has set `flipReady` (`:402-406`). |
| 6. Interleaved reads and animation cancels force repeated layouts | **Yes** | `canvas-rail-flip.ts:33-40` finishes all computed-style and rectangle reads before `cancel()`; there are no style writes inside the read loop. |

## New defects

None confirmed. The generation guard at `canvas-rail.component.ts:542-548` discards an older render callback only after a later effect has captured its own snapshot and scheduled playback; an equal layout does not create a later generation (`:519-521`). The computed-style read at `canvas-rail-flip.ts:35-38` is limited to tracked animations, and a newly created card receives entry opacity zero at `:53-55`. A moved, fading card retains both its measured transform delta and captured opacity (`:50-55,65-69`).

## Five logic questions

1. **Silent failure:** At opacity zero, the fade resumes as fully opaque without an error (`canvas-rail-flip.ts:35-38,64-69`).
2. **Unexpected user action:** Reordering during the first frame of an entry fade can make that card pop in (`canvas-rail-flip.ts:35-38`).
3. **Wrong input:** The numeric opacity value `0` is mistaken for a missing parse result (`canvas-rail-flip.ts:36`).
4. **Dependency failure:** If Web Animations is unavailable, `play()` returns without throwing (`canvas-rail-flip.ts:60-61`); this is an intentional no-motion fallback.
5. **Requirement gap:** The existing test does not cover interrupted opacity zero or a moved card mid-fade (`canvas-rail-flip.spec.ts:17-102`).

## Verification and limits

Read the helper and spec in full, plus the component template and effect. No tests or builds were run, as requested. The supplied `npm run verify -- -p @ptah-extension/canvas` result is reported as passing. Scoped `ptah_get_diagnostics` reported TS4111 at `canvas-rail-flip.spec.ts:11-12,73-74,85` (dataset dot access) and unrelated sibling errors; its compiler context differs from the passing verification, so these diagnostics are not treated as a new runtime logic defect. Skill loading was unavailable in this lane; no skill-loading tool was listed.

## Decisions

- **Verdict:** REVISE because the requested interrupted-fade behavior still fails at a valid opacity value. The fix is local and reversible.
