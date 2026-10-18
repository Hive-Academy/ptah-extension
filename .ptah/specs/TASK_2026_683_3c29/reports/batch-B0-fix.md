# Batch B0 fix — Electron motion recorder

## Summary

Updated `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` so M0 can retain measurements after a late failure and M1 checks use click-relative evidence. The spec was **not run**; runtime validity and visual frame-strip checks remain for the orchestrator's M0/M1 runs.

## Review fixes

| Item | Fix | Spec line |
| --- | --- | --- |
| 1 | Workspace titles are exact matches scoped to `ptah-workspace-sidebar`. | 256, 449, 452 |
| 2 | S8 focuses card 0, then opens the menu on non-focused card 2; checks the menu item's enabled state. | 458-461 |
| 3 | Probe placement, scroll, and initial visibility use the scroller with visible client rects; header and composer use visible hosts. | 97, 114, 147, 166 |
| 4 | Every completed window flushes `<label>.json`; outer `finally` writes `<label>.partial.json` on a throw, and per-window `finally` stops trace, screencast, observers, and listeners. | 245, 337-346, 511-515 |
| 5 | Capture-phase trusted click or Enter arms samples and three rAF reads. Long-task and layout-shift windows start at `clickAt`; screencast metadata is converted to click-relative milliseconds. An absent event falls back and records `armed: false`. | 170-188, 286-309, 327 |
| 6 | Trace stack attribution is marked `null` with `attribution: "unavailable"`; vacuous M1 trace assertions were removed. Dropped frames count across all trace threads. Observer long-task counts remain. | 68, 210-220, 316, 330 |
| 7 | S7 clicks via `page.mouse.click` at element centers; the task view layout button is a stable plain target. The recorder stores per-window receipt deltas and `reached` flags. | 322-334, 422-431, 482 |
| 8 | Focus restoration starts on the real `.rc-select` button and verifies the focus precondition. | 440-444 |
| 9 | S3 visits targets in eviction order `[4, 2, 3, 0, 1]`, checks they are not mounted, and records `targetRetained` in each window. | 77, 375-379 |
| 10 | Unset label skips the spec; a populated label cannot replace existing JSON without `PTAH_MOTION_OVERWRITE=1`. Frame strips are cleared only after validating the resolved path and overwrite gate. | 225, 229-236 |
| 11 | Test timeout is 30 minutes for the full set of windows. | 227 |

Other review findings addressed: layout shifts are restricted to rail/transcript sources and the click window (188); animation counts exclude infinite effects and include target/name evidence (117-134); entrance sampling runs only at +50 ms and has no duplicate placements in `samples` (142-160, 332); `blank` checks visible surfaces (138); retained cards use captured tab IDs and S5/S6 restore their retention set (363-389); M1 uses soft assertions for focus swaps, entrance presence/placement, split entrance, page transitions, reduced motion, and +100 ms Chat return continuity (470-509). M1 rejects a missing M0 file or `PTAH_MOTION_ASSERT=1` with `m0` (233-234). Pixel stability and a maximum blank interval still require frame-strip inspection; DOM samples alone cannot prove those visual criteria.

## How to run

Run from the repository root. Build fresh Electron development output before each capture. The fixture launches `dist/apps/ptah-electron/main.mjs`; build precheck also requires `preload.js` and `renderer/index.html` there.

```powershell
npx nx build-dev ptah-electron --parallel=1
npx nx copy-renderer-dev ptah-electron --parallel=1
```

M0 must run on the base implementation with B0 recorder changes only:

```powershell
$env:PTAH_MOTION_LABEL = 'm0'
Remove-Item Env:PTAH_MOTION_ASSERT -ErrorAction SilentlyContinue
Remove-Item Env:PTAH_MOTION_OVERWRITE -ErrorAction SilentlyContinue
npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts
```

After implementation batches and a fresh development build, run M1:

```powershell
$env:PTAH_MOTION_LABEL = 'm1'
$env:PTAH_MOTION_ASSERT = '1'
Remove-Item Env:PTAH_MOTION_OVERWRITE -ErrorAction SilentlyContinue
npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts
```

With `PTAH_MOTION_LABEL` unset, the spec is skipped in ordinary e2e runs. To intentionally replace an existing label's JSON and frame strip, set `$env:PTAH_MOTION_OVERWRITE = '1'` before the command. `PTAH_MOTION_ASSERT=1` requires `m0.json` and a label other than `m0`. Results are in `.ptah/specs/TASK_2026_683_3c29/measurements/<label>.json`, `<label>.partial.json` on failure, and `<label>-frames/`.

## Checks run

| Check | Result |
| --- | --- |
| `ptah_get_diagnostics` scoped to the spec | 0 errors, 0 warnings before final retention setup loop. |
| `npx nx typecheck ptah-electron-e2e --parallel=1` | Passed on final spec, exit 0. |
| `npx nx lint ptah-electron-e2e --parallel=1` | Passed on final spec, exit 0; 17 project warnings, 0 errors. |
| Playwright/Electron/e2e/build/serve | Not run, as instructed. |

The local Nx targets succeeded; Nx Cloud printed a disabled-organization notice. The typecheck and lint targets were repeated after two late fixes so the recorded passes apply to the final file.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Report trace attribution as unavailable, with null counts, and omit its M1 gate. | Add stack-enabled tracing or report unavailable. | Existing shared trace capture does not collect the stacks needed to attribute `Layout`/`RunTask` to motion code. A zero would be a false pass; the shared helper is outside B0 scope. | Yes. |
| Keep project-wide observer long tasks and scoped layout shifts as numeric evidence. | Fail on unattributed >50 ms tasks or record them for manual attribution. | Measurement plan U2 says render-caused excess is a follow-up; current trace cannot distinguish it. | Yes. |
| Use the task view's layout-mode button for S7 pointer receipt. | Arbitrary first button or stable layout control. | `tasks-view.component.ts` defines `tasks-view-mode-list` as an always-present plain button; arbitrary first button may open a dialog. | Yes. |
| Preserve M0 structural preconditions for S3 and S8. | Record invalid scenarios silently or fail clearly. | These paths must exercise a non-retained target and enabled split action to produce meaningful M0 evidence. | Yes. |

## Clarifications Needed

None for this fix. The orchestrator should inspect M0 for nonempty windows, click-relative frame strips, and the visual pass criteria before accepting the measurement harness.
