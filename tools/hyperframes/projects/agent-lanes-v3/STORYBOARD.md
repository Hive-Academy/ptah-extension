---
format: 1920x1080
duration: 30.448s
message: "Your agents work in parallel lanes, and they talk back."
arc: Wait → Split → Parallel proof → Pushed back → They talk (report, message, peer) → Held line → Lockup
audience: developers who already use AI coding agents
mode: collaborative
version: v2
---

# Agent lanes — storyboard v2 (series pilot)

v1 (the 46.6 s dive film) is archived in `STORYBOARD-v1.md`. The user rejected it on 2026-10-01; see "Changes from v1".

## Decisions

- **Message:** Your agents work in parallel lanes, and they talk back.
- **Audience and arc:** developers who use AI coding agents. Wait (problem) → split into lanes (the turn) → proof → results pushed back → messaging (report, message, peer) → held line → lockup.
- **Format:** 1920x1080, 30 fps, 30.448 s (17 bars at 134 BPM). No voiceover. Music + SFX. No captions track: the caption bar carries the story.
- **Spine: the lane diagram.** One world for the whole film: your session is a node at the left, three lanes run to the right (Glm, Codex, Copilot), and a peer session node waits below. Every scene is a camera position in this diagram or a proof card that grows out of one of its nodes and returns into it.
- **Series grammar (this pilot sets it for the next feature promos):**
  1. Caption bar: top-left inside title-safe, Archivo Black 84 px uppercase, one gold word or phrase; an optional Inter 40 px muted sub-line. One caption per beat, never two.
  2. Diagram stage: flat `#131317`, lines 6 px, nodes 120 px, lane labels Inter 36 px. Packets are 28 px gold dots that travel along lines.
  3. Proof card: ONE real `ptah-ui` kit component at a time, centered, mounted at u 1.2-1.6, grown from its node (scale 0.1 → 1 from the node position, `expo.out` 0.45 s) and returned to it the same way. The diagram dims to 30% under a proof card.
  4. Seams: camera moves inside the one world and match cuts (an element of scene N becomes an element of scene N+1). One shader seam at most (into the lockup).
  5. Lockup: the session node becomes the Ptah icon; "Ptah" + the feature name + the CTA pill.
- **Held frame:** Frame 08 (25.075-26.866). Nothing moves; the line lands.

## Beat grid

- 134 BPM. Beat B = 0.448 s. Bar = 1.791 s. Music `data-media-start="12.575"`, so the drop lands at film 1.791 s (the split).
- Bar starts: 0.000, 1.791, 3.582, 5.373, 7.164, 8.955, 10.746, 12.537, 14.328, 16.119, 17.910, 19.701, 21.493, 23.284, 25.075, 26.866, 28.657, 30.448.
- Every scene change is on a bar. Every entrance is on a beat.

## Brand tokens (from `kits/ptah-ui/SPEC.md` §1)

| Role | Value |
| --- | --- |
| Background | `#131317` flat + one static vignette under the UI |
| Text | `#e8e6e1`; muted `#989291` (SPEC 1.5 deviation 2) |
| Accent | Pharaoh gold `#d4af37`: one caption word, packets, Ptah tool rows |
| Lane state | running info `#3b82f6`, completed success `#16a34a` |
| Display type | Archivo Black 84 px captions, 80 px held line (title-safe width) |
| UI type | Inter / JetBrains Mono through the kit roles (26 px floor on screen) |
| Eases | `expo.out` slams and card grows, `expo.inOut` camera travel, `power3.out` UI settles, `sine.inOut` packet travel |

## Bans

- Never more than one kit component on screen. No component placed over another component.
- No 2+2 session grid, no dense overview, no camera zoom to read small UI. A proof card is big when it appears.
- No caption that names an API (`ptah_agent_spawn`, `<agent-lane-completed>`) in the caption bar. Outcome language only; tool names appear only inside real UI.
- No "delivered", "received" or "read" for Peer. Only "Accepted".
- No claim that lanes are unlimited. (The film shows three; the default cap is 5, configurable to 20.)
- No drifting blobs, particles or grain. No elastic or bounce on product UI.
- Motion failures to avoid: the slideshow (a proof card with no diagram motion that led to it) and the screensaver (diagram motion with no state change).

## Truthfulness

- Lanes: background CLI agents started from the session (`ptah_agent_spawn`). Built-in CLIs include codex and copilot (`libs/shared/src/lib/types/agent-process.types.ts:58-65`). "Glm" is the user's Ollama Cloud lane (a user-configured ptah-cli provider).
- Pushed back: `LaneCompletionNotifier` pushes one `<agent-lane-completed>` turn into the session that spawned the lane, with a verdict such as `delivered`. The kit `lane-completion-toast` is a visualization of that push; it carries the eyebrow "PUSHED TO THE PARENT SESSION" (user-approved decision).
- Report mid-run: `ptah_agent_report` shows a lane's report in the parent session before the lane finishes.
- Message a lane: `ptah_agent_message` sends a message to a running lane. The film does not claim a delivery mode.
- Peer: "Message Peer Session" dialog, outcome "Accepted" (`peer-session-send-dialog.component.ts`).
- Agents panel: up to 3 lane columns side by side (`agent-monitor/agent-lane-layout.ts:11-13`).

## Seam map

| Time | From → To | Seam |
| --- | --- | --- |
| 1.791 | 01 → 02 | match cut: the spinner shrinks into the session node |
| 5.373 | 02 → 03 | camera travel right along the lanes |
| 10.746 | 03 → 04 | match cut: the panel columns fold back into the lanes |
| 14.328 | 04 → 05 | proof card returns into the node; caption swap |
| 17.910 | 05 → 06 | proof card returns into the node; caption swap |
| 21.493 | 06 → 07 | camera travel down to the peer node |
| 25.075 | 07 → 08 | camera pull-back to the whole diagram |
| 26.866 | 08 → 09 | match cut: the session node becomes the Ptah icon (one `light-leak` shader at most) |

Direction rule: work flows right (prompt to lanes), results flow left (lanes to session). The camera never reverses a flow on screen.

## Audio plan

- Music bed: same track, volume 0.6, fade over the last bar.
- SFX bus `<hf-audio-group id="sfx">` (compressor + limiter, as v1).
- Packet SFX: one soft tick per packet launch, one pop per packet arrival. Caption slams duck the music 0.3 s.

## Build notes (to verify before Frame 03)

- Kit change: `agents-panel` needs a third lane (`lane3Name`, `lane3Status`, `lane3Rows`); the real panel shows up to 3 columns. Rebuild the kit after the change (`node build.mjs`).
- The diagram is plain HTML/SVG inside each frame fragment (lines, nodes, packets). It is not a kit component.
- About 1-2 kit mounts per frame (v1 had 9-16). Studio transition caching gets much faster.
- No `data-layout-ignore` / `-allow-*` attributes. `check` must pass clean.

## Changes from v1 (user review, 2026-10-01)

User, verbatim: "the way we show components on each others is very confusing and i don't understand or have any clue on what we are trying to say and the video is not properly show so we need to step back and think as a true motion graphic video editor and see the main mess and hook we want users to get which is about our agent-lanes workflows and agent messaging capability in ptah with pure and clear animation so basically we should think of scenes , scenes transitions and proper messaggings all over to get the user attention not losing it"

User, verbatim: "GLM is the name i have chosen for ollama cloud cli agent and for the ideas ptah offers too many but the proper way is to create small promos about each related features together in meaningful way and the agent-lane is just the first trial to see how we will be doing"

Diagnosis (reproduced in Studio and `snapshot`, `snapshots/studio-repro/`, `snapshots/engine-repro/`): v1 dive frames stacked 9-16 sibling kit mounts at fixed offsets, the camera cropped them, and no beat said one thing. 75 mounts + 11 shader seams also made Studio's transition caching slow.

Choices (2026-10-01): direction A "Swimlanes" with the problem opening from B; about 30 s per promo. Truth fixes: no "2+2" canvas preset, no product toast (the toast is labelled a visualization), lanes Glm / Codex / Copilot.

## Review of the Act 1 prototypes (user, 2026-10-01)

User, verbatim: "both are nearly fine i do like the one that has the chat more , but the start for both of them is not perfect basically we need some kind of a prompt first then start the session then call the spawn to start the lanes and then they send delivery  or raise a questions also no scene switching  but that's fine as a start"

What this means for the next version:
- Direction: C (session transcript) is preferred over A (swimlanes).
- New opening order: a prompt first → the session starts → the session calls the spawn → the lanes start → the lanes deliver results or raise questions (`ptah_agent_report`). The "one agent, one task" waiting hook is replaced by this sequence.
- No scene switching: one continuous scene (the transcript and its panels stay in one world); no cuts away to a separate panel scene.
- The Act 1 prototypes are accepted as a starting point and are committed as is.

## Still open

1. Caption copy for every frame (below). Approve or rewrite.
2. Lockup feature name: "AGENT LANES". The series lockup pattern is "Ptah" + feature name + "Free and open source · ptah.live".
3. Peer target title "review memory work" and workspace "ptah-extension" (kit defaults).

## Frame 01 — Waiting (0.000-1.791, 1 bar)

- status: planned
- src: compositions/frames/01-wait.html
- duration: 1.791s
- start: 0.000
- transition_in: cut
- kit: tool-call-row (Bash, running), mounted at u 1.5, centered
- caption: "ONE AGENT. **ONE TASK.**" (gold on "ONE TASK.")
- camera: none; the row drifts 1.00 → 1.03
- sfx: tick on every beat (clock), riser from 0.9

On screen: one large running row, "Bash" badge (info, spinner), "Executing Bash...". Under it a mono timer counts 17m 58s → 18m 04s on the beats. The caption sets on beat 1.

Motion: first motion at 0.0 (timer tick). Beat 4 (1.343): the row and the timer fade to 30%, the spinner keeps spinning.

Seam out: on the drop (1.791) the row shrinks into a 120 px node and moves to the left edge (x 240): that node is "Your session" for the rest of the film.

Constraint: no "slow" or "frustrating" copy; the timer says it.

Why: the problem in outcome language: one agent works on one thing, and you wait.

## Frame 02 — Split (1.791-5.373, 2 bars)

- status: planned
- src: compositions/frames/02-split.html
- duration: 3.582s
- start: 1.791
- transition_in: match cut (row → node)
- kit: none (diagram only)
- caption: "ONE PROMPT. **THREE LANES.**"
- camera: hold at 1.0
- sfx: impact on the drop, three whooshes on beats 2-4

On screen: node "Your session" at the left. On the drop a gold line shoots right from the node and splits into three lanes at x 640: "Glm", "Codex", "Copilot" (lane labels with a running dot each, Inter 36 px). Lanes draw on beats 2, 3, 4 (`svg-path-draw`, 0.35 s each). Bar 2: tick marks flow right along all three lanes at the same speed.

Seam out: camera travels right along the lanes (5.373).

Constraint: no product UI yet; the diagram explains the structure.

Why: the turn: one prompt becomes three agents at work.

## Frame 03 — All at once (5.373-10.746, 3 bars)

- status: planned
- src: compositions/frames/03-parallel.html
- duration: 5.373s
- start: 5.373
- transition_in: camera travel
- kit: agents-panel (3 lanes: Glm, Codex, Copilot), mounted full width at u 1.2 (needs the kit change)
- caption: "ALL **AT ONCE.**" then (bar 2) eyebrow "THE AGENTS PANEL"
- camera: bar 1 travel right 0 → 420 px (`expo.inOut`); bar 2 the lanes turn into the panel's three columns
- sfx: soft click on every row start (all three lanes together)

On screen, bar 1: the three lane lines with their running dots, tick marks flowing. Bar 2 downbeat (7.164): match cut, the three horizontal lanes rotate into three vertical columns and become the real Agents panel: header "Agents" + count "3", tabs "Glm", "Codex", "Copilot" with info dots, three columns. Rows arrive on the same beat in all three columns, each pending → running → done. Bar 3 beat 4 (10.299): the Glm dot flips to success and its tab check springs.

Seam out: at 10.746 the columns fold back into the three horizontal lanes (reverse match cut).

Constraint: the three columns move at the same time; never one after the other.

Why: proof with the real product that the lanes run in parallel.

## Frame 04 — Pushed back (10.746-14.328, 2 bars)

- status: planned
- src: compositions/frames/04-pushed.html
- duration: 3.582s
- start: 10.746
- transition_in: match cut (panel → lanes)
- kit: lane-completion-toast (agent Glm, verdict delivered), grown from the session node, u 1.6
- caption: "RESULTS **COME BACK** TO YOU." sub-line "Pushed to your session. No polling."
- camera: hold on the whole diagram
- sfx: pop at packet launch, notification at arrival

On screen, bar 1: the Glm lane is green. A gold packet leaves the Glm lane end and travels left into the session node (`sine.inOut`, 0.9 s, beats 1-3); the node pulses once on arrival (beat 3). Bar 2 downbeat (12.537): the proof card grows out of the node: eyebrow "PUSHED TO THE PARENT SESSION", "Lane Glm finished: completed", chip "delivered", the deliverable path and byte count. The chip gets the gold focus ring on beat 2.

Seam out: the card returns into the node (14.328).

Constraint: the card says "visualization" through its eyebrow; no fake OS notification chrome.

Why: the first half of the message: results come to you, you do not go to them.

## Frame 05 — Lanes report while they work (14.328-17.910, 2 bars)

- status: planned
- src: compositions/frames/05-report.html
- duration: 3.582s
- start: 14.328
- transition_in: caption swap on the downbeat
- kit: agent-report-card (Codex), grown from the session node, u 1.4
- caption: "AND THEY **TALK BACK.**" sub-line "A lane reports before it finishes."
- camera: hold
- sfx: impact on the caption, tick at launch, sparkle at "Report Delivered"

On screen, bar 1: the Codex lane is still running (ticks flowing). From the MIDDLE of the Codex lane a gold packet travels left to the node while the lane keeps running. Bar 2 downbeat: the proof card grows from the node: gold badges "Ptah Superpower" + "ptah agent report", the row expands to "Report Delivered", "Delivered: Yes".

Seam out: the card returns into the node (17.910).

Constraint: the Codex lane never stops moving during this frame (the point is "before it finishes").

Why: opens the messaging act: lanes talk to you without being asked.

## Frame 06 — Message a running lane (17.910-21.493, 2 bars)

- status: planned
- src: compositions/frames/06-message.html
- duration: 3.582s
- start: 17.910
- transition_in: caption swap on the downbeat
- kit: tool-call-row (gold variant, tool `mcp__ptah__ptah_agent_message`), grown from the session node, u 1.6
- caption: "**MESSAGE** A RUNNING LANE."
- camera: hold
- sfx: key-press at launch, ping at arrival

On screen, bar 1: a gold packet leaves the session node and travels RIGHT along the Copilot lane to its running head; the Copilot dot flashes on arrival. Bar 2 downbeat: the proof row grows from the node: "Ptah Superpower" + "ptah agent message", running → done (check).

Seam out: camera travels down to the peer node (21.493).

Constraint: no claim of "steer", "interrupt" or a delivery mode in copy.

Why: the conversation goes both ways: you can redirect work in flight.

## Frame 07 — Sessions talk to each other (21.493-25.075, 2 bars)

- status: planned
- src: compositions/frames/07-peer.html
- duration: 3.582s
- start: 21.493
- transition_in: camera travel down
- kit: peer-send (target "review memory work", outcome accepted), centered, u 1.3
- caption: "SESSIONS TALK **TO EACH OTHER.**"
- camera: 21.493-21.941 travel down 360 px (`expo.inOut`); hold
- sfx: whoosh on the travel, typing, key-press on send, ping on "Accepted"

On screen, bar 1: a second session node "review memory work" sits below "Your session"; a gold arc draws between them (beat 2). Beat 3: the proof dialog grows from the arc's midpoint: "Message Peer Session", target "review memory work", the message types "Batch 5 review is approved. Start P2." Bar 2 beat 2: Send press; beat 3: outcome "Status: Accepted" with the focus ring.

Seam out: camera pull-back to the whole diagram (25.075).

Constraint: "Accepted" only. No "delivered", "received", "read".

Why: the last capability: messaging is not only parent and lanes; sessions coordinate too.

## Frame 08 — The line (held frame) (25.075-26.866, 1 bar)

- status: planned
- src: compositions/frames/08-line.html
- duration: 1.791s
- start: 25.075
- transition_in: camera pull-back
- kit: none
- caption: none (the line replaces it)
- camera: 25.075-25.523 pull back to the whole diagram (`expo.out`), then locked
- sfx: impact on the line

On screen: the whole diagram, static: "Your session", three green lanes, the peer node and its arc. Beat 2 (25.523): the line slams under the diagram, 80 px (fits title-safe): "YOUR AGENTS WORK IN PARALLEL." / "**AND THEY TALK BACK.**" (gold second line). Nothing else moves.

Seam out: match cut, the session node becomes the Ptah icon (26.866).

Constraint: no motion after the slam.

Why: the message, stated once, over the picture that proved it.

## Frame 09 — Lockup (26.866-30.448, 2 bars)

- status: planned
- src: compositions/frames/09-lockup.html
- duration: 3.582s
- start: 26.866
- transition_in: match cut (node → icon), optional `light-leak` 0.5 s
- kit: none
- caption: none
- camera: none
- sfx: chime on the icon, pop on the pill

On screen: `ptah-icon.png` (220 px) where the node was, travelling to center (beat 1); "Ptah" wordmark (Archivo Black 150 px, beat 2); "AGENT LANES" (Inter 44 px, letter-spaced, muted, beat 3); bar 2 downbeat: pill "Free and open source · ptah.live" springs. The last 0.9 s are still; music fades over bar 2.

Constraint: no drifting glow.

Why: brand, the feature name for the series, and the one action.
