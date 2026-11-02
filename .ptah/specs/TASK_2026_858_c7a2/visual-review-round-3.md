# Visual review, round 3 - TASK_2026_858_c7a2

## Verdict: FAIL (defect 1 still open)

Fix R2 does not restore the stagger for a session opened from the Previous sessions dialog. The two regression checks pass.

## Environment

- Real Electron app. Bundle `%TEMP%\ptah-stagger-app\main.mjs` (built 03:01, after the last source edit at 02:27). The renderer bundle holds the fix (`replayMotionHold` input in `main.js`).
- Playwright `_electron`, profile `%TEMP%\ptah-stagger-udd`, window 1186x780, flag `--force-prefers-no-reduced-motion`. Theme anubis-light, preset Slide left, motion "always". `matchMedia(reduce)` false.
- Method: MutationObserver, rAF sampler, `getAnimations()`. Scripts: `visual-review-round-3/scripts/` (`r3m.cjs`, `r3x.cjs`). Data: `visual-review-round-3/*.json`.
- No chat message was sent. No setting was changed. One Electron instance at a time; all closed.
- Cold state: I closed all session tabs in the profile first, so the home view was empty ("71 previous sessions" button). Before this, opened session tabs were restored at each launch and hid the real result (a session already loaded in a hidden pane). The cold state is the valid test.

## Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1a | Open mid-size session (16 rows) from dialog | FAIL | adds 16, enters 0, row animations 0 (`r3m_row15.json`) |
| 1b | Open long session (56 rows, 62 msgs) from dialog | FAIL | adds 56 in 2 ms, enters 0, row animations 0, no pane animation (`r3m_row5.json`, `r3m_row5_final.png`) |
| 2a | Open 2-row session from dialog | FAIL (changed) | adds 2, enters 0, row animations 0 (`r3m_row16.json`). Round 2 reported a stagger here |
| 2b | Switch to loaded background tab, then back | PASS | First show of the 16-row tab: 6 rows animated, pane `ptahPaneCrossfade` opacity only 380 ms. Switch back: adds 0, enters 0, row animations 0, crossfade only. Same tab again: adds 0 |
| 2c | Prepend older history (56-row tab, 5 scrolls to top) | PASS | adds 6, enters 0, removes 0, row animations 0 |
| 3 | Glass theme open of a long session | NOT DONE | Defect 1 shows no animation on the dialog open in any theme path I could reach. No theme or motion setting was changed, so nothing to restore |

## Defects

### 1. Session opened from the Previous sessions dialog still does not stagger (Serious)

- Expected: delays 0..180 ms in 36 ms steps, max 6 rows, rest instant; pane opacity only.
- Measured: 16, 56 and 2 rows are added in one frame with no `ptah-msg-enter` class and no row animation. The 16-row and 2-row opens show a pane crossfade (opacity only). The 56-row open shows no pane animation.
- Same session shown later by clicking its tab card (check 2b) does stagger 6 rows. So the row animation works; the dialog open path is still suppressed.
- Round 2 (profile with a restored tab in focus) and this round (cold home view) both fail. The 2-row case no longer staggers in this cold path.
- Not found: the cause. `TranscriptMotionDirective.ngOnChanges` still suppresses when `!active` or on `activationCatchUp`, besides `replayMotionHold`. I did not trace which one fires. Check these first (`transcript-motion.directive.ts:36-52`).
- Impact: a user who opens any session from the dialog sees all rows appear at once.

## Limits

- Row delays (36 ms steps) were not measured for the 2b switch; only the count (6) and the pane property.
- The cold-open evidence is for the home-view path. The "open into a focused empty tab" path of round 2 was not repeated because the profile restores tabs unpredictably.
- Check 3 not done (see table).
