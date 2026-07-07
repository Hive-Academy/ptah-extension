---
name: video-showcase
description: Generate narrated, captioned, camera-animated marketing videos from automated UI walkthroughs. A portable Nx pipeline — Playwright drives the real app and records a flat screen capture plus a beats/shots manifest; Remotion renders it into an MP4 with virtual-camera zoom/pan, amber highlight rings, motion blur, a device frame, word-timed captions, AI narration, and a music bed. Use when the user wants to create/record/render a product demo, feature tour, showcase, or marketing video from their app; author or edit a scene/tour; tweak the zoom/highlight/camera behavior; re-skin the videos for a different brand; or PORT this whole pipeline into another Nx workspace/SaaS project. Triggers on "showcase", "product/demo/tour video", "record a scene", "render the video", "camera/zoom/highlight", "narration/captions", or "reuse the video setup in <other project>".
---

# Video Showcase

Turns automated UI walkthroughs into polished marketing MP4s. It is **two halves joined by JSON manifests** — capture is deliberately dumb (flat footage + data), all cinematography is a post-process, so you re-render endlessly without re-recording.

```
┌── CAPTURE (Playwright) ──────────┐        ┌── RENDER (Remotion) ─────────────┐
│ Director drives the real app     │        │ render-all.mjs builds props      │
│ records raw.webm (flat, no zoom) │ beats  │ ShowcaseVideo composition applies│
│ emits beats.json + shots.json  ──┼──json──▶ virtual camera (zoom/pan),       │
│ (+ narrate → wav, caption → json)│ shots  │ amber ring, captions, audio, mux │
└──────────────────────────────────┘  json  └───────────────▶ out/<scene>.mp4 ─┘
```

**Golden rule:** zoom and highlight borders are NOT in the recording — the Director only records element rectangles + timestamps into `shots.json`. Everything cinematic happens at render time. So visual/camera fixes never need a re-capture, only a re-render.

## The three engine units (what's reusable/portable)

| Unit            | Path (this repo)                               | Role                                                                     |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Remotion app    | `apps/ptah-video-studio`                       | Compositor + `render-all.mjs`, narration/caption scripts, camera grammar |
| Shared types    | `libs/showcase-manifest`                       | `beats`/`shots` manifest types — the contract between capture & render   |
| Capture harness | `apps/ptah-electron-e2e/src/showcase/_harness` | `Director` + Playwright fixtures (web + Electron launchers)              |

**Project-specific (authored per app):** scene specs (`*.scene.ts`), narration scripts (`scripts/<scene>.json`), and branding (`brand.config.ts`).

## Workflow

1. **Author a scene** — a `*.scene.ts` (Playwright walkthrough using the `Director`) + a `scripts/<scene>.json` (ordered narration lines). See `reference/scene-authoring.md`.
2. **Capture** — run the showcase Playwright project → writes `dist/apps/<e2e>/recordings/<scene>/{raw.webm, beats.json, shots.json}`.
3. **Narrate** — `npm run narrate` (ElevenLabs) → `wav/NNNN.wav` + `durations.json` (drives audio-locked pacing).
4. **Render** — `node apps/ptah-video-studio/scripts/render-all.mjs --scene <slug>` → `out/<scene>.mp4`.
5. **Preview/iterate** — `cd apps/ptah-video-studio && npm run studio` opens Remotion Studio to scrub the camera frame-by-frame without a full render.

## Quick commands

```bash
# Render one scene / all scenes
node apps/ptah-video-studio/scripts/render-all.mjs --scene dashboard-tour
node apps/ptah-video-studio/scripts/render-all.mjs
# Higher-res output (supersamples from the capture)
node apps/ptah-video-studio/scripts/render-all.mjs --scene X --out-res 1080p
# Interactive preview
cd apps/ptah-video-studio && npm run studio
```

Videos land at `dist/apps/ptah-electron-e2e/recordings/<scene>/out/<scene>.mp4`; the raw un-styled capture is `raw.webm` in the same folder.

## Camera behavior (the part people tweak most)

The virtual camera follows `shots.json` under a "grammar" enforced in `render-all.mjs` `applyCameraGrammar`: a full-frame establishing opener, minimum spacing between punch-ins, and — critically — a **release shot** after each punch-in so the camera zooms back OUT to full-frame instead of freezing on one element. Tunables: `HOLD_MS` (dwell before releasing, 2600), `RELEASE_MIN_GAP_MS` (skip release if the next punch is closer, 1400), `ESTABLISH_MS`, `MIN_SHOT_MS`. Full details + troubleshooting (frozen zoom, ring on empty space, edge-pan black gap) in `reference/camera-and-render.md`.

## Re-skin for a different brand

All branding is centralized in `apps/<studio>/src/brand.config.ts` (`BRAND`): `wordmark`, `productName`, `tagline`, `ctaLabel`, and `theme` (colors + font). Editing that one file re-skins every video. See `reference/brand-and-runtime.md`.

## Port into another Nx workspace

Copy the three engine units, rename the `@ptah-extension/showcase-manifest` package alias, add the deps, set `brand.config.ts`, and pick the capture runtime (web via `browser-fixtures.ts`, Electron via `showcase-launcher.ts` — both ship). A generated, copy-pasteable kit can be produced with `node apps/ptah-video-studio/scripts/export-kit.mjs`. Step-by-step in `reference/install.md`.

## Reference

- `reference/scene-authoring.md` — full `Director` API + how to write a scene + narration script
- `reference/camera-and-render.md` — shots/beats model, coordinate system, camera grammar, render pipeline, troubleshooting
- `reference/brand-and-runtime.md` — `brand.config.ts` fields + web vs Electron capture
- `reference/install.md` — porting the pipeline into a new Nx workspace

For heavy authoring or a full record→render pass, delegate to the `video-director` subagent.
