# Batch B0: Electron motion recorder

## Summary

Created `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts`. It records S1–S8 in the Electron fixture, with 600 ms measurement windows, browser long tasks, layout shifts, CDP trace summaries when available, animation and entrance placement samples, three scroll frames, canvas counters, and PNG screencast frames. M0 is informational. M1 assertions are enabled only by `PTAH_MOTION_ASSERT=1`. The spec was **not run** in this lane; the orchestrator's M0 fixture run is the remaining acceptance gate.

The worktree already contains an untracked `.ptah/specs/TASK_2026_683_3c29/` tree. I wrote only this report within that tree and the requested spec file; I did not create or change the other task documents.

## Scenario map

| Scenario | Recorded window names | What is recorded |
| --- | --- | --- |
| S1 | `round-N-tasks`, `round-N-analytics`, `round-N-canvas` (N=1–10) | Thirty navbar surface changes, including the return to Canvas and view-transition presence. |
| S2 | `retained-N` (N=1–10) | Ten focus swaps across four opened Rail sessions; DOM nodes and event listeners before, and after GC. |
| S3 | `non-retained-N` (N=1–5) | Five sidebar opens alternating the fifth and first sessions across the four-tab retention cap. |
| S4 | `first-open-N` (N=1–3) | Three previously unopened sessions, including a short fixture, for first-frame and empty-state inspection. |
| S5 | `rapid-focus-five`, `rapid-page-three` | Five Rail clicks and three navbar clicks paced at 80 ms; each click timestamp is captured by a document listener. |
| S6 | `reduced-round-N-*`, `reduced-retained-N`, `reduced-split-*` | S1, S2, and S8 repeated under `prefers-reduced-motion: reduce`. |
| S7 | `pointer-during-transition`, `keyboard-during-transition`, `focus-restoration`, `workspace-remount-focus` | Click receipt, resulting surface, focus at the samples, and the configuration-surface workspace remount. M1 compares +400 ms focus with M0. |
| S8 | `split-open-N`, `split-close-N` (N=1–2) | Two open-beside entrances with a close between them, including pane counts and frame strips. |

Every window includes the same metrics; rows in the table describe the distinct action being measured. The fixture uses five large session histories plus three unopened sessions, and reuses the project's `makeSessionFixture`, `prepareCanvasWithSessions`, and `sessionRowButton` helpers.

## Output format

`<repo>/.ptah/specs/TASK_2026_683_3c29/measurements/<label>.json` has top-level `label`, `recordedAt`, `host`, `capability` (`startViewTransition`, `chromeVersion`), `memoryS2` (`before`, `afterGc`, each with `nodes` and `jsEventListeners` or `null`), `clickReceipt`, and `windows`.

Each `windows[]` row has `scenario`, `name`, `reducedMotion`, `clickTimes`, `windowStartMs`, `windowEndMs`, `longTasks` (`count`, `maxMs`, `sumMs`, `entries`, `perClick`), `layoutShift`, `trace`, `samples`, `entrance`, `scrollFrames`, `railShiftsDelta`, `focusSwapsDelta`, `frames`, `screencast`, and `outcome`. `trace` is the string `"unavailable"` when CDP tracing cannot start; otherwise it has `droppedFrames`, `layoutCount`, `updateLayoutTreeCount`, `forcedLayouts`, `motionForcedLayouts`, `motionLongTasks`, and `summary`. `samples` has `at0`, `at50`, `at100`, and `at400`: animation count, view-transition presence, surface and focus, pane count, canvas counters, element rectangles, blank-host indicator, and message placements. `entrance` has `visibleAtSwitch`, all +50 ms `placements` (`id`, visible-at-switch/at-50 flags, `entranceIndex`, `delayMs`, `animationNames`), `firstVisibleIndex`, and `firstVisibleDelayMs`. `scrollFrames` holds three `{frame, scrollTop, scrollHeight}` rAF samples. `frames` holds PNG filenames and relative times; the files are in `measurements/<label>-frames/`.

The frame strips are the evidence for pixel-level header/composer stability, brief blank intervals, and a return transition cut short. Those visual conditions need inspection after the M0 and M1 runs; the automated M1 gate checks available numeric criteria and focus equality but does not claim pixel equivalence from DOM rectangles.

## How to run

From the repository root, build the Electron development output first (the direct Playwright command does not invoke Nx `dependsOn`):

```powershell
npx nx build-dev ptah-electron --parallel=1
npx nx copy-renderer-dev ptah-electron --parallel=1
```

The fixture launches `dist/apps/ptah-electron/main.mjs`; `build-precheck.ts` also requires `preload.js` and `renderer/index.html` under that directory. Run M0 on the base code with only B0 added:

```powershell
$env:PTAH_MOTION_LABEL = 'm0'
Remove-Item Env:PTAH_MOTION_ASSERT -ErrorAction SilentlyContinue
npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts
```

After the implementation batches and a fresh development build, run M1:

```powershell
$env:PTAH_MOTION_LABEL = 'm1'
$env:PTAH_MOTION_ASSERT = '1'
npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts
```

M1 reads `measurements/m0.json` to compare the S7 +400 ms focus records. Labels accept letters, digits, underscore, and hyphen; unset `PTAH_MOTION_LABEL` defaults to `m0`. Do not run the two recording commands concurrently or reuse a label while another capture is writing frames.

## Checks run

- `ptah_get_diagnostics` scoped to the new spec: 0 errors, 0 warnings.
- `npx nx typecheck ptah-electron-e2e --parallel=1`: passed. Nx Cloud printed an organization-disabled notice after the successful local target.
- `npx nx lint ptah-electron-e2e --parallel=1`: passed with 0 errors and 20 warnings across the project. Nx Cloud printed the same notice.
- The Playwright spec, Electron, build, serve, and e2e targets were not run, as instructed. There are no observed M0/M1 measurements yet.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| One Playwright test contains all scenarios in one Electron fixture. | One test or separate tests per scenario. | S2 and S3 depend on a shared retained-tab state, and the plan requests one JSON output per run. | Yes. |
| The S4 three opens use three distinct unopened sessions. | Reopen one session three times or use distinct sessions. | A reopened session is no longer a first show; the plan names three opens of a not-yet-open session. | Yes. |
| Trace failure records `"unavailable"` and continues with observer data. | Fail or record observer-only metrics. | Plan §9 explicitly requires observer-only fallback when `startTraceCapture` returns null. | Yes. |
| M0 captures missing motion as null indices/delays and empty animation names. | Assert presence immediately or record absence. | B0 requires a pure recorder against the base commit. | Yes. |

## Clarifications Needed

None for writing the recorder. The orchestrator still needs to run M0 and inspect that every scenario has nonempty windows and a usable frame strip before accepting B0; typecheck and lint alone cannot establish that runtime gate.
