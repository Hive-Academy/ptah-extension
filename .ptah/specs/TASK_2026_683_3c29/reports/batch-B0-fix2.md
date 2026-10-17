# Batch B0 fix round 2

## Summary

The Electron recorder now expands the Rail and records the actual Electron window size. It no longer depends on tool output hidden in a collapsed “Worked” row. The third and final permitted M0 run reached S7, then failed before S8. **M0 is incomplete and this batch has not met its full-run acceptance criterion.** The generated `measurements/m0.json` is a 94-window partial recording from run 3, explicitly marked `complete: false`; the updated recorder will reject it as an M1 baseline. The seven independent re-review findings and the S8 return-to-Canvas fix were made after run 3 and have only static verification.

## Fixes

- `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:243-255`: set the Electron `BrowserWindow` to 1800 × 1000 before Canvas setup, read back its actual size, and write `host.windowSize` to JSON. The source Rail auto-collapse threshold is 640 px of board width (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:41,347-350`).
- `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:263-268`: replace the tool-output marker wait with a focused-session region and Rail-card-count wait. Opening a sidebar session adds a card but leaves the previous session in focus, so the helper explicitly activates the new card button. DOM activation avoids a focused card intercepting Playwright's physical click.
- `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts:370-398`: use that opening action for S2 setup, S3, S4, and S5/S6 setup. S3 and S4 therefore measure the sidebar open followed by focus of the new card.
- Shared support helpers were not changed. No other source file was edited.

## Independent re-review fixes

| Item | Fix | Spec line |
| --- | --- | ---: |
| N1 | In-progress writes use `<label>.partial.json`; final JSON gets `complete: true` only after the scenario-count check. M1 requires a complete 102-window M0 baseline. A failed run leaves its partial checkpoint. | 239, 245, 261, 563-567 |
| N2 | S5's five Rail clicks and three navigation clicks use real mouse input through a shared centre-click helper, so the trusted click probe arms and records each click. | 419-435 |
| N3 | S6 reduced Rail swaps start at card 1 and check that the target card is not focused before each window. | 443-446 |
| N4 | Every M1 window soft-fails on a newly introduced maximum long task above 50 ms versus its matching M0 window. JSON includes `longTaskReport` with both maxima and `attribution: "unavailable"`. | 261, 535-537 |
| N5 | S3 resolves the session's Rail `data-tab-id` and uses that id when checking mounted transcripts; a session with no Rail card is non-retained. | 405-409 |
| N6 | The observer now records both `layoutShiftAll` and `layoutShiftNoInput` for Rail/transcript sources; M1 asserts the all-shifts value. | 192-197, 359, 534 |
| N7 | Split animation sampling covers the actual pane sections and descendants under `[data-testid="rail-pane-container"]`; that section selector is written to JSON. | 30, 139-140, 261 |
| S8 | After the S7 remount, explicitly restore and verify its starting Thoth surface in each workspace, return to Chat/Canvas, and wait for three visible cards in the expanded Rail before starting S8. | 481-502 |

The S8 setup restores Thoth after the S7 workspace switch, returns to the original workspace, then routes to Chat/Canvas and reopens three Rail cards if needed (`:481-502`). It requires a selected Chat tab and three visible expanded Rail cards before S8 begins. This addresses the run-3 failure path but remains unverified because the run limit was reached.

## M0 runs

Command for each run: `PTAH_MOTION_LABEL=m0 PTAH_MOTION_OVERWRITE=1 npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts` (PowerShell environment variables set to those values; `PTAH_MOTION_ASSERT` unset). The existing Electron dist was used; no rebuild was run.

| Run | Result | Failing step |
| --- | --- | --- |
| 1 | Exit 1; S1 recorded 30 windows | S2 setup: the sidebar created a second Rail card but did not focus it; `Focused session: …MOTION_RAIL_1` was absent. |
| 2 | Exit 1; S1 recorded 30 windows | S2 setup: Playwright's physical click on the new card button timed out because the focused card intercepted pointer events. |
| 3 | Exit 1; recorded through S7 | S8 setup at `nav-session-motion.perf.spec.ts:469`: `cards().nth(0).click()` timed out after 30 seconds waiting for `ptah-canvas-rail-board:visible`. The snapshot shows Tasks still selected after the S7 workspace-remount return and `nav('Chat').click()` at line 464. The Canvas Rail was not mounted. |

The three-run limit is exhausted. No further spec run was made. After run 3, `tasklist /FI "IMAGENAME eq electron.exe"` found no Electron process.

## Recorded output

`measurements/m0.json` contains `complete: false`, `host.windowSize = {"width":1800,"height":1000}`, and 94 windows. `measurements/m0-frames/` contains 1,447 PNG frames. These counts are from run 3; earlier runs were overwritten as requested. The file was marked incomplete after the review. It remains available as evidence but cannot pass the new M1 baseline gate.

| Scenario | Windows |
| --- | ---: |
| S1 | 30 |
| S2 | 10 |
| S3 | 5 |
| S4 | 3 |
| S5 | 2 |
| S6 | 40 |
| S7 | 4 |
| S8 | 0 |

S8 has no evidence. The final JSON must not be used as a complete M0 comparison baseline. The recorder also wrote its failure checkpoint as `measurements/m0.partial.json`.

## Checks run

- `ptah_get_diagnostics` after the S8 edit: 0 errors, 0 warnings for the changed spec and owning project.
- `npx nx typecheck ptah-electron-e2e --parallel=1`: exit 0; project target passed after the S8 edit.
- `npx nx lint ptah-electron-e2e --parallel=1`: exit 0; 0 errors, 17 warnings after the S8 edit.
- The spec was not rerun after the review and S8 edits because all three permitted runs had already been used.
- Nx printed a nonblocking cloud-plan 401 notice after each successful project target.

## Decisions

- **Window width:** chose 1800 px over keeping the inherited window width or using the 1280 px narrow-split test size. The Rail collapses below 640 px of board width; run 1's snapshot shows the 1800 px window expanded the Rail. Reversible.
- **Session readiness:** chose the focused region and card count over expanding every “Worked” disclosure. The marker is inside collapsed tool output, while the Rail card and focused region are visible in the failure snapshots. Reversible.
- **Card activation:** chose DOM click for setup and S3/S4 opening after a physical sidebar click. Run 2 showed a physical card-button click was intercepted by the focused card; existing rapid-focus windows also use DOM clicks. Reversible.
- **S7/S8 surface recovery:** chose `ui.goto('thoth')` to re-establish the starting S7 configuration surface in both workspaces, then `ui.goto('canvas')`, a Chat tab click, and a visible expanded Rail/card-count gate before S8. The remount test expects Thoth to remain the active surface across a workspace switch, and the run-3 snapshot showed Tasks selected with no Rail. Reversible.

## Clarifications Needed

The task's three-run limit prevents another verification run in this lane. The orchestrator will run the final M0 to verify S8 Canvas re-entry and the seven review fixes. At the final executed failure, Tasks remained selected with no Rail; the exact failure and snapshot are in `.ptah/tmp/m0-fix2-run3.log` and `dist/apps/ptah-electron-e2e/test-results/perf-nav-session-motion.pe-2625c-on-and-session-motion-S1-S8/error-context.md`.
