# Recording Ptah videos (self-shot)

This is the founder's spec for shooting the **self-shot** marketing videos —
_you_ on camera and/or screen-sharing, amplified by the same cinematic engine
(virtual-camera zoom, amber highlight rings, motion blur, word-timed captions,
music bed, branded end card) that powers the showcase tours. **No AI narration.**

Three modes, one pipeline:

| Mode           | You get                                                                                       | Composition   |
| -------------- | --------------------------------------------------------------------------------------------- | ------------- |
| `talking-head` | Your camera full-frame + captions + lower-third / keyword / stat / b-roll overlays + end card | `TalkingHead` |
| `screen-demo`  | Your screen full-frame under the virtual camera (zoom/pan/ring) + optional camera bubble      | `ScreenDemo`  |
| `hybrid`       | A layout state machine: camera-full ↔ screen+bubble ↔ side-by-side ↔ screen-only              | `Hybrid`      |

Everything cinematic happens at **render** time from your recording + a **beats
manifest** — so you can re-render endlessly without re-shooting.

---

## 1. OBS setup (separate camera + screen tracks)

Record **two independent files** (or two tracks you export separately). Never
bake your webcam into the screen capture — the pipeline composites them.

**Scene / sources**

- **Screen source:** Display or Window Capture at **native resolution** (don't
  downscale). 1440p or 4K screens record at full res — the renderer supersamples
  down, so zoom-ins stay crisp.
- **Camera source:** your webcam / camera at **1080p minimum** (1440p+ ideal).
  Frame yourself with headroom; you'll appear full-frame and as a corner bubble.
- Put camera and screen in **separate scenes**, or use OBS **"Record"** with two
  captures and OBS's multi-track audio, then export two files. Simplest reliable
  path: record two passes, or use two OBS profiles.

**Output**

- Container **MP4** (or MOV), **H.264**, **30 fps** (the compositions render at
  30 fps — match it to avoid resampling judder).
- **Constant frame rate (CFR)**, not variable — VFR webm confuses seeking.

**Audio**

- Use a real mic (USB condenser, lav, or headset — not the laptop mic).
- Record voice on a **dedicated audio track**. Either:
  - export a separate `audio.wav` (best — lets the renderer mute both videos and
    play a clean voice track), **or**
  - ensure your **camera** file carries the mic (talking-head/hybrid), or your
    **screen** file carries it (screen-demo).
- Aim for **-16 to -12 dB** average, no clipping. Quiet room, no fan noise.

**The 2-second silence rule**

- Start every take with **~2 seconds of silence** before you speak, and hold a
  beat at the end. This gives a clean handle for sync/trim and lets the intro
  lower-third breathe over calm footage. Don't jump-cut the first word.

---

## 2. Name and drop your files

Create one folder per video under `apps/ptah-video-studio/selfshot/<slug>/` and
drop your recordings in, named by convention (the tools auto-detect them):

```
apps/ptah-video-studio/selfshot/my-intro/
  camera.mp4     ← your face (talking-head / hybrid)
  screen.mp4     ← your screen recording (screen-demo / hybrid)
  audio.wav      ← optional separate voice track (recommended)
```

Prefixes recognized: `camera*` / `cam*` / `face*`, `screen*` / `demo*` /
`desktop*`, `audio*` / `voice*` / `mic*`. Anything else, declare explicitly in
`beats.json`'s `input` block.

---

## 3. The three commands

Run from `apps/ptah-video-studio/`. First-time only: `npm run gen:qr` (regenerates
the end-card waitlist QR; already committed, so usually skippable).

### a) Transcribe — voice → `words.json`

```bash
npm run selfshot:transcribe -- --slug my-intro
```

Runs whisper.cpp (the same engine the showcase captions use; model cached under
`.whisper/`) on your voice track and writes `selfshot/my-intro/words.json` with
word-level timestamps. Powers both the on-screen captions **and** the beats
manifest's word anchors. Re-run with `--force` after re-recording.

### b) Draft beats — `words.json` → starter `beats.json`

```bash
npm run selfshot:draft -- --slug my-intro \
  --keywords "open source,agents,memory,Builders" \
  --title "Your Name" --subtitle "Founder, Ptah"
```

Writes a first-draft `beats.json`: mode inferred from your files, an intro
lower-third at 0.5s, keyword chips at the first time you say each keyword, an end
card, and (for hybrid) a couple of layout switches. **Then edit it** — add zoom
punch-ins, stat cards, b-roll cutaways, and tune timing. See the beats reference
below.

### c) Render — `beats.json` (+ media + words) → MP4

```bash
# Horizontal 1920x1080 (default)
npm run selfshot:render -- --slug my-intro

# Vertical 1080x1920 (Shorts/Reels/TikTok) — SAME manifest, reflows automatically
npm run selfshot:render -- --slug my-intro --format 9x16

# Both at once
npm run selfshot:render -- --slug my-intro --format both

# Fast preview of just a few seconds (frame range) while you tune beats
npm run selfshot:render -- --slug my-intro --range 0-90
```

Output: `selfshot/my-intro/out/my-intro-16x9.mp4` (and/or `-9x16.mp4`). Preview
interactively with `npm run studio` (open the `TalkingHead` / `ScreenDemo` /
`Hybrid` composition).

---

## 4. The beats manifest

One JSON per video. `at` (and optional `until`) is **seconds** OR a **word
anchor** `{ "word": "agents", "occurrence": 1 }` resolved from `words.json`, so
timing stays locked to what you actually say even after you re-record.

```jsonc
{
  "mode": "screen-demo",
  "input": { "screenVideo": "screen.mp4", "cameraVideo": "camera.mp4", "audio": "audio.wav" },
  "bubble": { "enabled": true, "corner": "br", "sizePct": 0.24 },
  "endCard": { "enabled": true, "durationMs": 6000 },
  "beats": [
    { "type": "lower-third", "at": 0.5, "title": "Ptah", "subtitle": "open source" },
    { "type": "keyword", "at": { "word": "agents" }, "text": "AI agents", "corner": "tr" },
    { "type": "stat", "at": 6.0, "value": "9 agents", "label": "in parallel", "corner": "tr" },
    { "type": "zoom", "at": { "word": "dashboard" }, "until": { "word": "cost" }, "rect": { "x": 0.08, "y": 0.1, "w": 0.42, "h": 0.4 }, "ring": true },
    { "type": "highlight", "at": 14.0, "durationMs": 2000, "rect": { "x": 0.5, "y": 0.5, "w": 0.3, "h": 0.25 } },
    { "type": "broll", "at": 20.0, "until": 24.0, "src": "canvas-orchestra", "layout": "full" },
    { "type": "layout-switch", "at": { "word": "watch" }, "layout": "screen-full-with-bubble" },
  ],
}
```

**Beat types** — `layout-switch` (hybrid layout state), `lower-third`,
`keyword`, `stat`, `broll`, `highlight` (amber ring, no camera move), `zoom`
(virtual-camera punch-in, optional ring). Rects are normalized `0..1`
(`x`/`w` over width, `y`/`h` over height). `broll.src` is either a file you drop
in the folder **or a showcase scene slug** (e.g. `canvas-orchestra`) — its
rendered tour MP4 is pulled in as b-roll (the only sanctioned use of those AI
clips now). Full field list + validation live in
`src/selfshot/manifest.ts` (zod, source of truth) and
`scripts/lib/selfshot-resolve.mjs` (the render-side validator/resolver).

---

## 5. Checklist before you hit record

- [ ] Camera ≥ 1080p, screen at native res, both 30 fps CFR.
- [ ] Separate camera and screen files (never webcam baked into screen).
- [ ] Clean mic, -16…-12 dB, quiet room.
- [ ] ~2 s of silence at the start (and a beat at the end).
- [ ] Say your keywords clearly (they drive the pop-up chips and anchors).
- [ ] One folder per video under `selfshot/<slug>/`, files named by convention.
