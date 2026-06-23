# E09 — Always-On Ops — Full Script

**Length:** 10–12 min · **Trial day:** Day 19 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Make TaskFlow maintain itself without you — scheduled agent jobs via the Schedules tab — and drive Ptah remotely via the messaging gateway (Discord/Telegram/Slack) including voice, ending on the "code from your phone" moment.
**Controlling thesis:** Scheduled jobs run upkeep while you're away, and the messaging gateway lets you start a session or send a fix from wherever you are.

## Pre-record checklist

- Hardened codebase from E08 green and committed.
- Ptah Desktop running with the Schedules tab and Gateway tab visible (Electron-only features — confirm tabs load).
- Discord bot pre-connected per the gateway integration kit; bot is in a private test server; bot tokens NOT visible on screen at any point. [VERIFY connection is pre-configured so no token entry happens on camera]
- Phone screen-mirror or camera-over-shoulder rig tested and framed before recording.
- Microphone for the voice demo tested — clear input, minimal background noise.
- A short real fix request scripted for the phone demo: e.g. "add a `createdBy` field to the task list API response."
- Nightly cron job inputs pre-scripted: job name, schedule string, and the task description for the dependency check + test run + changelog draft sequence.
- If demoing Telegram or Slack instead of Discord as a fallback, confirm the adapter is connected and the per-thread multi-session behavior works the same way.

## Assets / overlays

- "Day 19 / 100" trial counter.
- Schedules-tab run capture: slot-claim animation, job output stream.
- Discord conversation capture: bot reply in thread.
- Phone-in-frame shot label: "from your phone."
- Voice waveform overlay during the voice demo.
- "Always-on loop" diagram for the recap: cron → gateway → voice.

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat, open-weight model badge visible. The Schedules tab is visible in the Ptah sidebar. The clock on the desktop shows a late-night hour — or a simple "11:47 PM" lower-third sets the scene.
- **ON-SCREEN (lower-third):** "Day 19 / 100"
- **VO:** "Today: scheduled jobs that run on their own, and a way to send a real fix from your phone via the messaging gateway."

### [00:20–01:10] Context: the two loops

- **VISUAL:** A simple two-loop diagram: "Scheduled upkeep (cron)" on the left, "Remote control (gateway + voice)" on the right. Arrows connect them to the TaskFlow project in the center.
- **VO:** "Two ways this works. The first is scheduled: you define a job, set a schedule, and Ptah runs it without prompting — dependency checks, test runs, whatever you need on a cadence. The second is inbound: you send a message from Discord, Telegram, or Slack, and Ptah starts a session, works the request, and replies in the same thread. Voice input works on top of that second path."
- **ON-SCREEN:** Two-loop diagram, labeled.
- **VO:** "Starting with the cron."

### [01:10–04:00] Beat 1 — Cron scheduler: Schedules tab

- **VISUAL:** Ptah Desktop. Navigate to the Schedules tab. [VERIFY exact tab label and location in the Electron app]
- **VO:** "The Schedules tab is where you define what Ptah does on its own. It's SQLite-backed, slot-claimed — meaning no two jobs run the same slot simultaneously, no race conditions on a single machine."
- **VISUAL:** Click to create a new scheduled job. Enter the job details: name "TaskFlow nightly upkeep," a cron schedule string for midnight daily, and a description of what the job should do.
- **VO:** "I'm creating a nightly job. Midnight every day. The task: check for dependency updates, run the full test suite, and draft a changelog entry for anything that changed. Three things I'd otherwise have to remember."
- **VISUAL:** The job is saved. The Schedules tab shows it in the list with its next-run time.
- **ON-SCREEN:** Job row: "TaskFlow nightly upkeep · runs at 00:00 · next run: [date]"
- **VO:** "Now I want to see it run — not at midnight, now. Let me trigger it manually so you can see the output."
- **VISUAL:** Manually trigger the job. [VERIFY how manual trigger works in the Schedules tab UI] The slot-claim mechanism runs; an agent session starts and output streams into the job log.
- **ON-SCREEN:** Schedules-tab run capture: slot-claim → session start → streamed output.
- **VO:** "There's the slot-claim — the scheduler reserves the slot, starts the agent, and the output streams back into the job log. Dependency report, test results, changelog draft. Three tasks, one scheduled job, zero manual effort."
- **VISUAL:** Job output finishes. A short changelog entry is visible in the log — formatted, accurate.
- **VO:** "That's the scheduled loop. From here, every night at midnight, that job runs. Now the inbound side — a way to reach in from outside."

### [04:00–06:30] Beat 2 — Messaging gateway: Discord

- **VISUAL:** Ptah Desktop. Navigate to the Gateway tab. [VERIFY exact tab label and location] The Discord adapter is shown as connected (green indicator). Bot token is NOT visible — the configuration is already done, just the status indicator is shown.
- **VO:** "The Gateway tab is the inbound channel. I've already connected a Discord bot — the bot tokens are off-camera, and the gateway integration kit covers the setup separately. What matters on camera is what happens once it's running."
- **VISUAL:** Split screen: Ptah Desktop on the left, a Discord channel on the right.
- **VO:** "From a Discord channel, I can start a Ptah session by mentioning the bot. The gateway creates a session tied to this thread — not a global session, a per-thread one. Every reply stays in the same thread. Multiple conversations can run simultaneously in different threads."
- **VISUAL:** On the Discord side, user types a message mentioning the bot: asking Ptah to run a quick status check on the TaskFlow API health endpoint.
- **ON-SCREEN:** Discord conversation visible; bot is typing indicator shows.
- **VO:** "The session starts. Kimi picks it up, resolves the request, and replies in the thread. If I start a different conversation in a different thread, that's a separate independent session."
- **VISUAL:** Bot reply appears in the Discord thread with the API status result.
- **VO:** "A Ptah session started from Discord, completed in Discord, no desktop required. One bot, many threads, each with its own context."
- **ON-SCREEN:** Discord conversation capture.

### [06:30–08:00] Beat 3 — Code from your phone

- **VISUAL:** Phone appears on camera — either screen-mirrored to the recording or captured over-shoulder. The Discord app is open on the phone showing the same channel.
- **ON-SCREEN:** "from your phone" lower-third.
- **VO:** "I'm going to send a real code request from my phone."
- **VISUAL:** On the phone, user types a message to the bot: a small real fix request — e.g., "add a `createdBy` display name field to the task list API response. The User relation is already on the Task model."
- **VO:** "A real request. Not a demo request — a genuine, modest feature addition. The `User` relation exists on the `Task` model from episode three. I'm asking Ptah to surface the display name in the list response."
- **VISUAL:** Bot picks up the request; replies with a plan in the Discord thread; then works the change. A brief stream of progress messages in the thread. [VERIFY how the gateway shows in-progress updates in Discord — confirm it posts intermediate replies or a single final reply]
- **VO:** "Ptah picks it up. The orchestrator reads the model, generates the change, runs through validation. A coding session happening in a Discord thread, on a phone."
- **VISUAL:** Bot posts the result: "Done. Added `createdBy.displayName` to TaskListResponseDto. Change is committed." Show the commit message if visible.
- **VO:** "Done. A fix, from a phone, via Discord, on a desktop I'm not sitting at."
- **VISUAL:** Camera pulls back slightly to show the phone and the desktop screen simultaneously — both showing the result.

### [08:00–09:30] Beat 4 — Voice

- **VISUAL:** Back at the desktop. Discord app visible. Microphone icon near the input — or the user simply speaks to the gateway's voice interface. [VERIFY how voice is invoked via the gateway — confirm whether it is a Discord voice channel, a voice message transcription, or a separate voice interface in the Ptah Desktop. Write VO generically and add VERIFY flag.]
- **VO:** "The gateway can also accept voice input — you speak a request, it transcribes, and the same session loop runs."
- **VISUAL:** User speaks a short request clearly: "Check whether the TaskFlow API has any open Sentry alerts from today." [VERIFY this is a realistic request the gateway can handle]
- **ON-SCREEN:** Voice waveform overlay.
- **VO:** "Spoken, transcribed, and routed to the orchestrator the same as a typed message. The transcription shows in the thread so you can see what Ptah heard."
- **VISUAL:** Transcription appears; bot replies with the result of the request.
- **VO:** "Keyboard, text message, voice — the same session either way."

### [09:30–10:30] Beat 5 — Optional CLI delegation in the scheduled job

- **VISUAL:** Back to the Schedules tab. Show the nightly job log — the dependency check step. The orchestrator delegated the actual `npm outdated` and update commands to a CLI agent inside the job run.
- **ON-SCREEN (lower-third):** "Spawn → Poll → Read"
- **VO:** "Worth pointing out in the job output: the orchestrator delegated the dependency commands to a CLI agent, same pattern as all series. Scheduled jobs follow the same delegation model. The orchestrator still plans; it still dispatches. The only difference is no one started the session manually."

### [10:30–11:30] Recap — the always-on loop

- **VISUAL:** The two-loop diagram from the intro, now with green checkmarks on both loops.
- **ON-SCREEN:** "Always-on loop" diagram: cron → gateway → voice. All labeled, all green.
- **VO:** "Scheduled upkeep runs every night — dependencies, tests, changelog. The messaging gateway gives you an inbound channel from Discord, Telegram, or Slack. Voice works on top of that. And a fix requested from a phone is now in the codebase."
- **VO:** "Scheduled upkeep, inbound sessions from Discord, and a fix from my phone — all on open weights."
- **ON-SCREEN:** Green checkmarks on both loops.

### [11:30–12:00] CTA / End screen

- **VISUAL:** End card. Phone, desktop, and Discord thread visible in a triptych.
- **VO:** "That's episode nine. Scheduled jobs are running, and the gateway is wired. Next episode: deploy it. Multi-stage Docker, live migrations, and the URL reveal. I'll see you in episode ten."
- **ON-SCREEN:** End card — "Next: Ship It (Deploy)" · "Day 22 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Desktop chat + open-weight badge + Schedules tab visible + late-hour clock.
2. Two-loop diagram animation (cron loop + gateway loop).
3. Schedules tab navigation.
4. New job creation: name, schedule string, task description.
5. Job saved — list view with next-run time.
6. Manual job trigger: slot-claim animation + streamed output.
7. Job log close-up: dependency report + test results + changelog draft.
8. Gateway tab navigation — Discord adapter connected (green status, no token visible).
9. Split screen: Desktop + Discord channel.
10. Discord mention → bot session start → bot reply in thread.
11. Phone on camera (screen-mirror or over-shoulder).
12. Phone Discord message: real fix request typed.
13. Bot progress replies in Discord thread.
14. Bot completion reply + commit reference.
15. Phone + desktop twinned shot (both showing result).
16. Voice input: spoken request + waveform overlay.
17. Transcription in thread + bot reply.
18. Schedules tab log showing CLI agent delegation inside the job run.
19. Two-loop diagram with green checkmarks.
20. End card.

## [VERIFY] flags

- Confirm the Schedules tab is the exact label for the cron scheduler in Ptah Desktop (Electron). Note from project memory: cron-scheduler-ui is Electron-only; confirm the tab is visible in the build used for recording.
- Confirm how to manually trigger a scheduled job from the Schedules tab UI — button label, right-click menu, or chat command. Write VO generically pending confirmation.
- Confirm the Gateway tab label and that the Discord adapter shows a connection status indicator that is readable on screen without exposing the bot token.
- Confirm pre-connection flow: the series references the "gateway integration kit" for bot setup. Confirm this kit exists as documentation or a skill that viewers can follow before recording, so no token entry is needed on camera.
- Confirm how the gateway handles in-progress updates in Discord — does it post a series of replies, edit a single reply, or post a final reply only? The VO says "stream of progress messages" — adjust if it is a single final reply.
- Confirm the exact mechanism for voice input via the gateway: Discord voice channel transcription, voice-message file transcription, or a dedicated voice interface in Ptah Desktop. The VO is deliberately generic — fill in the correct mechanism before recording and update the VISUAL beat accordingly.
- Confirm that the messaging gateway supports Telegram and Slack in addition to Discord as fallback options, and that per-thread multi-session behavior is consistent across all three adapters. [Project memory confirms multi-session Option A landed for the gateway, map-free Discord per-thread sessions.]
- Confirm that `ptah_agent_spawn` delegation from inside a scheduled job (not an interactive chat session) works correctly — the CLI delegation beat in the job log depends on this.
- The Sentry voice request ("check for open Sentry alerts from today") is used as a realistic example — confirm Ptah has MCP or tool access to query Sentry from inside a gateway session, or replace with a simpler request (e.g., "run the test suite and report the result") that is definitely supported.
- Confirm "code from your phone" commit visibility: does the gateway session produce a real committed change that can be shown in the Discord reply, or is it a generated diff that requires a separate commit step? Adjust the VO if the latter.
