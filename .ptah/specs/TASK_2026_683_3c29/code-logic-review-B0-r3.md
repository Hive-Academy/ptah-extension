# Code Logic Review B0, round 3 (final) - TASK_2026_683_3c29

Reviewer: Claude (independent). Read in full: `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` (572 lines) and `reports/batch-B0-fix2.md`; selectors cross-checked in the app sources. Nothing was run; `dist/` and `measurements/` untouched. Note that S8 and everything after the S7 remount has never executed; run 3 only proves S1-S7 (94 windows) against the code as it was before the N1-N7 edits.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | NEEDS_FIXES for the M1 assertions; the M0 recorder is usable |
| BLOCKING-M0 | 0 |
| Serious | 1 |
| Moderate | 4 |

## N1-N7 and the two lane additions

| Item | Status | Evidence |
| --- | --- | --- |
| N1 partial vs final file | FIXED | `persist(true)` writes `<label>.partial.json` per window (366); `<label>.json` with `complete:true` only after the 102-window count check (541-545); M1 requires `complete` and the exact per-scenario counts (244-247; counts sum to 102). `finally` writes a partial on failure (547-549). |
| N2 S5 anchoring | FIXED | Both S5 windows use `page.mouse.click` through `clickCenter` (419-435), so the trusted-click probe arms on the first click and records every click. |
| N3 S6 no-op first window | FIXED | `retainedCard((i+1)%4)` (444) with a precondition that the target is not `.rc-focused` (445; the class exists on `ptah-compact-rail-card`, compact-rail-card.component.ts:47). After S5 the focus is card 0, so the sequence 1,2,3,0,... always swaps. |
| N4 long-task gate | FIXED (differential) | 513-515 soft-fail any window whose max goes over 50 ms where the matching M0 window was at or under 50 ms; missing M0 row also fails; `longTaskReport` in the JSON (261). It is a regression proxy, not attribution; render-caused regressions will fail it too (plan U2 says those should only be reported). Accept, but read failures before treating them as motion. |
| N5 S3 retention key | FIXED (new risk R1) | 405-408 resolve the card's `data-tab-id` and test `ptah-chat-transcript[data-tab-id=...]`; no card means not retained. |
| N6 layout shift | FIXED (new risk M1) | Both `layoutShiftAll` and `layoutShiftNoInput` recorded (192-197, 359), `All` asserted (512). |
| N7 split pane selector | PARTIAL | Selector now matches the real `section[data-pane-side]` (canvas-rail-board.component.ts:160-165) and is written to the JSON (30, 140, 261). The assertions on it are still weak: M2 below. |
| Lane: S2 setup, wide window | OK | `setSize(1800,1000)` and read-back stored as `host.windowSize` (267-273). |
| Lane: S7 to S8 handoff | PLAUSIBLE, UNVERIFIED | 487-502: Thoth restored, original workspace, `goto('canvas')`, Chat tab selected, cards re-opened if missing, three visible cards. See notes. |

## New defects

### S1 (Serious). S3/S4 windows are anchored on the sidebar click, but the measured swap is a later programmatic card click

- `openAndFocusSession` (279-284) is the action for S3 (410) and S4 (413). The trusted sidebar click arms the probe (185); the focus swap is the later `evaluate(el.click())` at 282 (untrusted, ignored by the listener) after `expect.poll` and a role lookup, typically 30-300 ms later. The +50 ms placements, the three rAF scroll reads, the +50 ms animation targets and the 600 ms long-task/layout-shift window therefore start before the swap happens. In M0 this records the entrance/scroll of the wrong moment (A7, F6 and F7 evidence); at M1 lines 523-529 ("entrance exists", viewport, first delay 0) can fail falsely for S3/S4 even with a correct implementation, or pass vacuously on the old transcript.
- Fix: inside `openAndFocusSession`, re-arm at the card click: expose `rearm()` on the probe (reset `clickAt`, samples, placements and the rAF chain) and call it in the same `evaluate` that clicks the card (`window.__ptahMotionProbe?.rearm(); el.click()`), or do the sidebar click and card wait outside `measure` and measure only the card click with `isTrusted` removed from the listener. For S4 keep the sidebar open in `outcome` if it is wanted as evidence.
- Interim: until fixed, treat M1 soft failures on S3/S4 entrance as inconclusive and read the frame strips (frames are click-relative to the sidebar click).

### R1 (Moderate, M0 risk). Hard S3 precondition is now a real check and was never exercised

- Line 409 `expect(retained, ...).toBe(false)` aborts the whole recording if the eviction order assumption `[4,2,3,0,1]` is wrong (e.g. a new unfocused card mounts a hidden transcript, or retention keys differ). Under the old selector (session id) it was vacuous, so run 3 never tested it. A throw here loses S3-S8 and yields another incomplete M0.
- Fix: replace with a recorded flag only: keep `targetRetained: retained` in the row and `console.warn` when true; fail in the M1 block (soft) or in the post-run summary instead of aborting mid-run.

### M1 (Moderate). `layoutShiftAll` must be zero in S8, where panes legitimately resize

- 512 applies to every window. Opening/closing a split changes the width of the existing pane, so transcript/rail nodes shift (sources are inside `ptah-chat-transcript`/`ptah-canvas-rail`, the filter at 194). Expect S8 and S6 split windows to fail on both M0 and M1 content. Restrict the assertion to switch windows (S1-S7) or compare with the M0 value per window (as done for long tasks).

### M2 (Moderate). Split-entrance assertions are vacuous or falsely failing

- 139 counts any animation whose target is inside a pane section, including transcript message entrances, CSS transitions caused by the focus/hover change of header buttons, and the like. Line 532 (`> 0`) is therefore satisfied by unrelated finite animations, and 521 (`=== 0` under reduced motion for every reduced window) can fail on a transition that survives the global reduced-motion rule. Narrow to `CSSAnimation` objects whose target is the pane `section` itself (or has a name matching the B6 keyframes once implemented) and exclude `.chat-msg-slot` descendants; apply the reduced check only to S6 split windows.

### M3 (Moderate). Handoff and operational notes for the running M0

- `ui.goto(...)` pushes `workspaceChanged` with an empty payload (ui-driver.ts:561-563), and `workspace:getInfo` is mocked to always return `activeFolder: ws-1`. So the `goto('thoth')` at 487 while on ws-2 may itself switch back to ws-1, which makes the explicit ws-1 title click at 490 redundant but harmless; if it does not, 490 restores it. Either way the later `goto('canvas')` plus the Chat-selected assertion (495-497) should recover, but this path is the only unexecuted code that precedes S8.
- A stale `measurements/m0.json` (complete:false) exists; 240 throws unless `PTAH_MOTION_OVERWRITE=1`, and 248 then deletes the existing file before the new run has produced anything. Use OVERWRITE=1 for the final M0 and keep a copy of the 94-window partial if it is wanted as evidence.
- The long-task differential at 515 will flap for windows near 50 ms (M0 49 ms, M1 51 ms); read the reported maxima before concluding.

## Notes (no action needed)

- Window counts: S1 30, S2 10, S3 5, S4 3, S5 2, S6 44 (30 + 10 + 4 reduced split), S7 4, S8 4 equals the 102 enforced.
- No `any`, `ts-ignore` or `as unknown as`; helpers reused; CDP sessions and probe listeners are released in `finally`.
- Residual from round 2 not fixed: the S8 preconditions at 487 and 509-style hard expects abort the run (acceptable now that partial output is written).

## Verdict

- Recommendation: use the final M0 run as the baseline only if it completes through S8 and writes `complete:true`. Before trusting M1 results, fix S1, then M1/M2; apply R1 now if another M0 attempt is possible.
- Confidence: MEDIUM (static review; S8 and the new N1-N7 code paths unexecuted).
