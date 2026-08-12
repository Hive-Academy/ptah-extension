# Video Studio Extraction — Full Script

## Voice notes (from `selfshot/ptah-opensource/words.json`)

Reconstructed prose from the transcript, then matched against it line by line.
What actually shows up, over and over:

- **"Basically," and "actually" as connective tissue**, not filler he's trying
  to cut. "Basically, I have been using Nx workspaces…", "Ptah is a provider
  agnostic coding orchestra…", "They are actually the way I have been
  coding…". Use them the same way — to pivot from a claim to the plain
  explanation of it.
- **WHY before WHAT, every time.** He never opens with a feature. He opens
  with the problem: agents are good at writing code but struggle to
  understand _his_ architecture — THEN he says what he built to fix it. The
  extraction video has to do the same: don't open with "I'm extracting the
  video studio," open with why it's in the wrong place.
- **Short, declarative, stacked sentences**, not subordinate clauses. "It is
  a setup wizard as well that understands your architecture and your tech
  stack." "It's a CLI tool as well work both ways." He reaches for "as well"
  and "also" to bolt one more fact onto a sentence rather than restructuring
  it — don't smooth that into a semicolon.
- **First person, ownership language.** "I built Ptah." "I called it Ptah."
  "I found somewhere they are actually the way I have been coding." Never
  "the tool does X" when "I built X so that…" is available.
- **Technical without jargon-stacking.** He names real things — Nx, NestJS,
  Prisma, domain-driven design, MCP-adjacent concepts — but always cashes
  them out in a plain follow-up clause ("...to build a maintainable SaaS
  application"). No unexplained acronym drops.
- **Non-native cadence, not broken grammar.** Real hesitations in the source
  ("almost struggled," "it like have an evaluation," "run in three places, a
  VS Code extension...") are charming and real but NOT to be copied verbatim
  — the direction is: keep the plain-declarative rhythm and the connectors,
  don't manufacture grammar slips that aren't there. He is fluent, just
  unpolished; write unpolished-fluent, not broken.
- **Numbers land as bare facts, not marketing beats.** "24 skills," "around
  15 agent templates," "nine different agents" — stated flat, no hype
  adjective in front of them. The stat cards in `overlays.tsx` (`StatCard`,
  count-up numeral) exist because this is exactly how he talks — the visual
  grammar was built around this habit, not the other way around.
- **Closes on a plain instruction, not a tagline.** The real video ends on
  "...generate them to use into your project from now on" — a capability
  statement, not "join the revolution." This script's CTA should land the
  same way: what you can now go do, not how you should feel about it.

---

**Length:** 4:30–4:50 · **Runtime:** Ptah Desktop or VS Code extension — harness builder [VERIFY badge on camera] + `apps/ptah-video-studio` hybrid self-shot pipeline (camera + screen, OBS two-track)
**Goal:** Show the video studio's two pipelines running (including the fact that THIS video is running one of them), state plainly why it's outgrowing Ptah's repo, then use Ptah's harness builder to give the extracted project a harness on day one.
**Controlling thesis:** This video is made by the thing it's about — and the thing it's about has outgrown the repo it was born in.

> Meta promo, self-shot hybrid mode (camera + screen, `layout-switch` beats).
> Not part of the SaaS-on-open-weights series. Follows the shared self-shot
> style guide (`RECORDING.md`) and the house camera grammar from
> `render-all.mjs` for the b-roll cutaways.

## Pre-record checklist

- **OBS: two separate tracks.** Camera at 1080p+ (headroom framing, same as
  `ptah-opensource`), screen at native res, both 30fps CFR. Dedicated mic
  track, -16…-12 dB, quiet room. ~2s silence at the very start (per
  `RECORDING.md`) — the intro lower-third needs calm footage to land on.
- **B-roll refreshed, not stale.** `dist/apps/ptah-electron-e2e/recordings/canvas-orchestra/out/canvas-orchestra.mp4`
  (or another current showcase render) needs to reflect the CURRENT camera
  grammar (segment time-remap, release shots, motion blur) — several of these
  landed after early renders. Re-render before using anything as b-roll.
  [VERIFY which showcase mp4 is current on record day.]
- **Do NOT run `export-kit.mjs` live as a demo.** It copies the whole
  `apps/ptah-video-studio` directory into `dist/video-showcase-kit/`, and its
  `EXCLUDE` list (`node_modules`, `dist/`, `out/`, `.whisper`, `.env`,
  `.DS_Store`, `render-props.json`) predates the self-shot feature — it does
  **not** scrub `selfshot/<slug>/camera.mp4`, `screen.mp4`, `audio.wav`,
  `words.json`, or `_public/`. Running it on camera today would package this
  founder's own recordings and transcripts into a "portable kit." Reference
  the doc and the script on screen; don't execute it. [VERIFY: fix the
  exclude list before this ships as an actual extraction, independent of the
  video.]
- **Harness-builder prompt drafted and ready to paste** (see the dedicated
  section below) — know the target repo name before recording; the prompt
  currently uses a placeholder.
- **Confirm the harness builder's on-screen entry point** in whichever
  runtime is being recorded. [VERIFY exact location/label — Desktop vs VS
  Code webview.]
- No secrets on screen — blur any `.env` values (ElevenLabs key, Anthropic
  auth) if a terminal or editor tab happens to show one.

## Assets / overlays

- Reuse the existing icon set (`icons.tsx`): `sparkles`, `layers`, `agents`,
  `memory`, `wizard`, `terminal`, `shield`, `plug`, `branch`, `trending`,
  `runtimes`, `code` — all already wired into `keyword` / `stat` beats.
- Reuse existing `graphic` panels (`harness-layers`, `wizard-phases`) where
  the beat lands on general Ptah concepts (harness, sub-agents). None of the
  nine authored panels is video-studio-specific — for the extraction-specific
  beats (showcase vs. selfshot, the sub-agent roster), fall back to
  `keyword`/`stat` chips rather than authoring new `graphic` scenes for a
  one-off video, unless there's time to add a tenth panel.
- Self-referential corner label for Scene 3 — literally caption that this
  pipeline is narrating itself right now. It's the one moment worth
  lingering on.
- End card: reuse `rising-dawn.mp3` bed + waitlist QR end card from
  `ptah-opensource` for continuity, or swap tracks. [VERIFY music licensing
  for reuse across videos.]

---

### [00:00–00:22] Cold open

- **VISUAL:** `camera-full` — same framing/lighting as the `ptah-opensource`
  recording (deliberate callback).
- **VO:** "Hi. So this video — and every video I've shipped so far — was
  actually made by a tool I built myself, and right now it lives inside
  Ptah's own repo, next to the coding agent. Basically, it takes a screen
  recording, or me just talking to a camera like this, and turns it into
  what you're watching — captions, callouts, graphics, all timed
  automatically. I want to show you how the two sides of it work. And then I
  want to show you why I'm about to pull the whole thing out of Ptah and
  give it its own home."
- **ON-SCREEN:** (none)

### [00:22–01:05] The showcase pipeline, running

- **VISUAL:** `layout-switch` → `screen-full-with-bubble`. Screen: a
  terminal kicking off `nx run ptah-electron-e2e:showcase` (or Remotion
  Studio scrubbing a composition), then the rendered showcase mp4 — amber
  zoom rings, lower-thirds, the virtual camera punching into a tile.
- **VO:** "There are actually two ways I make these. The first one's called
  showcase. A script drives the real Ptah app with Playwright — clicks,
  hovers, the whole tour — and while it's doing that it also records a
  timing file: what to zoom into, when, what to highlight. Then Remotion
  reads that file afterward and does all the camera work — punch-ins,
  highlight rings, motion blur. Capture is dumb, render is smart. I never
  re-record the screen, I just tune numbers and re-render."
- **ON-SCREEN (lower-third):** "Showcase — Playwright capture + Remotion camera"

### [01:05–02:00] The selfshot pipeline — this video

- **VISUAL:** `layout-switch` → `screen-only`, then back to `camera-full`.
  Screen: the `selfshot/<slug>/words.json` file with millisecond timestamps,
  then `beats.json`, then a glimpse of `icons.tsx` — a stroke icon drawing
  itself on. Cut to the panel graphics animating beside him RIGHT NOW as he
  talks (meta shot).
- **VO:** "The second way is this one, right now. I talk into a camera.
  Whisper transcribes every word with a timestamp down to the millisecond.
  Then I write a small file — a beat, anchored to a word I actually said,
  not some hardcoded time code — and that beat can pop a keyword chip, a
  stat card, or one of these graphic panels I built. I actually finished the
  icons and the panels this week — the open-source announcement video I
  shipped a few days ago was the first thing that used them. And this video
  is using the exact same pipeline, live, to talk about itself."
- **ON-SCREEN (self-referential callout):** "You're watching this pipeline narrate itself."
- **ON-SCREEN (keyword chips, in-grammar):** "words.json" → "beats.json"

### [02:00–02:45] Why it doesn't belong here

- **VISUAL:** `camera-full`, or a quick cut to the file tree —
  `apps/ptah-video-studio/` sitting inside the Ptah monorepo, next to
  `ptah-license-server` and `ptah-extension-vscode`. `PORT-TO-NEW-PROJECT.md`
  open.
- **VO:** "Now — here's the thing. This tool has nothing to do with coding
  agents. It's a video pipeline. It only lives inside Ptah's repo because
  that's where I happened to build it, and honestly that's started getting
  in the way — every time I touch Ptah's Nx graph, this thing rides along
  for no reason. I actually already wrote the plan to pull it out — there's
  a doc in the repo, and a script that packages the engine into a portable
  kit for a new project. But when I reread it this week, I found it packages
  the WHOLE app folder — which means it would drag my own camera footage and
  transcripts along with it, because the self-shot half showed up after that
  script was written. So before I extract this for real, that has to get
  fixed."
- **ON-SCREEN (callout):** highlight `PORT-TO-NEW-PROJECT.md` and
  `export-kit.mjs` in the file tree.

### [02:45–03:15] The prompt

- **VISUAL:** Screen — open the harness builder [VERIFY exact surface/path],
  paste the prompt below. Scroll through it — persona, four sub-agents,
  domain knowledge.
- **VO:** "So here's what I'm actually doing. I'm taking this pipeline out
  into its own project. And instead of starting that new repo with a blank
  coding agent that knows nothing, I'm using Ptah's own harness builder to
  give it a harness on day one. I'm describing the job, not the wiring."
- **VISUAL:** Submit.
- **ON-SCREEN:** Pasted prompt visible.

### [03:15–04:05] The build

- **VISUAL:** Build streams — sub-agents appearing one at a time, then the
  domain-knowledge files being written. Speed-ramp the dead time.
- **VO:** "It reads the job and builds specialists around it — a scene
  author, a beats and timing editor, a caption and transcript corrector, a
  render and QC operator. And it writes the domain knowledge straight into
  the harness — how a Remotion composition is actually put together, what
  the beats manifest allows, how word anchors resolve from a whisper
  transcript, what a clean loudness pass looks like before anything ships. I
  didn't type any of that by hand."
- **ON-SCREEN (lower-thirds, as each appears):** "scene-author" ·
  "beats-timing-editor" · "caption-asr-corrector" · "render-qc-operator"

### [04:05–04:40] Result / CTA / End screen

- **VISUAL:** `camera-full`. Then end card.
- **VO:** "Once it's actually extracted, this becomes its own thing, with
  its own harness — built by the same product it's leaving behind. That's
  kind of the whole point of Ptah, actually. It's open source, the harness
  builder ships with it. Go try it yourself."
- **ON-SCREEN:** End card — Ptah logo · repo URL · "Download Ptah → ptah.live".

---

## The harness builder prompt

Exact text to paste. Describes the job — persona, sub-agents, domain
knowledge, repo conventions — not the file wiring; the harness builder
figures the wiring out from this and from reading the target repo.

```
Be a marketing-video pipeline specialist for this repo. This project turns
screen recordings and self-shot camera footage into narrated, captioned,
camera-animated MP4s — Remotion does the compositing, whisper.cpp does the
transcription, and a JSON beats manifest is the one contract between capture
and render.

Give me four sub-agents:

- A SCENE AUTHOR who writes and edits scene walkthroughs and beats manifests
  for real product flows. Knows how a Playwright-driven capture scene is
  structured, how self-shot beats reference transcript words instead of raw
  seconds, and never invents a UI selector or a spoken word it hasn't seen in
  the actual recording or app.
- A BEATS/TIMING EDITOR who tunes pacing — camera punch-in/hold/release
  timing, keyword and stat card placement, avoiding overlaps between
  simultaneous overlays — and keeps the camera grammar intact (establish
  full-frame before the first punch-in, don't punch in faster than the
  minimum shot spacing, release back to full-frame before the next punch-in
  unless it's close enough to pan straight across).
- A CAPTION + ASR CORRECTOR who cleans up whisper.cpp's word-level output —
  merges sub-word tokens into whole words, fixes proper-noun mishears
  (product names, technical terms) against a text-normalization dictionary,
  and keeps word anchors resolvable after a re-recording changes the exact
  timestamps.
- A RENDER/QC OPERATOR who runs the render pipeline end to end and checks
  the output before anything ships: audio loudness at -16 LUFS integrated
  with true peak under -1.5 dBTP, no clipping, no dead air longer than 2
  seconds, captions in sync with the audio track. Reports failures with the
  exact frame or timestamp, never a vague "something's off."

Domain knowledge to bake into the harness, not just the prompt:

- The Remotion composition model: compositions are pure functions of a frame
  number driven by useCurrentFrame/useVideoConfig; assets are served through
  staticFile() against a --public-dir, never a raw file:// path; Sequence
  windows are how beats get scheduled onto the timeline.
- The beats manifest contract: a beat's `at`/`until` is either a raw seconds
  offset or a transcript word anchor ({ word, occurrence, offsetMs })
  resolved against the whisper words.json, so timing stays locked to what's
  actually spoken instead of a hardcoded timestamp that drifts the moment I
  re-record. The manifest's zod schema is the single source of truth; any
  plain-JS script that can't import it directly re-implements a structural
  validator by hand — the two must be kept in lockstep whenever a field
  changes.
- Whisper word-timing: token-level transcription output arrives as sub-word
  fragments and has to be merged into whole words before anything
  downstream — captions, word anchors — can use it. A leading space marks
  the start of a new word; bare punctuation attaches to the previous one.
- ffmpeg loudness/true-peak QC: loudness normalization via the `loudnorm`
  filter (EBU R128, target -16 LUFS integrated / -1.5 dBTP true peak), and
  how to read its stats output to confirm a clip is actually in spec before
  render, not just eyeball it after.

Repo conventions to follow:
- Nx monorepo, ESM .mjs scripts, Node >=22.9, `catch (error: unknown)` with
  explicit narrowing before touching `.message`.
- A zod schema is the authoring contract for every manifest; TypeScript
  types are inferred FROM the schema, never hand-written separately.
- kebab-case filenames. Every pipeline stage reads and writes a JSON
  manifest as the interchange format — no stage should require re-running an
  earlier one just to change something a later stage controls.
- Every generated or cached asset — downloaded models, rendered mp4s, staged
  public dirs — is gitignored and reproducible from source. Nothing
  hand-maintained that could silently drift from the pipeline that produces
  it.
```

---

## Shot list (quick capture summary)

1. Cold open: camera-full, same framing as `ptah-opensource`.
2. Layout switch to screen+bubble: terminal/Remotion Studio running the
   showcase capture; cut to a current rendered showcase mp4 with camera work
   visible.
3. Layout switch to screen-only: `words.json` → `beats.json` → `icons.tsx`
   drawing-on animation.
4. Cut back to camera-full: the panel graphics animating live beside him
   (meta shot — self-referential callout on screen).
5. Camera-full or file-tree cutaway: `apps/ptah-video-studio` inside the
   monorepo; `PORT-TO-NEW-PROJECT.md` + `export-kit.mjs` highlighted.
6. Screen: harness builder open, prompt pasted, scroll persona/sub-agents/
   domain knowledge, submit.
7. Build streams — sub-agent lower-thirds appearing in order, domain files
   being written (speed-ramp the dead time).
8. Camera-full close.
9. End card — logo, repo URL, download CTA.

## [VERIFY] flags

- **Exact on-screen entry point for the harness builder** at record time —
  Ptah Desktop vs. the VS Code extension webview; confirm the label/route
  before Scene 5. `libs/frontend/harness-builder` is the implementing lib but
  its user-facing entry point wasn't confirmed on disk.
- **`export-kit.mjs`'s `EXCLUDE` list does not scrub the self-shot ingest
  folders** (`camera.mp4`, `screen.mp4`, `audio.wav`, `words.json`,
  `_public/` under `apps/ptah-video-studio/selfshot/<slug>/`) — it predates
  the self-shot feature by about a week (script: Jul 11; self-shot files:
  Jul 19+). Running the script today would package personal recordings into
  the portable kit. This is real and independent of the video — confirm
  whether it needs fixing before or in parallel with recording, and whether
  the script should even be shown executing on camera (recommend: reference
  only, don't run it live).
- **Which showcase mp4 to use as b-roll and whether it's still
  representative** of the current camera grammar (segment time-remap,
  release shots, motion-blur, supersampled zooms all landed after some early
  renders per `ROADMAP.md`). Re-render before recording if stale.
- **Target repo name for the extracted project** — the harness-builder
  prompt above is intentionally silent on this (it doesn't need the name to
  describe the job), but the on-screen file tree / any typed repo name
  during the demo needs a real decision before recording, not a placeholder
  visible on camera.
- **Whether `PORT-TO-NEW-PROJECT.md`'s existing plan needs updating** to
  explicitly list `libs/showcase-manifest`-style shared types for
  `src/selfshot/manifest.ts`/`resolved.ts` too — today the doc's "What
  you're installing" table only names three units (compositor, shared
  showcase-manifest lib, capture harness); it doesn't mention the self-shot
  side by name even though `copyDir(APP_ROOT, …)` mechanically includes it.
  Decide if the doc's prose gets a self-shot row added before or after this
  video ships.
- **Music-bed licensing** for reusing `rising-dawn.mp3` (or any track from
  `assets/music/`) across multiple public marketing videos.
- **OBS two-track hardware setup** confirmed ready per `RECORDING.md`'s
  checklist (separate camera/screen files, dedicated mic track, native-res
  screen capture, 30fps CFR) — this is a hybrid-mode shoot, not talking-head,
  so both tracks are load-bearing this time, not just one.
