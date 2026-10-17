# M1 Electron motion soft-assert diagnosis

Sources: `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` (the recorder), `measurements/m0.json` and `measurements/m1.json` (102 windows each, probe version 3), and `.ptah/tmp/m1-run.log`. JSON `null` can represent serialized `NaN`; the source expression resolves that ambiguity. No Electron run was made for this diagnosis.

| Group | Failed asserts | Class | Fix needed? |
| --- | ---: | --- | --- |
| A. Rail delta | 101 | RECORDER defect (two assertion mistakes) | Yes, recorder |
| B. S2 entrance event | 10 | RECORDER defect | Yes, recorder |
| C. Reduced-motion slot targets | 5 | RECORDER defect | Yes, recorder |
| D. S7 pointer and focus | 3 | PRODUCT regression; exact hit target remains unrecorded | Yes, product and diagnostic probe |
| E. New long tasks | 15 | EXPECTED by plan U2 **if render-caused**; attribution unproved | Yes, recorder assertion; investigate product cost separately |

## A. Rail delta

**Evidence and cause.** `snapshot()` returns `undefined` for a missing rail (`perf.spec.ts:388-392`), while `delta()` checks only `!== null` and evaluates `Number(undefined) - Number(undefined)` (`:457`). The in-memory result is `NaN`, serialized as `null`; the assert at `:647` does not exclude it. `m1.json` has 64 null rail deltas and 38 numeric ones. Of the numeric values, 37 are nonzero and one is zero, explaining the 101 failures. M0 likewise has 64 null and 38 numeric. The rail metric counts geometry changes through `canvas-rail-board.component.ts:495-514`; a focus or split action may change it. S8 non-reduced split open/close rows are **2 in both M0 and M1**, so zero is an invalid invariant. Plan `implementation-plan.md:45-47,145-146,921` allows split creation and instantaneous closure. The broader `context.md:13` no-rail-shift goal needs an actionable layout-shift measure, not this cumulative geometry counter alone.

**Minimal recorder fix.** At `:390-391`, return `?.getAttribute(...) ?? null`; at `:457`, require finite numeric endpoints. At `:647`, compare each finite delta to its matched M0 row (or report increases separately) rather than zero. Offline recomputation: 38 comparable pairs; **31 equal, 3 lower, 4 higher**. Higher: `retained-1` 3→4, `rapid-focus-five` 8→9, `reduced-split-close-1` 2→3, `reduced-split-close-2` 2→3. Thus normalization plus an `<= M0` comparison would still fail four rows; the product does **not** wholly pass this proposed assertion offline. Check whether those four extra counted geometry changes are visible shifts using `layoutShiftAll`/frames before treating them as regressions.

## B. S2 retained entrance

**Evidence and cause.** The probe accepts only the literal animation name `ptahTurnEnter` (`perf.spec.ts:154-158,177-190`), and the assertion repeats that exact comparison (`:661-664`). Angular scopes the component CSS keyframe in the renderer: all ten M1 S2 rows have **six** +50 ms animation targets ending in `_ptahTurnEnter` and carrying `.chat-msg-slot.ptah-turn-enter`, but zero recorded entrance events. M0 has zero such targets for all ten. The product marks slots in `transcript-session-entrance.ts:92-113`, with the rule in `chat-transcript.component.css:1-9`; this matches plan D4/U5 (`implementation-plan.md:230,908,918`).

**Minimal recorder fix.** Normalize animation names with a narrow match such as `name === 'ptahTurnEnter' || name.endsWith('_ptahTurnEnter')` in both the event listener and assert; keep the target/class check. Recompute from saved JSON: the +50 ms presence proxy passes **10/10**, six scoped turn animations per S2 row (M0 0/10). The exact `animationstart` count and `visibleAtStart` cannot be recovered: the defective probe discarded those events. A corrected event assertion needs a later run. Do not infer event timing from the +50 ms snapshot.

## C. Reduced motion

**Evidence and cause.** `sample()` uses `document.getAnimations()` without restricting to CSS animations or a name (`perf.spec.ts:200-208`); `:657-659` then counts *every* target whose class string contains `chat-msg-slot`. In the five failing M1 rows, the returned target strings end with `:` (no `CSSAnimation.animationName`), including the six `.ptah-turn-enter:` targets in `reduced-retained-4`. The explicit reduced-motion product rule sets the turn/pane animation to none (`chat-transcript.component.css:15-20`); the router also skips reduced-motion transitions (`surface-view-transitions.ts:25-34,83-95`), as required by plan `implementation-plan.md:120,230,352-353`. Counts of all slot targets: M1 `reduced-round-3-canvas` 54, `reduced-round-10-canvas` 54, `reduced-retained-4` 6, `reduced-split-open-1` 108, `reduced-split-open-2` 108; corresponding M0 counts are 0, 0, 0, 270, 270. The two M0 split rows already show that counting arbitrary slot effects cannot test the new turn entrance.

**Minimal recorder fix.** Have `sample()` record animation type and name, or filter for a `CSSAnimation` whose normalized name is `ptahTurnEnter` and whose target is a message slot. Assert that count is zero for reduced-motion rows. Offline recomputation from the saved target-name suffix is **0 turn animations in every reduced-motion row in both M0 and M1**; all five failures disappear. Existing class marks under reduced motion do not themselves mean motion played.

## D. S7 pointer during page transition

**Evidence and cause.** `clickCenter()` sends raw mouse clicks at bounding-box centers (`perf.spec.ts:532-536`); S7 clicks Analytics, waits 80 ms, then clicks Tasks and conditionally its button (`:564-580`). The capture listener records receipt by the event target (`:565-572`), and the assert checks three receipts plus M0 focus (`:636-645`). M0 recorded Analytics/Tasks/button = **1/1/1**, click offsets about 7/128/211 ms, final focus on `tasks-view-mode-list`, and final surface Tasks. M1 recorded **1/0/0**, offsets about 15/334 ms (no third click), final focus BODY and surface Analytics. M1 was still in a view transition at the delayed +50/+100/+400 samples; the first transition animation-start events were logged near +342 ms and ended +461–527 ms. Its one 82 ms long task began near +120 ms, so the intended 80 ms interval was not maintained. These are product-visible missed input/focus outcomes, though the recorder lacks the actual hit element of the second click.

`styles.css:758-760` **already** has `::view-transition { pointer-events: none }`; adding that rule again is not a fix. `surface-view-transitions.ts:83-95` calls `skipTransition()` only for same-surface or reduced-motion navigations, not for the active cross-surface transition. Plan assumption A2 explicitly prescribes a fallback if S7 receipt fails: have `SurfaceTransitionTracker` skip its active transition on capture-phase `pointerdown`/`keydown` (`implementation-plan.md:178-185`). Implement that in `surface-view-transitions.ts:37-80`, with listener cleanup on destroy and only while busy. Preserve cross-surface transitions when no new input arrives. Because hit testing happens before a capture listener, also record the actual `pointerdown` and `click` targets, computed pointer-events on the pseudo overlay, transition state, and navigation result in the next S7 probe. Those data would distinguish an overlay swallowing the click from a late or aborted route update. The current JSON proves receipt failure, not which mechanism caused it. No offline correction of the product outcome is possible.

## E. New >50 ms long tasks

**Evidence and cause.** `perf.spec.ts:444-463` collects entries in the 600 ms click window and buckets them by click; `:653` fails any M1 maximum >50 ms when M0 is <=50 ms, regardless of task stack or motion attribution. All **15** rows below have their new long task in a click bucket (one entry each). Values and buckets were recomputed from the two JSON files; `yes` means `longTasks.perClick` contains the entry.

| Row | M0 max ms | M1 max ms | In click bucket? |
| --- | ---: | ---: | --- |
| non-retained-2 | 0 | 67 | yes, click-0 |
| reduced-round-1-tasks | 0 | 147 | yes, click-0 |
| reduced-round-2-tasks | 0 | 226 | yes, click-0 |
| reduced-round-3-tasks | 0 | 190 | yes, click-0 |
| reduced-round-4-tasks | 50 | 212 | yes, click-0 |
| reduced-round-5-tasks | 0 | 161 | yes, click-0 |
| reduced-round-6-tasks | 0 | 151 | yes, click-0 |
| reduced-round-7-tasks | 0 | 124 | yes, click-0 |
| reduced-round-8-tasks | 0 | 155 | yes, click-0 |
| reduced-round-9-tasks | 0 | 155 | yes, click-0 |
| reduced-round-9-analytics | 0 | 66 | yes, click-0 |
| reduced-round-10-tasks | 0 | 209 | yes, click-0 |
| pointer-during-transition | 0 | 82 | yes, click-0 |
| focus-restoration | 0 | 54 | yes, click-0 |
| split-close-2 | 0 | 54 | yes, click-0 |

The ten reduced-motion Tasks rows (plus reduced Analytics) cannot be caused by *running* the new page/turn animation: reduced motion skips the router transition (`surface-view-transitions.ts:25-34,83-95`), and the targeted CSS disables it. Rendering, route activation, the probe's trace/screencast overhead, or concurrent work remain candidates. A click bucket means temporal proximity, not a stack attribution. Plan U2 explicitly says to report render-caused >50 ms tasks and fix them later (`implementation-plan.md:22-25,798,905,938`); motion-caused excess still fails this task. The M0 build predates PR #739 while M1 includes its resync changes (`decisions.md:12`), so PR #739 is a **plausible confounder** for render work, especially `non-retained-2`, but no saved task stack proves that cause. `reports/batch-CR739.md:5-8` identifies the changed finalization/replayer paths. The near-systematic reduced Tasks spike is less specifically explained by resync and warrants trace/stack attribution. Treat `pointer-during-transition` as linked to D until separated. 

**Minimal recorder fix.** Keep the 15-row report but gate the soft failure on evidence of a motion-code stack or a matched baseline with PR #739 included, rather than the unconditional max comparison at `:653`. The JSON alone cannot recompute a *motion-attributed* pass/fail: it has timings and trace summaries but no JS stack for these entries. Offline recomputation of the current assertion is **15 failures**, as tabulated. No product performance edit is justified by these measurements alone; profile the reduced Tasks route and `non-retained-2` after the causal baseline is aligned.

## Decisions

- **Recorder diagnosis, reversible:** normalize scoped `ptahTurnEnter` names and distinguish CSS animation names from other effects. Evidence: all ten M1 S2 rows have six named targets but zero recorded events; all five reduced-motion failures have zero named turn targets.
- **Rail criterion, reversible:** represent missing counters as `null` and compare finite deltas with M0. Evidence: 64 absent rows, 38 comparable rows, and S8 non-reduced split deltas of 2 in both runs. Four increases remain for review.
- **Pointer fallback, reversible:** follow plan A2's active-transition input cancellation, then capture actual hit targets to confirm mechanism. Evidence: S7 receipt/focus failure despite the existing pseudo-element pointer-events rule. This is a recommendation for the implementer, not an edit in this read-only diagnosis.
- **Long-task attribution, reversible:** report all 15 and defer render-cost fixes under U2 until a matched post-#739 baseline or stack evidence isolates the source. Evidence: `decisions.md:12`, `implementation-plan.md:905`, and the reduced-motion concentration above. Attribution remains unknown.
