# Code Logic Review - M1 fix (TASK_2026_683)

Review family: reviewer: Claude; implementer: codex

Score: 7/10. Verdict: APPROVED (no Critical or Serious findings).

Scope: `surface-view-transitions.ts` and its spec (whole files), the perf-spec diff (attribution, probe, asserts, persist), plan :170-186, :796-815, :905, decisions O14/O15. Nothing was run: no Jest mutation check (the listener body is the only thing that calls `skip`, so the three skip tests cannot pass without it), no Electron. Remaining uncertainty is runtime-only (finding 1).

## Product

The fix matches plan A2. `skipOnInput` uses `this.current?.`, so it is a no-op when idle or settled. `finished` still resolves after a skip, so `settle()` runs once and queued `afterTransition` callbacks run once. The router update callback still runs after a skip. Chromium queues it as a task, so it is not dropped. One shared instance, guarded by `listening`, with removal in `destroyRef.onDestroy`. SSR is unaffected: `track()` only runs client-side after `onViewTransitionCreated`. The new tests fail without the fix: skip count 1, none before or after settle, one listener of each type, removal on destroy.

1. Moderate, `surface-view-transitions.ts:64-65`, unverified at runtime. A synthetic Playwright click sends pointerdown and pointerup back to back. If the skip lands before the update callback has run, the old DOM can still be the hit target at pointerdown. The new DOM then arrives in a later task, so the click can land on a node that was replaced. Real users have roughly 50-100 ms between the two events, so this is fine for them. The S7 re-run is the proof. Do not read a green unit spec as evidence that the click reaches the target. Fix if S7 still loses the click: also call the skip from `click` capture, or wait for `updateCallbackDone`.
2. Minor, `:65`. Any `keydown` skips the transition, including modifier-only keys and auto-repeat (`event.repeat`). It only drops the animation, so it is acceptable. Typing in the composer during the 200 ms window loses the animation, with no data effect. Ignoring modifier-only keys and repeats would be cheap.
3. Minor. `skipTransition()` rejects `ready` with AbortError. The existing comment says dev builds log this. It now happens on every user-interrupted navigation in dev. There is no production effect.
4. Minor, spec. There is no test that an `afterTransition` callback queued before an input skip still runs exactly once after `finish()`. That is the documented invariant.

## Recorder

Rail delta is fixed: `snapshot()` returns null and `delta()` (`perf.spec.ts:529`) is null unless both ends are finite. `m0RailShiftsDelta` is read with `?.`/`??` from the loaded M0 windows (`:544`). `probeVersion` stays 3 and the probe change is additive, so M0 still loads and compares. A missing M0 row still fails the "M0 record" assert. The scoped `_ptahTurnEnter` name is normalized once in the sample (`:215`) and in `recordEntrance` (`:165`). The reduced-motion filter on `type === 'CSSAnimation' && name === 'ptahTurnEnter'` therefore matches the scoped name and is not vacuous. A null `focusSwapsDelta` now fails `toBe(1|5)` where it used to be NaN, which is correct. Rail "0" became a report (O15). The evidence in O15 (counter rises with `layoutShiftAll` unchanged) is sound. The S8 and split rows now compare no-input `layoutShift` against M0, which is stricter than before and consistent with the plan.

5. Moderate, `perf.spec.ts:331-371, 731`. The motion long-task gate can pass without checking anything. `classification === 'motion'` needs a JS frame whose function name or url matches the regex (`:366`). Work caused by view transitions or CSS animations (snapshot capture, style recalc, animation frames) has no JS frame, so it is classed `render` or `unknown` and never fails. Attribution also needs the trace to contain the `ptah-motion-trace-anchor` event (`:335`) and `FunctionCall`/`EvaluateScript` children with `functionName`/`url`. If the trace categories omit user timing, or the dev build's bundled urls hide the source file names, every task is `unknown` and the assert is green. The report writes a note, but only when `stackAvailable` is false (`:430`). U2 allows render-caused excess to be reported, but a silent `unknown` is not a render finding. Fix: report the count of new >50 ms tasks by class and leave a visible marker (or fail soft) when any new >50 ms task is `unknown`. Reviewers must read `longTaskReport` before signing M1.
6. Moderate, `:366`. The regex does not include the stacks the plan names (`ChatView`, `ChatTranscript`, lane view). It also lacks `onViewTransitionCreated`. Add them or match on the source file names of those components.
7. Minor, `:724-736`. Indentation is inconsistent in the edited block (cosmetic, route to style).

## Plan pass-criteria check

- Long-task criterion is weakened only as far as O15 records, plus the gap in findings 5 and 6.
- "Rail shifts 0" is changed to a report (O15). "Layout shift 0" stays as at-most-M0 (the same as before this change).
- No NaN or undefined path remains in rail or focus deltas.
- Unchanged: S7 click receipt asserts. `finalSurface` and `inputEvents` are now captured for S7, which helps with finding 1.

## Re-review (fix round 1)

Findings 4-7 checked in the diff; findings 1-3 not re-reviewed.

- 4 fixed: the new spec queues `afterTransition` after `track`, skips on pointerdown, then asserts one callback after `finish()` and still one a microtask later.
- 5 fixed: new >50 ms tasks classed `unknown` now fail a soft assert when M0 max <= 50 ms. `longTaskNeedsReview` is also written into the report.
- 6 fixed: the motion regex now covers ChatView, ChatTranscript, CanvasLaneView, CanvasRailBoard, onViewTransitionCreated and the component urls.
- 7 fixed: indentation is consistent.
- No regressions seen.

Verdict: APPROVED. Score 8/10.

## Re-review (S7 CSS fix)

Verdict: APPROVED (8/10). No Serious findings. Nothing was run; this is CSS and code reading only.

- Mechanism correct (`styles.css:758-761`). The root group existed only because `html` had the implicit root name, and its pseudo layer overlays the page, which matched the run-2 symptom (target = HTML). With the root name removed, only `ptah-surface` is captured. Navbar, rail and dock stay live DOM. `::view-transition` keeps `pointer-events: none` (:763).
- Timing OK. `track()` adds `ptah-vt-active` synchronously in `onViewTransitionCreated`, before the next-frame old-state capture. It is removed on settle. The existing surface naming rule relies on the same timing.
- VS Code unchanged. `:has(.ptah-vt-surface)` is false there (the class is only used in `electron-shell.component.ts`), so the root cross-fade (plan rows 226-227) stays.
- The `(root)` animation rules at :779-793 match nothing in Electron; they are harmless dead CSS.
- Clicks inside the surface: the A2 pointerdown/keydown skip still covers them. Reduced motion is unchanged: transitions are skipped before `track()`, and :834 sets animation none.
- Minor (visual): with root uncaptured, the live background shows through while old/new fade at <1 opacity. Confirm the surface or html background is the same colour and that there is no flash in the frame strip. The surface group does not overlap the navbar, so there is no z-order risk. `:has()` needs Chromium 105 or later, which Electron satisfies.
- Minor: add a CSS or spec guard that `.ptah-vt-surface` is only set in the Electron shell.
