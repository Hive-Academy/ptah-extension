# M1 summary — TASK_2026_683_3c29 (Electron 1800×1000, probe 3)

**Verdict: M1 run 5 passes every soft assert.** `m1.json` is complete and contains 102 windows. The measured focus and click receipts match M0; `longTaskNeedsReview` and `railShiftReport` are both empty. The comparison has the O7 baseline caveat below.

Source: `measurements/m0.json` and `measurements/m1.json` (final M1, run 5). Both have `complete: true`, `probeVersion: 3`, and scenario counts S1 30, S2 10, S3 5, S4 3, S5 2, S6 44, S7 4, S8 4 (`$.windows[*].scenario`). Earlier runs are `m1-run1.json` through `m1-run4.json`.

## Q1. Motion duration and visual stability

The JSON has no generic transition-duration field. Durations below pair `start` and `end` entries with the same name and selector in `$.windows[*].viewTransitionEvents` or `$.windows[*].splitPaneEvents`; values are medians, with observed ranges. M0 has no entries in either event array, so its duration is **unmeasured**, rather than zero. `$.windows[*].entrance.events` records only `start`, so it cannot establish full turn-entrance duration.

| Scenario | M0 transition duration | M1 measured transition duration | Max `layoutShift` M0 → M1 | Max `layoutShiftAll` M0 → M1 |
| --- | --- | --- | ---: | ---: |
| S1 page round trips (30) | Unmeasured | Surface group 190.25 ms (184.2–204.3; 30 paired events); `ptahPageOut` 123.05 ms (116.4–140.7) | 0 → 0 | 0 → 0 |
| S2 retained swaps (10) | Unmeasured | Turn entrance starts recorded in all 10; six starts per window, configured `delayMs` 0–140; end unmeasured | 0 → 0 | 0 → 0 |
| S3 non-retained (5) | Unmeasured | Six turn-entrance starts in one window; end unmeasured | 0.013280 → 0 | 0.013280 → 0 |
| S4 first open (3) | Unmeasured | Six turn-entrance starts per window; configured `delayMs` 0–140; end unmeasured | 0.014867 → 0.000172 | 0.019525 → 0.000172 |
| S5 rapid (2) | Unmeasured | One view transition starts but has no paired end; turn-entrance starts recorded; duration unmeasured | 0 → 0 | 0 → 0.000110 |
| S6 reduced motion (44) | Unmeasured | No recorded view-transition, split-pane, or turn-entrance events | 0 → 0 | 0.038670 → 0.038670 |
| S7 input/focus (4) | Unmeasured | One complete surface-group event: 187.1 ms; two `ptahPageOut` events: 123.2–151.1 ms (median 137.15) | 0 → 0 | 0 → 0 |
| S8 split pane (4) | Unmeasured | Two paired pane-entrance events: 141.5 and 177.9 ms (median 159.7); closes have no pane-entrance pair | 0 → 0 | 0.047239 → 0.047239 |

`layoutShift` is the visible-shift gate used in O15; all M1 scenario maxima are at or below M0. `layoutShiftAll` includes shifts that the gate excludes. In S8, `split-open-1` rises from 0 to 0.035950 and `split-open-2` from 0.035334 to 0.035792 in `layoutShiftAll`, while both retain `layoutShift: 0`. The close windows remain at 0.047239. Report this difference alongside the passing gate; do not describe all S8 shift measurements as improved. JSON paths: `$.windows[*].layoutShift`, `$.windows[*].layoutShiftAll`, and `$.windows[*].name`.

## Q2. First-frame scroll and entrance

M0's summary documented the first-frame top-position jump; B7 was therefore needed. In `$.windows[*].scrollFrames`, a zero `scrollTop` in rAF 1 or 2 followed by a positive value occurs in M0 for S3 1/5, S4 3/3, and S6 reduced retained 3/10 windows. In final M1 it occurs in **0/5, 0/3, and 0/10**, respectively. S4 `first-open-1` is illustrative: M0 rAF scroll tops are 6103 → 0 → 965 px; M1 is 5839 → 971 → 971 px, with the new transcript at its bottom by rAF 2. The M1 turn entrance is observable at `$.windows[*].entrance.events`: S2 has 60 starts across 10 windows and S4 has 18 across three, with indices 0–5 and configured delays 0–140 ms. This fixes M0's missing entrance-event instrumentation, but the JSON does not pair animation ends or by itself establish a painted-frame duration. S3 windows 2–5 are labelled non-retained but the runner logs `targetRetained=true`; interpret that scenario accordingly.

F7's empty-state flash is absent in both recordings: `$.windows[*].samples.{at0,at50,at100,at400}.blank` is `false` for every S2–S5 sample in M0 and M1. As in the M0 summary, these fixtures have preloaded history and do not exercise an asynchronous history-load path.

## Q3. Focus, click receipts, memory and rail counter

The global `$.clickReceipt` values match exactly: Analytics 2, Tasks 2, tasks-button 1, Setup hub 1, Chat 1 in both M0 and M1. S7 `pointer-during-transition` also has `$.windows[*].outcome.reached` Analytics/Tasks/tasks-button all `true` in both files, with per-window receipts 1/1/1. At +400 ms, `$.windows[*].samples.at400.focus` matches by S7 window: List button (`tasks-view-mode-list`), Setup hub, Tasks, then DIV after workspace remount. At +100 ms, the final run matches M0 too: Analytics, Analytics, Tasks, BODY. The keyboard +100 ms mismatch seen in earlier runs (O19) did not recur in run 5.

S1 page focus, S2 retained focus, S3/S4 session focus, S5 rapid focus, S6 reduced-motion focus, and S8 split-action focus all match M0 at +100 and +400 ms in the corresponding windows (`$.windows[*].samples.at100.focus` and `.samples.at400.focus`). The JSON does not store a separate global focus-receipt count.

S2 memory (`$.memoryS2`): M0 before 19,761 DOM nodes / 2,835 JS event listeners, after GC 12,439 / 1,581; M1 before 14,041 / 1,642, after GC 12,392 / 1,584. The after-GC differences are −47 nodes and +3 listeners.

`$.railShiftReport` is `[]` in final M1. This is a reported counter under O15; it is not a zero-shift assertion. The visible `layoutShift` comparison above is the gate. Individual counter values are in `$.windows[*].railShiftsDelta` and `$.windows[*].m0RailShiftsDelta`.

## Q4. Long tasks (recorded windows, task count, maximum)

Values come from `$.windows[*].longTasks.count` and `.maxMs`; the middle count is the number of windows with at least one recorded long task. These are timing observations, not proof of motion attribution.

| Scenario | M0 windows with tasks / tasks / max ms | M1 windows with tasks / tasks / max ms |
| --- | ---: | ---: |
| S1 page round trips | 0 / 0 / 0 | 1 / 1 / 50 |
| S2 retained swaps | 10 / 18 / 246 | 7 / 7 / 104 |
| S3 non-retained | 1 / 4 / 171 | 1 / 1 / 86 |
| S4 first open | 3 / 7 / 211 | 3 / 9 / 214 |
| S5 rapid | 2 / 5 / 350 | 2 / 4 / 173 |
| S6 reduced: page (30) | 11 / 18 / 188 | 13 / 32 / 152 |
| S6 reduced: retained (10) | 10 / 27 / 287 | 8 / 11 / 174 |
| S6 reduced: split (4) | 4 / 16 / 296 | 4 / 12 / 464 |
| S7 input/focus | 0 / 0 / 0 | 0 / 0 / 0 |
| S8 split | 3 / 7 / 333 | 3 / 6 / 292 |
| **All 102 windows** | **44 / 102 / 350** | **42 / 83 / 464** |

The S6 peak is higher in M1 (464 vs 296 ms in the reduced split subset), while the overall number of tasks is lower (83 vs 102). `$.longTaskNeedsReview` is `[]` in final M1, and `$.windows[*].trace.motionLongTasks` is 0. Per U2/O15, the failure condition is a **new task over 50 ms attributed to motion code**, not any raw increase in task time. Task-level observations and attribution fields are in `$.longTaskReport[*]` and `$.windows[*].longTasks`. O7 limits causality: M0 uses the pre-PR-#739 base dist (main `6c0490f1f`), while M1 uses main `71820e0c0` plus this task; the #739 resync fixes also differ. Do not assign a long-task change solely to this motion work from this comparison.

## Run history

The JSON files store measurements, not process exit codes or soft-assert totals. Exit/failure information below is from `decisions.md` O14–O21 and `m1-diagnosis.md` (run 1); O21 also cites `.ptah/tmp/m1-run.log` for run 5. “Nonzero” is inferred from the documented failed assertions where an exact code was not retained.

| Run / JSON | Exit | Soft-assert failures | Decision and follow-up |
| --- | --- | --- | --- |
| 1 / `m1-run1.json` | Nonzero; exact code unavailable | 134: rail 101, entrance 10, reduced-motion targets 5, S7 pointer/focus 3, long-task comparison 15 | O14–O15: correct recorder defects; add the planned input cancellation; report rail counter and gate long tasks on motion attribution. |
| 2 / `m1-run2.json` | Nonzero; exact code unavailable | 4 | O16: S7 click hit `HTML` under the implicit root transition; remove the root view-transition name on Electron. |
| 3 / `m1-run3.json` | Nonzero; exact code/count unavailable | Count not retained; S7 incoming-surface click, S8 split scrollbar/shift, and keyboard +100 ms discrepancy documented | O17–O19: make the incoming surface live, clip the split pane while entering, and retain the exact keyboard check. |
| 4 / `m1-run4.json` | Nonzero; exact code unavailable | 3 | O20: one keyboard +100 ms mismatch and two failures from the List-button miss; add pointerdown hit-target and button-rect probe. |
| 5 / `m1.json` | 0 | 0; every soft assert passes | O21: List-button click reached the live button; keyboard +100 ms also passed. No further product fix. |

## Decision

Final M1 passes the recorded gates and restores S7 click/focus receipts. Retained swaps have fewer recorded long tasks and the final motion-attribution review list is empty. Keep the O7 baseline caveat and the S8 `layoutShiftAll` increase visible when using these numbers; they prevent a claim that every measured dimension improved because of motion code alone.
