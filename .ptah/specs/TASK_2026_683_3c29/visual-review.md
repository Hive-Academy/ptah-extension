# Visual Review - TASK_2026_683_3c29

Method: frame-strip review only (no browser, no Electron launch, no build). Evidence is `measurements/m0-frames` (base 6c0490f1f) vs `measurements/m1-frames` (final run 5) plus `m1-run3-frames` for O12/O18, with `m0.json` / `m1.json` for timings and layout shift. Windows are 1800x1000, Electron, Chrome 152 (host field in the JSON). Frame times (`atMs`) are relative to the click.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED (REVISE not required) |
| Visual breaking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 2 |
| Viewports tested | 1 (1800x1000, fixed by the recorder) |
| Frames opened | about 30 of 3,153 |
| Scenarios covered | S1, S2, S4, S6, S7, S8 viewed; S3, S5 metrics only |

Score rationale: 8 rather than 9-10 because only one viewport and one theme are evidenced, S3/S5 were not viewed frame by frame, and the cross-fade shows text-over-text overlap mid-transition. It is above 7 because every checked requirement is met with frame evidence and the one O12/O18 defect found earlier is verifiably gone.

## Environment

- Source: recorded frames from the shared Electron slot; the build under test is "build4" (O20/O21), same dist for runs 4 and 5.
- Viewport: single fixed 1800x1000 window. No narrow or intermediate width exists in the data. This is the recorder's setting, not an audit selection.
- Theme: dark only (see Gap G1).
- Background check done by pixel sampling (4 fixed points per frame, PowerShell System.Drawing) over every S1-S5 frame: M0 mean luminance 23.5-23.9, M1 23.3-24.7. No light or off-colour frame in either set, so the surface background matches the html background during all cross-fades sampled.

## Findings by severity

### Visual breaking

None.

### Serious

None.

### Moderate

1. Text-over-text overlap is visible mid cross-fade (accepted by design, flagged for the "no double content" criterion).
   - Frame: `m1-frames/s1-01-010.png` (@240 ms, Chat to Tasks): the outgoing "Open Marketplace Skills" button and "Intelligent Project Setup" card sit under the incoming "No tasks on the board / Create your first task" text and button; the "Tasks / Kanban / List" ghost header collides with the Ptah rail logo.
   - Frame: `m1-frames/s7-01-012.png` (@418 ms, Analytics to Tasks): the Dashboard is opaque while the Tasks empty state shows through it ("No tasks on the board" over "Session Analytics").
   - This is the intended cross-fade (implementation-plan.md motion table), lasting about 2 to 3 frames (s1-01-010 to s1-01-012, about 30 ms apart at 240 to 272 ms). Not a defect against the plan, but it is not "no double content" in the strict sense. Recommend leaving it; if a reviewer wants it stricter, shorten the overlap or make the outgoing layer fade first.
2. Reduced-motion: the nav tab indicator lags one swap behind the content, with stray blue arc fragments beside the tabs.
   - Frames: `m1-frames/s6-01-005.png` and `s6-01-006.png` (@210/217 ms): content is already Tasks but the "Chat" pill is still highlighted, with small blue arcs near "Apps" and "Tasks"; `s6-01-009.png` (@281) shows Tasks active and clean.
   - The same lag with the same arcs exists at base: `m0-frames/s6-01-003.png` (@260). So it is pre-existing and not introduced here, but it means S6 is "content instant, tab indicator still animates for about 70 ms". If the acceptance wording is "no animation at all" under prefers-reduced-motion, the tab-indicator transition is the remaining animated element.

### Minor

1. Nav bar differs between M0 and M1 ("Command Center" tab present only in M1, tabs shifted right). Compare `m0-frames/s1-01-006.png` with `m1-frames/s1-01-006.png`. `git grep` shows Command Center code in libs/frontend/chat-state, so the two runs are not built from identical product code and pixel-for-pixel diffs are not like-for-like. Does not affect motion conclusions.
2. Fixture noise unrelated to this task: Analytics shows the red banner "result.data.sessionStats is not iterable" (`m1-frames/s7-01-012.png`), and the right rail shows "Could not read git status" (many Chat frames). Both are present in the recorded environment, not caused by motion.

## Requirement-by-requirement results

### 1. S1-S5 surface and session switch (M1 vs M0)

- S1 surface switch (Chat to Tasks, window round-1-tasks).
  - M0: `m0-frames/s1-01-006.png` (@127, Chat) then `s1-01-008.png` (@309, Tasks with a centred spinner and empty body). The 127 to 304 ms gap in the frame list is a main-thread stall; the user sees a hard swap to a spinner.
  - M1: `s1-01-006.png` (@56, Chat) then `s1-01-008.png` (@141, still Chat) then `s1-01-010.png` (@240, cross-fade) then `s1-01-012.png` (@272, Tasks, with a residual ghost of the Chat rail fading). The first Tasks frame already has real content (empty-state card), no spinner and no blank frame. M1 has no gap above about 100 ms in the S1 window frame list, M0 has a 177 ms gap.
  - Result: smooth cross-fade, no blank flash. Pass. Double-content caveat: Moderate 1.
- S2 retained session switch (`s2-03`).
  - M0 (per `m0-summary.md` Q3): transcript blank from @304 to @612, composer only at about @418-491.
  - M1: `s2-03-001.png` (@103) already shows the new header (RAIL_2), the rail and composer with an empty transcript; `s2-03-004.png` (@168) shows the first "Worked" row fading in; `s2-03-008.png` (@245) shows Turn 63/64 present with the last row still faint (stagger rise). Bottom messages appear about 400 ms earlier than M0. Pass.
  - Minor residual: one short frame (about 65 ms, `s2-03-001`) shows the transcript pane empty before the first row, and the right rail briefly lacks its scrollbar (`s2-03-004` vs `s2-03-008`). This is the stagger start, not a blank-state flash.
- S4 first open (`s4-02`).
  - M1: `s4-02-001.png` (@228) shows the new session header with an empty transcript and a visible composer; `s4-02-004.png` (@290) shows "Worked" and Turn 39 rising from low opacity. Only 8 frames are in the M1 window against 23 in M0 (fewer paints because the animation is a compositor transform, not necessarily a loss).
  - M0 summary Q1 (F6 first-frame scroll) is confirmed at base; in M1 the first frames show the pinned bottom (Turn 39 at the bottom of the viewport, `s4-02-004`) rather than the scrollTop 0 jump seen at base. Pass on the frames viewed; the numeric `scrollFrames` were not re-read here.
  - The transcript pane is blank for about 60 ms after the first post-click frame. There is no `ptah-chat-empty-state` in the frames viewed.
- S3 and S5: not viewed frame by frame. Metrics only: S3 non-retained-1 layoutShift 0.0133 at base vs 0 in M1; S4 0.0149 at base vs 0.00017 in M1; S5 `layoutShiftAll` 0.00011 in rapid-focus-five vs 0 at base (negligible). Long tasks in the same windows are lower in M1 for S3/S4/S5 (86/124-214/173 ms vs 171/86-211/350 ms). Treated as supporting, not visual, evidence.
- Surface background vs html background: pixel sampling over all S1-S5 frames found no frame outside luminance 23.3-24.7 (see Environment). Pass.

### 2. Dark vs light theme

- Dark: every frame viewed, and the pixel sweep of all S1-S5 frames, is dark. No frame in either strip is light.
- Light: GAP G1. The recorder (`apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts`) has no theme switching (grep for theme / prefers-color-scheme finds nothing) and no decision or plan row mentions a light run. Light-theme cross-fade, the html background match and ghost-text contrast are unverified.

### 3. S6 reduced motion

- Content swap is instant: `m1-frames/s6-01-004.png` (@46, Chat) to `s6-01-005.png` (@210, Tasks) with no intermediate opacity or translate frame; 10 frames in the window against 7 at base. `m1.json` reports layoutShift 0 for every S6 window except `reduced-split-close-1` (0.0387, identical to base 0.0387, the S8 pane close).
- No session-switch rise visible in S6 retained windows (`reduced-retained-9`, long task 0 ms in M1 vs 252 ms at base).
- Pass, with Moderate 2 (tab indicator).

### 4. S7 click during transition

- `m1-frames/s7-01-007.png` (@270, Analytics clicked): the live Chat surface still present, Analytics tab active, a faint Dashboard layer emerging; the transcript is live and unfrozen (full text, scroll bar, composer).
- `s7-01-012.png` (@418, second click on Tasks 80-200 ms after the first): Tasks tab is active, the incoming Dashboard and Tasks layers are the live surfaces, no frozen snapshot of Chat is displayed. `m1.json` S7 pointer-during-transition: `clickReceipt` Analytics 1, Tasks 1, tasks-button 1; all `reached` true. Per decisions O21, the pointerdown lands on the live List button (`elementsFromPoint` has it on top); the button moves 4 px in `ptahPageRiseIn`.
- Pass. Caveat: `keyboard-during-transition` still has `Tasks 0` receipts, accepted as O19 (focus lands earlier, not a regression).

### 5. S8 canvas split pane (O12 / O18)

- run 3 (before the fix): `m1-run3-frames/s8-01-012.png` (@368): pane 2 is fully opaque and shifted, and a horizontal scrollbar is drawn along the bottom of the pane container (y about 929). Pane 1's composer sits at y 386 (compare final y 391), i.e. a pane jump of about 5 px.
- final run 5: `m1-frames/s8-01-012.png` (@368): pane 2 is a low-opacity ghost, no scrollbar at the bottom, pane 1 composer at y 391. `m1-frames/s8-01-020.png` (@549): pane 2 settled, no scrollbar, pane 1 composer still y 391 (pane 1 content does not move between 012 and 020).
- Base (`m0-frames/s8-01-012.png`, @157) is the pre-split state with the context menu ("Open beside"); the split appears later (@393+), without the entrance ease.
- M1 split-open layoutShiftAll is 0.0360 and 0.0358 vs base 0 and 0.0353 (window 1 and 2); split-close is 0.0472 in both. The 0.036 remains the pane geometry change itself (the second pane taking half the height), identical in magnitude to base window 2, so it is not a new defect; the 0.036 vs 0 in window 1 is a measurement difference (base split opened after the capture window).
- Pass: the O18 fix (`overflow: clip` while `.rail-pane-enter`) works in frames.

## Prototype fidelity

- Approved prototype: None for this task (a motion change, not a new surface; no `prototype/` folder in the task folder).
- Fidelity assessment: NOT APPLICABLE.
- Before/after comparison: dark pairs provided by the m0 and m1 strips: S1 (`m0-frames/s1-01-008.png` vs `m1-frames/s1-01-010.png` and `-012.png`), S2 (`m1-frames/s2-03-001/004/008.png` vs m0 per `m0-summary.md`), S6 (`m0-frames/s6-01-003.png` vs `m1-frames/s6-01-005.png`), S8 (`m0-frames/s8-01-012.png` vs `m1-frames/s8-01-012.png`/`s8-01-020.png`). No regression found; improvements noted above. Light pairs: none exist (G1).

## Viewport results

| Screen | Viewport | Status | Frames |
| --- | --- | --- | --- |
| Chat / Tasks / Analytics / Setup hub surfaces | 1800x1000 | Pass | s1-01-010/012, s7-01-007/012 |
| Session switch (retained and first open) | 1800x1000 | Pass | s2-03-001/004/008, s4-02-001/004 |
| Canvas split | 1800x1000 | Pass | s8-01-012/020 (m1), run3 s8-01-012 (fail, fixed) |
| Narrow / intermediate widths | not tested | GAP G2 | none |

## Accessibility and design-system notes

- Reduced motion is honoured for content (S6). The tab indicator animation remains (Moderate 2).
- Contrast and target sizes were not measured (frame evidence only). Ghost text during the cross-fade is intentionally low opacity (transient, about 30-60 ms).
- No design-token comparison possible from PNGs.

## Visual performance

- M1 removes the 127-to-304 ms stall visible at base in S1 and the 177 ms blank gap; M1's S1 frame deltas stay under about 100 ms.
- New >50 ms long tasks: `longTaskNeedsReview` is empty in M1 (O21). S8 split-open-1 shows a 292 ms long task in M1 vs 333 ms at base, so no new regression.
- Screencast only emits on paint, so a frozen main thread appears as a gap, not as a frame; smoothness at 60 fps is not provable from this data.

## Gaps (what the frames cannot show)

- G1: Light theme: none recorded. Required work: one S1/S2/S7 run with the light theme, then compare the html background against the surface background during the cross-fade.
- G2: One viewport only (1800x1000). Narrow-width overflow, the rail collapse, and the canvas split at small widths are unverified.
- G3: Actual frame rate and motion easing: the screencast is paint-driven and irregular (frame spacing 10 to 177 ms), so jank, easing curves and durations cannot be judged from stills. Durations come from the CSS plan, not from the frames.
- G4: S3 (non-retained session open) and S5 (rapid focus / page changes) were not viewed frame by frame.
- G5: Real history-load path: the fixture sessions are preloaded (M0 summary Q2), so the async empty-state flash (F7) cannot be exercised.
- G6: Hover, focus rings and interaction states, and pixel-level colour comparison of the new surface layer, are outside this data.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (HIGH on S1, S2, S7 and S8 in dark at 1800x1000; limited by G1 to G3)
- Key concern: no light-theme or narrow-width evidence exists for a change whose surface layer must match the html background; run one light-theme S1/S7 capture before release if the light theme ships.
