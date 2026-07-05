# ptah-video-studio

AI marketing-video pipeline for Ptah showcase scenes.

Produces one H.264 mp4 per scene from a Playwright screen capture, using
Kokoro-82M TTS for narration, whisper.cpp for word-level captions, and
Remotion as the compositor.

---

## Architecture overview

```
Phase 0 — Capture  (local dev machine, authenticated Electron + Docker)
  nx run ptah-electron-e2e:showcase
    -> dist/apps/ptah-electron-e2e/recordings/<scene>/raw.webm
    -> dist/apps/ptah-electron-e2e/recordings/<scene>/beats.json

Phase 1 — Render  (Linux CI or any non-SAC machine)
  narrate.mjs   beats.json  -> wav/*.wav + durations.json  (Kokoro TTS)
  caption.mjs   wav/*.wav   -> captions.json               (whisper.cpp)
  render-all.mjs            -> out/<scene>.mp4             (Remotion)
```

The capture step cannot run in CI because it requires:

- the live authenticated Electron app,
- a running local Docker backend.

The render step cannot run on Windows dev machines because Windows Smart App
Control (SAC) blocks Remotion's unsigned compositor DLLs at load time
(Win32 error 4551 on `swscale-8.dll`). Disabling SAC is permanent and
requires a factory reset to re-enable, so we render on CI (Linux) or any
machine without SAC (e.g. a Linux workstation, WSL, macOS).

---

## Artifact layout

```
dist/apps/ptah-electron-e2e/recordings/
  <scene>/                         e.g. editor-tour/
    raw.webm                       Playwright VP8 recording (renamed from random)
    beats.json                     Director timing manifest
    narration-script.json          optional — polish.mjs polished VO (dev-only)
    wav/
      0001.wav  …  NNNN.wav        Kokoro per-beat narration clips
      _concat.wav                  transient — 16kHz/mono concat for whisper
    durations.json                 TTS clip durations (for Phase-2 hold override)
    captions.json                  whisper word-timestamps (Caption[] for Remotion)
    render-props.json              transient — Remotion props written by render-all
    out/
      <scene>.mp4                  final rendered video (H.264)
```

---

## Environment variables

| Variable                        | Default                  | Purpose                                                                                                                                                                   |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PTAH_SHOWCASE_SILENT_CAPTIONS` | unset                    | Set to `1` during capture: beats are recorded but no lower-third text is baked into pixels (Remotion renders its own animated captions). Recommended for the AI pipeline. |
| `PTAH_SHOWCASE_RES`             | `1080p`                  | Capture resolution: `1080p`, `1440p`, or `4k`. Flows through to the Remotion composition via `beats.json.res`.                                                            |
| `PTAH_POLISH`                   | unset                    | Set to `1` to run `polish.mjs` before narration (requires Anthropic auth). Leave unset to narrate from raw beat captions.                                                 |
| `PTAH_TTS_ENGINE`               | `kokoro`                 | Narration engine: `kokoro` (local, free) or `elevenlabs` (cloud, billed, supports voice cloning). Overridden by `narrate.mjs --engine`.                                   |
| `ELEVENLABS_API_KEY`            | unset                    | ElevenLabs API key. Required when the narration engine is `elevenlabs`; `narrate.mjs` fails fast with a clear message if it is missing.                                   |
| `PTAH_ELEVENLABS_VOICE_ID`      | unset                    | Default ElevenLabs voice id (e.g. your Instant Voice Clone). Used when `--voice` is omitted and the engine is `elevenlabs`.                                               |
| `PTAH_ELEVENLABS_MODEL`         | `eleven_multilingual_v2` | Default ElevenLabs model id. Override with `--model` (e.g. `eleven_turbo_v2_5`).                                                                                          |

---

## Step 1 — Local capture

Run on your dev machine with the Electron app built and Docker running.

```bash
# Recommended: silent captions so Remotion renders its own lower-thirds
PTAH_SHOWCASE_SILENT_CAPTIONS=1 npx nx run ptah-electron-e2e:showcase

# Optional: capture at higher resolution (default is 1080p)
PTAH_SHOWCASE_RES=1440p PTAH_SHOWCASE_SILENT_CAPTIONS=1 \
  npx nx run ptah-electron-e2e:showcase

# Filter to a single scene (Playwright --grep flag via NX_ARGS)
PTAH_SHOWCASE_SILENT_CAPTIONS=1 npx nx run ptah-electron-e2e:showcase \
  -- --grep "editor-tour"
```

Output: `dist/apps/ptah-electron-e2e/recordings/<scene>/{raw.webm,beats.json}`.

---

## Step 2 — Optional: polish narration (dev machine only)

Rewrites terse beat captions into natural voiceover prose using the
in-repo claude-agent-sdk. Requires Anthropic auth (ANTHROPIC_API_KEY or
VS Code extension auth).

```bash
# Single scene
node apps/ptah-video-studio/scripts/polish.mjs --scene editor-tour

# All scenes
node apps/ptah-video-studio/scripts/polish.mjs
```

Writes `narration-script.json` next to `beats.json`. If this file is
present `narrate.mjs` uses it automatically; pass `--source beats` to
override and narrate from raw captions.

This step is permanently off in CI (Anthropic auth is not available there).

---

## Path A: render on CI (recommended for Windows dev machines)

### Why CI

Linux CI runners resolve `@remotion/compositor-linux-x64-gnu` automatically
and are not subject to Smart App Control, so `remotion render` works without
any system configuration change.

### A1 — Pack and upload recordings

After the local capture, upload the recordings directory to GitHub as a
release asset so the CI workflow can download it.

```bash
# From the workspace root:

# Pack the recordings directory
tar -czf showcase-recordings.tar.gz \
  -C dist/apps/ptah-electron-e2e recordings

# Create (or overwrite) the staging release (one-time setup, idempotent)
gh release create recordings/latest \
  --draft \
  --title "Showcase Recordings (staging)" \
  --notes "Staging release for showcase-recordings.tar.gz upload." \
  2>/dev/null || true   # ignore "already exists" error

# Upload the tar (--clobber overwrites a previous upload)
gh release upload recordings/latest showcase-recordings.tar.gz --clobber

echo "Upload complete."
```

To upload only a single scene:

```bash
# Pack only the editor-tour scene
tar -czf showcase-recordings.tar.gz \
  -C dist/apps/ptah-electron-e2e/recordings editor-tour
gh release upload recordings/latest showcase-recordings.tar.gz --clobber
```

### A2 — Trigger the upload-recordings workflow

```bash
# Trigger the staging workflow (downloads from the release, re-uploads as
# a proper Actions artifact so render-showcase.yml can consume it).
gh workflow run upload-recordings.yml \
  --field scene=""          # blank = all scenes, or set e.g. "editor-tour"

# Wait for it to finish and capture the run ID
sleep 5
UPLOAD_RUN_ID=$(gh run list \
  --workflow=upload-recordings.yml \
  --limit 1 \
  --json databaseId \
  -q '.[0].databaseId')
echo "Upload run ID: $UPLOAD_RUN_ID"

# Wait for the run to complete
gh run watch "$UPLOAD_RUN_ID" --exit-status
```

### A3 — Trigger the render workflow

```bash
# Trigger render with the upload run ID
gh workflow run render-showcase.yml \
  --field recordings_run_id="$UPLOAD_RUN_ID" \
  --field scene=""              # blank = all scenes
  --field whisper_model="base.en"   # or "medium.en" for higher quality

# Watch progress (renders can take 10-30 min per scene)
RENDER_RUN_ID=$(gh run list \
  --workflow=render-showcase.yml \
  --limit 1 \
  --json databaseId \
  -q '.[0].databaseId')
gh run watch "$RENDER_RUN_ID" --exit-status
```

### A4 — Download rendered mp4s

```bash
mkdir -p dist/rendered-videos
gh run download "$RENDER_RUN_ID" \
  --name showcase-videos \
  --dir dist/rendered-videos
find dist/rendered-videos -name '*.mp4' | sort
```

---

## Path B: render on any non-SAC machine

Any Linux machine, macOS, or a Windows machine that does not have Smart App
Control enabled (e.g. a Windows Server instance, WSL 2, or a machine
enrolled in WDAC policy mode rather than SAC evaluation mode) can render
locally.

### B1 — Copy the recordings directory

Transfer `dist/apps/ptah-electron-e2e/recordings/` from the capture machine
to the render machine. rsync, scp, or a mounted network drive all work.

```bash
# Example with rsync (run from the workspace root on the capture machine)
rsync -avz \
  dist/apps/ptah-electron-e2e/recordings/ \
  render-host:/path/to/ptah-extension/dist/apps/ptah-electron-e2e/recordings/
```

### B2 — Install dependencies on the render machine

```bash
# On the render machine, from the workspace root:
npm ci || npm install --no-audit --no-fund

# Linux only: install Chromium system libs (required by Remotion render)
sudo apt-get update && sudo apt-get install -y \
  libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
  libx11-6 libx11-xcb1 libxcb1 libxext6 libxfixes3 libxi6 \
  libxrender1 libxss1 libxtst6 fonts-liberation xdg-utils
```

### B3 — Run the pipeline

```bash
# All scenes
node apps/ptah-video-studio/scripts/narrate.mjs
node apps/ptah-video-studio/scripts/caption.mjs
node apps/ptah-video-studio/scripts/render-all.mjs

# Single scene
node apps/ptah-video-studio/scripts/narrate.mjs --scene editor-tour
node apps/ptah-video-studio/scripts/caption.mjs --scene editor-tour
node apps/ptah-video-studio/scripts/render-all.mjs --scene editor-tour

# Or via Nx targets (runs all scenes, no scene filter on individual targets)
npx nx run ptah-video-studio:narrate
npx nx run ptah-video-studio:caption
npx nx run ptah-video-studio:render
```

Output: `dist/apps/ptah-electron-e2e/recordings/<scene>/out/<scene>.mp4`.

---

## Nx targets reference

| Target      | Command                                  | Description                                      |
| ----------- | ---------------------------------------- | ------------------------------------------------ |
| `studio`    | `npx nx run ptah-video-studio:studio`    | Live Remotion preview (`remotion studio`)        |
| `narrate`   | `npx nx run ptah-video-studio:narrate`   | Kokoro TTS → wav clips + durations.json          |
| `caption`   | `npx nx run ptah-video-studio:caption`   | whisper.cpp → captions.json                      |
| `render`    | `npx nx run ptah-video-studio:render`    | Remotion render → mp4                            |
| `video`     | `npx nx run ptah-video-studio:video`     | Full chain: capture → narrate → caption → render |
| `polish`    | `npx nx run ptah-video-studio:polish`    | Claude VO polish (optional, dev-only)            |
| `typecheck` | `npx nx run ptah-video-studio:typecheck` | TypeScript check                                 |

The `video` target depends on `ptah-electron-e2e:showcase`, so it runs the
full end-to-end pipeline including capture. Use individual targets (narrate,
caption, render) when the capture was done separately.

---

## Pipeline script flags

### narrate.mjs

```
node apps/ptah-video-studio/scripts/narrate.mjs
  [--scene <slug>]      single scene; omit for all scenes with beats.json
  [--engine <name>]     kokoro (local, default) or elevenlabs (cloud, voice cloning)
                        env fallback: PTAH_TTS_ENGINE
  [--voice <id>]        kokoro: voice id (default: af_heart)
                        elevenlabs: voice id (env fallback: PTAH_ELEVENLABS_VOICE_ID)
  [--model <id>]        elevenlabs model id (default: eleven_multilingual_v2,
                        env fallback: PTAH_ELEVENLABS_MODEL; ignored by kokoro)
  [--speed <n>]         TTS speed multiplier (default: 1)
                        elevenlabs clamps to 0.7–1.2 and warns if outside
  [--stability <n>]     elevenlabs tone: delivery consistency, 0..1 (default 0.4)
                        lower = more expressive variation, higher = flatter read
  [--similarity <n>]    elevenlabs tone: adherence to the cloned timbre, 0..1
                        (default 0.75)
  [--style <n>]         elevenlabs tone: style exaggeration of the reference
                        clip, 0..1 (default 0.2; >0.5 risks artifacts)
  [--source beats]      force narration from raw beats.json captions
                        (default: uses narration-script.json if present)
  [--force]             re-generate even if durations.json is up to date
```

Voice examples (kokoro): `af_heart` (default), `am_michael`, `af_bella`, `am_adam`.
List all voices: `node -e "const {KokoroTTS}=require('kokoro-js'); KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q4',device:'cpu'}).then(t=>console.log(t.list_voices()))"`.

`durations.json` records the `engine`, `voice`, `model`, and a `settings`
fingerprint (speed + tone knobs). `narrate.mjs` reuses existing wavs only when
the narration source is unchanged **and** all of those still match — switching
any of them busts the skip and re-synthesizes (so you never silently ship stale
audio after changing voices or tone). `--force` always regenerates.

#### Voice cloning (ElevenLabs)

Narrate marketing videos in a clone of your own voice:

1. Create an **Instant Voice Clone** at [elevenlabs.io](https://elevenlabs.io):
   upload 1–5 minutes of clean, single-speaker speech (quiet room, no music).
2. Open the cloned voice and copy its **voice id**.
3. Set credentials in the studio-local env file (loaded automatically by the
   pipeline scripts; gitignored):

   ```bash
   cp apps/ptah-video-studio/.env.example apps/ptah-video-studio/.env
   # then edit it and set ELEVENLABS_API_KEY + PTAH_ELEVENLABS_VOICE_ID
   ```

   Shell exports still work and take precedence over the file. Do NOT put
   these in the workspace-root `.env` — that file is the license server's and
   is injected into its Docker container.

4. Narrate with the ElevenLabs engine:

   ```bash
   # Single scene
   node apps/ptah-video-studio/scripts/narrate.mjs \
     --engine elevenlabs --scene editor-tour

   # Explicit voice + faster/cheaper model
   node apps/ptah-video-studio/scripts/narrate.mjs \
     --engine elevenlabs --voice your_voice_id --model eleven_turbo_v2_5 \
     --scene editor-tour
   ```

Each ElevenLabs run is **billed per character**, so `narrate.mjs` prints the
character count per beat and a per-scene total to help you estimate credit
usage, and logs `up to date` (with the engine + voice) when it skips. Requests
are sequential and retry once on rate-limit / server errors. Commercial use of
cloned-voice audio requires a **paid ElevenLabs plan** — check their terms
before publishing.

**Tone tuning.** The clone inherits most of its tone from the reference
recording — record it in the exact delivery you want the videos to have.
Then shape it per run with the knobs: `--stability` (0.3–0.5 = lively
marketing read, 0.7+ = calm/flat), `--style` (0–0.3 subtle, higher amplifies
the reference style but risks artifacts), `--speed` (1.0–1.05 for demos).
Dial them in cheaply on one short scene before batch-narrating all 13.

### caption.mjs

```
node apps/ptah-video-studio/scripts/caption.mjs
  [--scene <slug>]      single scene; omit for all
  [--model base.en]     whisper model: base.en (~150 MB) or medium.en (~1.5 GB)
  [--force]             re-generate even if captions.json is up to date
```

### render-all.mjs

```
node apps/ptah-video-studio/scripts/render-all.mjs
  [--scene <slug>]         single scene; omit for all
  [--concurrency <n>]      Remotion render concurrency (default: Remotion default)
```

---

## First-run downloads (cached after first run)

| Asset                      | Size         | Location                           |
| -------------------------- | ------------ | ---------------------------------- |
| Kokoro-82M ONNX weights    | ~300 MB (q8) | `~/.cache/huggingface`             |
| whisper.cpp binary         | ~5 MB        | `apps/ptah-video-studio/.whisper/` |
| whisper base.en model      | ~150 MB      | `apps/ptah-video-studio/.whisper/` |
| whisper medium.en model    | ~1.5 GB      | `apps/ptah-video-studio/.whisper/` |
| Remotion headless Chromium | ~170 MB      | managed by `@remotion/cli`         |

All download steps are idempotent: re-running scripts after a cache hit is
fast (mtime-gated skip logic in narrate.mjs and caption.mjs).

---

## Why we cannot render on the Windows dev machine

Windows 11 Smart App Control (SAC) blocks any unsigned binary at load time.
Remotion's native compositor ships pre-built Windows DLLs
(`@remotion/compositor-win32-x64-msvc`) that are not signed with a
Microsoft-recognized certificate. When Node loads the compositor,
Windows raises Win32 error 4551 (ERROR_UNKNOWN_REVISION) and the process
exits.

Disabling SAC requires putting Windows into "evaluation mode" and then
re-enabling it — there is no toggle. A factory reset is required to revert.
This is not acceptable for a developer machine, so we render on Linux CI
where this restriction does not apply.

There is no workaround on the capture side: the capture itself runs fine on
Windows (Playwright + Electron work). Only the `remotion render` step is
affected.
