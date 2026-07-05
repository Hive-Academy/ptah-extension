# Ptah Video Studio — Roadmap & Follow-ups (TASK_2026_151)

Status of the showcase video pipeline and everything still on the table. Living
doc; update as items land. See `README.md` for the operator guide and
`.ptah/specs/TASK_2026_151/` for the original plan artifacts.

---

## Where things stand

The pipeline runs **fully locally** and produces polished, motion-graphics
videos. Reference deliverable: `dist/apps/ptah-electron-e2e/recordings/canvas-orchestra/out/canvas-orchestra.mp4`.

**Local render is unblocked.** Smart App Control was disabled on the dev host, so
Remotion's native compositor runs. The committed CI render workflows
(`render-showcase.yml` / `upload-recordings.yml`) are now an optional
"another machine" fallback, not the primary path.

### Delivered

| Area                   | What                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture (Phase 0)      | Director emits `beats.json` (caption text + wall-clock `tMs`); `PTAH_SHOWCASE_SILENT_CAPTIONS=1` lets Remotion own the lower-thirds.                                                                                                                                                                                  |
| Pipeline (Phase 1)     | `narrate.mjs` (Kokoro TTS) → `caption.mjs` (whisper.cpp) → `render-all.mjs` (Remotion). Nx targets wired.                                                                                                                                                                                                             |
| Asset serving          | Local assets served via `--public-dir` + `staticFile()` (Remotion rejects `file://`).                                                                                                                                                                                                                                 |
| First video            | `canvas-orchestra` reverse-engineered from real Jun-29 footage, single continuous VO track.                                                                                                                                                                                                                           |
| Caption sync           | Per-beat transcription, each beat's words offset to its footage `tMs`; sub-word tokens merged into whole words.                                                                                                                                                                                                       |
| Visual system          | `theme.ts`, animated `Backdrop`, `DeviceFrame` (rounded/shadowed device card + **auto gray-band crop detection**), richer `LowerThird` (spring pop, amber active-word, pill), `IntroCard` (agent-dot motif, drawing underline), `OutroCard` (CTA pill), `Watermark`, `ProgressBar`, edge crossfades.                  |
| Motion graphics        | `shots.json` → virtual camera (eased zoom/pan), highlight rings, floating callouts, positional (top/bottom) captions. Authored for `canvas-orchestra`.                                                                                                                                                                |
| Director auto-shots    | Director records a shot at every `spotlight`/`hover`/`click` (and element-targeted `caption(text, target)`), normalized to measured content coords, debounced, and flushes `shots.json` next to `beats.json` (never clobbers a hand-authored file when a run records no shots). Types shared via `showcase-manifest`. |
| Exact-viewport capture | Launcher measures the real renderer viewport after `setContentSize` and iteratively corrects until viewport == record size — no more gray `rgb(128)` padding band at the source. Band auto-crop in `render-all.mjs` remains as fallback. Measured res flows into the manifest + shot normalization.                   |
| Camera motion v2       | Per-shot `transMs` / `ease: ramp\|smooth\|cut` (fast-attack quintic ramp default), velocity-scaled motion blur on the footage layer (cap 8px), whip-pan / zoom-blur section transitions replacing plain crossfades (`SectionTransition.tsx`).                                                                         |
| Supersampled zooms     | `render-all.mjs --out-res 1080p\|1440p\|4k\|native`: capture high-res, render lower-res output — punch-ins stay crisp; `dynamicMaxScale` allows up to ~3.2× when supersampled.                                                                                                                                        |
| Sound-design hooks     | `SoundDesign.tsx`: whoosh on focus-changing shot boundaries + looped music bed with fades — activates only when `assets/sfx/whoosh.mp3` / `assets/music/bed.mp3` exist (see `assets/README.md`), silently skipped otherwise.                                                                                          |
| Voice cloning          | `narrate.mjs --engine elevenlabs` (ElevenLabs Instant Voice Clone via REST, PCM→WAV, sequential + retry, per-beat/scene char-count logging). `durations.json` records engine/voice/model and busts the reuse-skip on mismatch. Kokoro remains the default engine.                                                     |

### Known environmental notes

- **Gray padding band**: Electron/Playwright pad the recording with a uniform
  `rgb(128)` band at the bottom when the web-contents viewport is shorter than
  the record size (canvas-orchestra: content = top 967px of 1080). Fixed at the
  source for NEW captures (launcher now iterates until viewport == record size);
  `render-all.mjs` auto-detect + `DeviceFrame` clip remain for old footage and
  as a fallback when the display physically can't fit the capture res.
- **Intro offset**: camera/caption times are body-local; the rendered mp4 is
  offset by the intro (`DEFAULT_INTRO_MS`, 1800ms). Add it when scrubbing to a
  beat time.

---

## ~~The big next step — Director auto-emits `shots.json`~~ SHIPPED

Landed as described (see Delivered table): the Director records shots at every
`spotlight`/`hover`/`click` and element-targeted `caption(text, target)`,
normalizes to measured content coordinates, and flushes `shots.json` in fixture
teardown. Every designed scene now gets synced punch-ins, rings, and top/bottom
caption placement with zero hand-authoring. First real validation: the next
`dashboard-tour` capture.

---

## Remaining work

### 1. Fresh designed capture — dashboard-tour

- Prereqs (user-owned): fully quit the running Ptah app (single-instance lock);
  start Docker + backend for a fully authenticated boot.
- Run (targeted, preserves other recordings — do NOT use the full `showcase`
  target, it wipes `recordings/`):
  ```
  PTAH_SHOWCASE_SILENT_CAPTIONS=1 npx playwright test \
    --config=apps/ptah-electron-e2e/showcase.config.ts dashboard-tour
  node apps/ptah-video-studio/scripts/narrate.mjs  --scene dashboard-tour --source beats --force
  node apps/ptah-video-studio/scripts/caption.mjs  --scene dashboard-tour --force
  node apps/ptah-video-studio/scripts/render-all.mjs --scene dashboard-tour
  ```
- Ideally paired with Director auto-shots so it ships with camera work.

### 2. Push the motion further

- **Number count-ups** on stats (tokens/cost/turns animate up when focused).
- **Parallax** between tiles during pans (subtle depth).
- ~~Speed-ramps / hold-and-cut~~ — shipped (per-shot `transMs` / `ease`).
- ~~Section transitions~~ — shipped, hand-rolled (`SectionTransition.tsx`).
- ~~Motion blur~~ — shipped (velocity-scaled, footage layer only).
- **Sound design**: hooks shipped (`SoundDesign.tsx`); still need the actual
  assets — drop `assets/sfx/whoosh.mp3` + `assets/music/bed.mp3` in
  (see `assets/README.md` for expectations/sources).

### 3. Multi-beat timing — Phase 2 (video-follows-audio)

- Per-beat caption sync already handles caption alignment. Still needed to
  prevent **audio overlap** when a beat's narration is longer than its on-screen
  gap: `beat-timing.ts` + `holdForBeat(index)` gated by
  `PTAH_SHOWCASE_FOLLOW_AUDIO`, two-pass (narrate-for-durations → capture with
  holds). Only required for dense scenes; validate dashboard-tour first.

### 4. Scale to all 13 scenes — Phase 3

- `showcase.config.json`: per-scene `voice / speed / intro / outro / kenBurns`
  with a default fallback; `narrate.mjs` / `render-all.mjs` / composition read it.
- Per-scene `shots.json` (auto from Director once #1 lands).

### 5. Aspect-ratio variants

- Vertical **9:16** and square **1:1** for TikTok/Reels/Shorts. Camera focus
  rects become essential here (wide desktop UI can't fill a vertical frame — the
  camera _is_ the reframe). Composition already derives size from `manifest.res`;
  add a target-aspect option + per-shot vertical focus.

### 6. Reverse-engineered clips without Director metadata

- For old footage (no scene data), either hand-author `shots.json` (current) or
  add heuristic UI-region detection (panel/edge detection on frames) to
  bootstrap focus rects.

---

## Hardening / tech debt

- ~~Validate `shots.json` in `render-all.mjs`~~ — shipped (structural check in
  the `.mjs` mirroring `shotsFileSchema`; keep the two in lockstep — the
  authoritative zod parse stays composition-side).
- **Studio per-scene preview**: a `PTAH_PREVIEW_SCENE=<scene>` path so
  `:studio` opens with a real scene's props instead of the empty fallback.
- **Caption punctuation**: lone punctuation is mostly folded into words now;
  keep an eye on edge cases.
- **`render-all` concurrency**: `--concurrency` is plumbed; tune for batch renders.
- Branch `feat/video-studio-task-2026-151` is **not pushed**; several commits +
  uncommitted working-tree changes (visual system + motion layer). Pre-existing
  unrelated changes (smithery / canvas / chat-input) must stay untouched.

---

## Reference — `shots.json` schema

Per-scene camera + annotation track (`recordings/<scene>/shots.json`). Coords are
**normalized to the content region** (0..1; y over the cropped content height).
Validated by `shotsFileSchema` in `src/lib/shots.ts`.

```jsonc
{
  "scene": "canvas-orchestra",
  "shots": [
    {
      "fromMs": 13380, // body-local start (VO time)
      "focus": { "x": 0.685, "y": 0.1, "w": 0.25, "h": 0.5 }, // camera target; omit = full frame
      "ring": { "x": 0.688, "y": 0.05, "w": 0.245, "h": 0.7 }, // optional amber outline
      "callout": { "text": "Real cost — live", "pos": "tr" }, // optional corner card (tl|tr|bl|br)
      "captionPos": "top", // optional: move caption off a close-up (top|bottom)
    },
  ],
}
```

Camera eases into each shot over ~750ms then holds; scale is capped (~2.4×) to
keep close-ups crisp. See `focusAt` / `focusToTransform` / `activeShot` in
`src/lib/shots.ts`.
