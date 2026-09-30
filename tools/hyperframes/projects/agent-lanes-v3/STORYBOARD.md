---
format: 1920x1080
duration: 46.567s
message: "One prompt puts a whole AI team to work, and every result comes back to your session."
arc: Hook → Ask → Delegate → Parallel lanes → Pushed result → Peer sessions → Pull-back → Lockup
audience: developers who already use AI coding agents
mode: collaborative
version: v1
---

# Agent lanes v3 — storyboard v1

## Decisions

- **Message:** One prompt puts a whole AI team to work, and every result comes back to your session.
- **Audience and arc:** developers who use AI coding agents. Hook → ask → four features → pull-back → lockup.
- **Format:** 1920x1080, 30 fps, 46.567 s (26 bars). No voiceover. Music + SFX. No captions (on-screen type carries the story).
- **Spine:** one Ptah app window with four live sessions in the `2+2` canvas. Every feature scene is a camera dive into that same window (a slot, the Agents rail, or the footer). The pull-back in Frame 12 shows that all of it ran in one window at once.
- **Sandwich rhythm:** kinetic title (1 bar) → shader seam → live-UI dive (2-3 bars) → shader seam → next title. Titles say the claim; dives prove it with real UI states.
- **Held frame:** Frame 12, bar 2 (39.403-41.194). The camera stops; only streaming text moves; the line lands.

## Beat grid (from `beats/assets/music/mixkit-uplifting-bass.mp3.json`)

- 134 BPM. Beat B = 0.448 s. Bar = 1.791 s. Music `data-media-start="12.575"` (music bar 7), so the drop (music 14.366 s) lands at film 1.791 s.
- Every cut is on a bar downbeat. Every entrance is on a beat. Kit `cues` are frame-local seconds on this grid.
- Music: fade out over the last bar (44.776-46.567). The last 0.9 s hold still.

## Camera convention (all dive frames)

- The world is `app-window` (1920x1080, u = 1) with four `session-shell` mounts at the `2+2` slot rectangles (SPEC 4.11). Feature components mount inside a slot's body rectangle.
- A slot renders at u = 0.43. A reading framing uses camera scale >= 2.4 on that slot, so on-screen u >= 1.03 and the 26 px floor holds. The overview (scale 1.0) is for geography only, never for reading.
- Camera = one non-timed wrapper (`.cam`) with `translate + scale` keyframes (`/hyperframes-keyframes`, rule `viewport-change`). The kit focus beat of the target part fires on the same beat as each punch-in.
- Risk to verify at the first draft: crisp text at scale 2.4-3.5 on u = 0.43 mounts. Fallback: author the world at 2.4x (u = 1.03 mounts) and show the overview at camera scale 0.417.

## Brand tokens (from `kits/ptah-ui/SPEC.md` §1)

| Role | Value |
| --- | --- |
| Background | `#131317` flat + one static vignette (SPEC 3.4a) |
| Text | `#e8e6e1`; muted `oklch(63% .007 23)` |
| Accent (one word per title, focus ring) | Pharaoh gold `#d4af37` |
| Product state | primary `#2563eb`, info `#3b82f6`, success `#16a34a` |
| Display type | Archivo Black, 110-140 px, uppercase, tracking -0.01em |
| UI type | Inter / JetBrains Mono through the kit roles (26-36 px at u = 1) |
| Eases | `expo.out` camera landings and slams, `expo.inOut` camera travel, `power3.out` UI settles, `back.out(1.6)` chips |

## Bans

- No drifting blobs, particles, bokeh, or grain on UI frames (v2 review). One static vignette only.
- No screenshots and no generic cards. Every UI surface is a `ptah-ui` kit component.
- No text under 26 px on screen at a reading moment. No shrunken mounts.
- No elastic or bounce on product UI. Type slams only.
- No "delivered", "received", or "acknowledged" for Peer. Only "Accepted".
- Motion failures to avoid: the slideshow (a title with nothing live behind the next seam) and the screensaver (camera drift with no UI state change).

## Seam map

| Time | From → To | Seam | Dur |
| --- | --- | --- | --- |
| 3.582 | 01 → 02 | shader `glitch` | 0.35 |
| 5.373 | 02 → 03 | shader `cinematic-zoom` | 0.40 |
| 8.955 | 03 → 04 | shader `whip-pan` (leftward) | 0.30 |
| 10.746 | 04 → 05 | shader `cinematic-zoom` | 0.40 |
| 16.119 | 05 → 06 | shader `whip-pan` (leftward) | 0.30 |
| 17.910 | 06 → 07 | shader `cinematic-zoom` | 0.40 |
| 23.283 | 07 → 08 | shader `whip-pan` (leftward) | 0.30 |
| 25.074 | 08 → 09 | shader `chromatic-split` | 0.35 |
| 30.448 | 09 → 10 | shader `whip-pan` (leftward) | 0.30 |
| 32.239 | 10 → 11 | shader `cinematic-zoom` | 0.40 |
| 37.612 | 11 → 12 | hard cut on an identical frame (same world, same camera) | 0 |
| 41.194 | 12 → 13 | shader `light-leak` | 0.50 |

Direction rule: every whip-pan goes leftward. Every `cinematic-zoom` goes into a dive.

## Audio plan

- Music bed on track 10, volume 0.6, `data-media-start="12.575"`, fade-out automation over the last bar.
- SFX bus: one `<hf-audio-group id="sfx">` (`/hyperframes-audio`) with a compressor and a limiter, fader -2 dB. Every SFX clip below sits in it.
- The music ducks -4 dB for 0.3 s under each title slam (automation on the bed, not a carve: there is no voiceover).

## Still open

1. Title copy (Frames 02, 04, 06, 08, 10, 12) — approve or rewrite.
2. Lane names "Glm" and "Antigravity" (SPEC defaults). The CLI roster is per user; any two real CLI names work.
3. Outro line "Coding Orchestra" (app title bar caption, SPEC 4.11) and pill "Free and open source · ptah.live" (landing page JSON-LD).
4. Length 46.6 s (v2 was 60 s). Faster pace answers the "too slow" note on the footage promo.
5. Frame 11 does not show the peer session receiving the message (the product cannot observe that; SPEC 4.10).

## Locked

- Storyboard v1 approved by the user on 2026-10-01 as written, including the inferred items under "Still open" (title copy, lane names, outro copy, 46.6 s length). Sketch pass skipped: build scene by scene with a preview per scene.
- Frame 1 approved on 2026-10-01.

## Build notes

- Frames are fragments assembled into `index.html` by `node assemble.mjs` (kit mounts nested in sub-compositions collapse; see `tools/hyperframes/HANDOFF.md`).
- Frame 1: the vignette sits under the UI (above it, it darkened corner badges below 4.5:1). Glitch = one SVG filter on a lens wrapper (RGB split + turbulence slice displacement + blur 3.5 px max), a pure function of quantized time.

## Frame 1 — Hook: glitch to clarity

- status: animated
- src: compositions/frames/01-hook.html
- duration: 3.582s
- start: 0.000
- transition_in: cut
- scene: A glitched macro of a running Bash badge snaps clean as the camera pulls out to four live sessions on the drop
- voiceover: onscreen
- poster: 2.4
- blueprint: zoom-out-workspace-reveal (Adapt: the macro detail is a live UI badge, the reveal lands on the drop)
- rules: chromatic-glitch, depth-of-field-blur, viewport-change, multi-phase-camera
- kit: app-window (layout 2+2, activeTab Chat, notifications "9+"), 4 × session-shell, tool-call-row (Bash) in slot 1, chat-message streaming in slots 0, 2, 3
- camera: 0.000-0.591 hold at 3.5 on slot 1's tool badge; 0.591-1.791 3.5 → 1.0 `expo.inOut`; 1.791-3.582 hold 1.0 with 1.0 → 1.02 drift
- sfx: glitch-1 0.000, glitch-2 0.448, glitch-3 0.896, riser 0.300, impact-bass-1 1.791, click-soft 2.687
- constraint: no logo, no title in the hook; the product UI is the hook

On screen at 0.000: a blurred, RGB-split close-up of the `tool-call-row` badge "Bash" (info fill, spinner) with the live text "Executing Bash...". The app-window entrance cues are compressed into 0-0.3 s under the glitch, so the window is complete before it is readable.

Motion: chromatic split ±24 px and `blur(18px)` on the camera wrapper, with slice bursts on beats 1-3 (quantized hash, rule `chromatic-glitch`). Split and blur tween to 0 over 0.591-1.791 while the camera travels 3.5 → 1.0. On beat 4 (1.343) the badge flips to success and the check springs. At the drop (1.791) the frame is clean: four sessions, each streaming. On beat 4 of bar 2 (3.134) the gold focus ring fades in on slot 0 to set up the next dive.

Why: the viewer sees real work before any claim, and the "clarity" moment is the product at full scale.

## Frame 2 — Title: one prompt

- status: outline
- src: compositions/frames/02-title-team.html
- duration: 1.791s
- start: 3.582
- transition_in: glitch
- scene: Three slams on three beats, gold on the last line
- voiceover: onscreen
- poster: 1.2
- blueprint: kinetic-type-beats
- rules: kinetic-beat-slam
- kit: none (flat `#131317` + vignette)
- camera: none
- sfx: impact-bass-2 0.000, click 0.448, click 0.896
- constraint: no product UI behind the words; no gradient text

On screen: "ONE PROMPT." (beat 1, scale-slam) · "A WHOLE" (beat 2, side-snap from the right) · "AI TEAM." in gold (beat 3, rise-rotate). Three lines, 130 px Archivo Black, left-aligned on a 160 px margin. Beat 4 holds.

Why: states the message in five words before the proof starts.

## Frame 3 — The ask

- status: outline
- src: compositions/frames/03-ask.html
- duration: 3.582s
- start: 5.373
- transition_in: cinematic-zoom
- scene: Slot 0's composer types one prompt and sends it
- voiceover: onscreen
- poster: 2.9
- blueprint: prompt-type-submit-generate (Adapt: the clip ends one beat after the submit)
- rules: viewport-change, press-release-spring
- kit: app-window, session-shell ×4 (slot 0 title "fix review on 579"), composer in slot 0 (typeRate 16, mode autopilot, busyFor 1.0)
- camera: 0.000-0.448 2.0 → 2.6 `expo.out` onto slot 0's composer; hold with 2.6 → 2.65 drift; 2.687 punch 2.65 → 3.0 on `send` (`expo.out`, 0.3 s)
- sfx: whoosh-short 0.000, typing 0.448-2.550, key-press 2.687, pop 2.800
- constraint: no cursor pointer; the press is scale + brighten (SPEC 3.2)

On screen: the composer card with "Full Auto (YOLO)", MCP "7/12", Peer, "Claude CLI" in the status line. The prompt types from beat 2 (0.448): "fix the review on 579 and verify it" (35 chars at 16 chars/s, ends 2.64). Send press on beat 3 of bar 2 (2.687) with the `send` focus beat; the text slides up and the stop button springs in.

Why: one prompt is the only human input in the whole film.

## Frame 4 — Title: it delegates

- status: outline
- src: compositions/frames/04-title-delegates.html
- duration: 1.791s
- start: 8.955
- transition_in: whip-pan
- scene: "IT DELEGATES." slams in two hits
- voiceover: onscreen
- poster: 1.0
- blueprint: kinetic-type-beats
- rules: kinetic-beat-slam
- kit: none
- camera: none
- sfx: impact-bass-1 0.000, click 0.448
- constraint: one line only; gold on "DELEGATES."

On screen: "IT" (beat 1) then "DELEGATES." in gold (beat 2), 140 px, centered. Beats 3-4 hold.

Why: names the first capability.

## Frame 5 — Delegate: a specialist on call

- status: outline
- src: compositions/frames/05-delegate.html
- duration: 5.373s
- start: 10.746
- transition_in: cinematic-zoom
- scene: Slot 0 answers, spawns a backend-developer subagent, the user messages it, and it completes with stats
- voiceover: onscreen
- poster: 3.6
- blueprint: agent-progress-theater
- rules: viewport-change, anchored-layout-expand, spring-pop-entrance
- kit: app-window, session-shell ×4, chat-message (assistant) + subagent-bubble (agentType backend-developer, task "Fix review on 579", state running → completed, showMessage true) in slot 0's body
- camera: 0.000-0.448 2.0 → 2.5 onto slot 0's body; 1.791 punch 2.5 → 3.0 on `message-agent` (`expo.out`); 3.582 release 3.0 → 2.6 onto `stats`
- sfx: whoosh-short 0.000, pop 0.896, click 1.791, typing 2.239-3.920, key-press 4.030, chime 4.925
- constraint: no invented UI; every string from SPEC 4.2 / 4.6 defaults or the brief

On screen: assistant message streams "I'll hand the review fixes to a **backend-developer** and verify after." (beats 1-2). Beat 3 (0.896): the subagent bubble settles with the agent-color avatar "B", "Streaming" badge, status row "last: Grep". Bar 2 downbeat (1.791): "Message agent" press, input expands; from 2.239 "Also check the curator fallback path." types (typeRate 22, ends 3.92); send on 4.030, "Message sent". Bar 3 beat 4 (4.925): state → completed, stats footer slides in ("Opus 5.5", "127 tokens", "$0.81", "13.2s").

Why: shows delegation and that you can steer a running specialist.

## Frame 6 — Title: lanes in parallel

- status: outline
- src: compositions/frames/06-title-lanes.html
- duration: 1.791s
- start: 16.119
- transition_in: whip-pan
- scene: "LANES RUN / IN PARALLEL." two slams
- voiceover: onscreen
- poster: 1.0
- blueprint: kinetic-type-beats
- rules: kinetic-beat-slam
- kit: none
- camera: none
- sfx: impact-bass-2 0.000, click 0.448
- constraint: gold on "PARALLEL."

On screen: "LANES RUN" (beat 1) · "IN PARALLEL." (beat 2, gold). Beats 3-4 hold.

Why: names the second capability.

## Frame 7 — Lanes: two CLIs at once

- status: outline
- src: compositions/frames/07-lanes.html
- duration: 5.373s
- start: 17.910
- transition_in: cinematic-zoom
- scene: The camera travels to the Agents rail; the Agents panel opens and two lanes stream tool rows side by side
- voiceover: onscreen
- poster: 3.4
- blueprint: camera-journey (sub-shape A: cause in one place, consequence in another)
- rules: viewport-change, grid-card-assemble stagger timing, spring-pop-entrance
- kit: app-window (Agents rail focus), session-shell ×4, agents-panel mounted over the right of the canvas (count 2, lane1 "Glm", lane2 "Antigravity", both running → completed, rowGap 0.448)
- camera: 0.000 open at 1.0 on the window; 0.000-0.896 travel 1.0 → 1.6 to the right half (`expo.inOut`); 1.791 settle 1.6 → 1.75 onto the two lane columns; 4.478 punch 1.75 → 2.2 on `lane-1` status dot
- sfx: whoosh 0.000, click-soft on every row start (0.896 + n × 0.448), ping 4.478, ping 4.925
- constraint: both columns must visibly move at the same time; no sequential "one then the other"

On screen: the "Agents" header with count badge "2", tabs "Glm" and "Antigravity" with info dots, two lane columns. Rows arrive one per beat in both lanes at once: Read `.../git/run-stage-failure.spec.ts`, Thinking, Bash "Show git operation constants", Write `.../reviews/p1-approval.md` (lane 1); `view_file`, `write_to_file`, `call_mcp_tool` (lane 2). Each row runs pending → running → done. Bar 3 beats 3-4: both dots flip to success, tab checks spring.

Why: proves parallel lanes with the real panel, not a diagram.

## Frame 8 — Title: no polling

- status: outline
- src: compositions/frames/08-title-push.html
- duration: 1.791s
- start: 23.283
- transition_in: whip-pan
- scene: "NO POLLING." slams, a sub-line settles under it
- voiceover: onscreen
- poster: 1.2
- blueprint: kinetic-type-beats
- rules: kinetic-beat-slam, waterfall-entry
- kit: none
- camera: none
- sfx: impact-bass-1 0.000, whoosh-short 0.896
- constraint: sub-line >= 56 px

On screen: "NO POLLING." in gold (beat 1, 140 px). Beat 3: "The result is pushed to the session that spawned the lane." (56 px Inter 600, muted).

Why: names the third capability in plain words.

## Frame 9 — Report delivered, pushed back

- status: outline
- src: compositions/frames/09-report-push.html
- duration: 5.373s
- start: 25.074
- transition_in: chromatic-split
- scene: Lane Glm's report row expands to "Report Delivered"; the camera swoops to slot 0 where the lane toast lands
- voiceover: onscreen
- poster: 4.2
- blueprint: camera-journey (sub-shape A)
- rules: viewport-change, anchored-layout-expand, spring-pop-entrance
- kit: app-window, session-shell ×4, agents-panel (held completed state), agent-report-card in lane 1, lane-completion-toast (agent Glm, verdict delivered) anchored bottom-right of slot 0
- camera: 0.000 open at 2.4 on lane 1's last row; 1.343 punch 2.4 → 2.8 on `heading`; 2.687-3.582 swoop to slot 0 at 2.4 (`expo.inOut`); 4.030 punch 2.4 → 2.9 on `chip-verdict`
- sfx: click 0.000, sparkle 1.343, whoosh-cinematic 2.687, notification 3.582, pop 4.030
- constraint: the toast carries the eyebrow "PUSHED TO THE PARENT SESSION"; no fake notification chrome

On screen: gold two-badge row "Ptah Superpower" + "ptah agent report", spinner, check, expand: "Report Delivered", "Delivered: Yes", "Parent Session: 903993f2-…". Swoop. Toast: "Lane Glm finished: completed", chip "delivered", "Task: Review batch 5 code logic", ".../reviews/batch-5-code-logic-review.md - 4120 bytes".

Why: shows the result coming back without the user asking for it.

## Frame 10 — Title: sessions talk

- status: outline
- src: compositions/frames/10-title-peer.html
- duration: 1.791s
- start: 30.448
- transition_in: whip-pan
- scene: "SESSIONS / TALK TO / EACH OTHER." three slams
- voiceover: onscreen
- poster: 1.2
- blueprint: kinetic-type-beats
- rules: kinetic-beat-slam
- kit: none
- camera: none
- sfx: impact-bass-2 0.000, click 0.448, click 0.896
- constraint: gold on "EACH OTHER."

On screen: "SESSIONS" (beat 1) · "TALK TO" (beat 2) · "EACH OTHER." gold (beat 3), 130 px. Beat 4 holds.

Why: names the fourth capability.

## Frame 11 — Peer: accepted

- status: outline
- src: compositions/frames/11-peer.html
- duration: 5.373s
- start: 32.239
- transition_in: cinematic-zoom
- scene: Slot 0's Peer chip opens "Message Peer Session", a message types to "review memory work", and the status reads Accepted
- voiceover: onscreen
- poster: 4.6
- blueprint: cursor-ui-demo (Adapt: cursorless; presses are scale + brighten)
- rules: viewport-change, press-release-spring, anchored-layout-expand
- kit: app-window, session-shell ×4 (slot 3 title "review memory work"), peer-send (target "review memory work", workspace "ptah-extension", outcome accepted)
- camera: 0.000 open at 2.6 on slot 0's footer `Peer` chip; 0.448-0.896 pull 2.6 → 1.35 as the dialog opens (dialog at u >= 1 on screen); 3.582 punch 1.35 → 1.9 on `outcome`
- sfx: click 0.448, whoosh-short 0.500, typing 1.343-3.020, key-press 3.134, ping 3.582
- constraint: the words "delivered", "received", "acknowledged" never appear

On screen: dialog "Message Peer Session", "Target Peer Session: review memory work", "Workspace: ptah-extension" + "reachable", the notice box, message "Batch 5 review is approved. Start P2." (37 chars, typeRate 22, 1.343-3.02). Send press on 3.134, spinner, bar 3 downbeat (3.582): outcome panel, "Status: Accepted", "Target: review memory work"; first caveat line streams.

Why: shows cross-session messaging with the product's own honest wording.

## Frame 12 — Pull-back: one window (held frame)

- status: outline
- src: compositions/frames/12-pullback.html
- duration: 3.582s
- start: 37.612
- transition_in: cut
- scene: The camera pulls back from the Peer outcome to the full window; four sessions live; a line lands and the frame holds
- voiceover: onscreen
- poster: 3.0
- blueprint: zoom-out-workspace-reveal
- rules: viewport-change, multi-phase-camera, kinetic-beat-slam
- kit: app-window, session-shell ×4 (all streaming), agents-panel closed to the rail, lane toast still visible in slot 0
- camera: 0.000 open on Frame 11's last camera (1.9 on `outcome`); 0.000-1.343 one decelerating pull 1.9 → 0.82 (`expo.out`); 1.791-3.582 locked, no drift
- sfx: whoosh-cinematic 0.000, impact-bass-1 1.791
- constraint: nothing but streaming text moves in bar 2

On screen: the whole app window at scale 0.82 on the flat background with the vignette. Bar 2 downbeat (1.791): "ONE APP. THE WHOLE TEAM." slams below the window, 110 px, gold on "THE WHOLE TEAM." Held to the seam.

Why: the scale payoff; everything shown ran in one window at once.

## Frame 13 — Outro lockup

- status: outline
- src: compositions/frames/13-outro.html
- duration: 5.373s
- start: 41.194
- transition_in: light-leak
- scene: The Ptah icon assembles, the wordmark and caption settle, the CTA pill springs, then the frame holds
- voiceover: onscreen
- poster: 4.5
- blueprint: logo-assemble-lockup
- rules: spring-pop-entrance, waterfall-entry, svg-path-draw
- kit: none (registry `logo-outro` block adapted to the brand tokens, or a hand-built lockup if it does not fit)
- camera: none
- sfx: impact-bass-2 0.000, sparkle 0.448, pop 1.343, chime 1.791
- constraint: no drifting glow; the last 0.9 s are still

On screen: `ptah-icon.png` (220 px) assembles on beat 1; "Ptah" wordmark (Archivo Black 150 px) on beat 2; "Coding Orchestra" (Inter 44 px, muted) on beat 3; bar 2 downbeat (1.791) pill "Free and open source · ptah.live" (primary fill, 40 px) springs. Bars 2-3 hold; music fades over bar 3.

Why: brand and the one action.
