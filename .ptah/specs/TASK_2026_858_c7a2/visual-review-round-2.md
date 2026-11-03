# Visual review, round 2 - TASK_2026_858_c7a2

## Verdict: FAIL (1 defect open, 1 note)

D1 passes. D2 passes only in two paths. It fails when a long session opens from the Previous sessions dialog.

## Environment

- Real Electron app. Bundle: `%TEMP%\ptah-stagger-app\main.mjs` (renderer built 01:19, after the last source edit at 00:36).
- Playwright `_electron`, profile `%TEMP%\ptah-stagger-udd`, window 1186x780, flag `--force-prefers-no-reduced-motion` (except the Reduce-motion run).
- Method: MutationObserver, rAF sampler, `getAnimations()` delays and properties. Scripts and data: `visual-review-round-2/scripts/` and `visual-review-round-2/*.json`.
- Themes: ptah-glass (preset Slide left) and anubis-light (preset Slide left).
- One Electron instance at a time. All instances closed. Motion restored to "Always animate" (`motionPreference: always` in the profile config).
- Real replies: 3 (glass turn 1, glass turn 2, light turn 1). Two earlier runs timed out before the reply came (the reply takes about 2 minutes); they only gave user-row data.

## Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | D1 first reply enters once, no double row, no jump | PASS | See D1 data below |
| 2a | D2 open of a short session (2 rows) | PASS | Rows 0 and 36 ms, `ptahMotionEnterGlass`, transform only. Pane `ptahPaneCrossfade`: opacity only, 380 ms. Scroller minimum opacity 0.93, no transform (`d3_open.json`) |
| 2b | D2 first display of a loaded tab (18 rows glass; 4 rows light) | PASS | Delays 0,36,72,108,144,180 ms, 6 rows animated of 18 (`d3_sw2.json`). Light: 0..108 step 36 for 4 rows (`d4_B1.json`). Pane: opacity only, 380 ms. Scroller transform: none in all samples |
| 2c | D2 open of a long session from the Previous sessions dialog | FAIL | See defect 1 |
| 3 | Switch back to a loaded tab | PASS | `d4_A2`, `d4_B2`: adds 0, enters 0, no row animation. Pane crossfade opacity only (min 0.26 and 0.72), no transform |
| 4a | Glass theme | PASS | Row enter animation: `ptahMotionEnterGlass`, property `transform` only. No leave in the flows run (see Not tested) |
| 4b | Light theme | PASS | Light enter: `ptahMotionEnter`, `opacity,transform`, 320 ms. Reply: 1 add, 0 removes, user row top delta 0 |
| 4c | Reduce motion | PASS | `matchMedia(reduce)` true. One add with class enter, duration 0.01 ms, delay 0. No stagger. `rm_after.png`, config restored |
| 5 | Prepend of older history | PASS | Scroll to top 4 times on a 30-row session: 12 rows added, 0 enter class, 0 removes. Anchor row top 112.3 to 111.7 px (no jump) (`d_open_final.png`, `d_scrolled_top.png`) |

### D1 data

- Glass turn 1: adds = user row at 800 ms (enter, index 0) and one reply row at 137179 ms (class `ptah-msg-enter`, index 0). Removes: 0. Leave attributes: 0. Maximum rows 2.
- Glass turn 2: user add, one reply add (3109 ms), removes 0.
- Light turn 1: user add, one reply add (169264 ms), removes 0. Scroll height grew 482 to 532 px during the enter. The user row top did not move (max delta of a persisting row: 0 px).
- Round 1 showed two adds for one reply (140 ms apart) and a timed leave. No run in round 2 shows a second add or a leave.
- Limit: the stream-to-final swap itself did not occur in the DOM in these 3 runs (no remove event). So the "old row is cut" path was not observed live. The evidence is the absence of the double add and of any timed leave. The cut path stays covered by unit tests only.

## Defects

### 1. Long session opened from the Previous sessions dialog does not stagger (Serious)

- Expected (D2): open or history load staggers rows 0..180 ms, max 6.
- Measured, glass: 18 rows added within 0.3 ms, 0 with the enter class, no row animation (`d2_glass.json`, run 4: adds 18, enters 0).
- Measured, light/glass: 30-row session, adds 30, enters 0 (`d.cjs` run, `d_open_final.png`).
- The same 18-row session staggers 6 rows when its tab is shown for the first time after loading in the background (check 2b). So the pane switch and the stagger are correct, but the direct dialog open path is suppressed.
- Cause (from source, not changed): `chat-transcript.component.ts:1223-1240`. After `historyReplaying` falls, `replayMotionHold` is set for 300 ms, and it feeds `[suppressed]` of `TranscriptMotionDirective`. The history rows arrive in that window.
- Impact: the user sees the long history appear with no stagger when the open uses the dialog. If this is the wanted rule (no motion for a replay of history), change the D2 text. If not, the hold must not cover the first open batch.
- Note: a 2-row session opened the same way does stagger (check 2a). So the behavior depends on whether the load runs as a replay.

## Notes

- In this profile, sessions opened from the dialog while an empty tab was focused loaded into a new background tab and left the empty tab in focus in 4 of 7 runs (some runs loaded into the focused tab, so the path is not stable). I did not find the cause. It made check 2c hard to repeat; the two valid runs are listed above.
- During the run one tab content was a sub-agent detail pane (not a transcript). It was excluded from the data.
- Pane-level `ptahMotionLeave` (180 ms) animations on `.ptah-motion-panel` appear during tab switches. They are not row animations and were not changed by this fix.

## Not tested

- Live observation of the stream-to-final DOM swap and a cut leave (no swap occurred in 3 replies).
- Rewind leave in light and glass (not repeated in round 2; each cost a real reply).
- Reduce motion with a multi-row open.
- Visual frames: screencasts are in `visual-review-round-2/frames/` (not reviewed frame by frame; the verdict uses the sampler data).

## Files

- Report: `D:\projects\ptah-extension\.claude-worktrees\chat-message-stagger\.ptah\specs\TASK_2026_858_c7a2\visual-review-round-2.md`
- Data and screenshots: `...\visual-review-round-2\` (`d1_glass_turn1.json`, `d1_light_turn1.json`, `d2_glass.json`, `d3_open.json`, `d3_sw2.json`, `d4_A1.json`, `d4_A2.json`, `d4_B1.json`, `d4_B2.json`, `d.json`, `rm_after.png`, `d_open_final.png`, `d_scrolled_top.png`)
