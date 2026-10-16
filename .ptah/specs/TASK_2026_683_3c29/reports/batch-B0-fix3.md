# Batch B0 final M0 fix pass

## Result

The Electron M0 recording completed on the first permitted run. `measurements/m0.json` has `complete: true` and all 102 required windows. `measurements/m0-frames/` contains 955 PNG frames. No second run was needed. Only `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` was changed; shared support files were untouched.

## Fixes A–E

| Item | Change and evidence | Spec lines |
| --- | --- | --- |
| A, S3 targets | Inspect the remaining candidate sessions before every S3 window using each card's `data-tab-id` and mounted `ptah-chat-transcript`; choose a non-retained candidate when available. If none exists, warn and record `targetRetained: true` plus `outcome.targetSession`. The run completed; S3 window 1 was non-retained, windows 2–5 were flagged retained. | 421–434 |
| B, swap anchor | Expose `rearm()` and invoke it inside the same browser evaluation as the programmatic card click. Re-arm refreshes `clickAt`, visible messages, samples, placements, scroll reads and layout-shift totals; a generation counter discards callbacks scheduled by the sidebar click. The card click is also entered into `clickTimes`. S3/S4 windows now anchor to the focus swap. | 104–120, 186–204, 294–301 |
| C, split shifts | Exclude S8 and S6 split windows from the zero `layoutShiftAll` assertion because their pane geometry changes. | 557 |
| D, pane animations | Count only CSS animations whose effect target is the pane `section` itself using `getAnimations({ subtree: false })`. Keep the pane selector in each sample and run metadata. Apply the reduced-motion pane check only to split windows. | 30, 143–145, 566 |
| E, review findings | Implemented review S1, R1, M1 and M2 above. The M3 operational note was handled by overwrite mode, a complete-file gate, and Electron process checks. No other review code change was needed. | 255–266, 584–591 |

## Run and measurements

Command (from the worktree root): `PTAH_MOTION_LABEL=m0 PTAH_MOTION_OVERWRITE=1 npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts`, with `PTAH_MOTION_ASSERT` unset. Output was filtered to its final 40 lines and saved in `.ptah/tmp/m0-fix3-run1.log`.

| Run | Result | Failing step |
| --- | --- | --- |
| 1 | Exit 0; 1 Playwright spec passed; 102 windows, 955 frames | None |

| Scenario | Windows |
| --- | ---: |
| S1 | 30 |
| S2 | 10 |
| S3 | 5 |
| S4 | 3 |
| S5 | 2 |
| S6 | 44 |
| S7 | 4 |
| S8 | 4 |
| **Total** | **102** |

S3's four `targetRetained: true` rows preserve the real state; they are not evidence of a non-retained switch. Each S3 row reports three scroll frames and `armed: true`. The first S3 `at50` sample was delivered about 453 ms after the card click, showing renderer scheduling delay under load; the probe's time anchor is the card click, but the browser cannot guarantee a timer executes at exactly +50 ms. S8 recorded two split opens and two closes, with two panes at each open's +50 ms sample. The base M0 had zero pane-section CSS animations, as expected before the motion implementation.

`tasklist /FI "IMAGENAME eq electron.exe"` showed no Electron process before the run or after it.

## Checks

- `ptah_get_diagnostics` on the edited spec: 0 errors, 0 warnings.
- `npx nx typecheck ptah-electron-e2e --parallel=1`: exit 0.
- `npx nx lint ptah-electron-e2e --parallel=1`: exit 0; 0 errors, 17 project warnings. Nx Cloud printed a nonblocking plan 401 notice.
- JSON inspection: `complete: true`, 102 windows with the scenario counts above; 955 `.png` files in `m0-frames/`.

## Decisions

- **S3 selection:** choose from remaining unused sessions, preferring a non-retained one; if none exists, record a retained target. Reusing the same non-retained target would make the five windows less independent, while a fixed eviction order already failed in the previous run. The run showed no non-retained unused candidate after S3 window 1. Reversible.
- **Probe reset:** re-arm at the card click and invalidate old callbacks, rather than moving the sidebar action outside the window. This retains sidebar-open evidence while making the measured window relative to the swap. Review S1 identified the earlier anchor as incorrect. Reversible.
- **Shift assertion:** exempt split windows rather than require zero shift during a legitimate pane resize. Review M1 and the pane layout establish that resize moves content. Reversible.
- **Pane animation count:** count CSS animations on the pane element itself, rather than descendant animations. The review found descendant transcript and header transitions could satisfy or falsely fail the split assertion. Reversible.
