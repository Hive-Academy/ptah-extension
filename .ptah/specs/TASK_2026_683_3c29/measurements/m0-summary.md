# M0 summary - TASK_2026_683_3c29 (base 6c0490f1f, Electron 1800x1000, Chrome 152)

**Verdict: B7: NEEDED; B8: NOT NEEDED**

> Re-recorded 2026-10-17 with probe version 3 (R5 fix: `visibleAtStart` sampled two frames after
> `animationstart`; S3/S4 entrance check conditional). Same base dist (6c0490f1f, built 2026-10-16
> 22:58). `m0.json`: `complete: true`, `probeVersion: 3`, 102 windows, same scenario counts. The
> analysis below is from the probe 1 run; F6 is still present at probe 3: `scrollFrames` show
> scrollTop 0 at rAF 1 or 2 in S3 `non-retained-1` and S4 `first-open-1/2/3`, then a jump to the
> bottom. 43 of 102 windows have a long task over 50 ms.

Source: `m0.json` (102 windows: S1 30, S2 10, S3 5, S4 3, S5 2, S6 44, S7 4, S8 4) and `m0-frames/`.
Frame `atMs` is relative to the click (negative = before the click). Window file prefix:
`s2-NN-*` = S2 window NN, `s4-02-*` = first-open-2, and so on. Screencast only emits on paint, so a
frozen main thread shows as a gap between frames.

## Q1. F6 first-frame scroll: CONFIRMED (S4 3/3, S3 1/5, S6 reduced-motion 2/10; not S2 default)

`scrollFrames` = scrollTop/scrollHeight of the active scroller at three chained rAFs after the click.
Pinned-bottom target is scrollHeight minus 577 px (viewport).

| Window | rAF 1 | rAF 2 | rAF 3 | Reading |
| --- | --- | --- | --- | --- |
| S4 first-open-1 | 5725/6302 (previous session) | **0**/1542 | 965/1542 | new transcript at top for frame 2, then +965 px jump |
| S4 first-open-2 | 965/1542 (previous) | **0**/6374 | 5755/6332 | top for frame 2, then +5755 px jump |
| S4 first-open-3 | 5377/5954 (previous) | **0**/6374 | 5755/6332 | same, +5755 px |
| S3 non-retained-1 | **0**/6902 | 6325/6902 | 5989/6566 | top at frame 1, then +6325 px, then a second correction (-336 px, scrollHeight 6902 to 6566) |
| S6 reduced-retained-2, -3 | **0**/6680 | 6103/6680 | 5683/6260 | top at frame 1, jump +6103, then correction -420 |
| S6 reduced-retained-1 | 14945/15522 | **0**/6302 | 5641/6218 | top at frame 2, then +5641 |

- S2 default retained swaps (10 windows) and S3 non-retained-2..5: target scrollTop from rAF 1
  (e.g. retained-3 5683/6260 x3). Not affected.
- Frames show it for S4: `s4-02-000.png` (@374), `s4-02-003.png` (@439) and `s4-02-004.png` (@447)
  show NEW_1 at the very top ("Load earlier messages", Turn 13-15); `s4-02-006.png` (@504) is already
  at the bottom (Turn 66 region). So about 5 captured frames over ~70 ms paint the wrong position,
  with a jump of about 5.7k px. `s4-03-000.png` shows the same for first-open-3 (NEW_2, Turn 13-15 at top).
  `s4-01-005.png` (@280) and `s4-01-006.png` (@289) show NEW_0 at top (Turn 0, 1, 2) at full
  opacity; scrollFrames then show 965 (bottom) at rAF 3. About 2 captured frames, jump 965 px.
- S3 non-retained-1: the first captured post-click frame `s3-01-002.png` (@479) is already at the
  bottom, because 237 ms + 164 ms long tasks delayed the first paint. The wrong scroll is in
  `scrollFrames` only, not in a frame.
- Severity: 1 to 3 painted frames (S4: up to ~5 frames / 70 ms) at the top, jump 965 to 5755 px, up
  to 6.3k px in S3. In S4 the content at the top is fully opaque (not hidden by the stagger), so the
  user sees the thread start and then snap to the end. This is the "first-open" case, which is the
  user-facing path the plan calls out. It meets the plan trigger "M0 shows a wrong-scroll first frame".

## Q2. F7 empty-state flash: NOT observed

- No `blankHost` field exists in `m0.json`. The only probe is `samples.*.blank`: `false` in every S2
  to S5 sample (at0 / at50 / at100 / at400). The single `true` is S7 `keyboard-during-transition`
  at400, surface "Setup hub" (a different surface with no transcript, not F7).
- Frames of S4 (`s4-01-004..006`, `s4-02-000..011`, `s4-03-000`) and S3 (`s3-01-002`, `-009`): no
  `ptah-chat-empty-state` in any viewed frame. The first post-click frame already holds the
  transcript. The "blank" areas that do appear are the stagger (Q3), where the header and the rows
  exist at opacity 0 (ghost text visible in `s4-02-004.png`, `s3-01-009.png`).
- Caveat: the fixture sessions have their history preloaded, so M0 cannot exercise the async
  history-load path. B8's condition ("only if M0 shows the flash") is not met. If wanted later, it
  needs a fixture with delayed history, not a code change now.

## Q3. F1 stagger (current CV-2.1 entrance): CONFIRMED, the visible bottom is late

- S2 retained-3 (`s2-03-*`): `s2-03-000` (@-66) old session RAIL_1 with composer. `s2-03-001`
  (@304) is the first post-click frame: new header (RAIL_2) but the transcript pane is empty (no
  message, no composer). Frames 001 to 013 (@304 to @612) are all blank transcript (`s2-03-004`
  @386, `-008` @491, `-011` @571 viewed). The composer reappears only at about @418 to @491
  (file size step at `s2-03-006`; visible in `-008`), which is the `.st-f` fade-in (F2). The
  first visible bottom messages are `s2-03-014` (@647), still a faint ghost (Turn 67/68 at low opacity).
- So the bottom, in-view messages are invisible for at least ~340 ms of captured frames and only
  just starting at ~650 ms. Matches F1: the first 8 stagger slots are consumed by off-screen
  top turns, and the visible ones wait the capped 360 ms (backwards fill).
- `samples.at50` (taken at +210 to +395 ms because of the long task): 79 to 81 animations, of which
  36 are `ptahStaggerUp st-t`, 12 `execFadeIn`, 1 `ptahFadeIn st-f`, 1 `rail-lane-enter`. At at400, 49
  remain, 36 of them the stagger. In S4 at50 has 9 `st-t`.
- Instrumentation gap: `entrance.placements[].delayMs / entranceIndex / animationNames` and
  `firstVisibleDelayMs` are `null`/empty in all 20 non-S1 windows (6 `visibleAtSwitch` ids, 0
  animated placements). The probe targets `.chat-msg-slot`, but the animations run on `.st-t`
  children. The F1 delay therefore comes from frames and `getAnimations` targets, not from
  `placements`. M1 will have the same blind spot unless the probe selector is fixed.

## Q4. Long tasks (>50 ms; `longTasks.entries`, offset from `clickTimes[0]`)

| Scenario | Windows | Windows with LT>50 | Tasks | Max (ms) | Sum (ms) | Aligned with the switch |
| --- | --- | --- | --- | --- | --- | --- |
| S1 page round trips | 30 | 1 | 1 | 68 (round-1-tasks) | 68 | one-off, first Tasks view, click+126 |
| S2 retained swap | 10 | **10** | 21 | **292** (retained-1) | 2816 (avg 282 per window) | 7/10 start 1 to 4 ms after the click (189 to 292 ms), the other 3 start ~230 ms; second task of 51 to 135 ms at +240 to +365 |
| S3 non-retained | 5 | 1 (non-retained-1) | 3 | 237 | 592 | click+9 (237), +247 (164), +479 (191); windows 2 to 5 clean (0 LT) |
| S4 first open | 3 | **3** | 8 | **303** (first-open-3) | 1504 (avg 501) | all start click+5..12; follow-ups +253..+333 (79-122) and +485..+495 (184-190) |
| S5 rapid | 2 | 1 (focus-five) | 2 | 262 | 340 | click+1 (262), +275 (78); page-three clean |
| S6 reduced: S1 | 30 | 14 | 28 | 250 (round-2-canvas) | 2928 | 7 of them start within 15 ms of click |
| S6 reduced: S2 | 10 | **10** | 26 | **331** (reduced-retained-4) | 3530 (avg 353) | 8/10 start within 15 ms of click |
| S6 reduced: S8 | 4 | 4 | 16 | 343 (split-open-2) | 2356 | 4/4 |
| S7 | 4 | 0 | 0 | 0 | 0 | none |
| S8 split | 4 | 4 | 8 | 267 (split-open-1) | 907 | 3/4 within 15 ms of click |

- Session switches are the problem: every S2 and S4 window runs a 190 to 330 ms task that begins
  in the click tick (the render plus `playEnter` `querySelectorAll`/forced layout in F3), then one to
  two more tasks of 50 to 190 ms. This blocks the first post-click paint until ~250 to 450 ms
  (`samples.at50.atMs` is 210 to 457 instead of ~50). Page switches (S1) are essentially free by
  comparison (1 task of 68 ms in 30 windows).
- Reduced motion does not remove the cost: S6 session swaps have the same 150 to 330 ms tasks
  (reduced-retained-4: 331), so the cost is render/mount work, not the animation. `reduced-retained-1..3`
  also show a different tail (200 ms+) with the S6 `samples.at50.animations` at 381 on retained-3
  (probably a layout/animation-count artefact, not investigated).
- `attribution` is "unavailable" for all entries (`longTaskReport[].attribution`), so the culprit
  inside the task is not named. For the U2 report to TASK_2026_629 row 74: session switch long
  tasks are 190 to 330 ms in 100% of S2/S4 windows (peak 331 ms) and start inside the click tick;
  S1 page transitions 1/30 (68 ms).
- Other M0 numbers worth keeping: layoutShift ~0.005 on S4 (negligible); `memoryS2` before 22188
  nodes / 3273 listeners, after GC 12411 / 1581; trace `droppedFrames` 0 in the sampled windows.

## Decision for the plan

- B7 (F6): run. Evidence: S4 3/3 and S3-1 and two S6 windows (`scrollFrames` rAF 1 or 2 at scrollTop 0
  then a jump of 965 to 6325 px), frames `s4-02-000/003/004`, `s4-03-000`, `s4-01-005/006`.
- B8 (F7): close as "not needed (M0)". Caveat above: fixture history is preloaded.
