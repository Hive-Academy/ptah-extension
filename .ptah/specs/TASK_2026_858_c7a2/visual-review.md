# Visual review - TASK_2026_858_c7a2 (staggered enter and class-based leave of chat messages)

Verdict: **FAIL**

Two defects block the checklist.
- Defect 1 (Serious): the first reply of a new session enters twice. The streaming row is replaced by a second row that runs the enter animation again.
- Defect 2 (Serious): no tested UI path shows a row stagger. Every batch of more than one row is suppressed as a tab edge. The delay `index x 36 ms` was never seen.

All other items pass or pass with notes. No product code was edited. All evidence is in `visual-review/`.

## Environment

- Real Electron app. Playwright `_electron`, one instance at a time, real backend (Claude CLI, real replies).
- Bundle: `dist/apps/ptah-electron/main.mjs` of the worktree, not rebuilt. I copied the bundle folder to `%TEMP%\ptah-stagger-app` with a node_modules junction. The SHA-256 of `main.mjs` is the same in both places (`EEDE6531...DCE06`).
  - Reason for the copy: the app refuses sessions of `D:\projects\ptah-extension` when the app folder is inside that path (`SESSION_FOLDER_UNAVAILABLE`, `workspace-path-guards.ts` "ancestor of app installation directory"). This is a test-setup limit, not a defect of the feature.
- Profile: `%TEMP%\ptah-stagger-udd` (copy of the earlier motion profile). Database: a copy of `~/.ptah/state/ptah-dev.sqlite` at `%TEMP%\ptah-stagger-db`. Workspace: `D:/projects/ptah-extension` (CLI argument).
- Window: 1186 x 780 DIP (about 1758 x 1077 px in the PNG files, device pixel ratio 1.5).
- Flags on every run except the Reduce run: `--force-prefers-no-reduced-motion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion`. The occlusion flags stop Chromium from slowing `requestAnimationFrame` to 1 Hz in a covered window.
- `process.versions.chrome` = **152.0.7977.130**. `CSS.supports('interpolate-size','allow-keywords')` = **true**.
- Instrumentation: MutationObserver on `.chat-msg-item` (add, remove, class, style, `inert`, `aria-hidden`, `data-ptah-leaving`, `data-ptah-leave-cut`), `requestAnimationFrame` sampler (rect, opacity, transform, `document.getAnimations()` name, delay, duration, keyframe properties), `PerformanceObserver('longtask')`, CDP `Page.startScreencast` frames. Scripts: `visual-review/scripts/`. Raw data: `*.json`.
- Sessions: the list shows 55 messages for the longest session that opened (`agent-lanes`). I did not find a session with 200 or more messages that the app can open. See item 2.
- Cost note: each real reply used the Claude CLI (about 0.5 USD for the first reply of a session). The first reply of a new session took 27 to 93 s.

## Checklist

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Themes and presets | PASS WITH NOTES | See "Preset table". All six presets in dark; Rise and Slide left in light and in glass. Stagger index above 0 never seen (Defect 2). |
| 2 | Open long session into the current empty tab: staggered rows are the visible rows, no flash, view at bottom | FAIL (see Defect 2) | New empty tab plus Previous sessions: 18 rows added, 0 with `ptah-msg-enter`, scroller class `ptah-pane-switch-enter` (`s2c.json`, `s2c_final.png`, frames `s2c`). Long session (55 messages): 30 rows added at once, 0 enter classes, view at bottom (`scrollTop 5124 + clientHeight 337 = scrollHeight 5462 - 1`) (`d.json`, `d_open_final.png`). No flash, no jump. The plan says a tab edge shows the pane switch only. |
| 2b | New tab: pane switch only | PASS | Same data as item 2: pane-switch class present, no row animation. |
| 3 | Tab switch to loaded tab and to replay tab: no stagger | PASS WITH NOTES | `tabs.cjs` run, 5 switches: rows added 0 to 2, 0 enter classes, 0 removals. The pane-switch class was not seen on the sampled scroller in these switches (the click may only move the card focus). |
| 4 | Chat to settings to chat: window crossfade only | PASS | 0 rows added, 0 enter classes, 0 item animations. `html` class went `ptah-vt-active` -> `` -> `ptah-vt-active` -> `ptah-vt-none` -> `` (View Transition) (`scripts/` run of `misc.cjs`). |
| 5 | Send and stream: user enters once, reply enters once, no re-entry | FAIL (see Defect 1) | User row: one add, one enter (all runs). Chunks: row height changes only (126.8 -> 148.9 -> 101.4 px), no extra add (`r5_turn2.json`). Turn 2 finalize: one add, no second add. First reply of a new session: second row added with enter (`r5_turn1.json`, `r6_turn1.json`). |
| 6 | Scroll up, older history: no animation, anchor does not move | PASS | 4 scroll-to-top passes on the 55-message session: rows 30 -> 42, 12 adds, 0 enter classes, 0 removals. Anchor row top min = max for 1.8 s each pass (e.g. -111.8 / -111.8). `scrollHeight` 5462 -> 10815 (`d.json`, `d_scrolled_top.png`). |
| 7 | Rewind and clear: leave without snap, Tab, inert, locator, rows above viewport | PASS WITH NOTES | Rewind removed 4 rows. Light: heights shrink 79.3 -> 20.8 px at 109 ms, nodes removed at +222 ms, no jump of other rows (`r5_rewind.json`, `r5_after_rewind.png`). Inert and `aria-hidden="true"` set in the same pass as `data-ptah-leaving` (events at one timestamp). 12 Tab presses from 25 ms after the click: focus never inside a leaving node. Locator note and untested parts below. |
| 7b | Rewind then send within 230 ms | NOT TESTED | Rewind dialog needs a confirm click; I did not repeat the run with a send inside the window. |
| 8 | Glass: enter no opacity change, leave a cut, no blur flicker | PASS WITH NOTES | Enter: animation `ptahMotionEnterGlass`, keyframe property `transform` only, sampled opacity 1 on every frame (`m1_ptah-glass_Rise`, `m2_ptah-glass_Slideleft`). Leave: `display: none` on the first frame (`LN` flag), node kept 266 ms (`r6_rewind.json`). Blur flicker: not measured; I did not inspect the frames one by one. |
| 9 | Reduce motion (UI setting and flag) | PASS | UI "Reduce motion" set, restart, `matchMedia('(prefers-reduced-motion: reduce)')` = true (`rm_setting_Reducemotion.png`). User row: enter animation duration 0.01 ms, delay 0, computed `animation-name` none after one frame; no visible motion (`rm_after.png`). The Reduce flag is the same Chromium switch. Leave under Reduce: not run (needs a reply to rewind); CSS has `display: none`. Setting restored to "Always animate". |
| 10 | Performance | PASS WITH NOTES | `process.versions.chrome` 152, `interpolate-size` true. Enter animates `opacity` and `transform` only (glass: `transform` only). Leave animates `height` (layout) and `margin` by design: heights measured per frame, 4 rows, no long task in the rewind window except 58 to 90 ms tasks that coincide with the dialog and the re-render. Long tasks of 50 to 95 ms in the send window of every combo (`lt` in `scripts/suite*.out`). Only 1 row animated at a time, so the 6-row worst case was not tested. |

## Preset table (enter of the appended user row)

Values are the sampled start values of the animation. Duration 320 ms, delay 0 ms (single row, index 0) in every case.

| Theme | Preset | Animation | Properties | Start | Evidence |
|-------|--------|-----------|------------|-------|----------|
| glass (`ptah-glass`) | Rise | `ptahMotionEnterGlass` | transform | opacity 1, ty 18 px | `m1_ptah-glass_Rise_after.png`, frames `m1_ptah-glass_Rise_*` |
| glass | Slide left | `ptahMotionEnterGlass` | transform | opacity 1, tx 32 px | `m2_ptah-glass_Slideleft_after.png` |
| light (`anubis-light`) | Rise | `ptahMotionEnter` | opacity, transform | opacity 0, ty 18 px | `m3_anubis-light_Rise_after.png` |
| light | Slide left | `ptahMotionEnter` | opacity, transform | opacity 0, tx 32 px | `m4_anubis-light_Slideleft_after.png` |
| dark (`anubis`) | Fade | `ptahMotionEnter` | opacity, transform | opacity 0, no translate | `m5_anubis_Fade_after.png` |
| dark | Rise (default) | `ptahMotionEnter` | opacity, transform | opacity 0, ty 18 px | `m6_anubis_Rise_after.png` |
| dark | Slide left | `ptahMotionEnter` | opacity, transform | opacity 0, tx 32 px | `m7_anubis_Slideleft_after.png` |
| dark | Slide right | `ptahMotionEnter` | opacity, transform | opacity 0, tx -32 px | `m8_anubis_Slideright_after.png` |
| dark | Scale | `ptahMotionEnter` | opacity, transform | opacity 0, scale 0.94 | `m1_anubis_Scale_after.png` |
| dark | Direction-aware | `ptahMotionEnter` | opacity, transform | opacity 0, tx +32 px (append) | `m2_anubis_Directionaware_after.png` |

Dark, light and glass screenshots of the transcript: dark `m6_anubis_Rise_after.png`, light `r5_before_rewind.png` and `m3_anubis-light_Rise_after.png`, glass `m1_ptah-glass_Rise_after.png` and `s5_final.png`. Preset frames: `frames/m<n>_<theme>_<preset>_004..014.jpg`.

## Defects

### 1. Reply row enters twice on the first reply of a new session (Serious)

Requirement 5 says the reply enters once and does not re-enter on finalize.

Reproduction:
1. Open the app. Choose theme `anubis-light` (or any theme). Press "New session", then "Create".
2. Send "Reply with the single word one. No tools."
3. Wait for the reply (27 to 93 s).

Observed (`r5_turn1.json`, light, preset Direction-aware):
- t = 27182 ms: row `hp5u0` is added with `ptah-msg-enter`.
- t = 28363 ms: row `bbcfr` (new id) is added with `ptah-msg-enter`. Row `hp5u0` gets `ptah-msg-leave`. It was at opacity 0.78 and was still entering.
- The new row starts at opacity 0 and translates 32 px, at top 165.9 px. The old row moves down to top 304.7 px and collapses over 180 ms. For about 200 ms two copies of the reply show, and the reply fades in again.
- Glass (`r6_turn1.json`): same sequence, 142 ms apart (`fqohv` then `26hwh`). The old row is a cut, but the new row restarts the slide.
- Turn 2 of the same sessions has one add only (`r5_turn2.json`, `r6_turn2.json`). In the `suite*.out` runs (turns 2 to 8 of one session) the reply showed two adds in 9 of 10 turns; the second add had the enter class in 5 of those 9. The plan states that stream and finalize keep one id; this does not hold for these cases.
- I did not capture a frame of the swap: the screencast frame limit ended at 5.8 s. The sampler values above are the evidence.

Likely code location: the slot id of the streaming row differs from the id of the finalized row, and the finalize suppression is not active: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts` (slot ids, `isFinalizingTransition`, `replayMotionHold`), `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts:199`, and `transcript-motion.directive.ts` (`planEntrance` treats the new id as an added row).

### 2. Row stagger never runs in a real flow (Serious, may be by design)

Checklist item 2 expects staggered rows on opening a session into the current empty tab. Every multi-row batch I could trigger was suppressed:
- Previous sessions into a new empty tab (`s2c.json`): 18 rows, 0 enter.
- Previous sessions from the home page (long session): 30 rows, 0 enter.
- Tab switch, resume of an open session: 0 enter.
- Only single-row appends enter (user row, reply row). All had `--ptah-msg-i` = 0 and delay 0.

So the part "delay = index x 36 ms" and "max index 5" has no runtime proof. The plan's scope text says a tab edge shows the pane switch only, so this may match the design. The checklist and the plan disagree about "the first load into the active tab". A decision is needed: either accept that the stagger only shows on same-tab replaces and multi-row appends, or fix the gating so an open batch staggers. I found no UI path to a same-tab replace.

Likely code location: `chat-view.component.ts` `wireSessionEntrance` (`pendingEntranceTabId` is set on every tab id change, including a session loaded into an empty tab) and the activation edge in `transcript-motion.directive.ts` (`!this.wasActive && active`).

### 3. Notes (Minor, no action required)

- Leaving rows match `[data-testid="chat-user-message"]` for 220 ms (light) and 266 ms (glass), because the node stays in the DOM. A Playwright locator in strict mode would match two nodes only if a new user message is added in that window. In the rewind run the new user row came 740 ms later (`r5_rewind.json`: add `4e1ba` at +772 ms), so no duplicate occurred. Add `:not([data-ptah-leaving])` in e2e helpers (the plan already lists this rule).
- The user row re-added after a rewind has no enter animation (`add 4e1ba`, class `chat-msg-item` only).
- Focus was inside the leaving row for one sampled frame at the start of the leave (the Rewind button of the removed row). After that, focus moved to `body` and Tab went to the page controls (12 presses, 0 in a leaving node).

## Not tested

- Rows above the viewport during a leave (the transcript was one screen high).
- Rewind then send within 230 ms (item 7b).
- Clear and filter leave paths (no filter control for transcript rows found; rewind was the only leave trigger).
- A 200+ message session (longest openable: 55 messages).
- Row stagger of 6 rows and delay values above 0 (Defect 2).
- Glass blur flicker (not measured).
- Reduce-motion leave (CSS only).
- Light or glass with Fade, Slide right, Scale, Direction-aware (item 1 asks for Rise plus one other in light and glass: done).

## Final profile state

Test profile `%TEMP%\ptah-stagger-udd`: Motion "Always animate", theme and preset were left as the last run set them (isolated profile, not the user profile). No other Electron instance ran.
