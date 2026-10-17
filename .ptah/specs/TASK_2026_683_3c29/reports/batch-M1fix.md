# M1 motion fix

## Changes

- **Product:** `libs/frontend/core/src/lib/routing/surface-view-transitions.ts:37-68` installs one capture-phase `pointerdown` and one `keydown` listener on the injected document when tracking begins. Input skips the active transition; `DestroyRef` removes both listeners. `surface-view-transitions.spec.ts:217-268` covers busy pointer and keyboard input, idle/settled input, single registration, and destruction.
- **Rail and visible shift:** `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:459-461,528-547,425-427,719-728` stores null for missing counters, computes finite deltas, records each row's M0 rail value, and reports increases in `railShiftReport` without failing on geometry changes. The visible layout shift assertion now includes S8 and split rows, using the no-input metric for split rows.
- **Entrance and reduced motion:** `nav-session-motion.perf.spec.ts:164-174,210-222,733-739` accepts Angular-scoped `ptahTurnEnter` names, stores animation type and normalized name, and limits the reduced-motion zero check to CSS turn animations on message slots.
- **S7 input:** `nav-session-motion.perf.spec.ts:292-310,494-500,544-547` captures actual pointerdown/click target tag, test ID, title, and active-transition class state, plus the final surface, in the pointer window outcome.
- **Long tasks:** `nav-session-motion.perf.spec.ts:330-393,425-430,472,516,728` aligns trace time using a User Timing mark, matches overlapping renderer `RunTask` events, collects top child function/script/timer/frame calls and stack frames, and classifies tasks as motion, render, or unknown. The assertion fails only for a motion-classified task over 50 ms that exceeds the matched M0 maximum. `longTaskReport` records every task and explicitly notes absent trace stack evidence. Existing trace categories already include `blink.user_timing`, `devtools.timeline`, and `disabled-by-default-devtools.timeline`; no shared capture file was changed.

Probe version remains 3; the M0 baseline shape and validation are unchanged. `m0.json` and `m1.json` were not edited. The recorder was not run in Electron under the verification restriction, so trace matching and S7 behavior still require the orchestrator's next measurement.

## Checks

| Command | Result | Counts |
| --- | --- | --- |
| `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/routing/surface-view-transitions.spec.ts --coverage=false --maxWorkers=2` | PASS | 1 suite; 20 tests passed |
| `npx nx typecheck core --parallel=1` | PASS | 0 compiler errors |
| `npx nx typecheck ptah-electron-e2e --parallel=1` | PASS | 0 compiler errors; rerun after final recorder edit |
| `npx nx lint core --parallel=1` | PASS | 0 errors; 14 warnings in project output |
| `npx nx lint ptah-electron-e2e --parallel=1` | PASS | 0 errors; rerun after final recorder edit |
| Scoped `ptah_get_diagnostics` after final edit | PASS | 0 errors, 0 warnings in changed recorder file |

Nx Cloud reported its disabled organization (401) during checks; local targets still exited successfully.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Install listeners lazily on first `track()` and remove them through `DestroyRef`. | Eager root registration or lazy registration. | Plan A2 permits lazy registration; the tracker is root-provided and already owns transition state. | Yes |
| Treat rail counter increases as a report, with visible layout shift as the gate. | Fail every counter increase or report it. | Verified diagnosis group A found four +1 geometry counts with no increase in visible layout shift; user specified `railShiftReport`. | Yes |
| Attribute long tasks only when an overlapping trace task and named child frames are available. | Infer from temporal proximity or retain `unknown`. | Plan U2 gates motion-caused work; the diagnosis says click buckets alone do not establish cause. | Yes |
| Keep probe version 3 and use additive fields. | Bump probe and require a new M0 baseline or preserve M0 compatibility. | Binding task requires existing probe-3 `m0.json` to load. | Yes |
