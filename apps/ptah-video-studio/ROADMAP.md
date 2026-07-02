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

| Area               | What                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture (Phase 0)  | Director emits `beats.json` (caption text + wall-clock `tMs`); `PTAH_SHOWCASE_SILENT_CAPTIONS=1` lets Remotion own the lower-thirds.                                                                                                                                                                 |
| Pipeline (Phase 1) | `narrate.mjs` (Kokoro TTS) → `caption.mjs` (whisper.cpp) → `render-all.mjs` (Remotion). Nx targets wired.                                                                                                                                                                                            |
| Asset serving      | Local assets served via `--public-dir` + `staticFile()` (Remotion rejects `file://`).                                                                                                                                                                                                                |
| First video        | `canvas-orchestra` reverse-engineered from real Jun-29 footage, single continuous VO track.                                                                                                                                                                                                          |
| Caption sync       | Per-beat transcription, each beat's words offset to its footage `tMs`; sub-word tokens merged into whole words.                                                                                                                                                                                      |
| Visual system      | `theme.ts`, animated `Backdrop`, `DeviceFrame` (rounded/shadowed device card + **auto gray-band crop detection**), richer `LowerThird` (spring pop, amber active-word, pill), `IntroCard` (agent-dot motif, drawing underline), `OutroCard` (CTA pill), `Watermark`, `ProgressBar`, edge crossfades. |
| Motion graphics    | `shots.json` → virtual camera (eased zoom/pan), highlight rings, floating callouts, positional (top/bottom) captions. Authored for `canvas-orchestra`.                                                                                                                                               |

### Known environmental notes

- **Gray padding band**: Electron/Playwright pad the recording with a uniform
  `rgb(128)` band at the bottom when the web-contents viewport is shorter than
  the record size (canvas-orchestra: content = top 967px of 1080). `render-all.mjs`
  auto-detects it (ffmpeg frame + sharp row scan) and `DeviceFrame` clips it.
- **Intro offset**: camera/caption times are body-local; the rendered mp4 is
  offset by the intro (`DEFAULT_INTRO_MS`, 1800ms). Add it when scrubbing to a
  beat time.

---

## The big next step — Director auto-emits `shots.json`

Today `shots.json` is hand-authored. The unlock: **designed scenes generate it
for free** because the Director already spotlights the elements we'd want the
camera on (`director.spotlight(el)`, `hover(el)`, `click(el)`, and each
`caption()` beat).

**Work:**

1. In the Director, capture `await locator.boundingBox()` at each
   spotlight/hover/click and at caption beats that target an element.
2. Normalize to **content coordinates**: divide x by capture width, y by the
   **content height** (not full frame — account for the gray-band crop), so
   focus rects line up with `DeviceFrame`'s cropped card space.
3. Emit a `shots.json` alongside `beats.json` with a shot per interaction:
   `focus` = padded element box, `ring` = tight element box, `captionPos` from a
   heuristic (top when the element sits in the lower half), optional `callout`.
4. `render-all.mjs` already reads `shots.json` — no render change needed.

**Payoff:** every designed scene (dashboard-tour, chat-code-edit, …) gets
synced punch-ins, rings, and callouts with zero hand-authoring.

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
- **Speed-ramps / hold-and-cut** instead of only eased moves.
- **Section transitions**: whip-pan / zoom-blur between intro→body→outro (not
  just crossfade). No `@remotion/transitions` installed — either add it or
  hand-roll.
- **Motion blur** on fast camera moves.
- **Sound design**: subtle whooshes on punch-ins + a low music bed under VO.

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

- **Validate `shots.json`** in `render-all.mjs` with the `shotsFileSchema` zod
  (currently trusted). Mirror the manifest's compile-time schema-match assertion.
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
