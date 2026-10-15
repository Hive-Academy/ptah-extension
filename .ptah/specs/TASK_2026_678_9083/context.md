# Task Context - TASK_2026_678_9083

## User Request
i want to build a command center as a new page ( i'm imagining it as an html canvas where we can
draw agents , basically it first utilize eleven laps on voice mode to allow a near realtime
conversation between the user and the main orchestrator which we can call and draw as Ptah the
head of engineering that can utilize all of the tools, mcp servers , agents , sessions to assign
tasks to different sessions as well to do more work and all get represented on canvas the main
focus is not to display sessions details or if you are going to compare it with tribunal it could
be very similar in away but rather handling only cli tools and the tribunal defined workflow, this
is more like a voice commands center where the user talks to the main head of engineering and wait
for updates from that agent we have a similar implementation in D://projects/property-hub using
elevenlabs and i think we can some of the requirements we need already implemented in our code
here as well ?

## Task Type
FEATURE

## Complexity
Complex

## Strategy
Full depth: research (reuse inventory of ptah + property-hub ElevenLabs) → PM → designer →
prototype → Gate 1.7 → architect → team-leader → QA.

Worktree: D:/projects/ptah-extension/.claude-worktrees/command-center (branch feat/command-center).

## CLI Lanes
- Preference source: memory `orchestration-executor-preference` + `implementation-lane-preference`
  (lanes-first, codex first, cross-family review).
- Mode: enabled. Approval mode: lane-review.
- `ptah_agent_list` 2026-10-15: codex installed (confirmed room, weekly 1%); antigravity installed
  (limit reader failed); opencode installed (monthly 91%, near limit); grok installed (unknown);
  Glm ptah-cli Ollama Cloud available (pc-355b645d-35af-4974-84cf-9cf961ea0164); copilot disabled;
  cursor, pi not installed.

## Conversation Summary
- Research phase first, because the user asked which requirements already exist in this repository.
- Research result: property-hub uses ElevenLabs REST STT/TTS only (no ConvAI); reusable parts are
  VAD, sentence chunker, TTS playback queue, voice HUD. Ptah already has ElevenLabs STT/TTS,
  key vault, agent monitor events, tribunal framing, session spawner, Electron-only route guard.
- User decisions (Gate 0, 2026-10-15):
  1. Voice: Hybrid ConvAI. ElevenLabs Conversational AI agent speaks as Ptah with client tools
     (e.g. delegate_task, get_status) that forward work to a Ptah orchestrator session (Claude
     SDK); orchestrator progress goes back into the call as contextual updates. Per-minute cost accepted.
  2. Hosts: Electron only for the first release; model/event code stays host-neutral.
  3. Canvas scope: only the Command Center orchestrator's own tree (its CLI lanes, child sessions,
     tribunal runs).
  4. Rendering: real HTML `<canvas>` (user-requested).
  5. Delegation scope: CLI tools and the tribunal-defined workflow (user-requested).
- User correction (2026-10-15, supersedes decision 1): "we should be utilizing what we have already
  in our chat but with different ui only and main voice config". Orchestrator = an ordinary Ptah
  chat session on the existing chat runtime with a head-of-engineering persona. Command Center =
  a different UI (canvas + voice HUD) over that session. Voice = existing voice-providers config
  (Whisper/Kokoro or ElevenLabs STT/TTS); new work only a hands-free VAD loop, playback interrupt
  and spoken status updates. No ElevenLabs ConvAI. ConvAI research lane stopped.
- User direction (2026-10-15, after design rev 1): "enhancing the ui way more than this i need a
  stunning experience with icons and 3d spheres optimized for performance and utilized by angular
  we have the capabilities in our code that can help us nail this ui down". Design restarts as a
  WebGL 3D scene (three 0.185.1 already a dependency; gsap + @hive-academy/angular-gsap and
  lucide-angular installed; angular-3d-scene-crafter skill documents @hive-academy/angular-3d,
  which is NOT yet in package.json — architect decides whether to add it). Design rev-2 lane
  (2D revision) stopped.
- User direction (2026-10-15): "no 3d libraries just some enhanced css transformations and pure
  canvas drawings". Scene = Canvas 2D (pseudo-3D shaded spheres, depth, glow) + CSS transforms for
  the DOM overlay/HUD; lucide-angular icons and gsap remain allowed. 3D lane stopped.
