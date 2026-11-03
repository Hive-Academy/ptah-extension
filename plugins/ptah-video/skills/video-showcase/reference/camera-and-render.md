# Camera Model and Render Pipeline

This is the RENDER half: how `beats.json` + `shots.json` (+ narration/caption
artifacts) become a rendered MP4. Source of truth:
`libs/showcase-manifest/src/lib/manifest.types.ts`,
`apps/ptah-video-studio/scripts/render-all.mjs`,
`apps/ptah-video-studio/src/lib/shots.ts`,
`apps/ptah-video-studio/src/components/DeviceFrame.tsx`.
Capture side is `scene-authoring.md`.

## Data model (`manifest.types.ts`)

```ts
interface Beat {
  tMs: number; // ms from recordStartMs — Playwright wall-clock
  text: string; // on-screen caption text / TTS source
  scene: string;
  scriptIndex?: number; // locks this beat to scripts/<scene>.json[i] / wav/{i+1}.wav
}

interface SceneManifest {
  // beats.json
  scene: string;
  title: string;
  recordStartMs: number;
  durationMs: number;
  res: { width: number; height: number };
  beats: Beat[];
}

interface ShotFocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
} // normalized 0..1

interface Shot {
  // one entry in shots.json
  fromMs: number; // SAME clock as Beat.tMs
  focus?: ShotFocusRect; // omit => full-frame ease-out
  captionPos?: 'top' | 'bottom';
  ring?: ShotFocusRect;
  callout?: { text: string; pos: 'tl' | 'tr' | 'bl' | 'br' };
  transMs?: number; // transition duration into this shot
  ease?: 'ramp' | 'smooth' | 'cut';
}

interface ShotsFile {
  scene: string;
  shots: Shot[];
} // shots.json
```

The Remotion side re-declares the runtime shape as a **zod** schema
(`apps/ptah-video-studio/src/lib/shots.ts`, `shotSchema`/`shotsFileSchema`) and
`render-all.mjs` has its own hand-rolled structural validator
(`validateShotsFile`) because it is plain `.mjs` and cannot import the TS zod
schema directly. **Keep all three definitions in lockstep** when a field
changes: `manifest.types.ts` (capture-side TS), `shots.ts` (`shotSchema`,
render-side zod), `render-all.mjs` (`validateShotsFile`).

## Coordinate model

- `x`/`w` are normalized 0..1 over the capture **WIDTH**.
- `y`/`h` are normalized 0..1 over the **CONTENT HEIGHT** (the cropped card,
  not the full capture — a padding band at the bottom is possible on a
  scaled display; see `detectSource()` below).
- `Shot.fromMs` and `Beat.tMs` share **one wall-clock**:
  `Date.now() - recordStartMs`, captured in the same Playwright process that
  drives the real-time `.webm` recording — so footage time, beat time and
  shot time are one coordinate with no separate alignment step needed.

## Render pipeline order (`render-all.mjs` → `buildProps()`)

For each scene with a `beats.json` under `dist/apps/ptah-electron-e2e/recordings/`:

1. **Load artifacts**: `beats.json` (required), `raw.webm` (required),
   `durations.json` (optional — narration clip lengths/word alignment),
   `captions.json` (optional whisper fallback), `shots.json` (optional).
2. **Captions**: prefer `captionsFromAlignment()` — word-accurate tokens built
   from ElevenLabs' character alignment in `durations.json`; falls back to
   `captions.json` (whisper) when no clip carries `words`.
3. **Validate shots**: `validateShotsFile(scene, raw)` — structural check
   mirroring `shotSchema`; throws with a `<scene>: …` message on mismatch.
4. **Lead-in trim** (`computeLeadTrim` + `LEAD_IN_MS=700`): skip captured dead
   footage before `firstBeat.tMs - 700`. Shifts `beats[].tMs`,
   `manifest.durationMs`, `shots[].fromMs` (via `shiftShots`) and
   `captions[].startMs/endMs` (via `shiftCaptions`) all by the same amount.
   Shots that fell entirely inside the trimmed region collapse to the opening
   shot instead of vanishing.
5. **Segment-based time-remap** (`buildSegments`, unless `--no-segments`):
   decouples OUTPUT time from CAPTURE time. Footage under an active narration
   window (`[beat.tMs, beat.tMs + clipDuration + BREATH_MS]`) plays at 1×;
   dead spans between windows are compressed via `planGap()` (speed-ramped up
   to `MAX_GAP_RATE`, or hard-cut if still too long) — see constants table
   below. Produces one monotonic `remap(srcMs) -> outMs` function applied to
   beats, shots, captions and total duration **once** (nothing is shifted
   twice). Runs AFTER lead-trim (works on the body-local clock) and BEFORE
   camera grammar (camera track spaced on the remapped times).
6. **Camera grammar** (`applyCameraGrammar`): see below — establishing shot,
   minimum spacing, and now the release-shot mechanism.
7. **Build props**: `render-props.json` written to
   `recordings/<scene>/render-props.json` — `rawVideo`, `manifest`,
   `narrationFiles` (beat index → `wav/NNNN.wav`), `durations`, `captions`,
   `source` (detected geometry), `shots`, `segments`, `narrationWindows`
   (music-bed ducking), `trimBeforeMs`, `outRes`, `whooshSfx`, `musicBed`.
8. **Invoke Remotion**: `npx remotion render src/Root.tsx ShowcaseVideo
<out> --props=<render-props.json> --public-dir=<sceneDir>`.

Output: `recordings/<scene>/out/<scene>.mp4` (H.264, yuv420p — see
`remotion.config.ts`).

## Camera grammar (`applyCameraGrammar`, tunable constants)

| Constant                                    | Value         | Meaning                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ESTABLISH_MS`                              | `2600`        | The body always opens full-frame for at least this long; any focus shot that fired inside this window is pushed out to fire exactly at `ESTABLISH_MS` (only the LAST such shot survives — earlier ones would flash by). |
| `MIN_SHOT_MS`                               | `1400`        | Minimum spacing between kept shots; a shot starting sooner than this after the previous kept shot is dropped (reads as camera jitter otherwise).                                                                        |
| `HOLD_MS`                                   | `2600`        | How long a punch-in dwells before a full-frame **release** shot is inserted.                                                                                                                                            |
| `RELEASE_MIN_GAP_MS`                        | `1400`        | A release shot is only inserted when the NEXT punch-in is at least this far past the release point; otherwise the camera pans straight to the next region instead of bouncing out and back in.                          |
| `RELEASE_TRANS_MS`                          | `650`         | Transition duration for the release shot's ease-out (uses `ease: 'smooth'`).                                                                                                                                            |
| `LEAD_IN_MS`                                | `700`         | Breath kept before the first narration line after the lead-in trim.                                                                                                                                                     |
| `DEFAULT_TRANS_MS` (`shots.ts`)             | `750`         | Fallback transition duration for a shot without `transMs`.                                                                                                                                                              |
| `MIN_FOCUS_EXTENT` (`shots.ts`)             | `0.22`        | Minimum focus-rect extent per axis; a smaller auto-emitted rect (scrollbar, divider, collapsed rail) is expanded (recentered, clamped 0..1) so a close-up always carries context.                                       |
| `dynamicMaxScale` base/hardCap (`shots.ts`) | `2.4` / `3.2` | Max camera punch-in scale. `2.4` when not supersampled; with supersampled footage (capture taller than output), scales up to `ratio * 2.4` capped at `3.2`.                                                             |

### The release-shot mechanism, in full

Without a release shot, a punch-in (`focus`/`ring` set) stays the "active
shot" — frozen, zoomed — until the **next** shot fires, which can be tens of
seconds later during a long narration hold. Two problems: (1) the zoom looks
frozen/dead on camera, and (2) if the underlying UI changes during that hold
(a scroll continues, a value updates), the static rect drifts onto pixels it
was never meant to frame. `applyCameraGrammar` fixes this by inserting a
synthetic full-frame shot at `punchInShot.fromMs + HOLD_MS` — `{ fromMs,
transMs: RELEASE_TRANS_MS, ease: 'smooth' }`, no `focus`/`ring` — **unless**
the next real punch-in is closer than `RELEASE_MIN_GAP_MS` past that point (in
which case panning straight to it reads better than bounce-out-bounce-in).

### Full ordering, step by step

1. Sort shots by `fromMs`.
2. Collapse the establishing window: keep only the LAST focus shot whose
   `fromMs < ESTABLISH_MS`, re-stamped to fire at exactly `ESTABLISH_MS`;
   prepend a synthetic full-frame shot at `fromMs: 0`.
3. Drop any shot starting within `MIN_SHOT_MS` of the previous kept shot.
4. For each remaining focus shot, insert a release shot at `+HOLD_MS` unless
   the next shot is within `RELEASE_MIN_GAP_MS` of the release point.

## Segment time-remap constants

| Constant          | Value  | Meaning                                                                                                                                   |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BREATH_MS`       | `400`  | Extra hold kept after a clip finishes before its active window closes.                                                                    |
| `DEFAULT_HOLD_MS` | `2500` | Active-window length for a beat with no resolvable narration clip.                                                                        |
| `GAP_OUT_CAP_MS`  | `900`  | A dead span at or under this plays at 1× (absorbed as connective footage); longer spans get compressed.                                   |
| `MAX_GAP_RATE`    | `8`    | Fastest a dead span is speed-ramped before a hard-cut is used instead.                                                                    |
| `HARDCUT_MS`      | `700`  | Length of the 1× tail kept from an enormous dead span (flows into the next narration beat); the rest is dropped from the source entirely. |

## `DeviceFrame` / footage geometry

`detectSource()` in `render-all.mjs` probes a frame of `raw.webm` a few
seconds in via `ffmpeg-static` + `sharp`, scanning bottom rows for a uniform
mid-gray (~rgb 128, low variance) band — Electron/Playwright pad the recorded
frame with this when the web-contents viewport is shorter than the record
size. `contentHeight` is set to where the band starts (guarded: a detected
band over 35% of the frame height is treated as a false positive → no crop).
`DeviceFrame.tsx` clips exactly that region.

`focusToTransform()` (`shots.ts`) maps a focus rect to `{ scale, tx, ty }`:
scale is `min(1/w, 1/h)` clamped to `[1, maxScale]`; translate centers the
focus point, then is **clamped** so the scaled footage always fully covers
the card (`tx`/`ty` bounded so `[0,cardW]×[0,cardH]` stays inside the scaled
footage) — this is what prevents a pan from ever revealing the card
background behind the video.

Motion blur (`DeviceFrame.tsx`) is proportional to `cameraVelocity()` (a
one-frame finite difference of `focusAt()`, normalized to a ~1.5
focus-units/sec ceiling), capped at `MAX_MOTION_BLUR_PX = 8`, and zeroes out
once the camera settles.

## Preview in Remotion Studio

```bash
cd apps/ptah-video-studio
npm run studio          # -> npx remotion studio src/Root.tsx
```

Opens the Remotion Studio UI with the `ShowcaseVideo` composition and a
`FALLBACK_MANIFEST` (empty, 6s) until you feed it real props. To preview an
actual captured/rendered scene, the fastest path is to run
`render-all.mjs` once (writes `render-props.json` into the scene dir) and
point Studio at that file, or run the full `video` Nx target and inspect the
resulting `out/<scene>.mp4` directly.

## Troubleshooting

| Symptom                                           | Cause                                                                                                                                                                                                                                                                  | Where                                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoom stays frozen / highlight sits on empty space | A long narration hold outlasted the punch-in's dwell before this feature existed, OR `HOLD_MS`/`RELEASE_MIN_GAP_MS` are tuned too loose for a specific scene's pacing.                                                                                                 | `applyCameraGrammar` in `render-all.mjs` — the release-shot mechanism exists precisely to bound this; check the shot's `fromMs` spacing against `HOLD_MS`.                                                     |
| Ring drawn on the wrong element                   | The `Shot.ring` rect is a **static** snapshot taken at capture time (`recordShot`); if the UI moves under it before the next shot fires, the rect is now stale.                                                                                                        | Add more `say()`/`spotlight()` beats to refresh the shot more often, or shorten `HOLD_MS` for that scene via a scene-specific tuning pass (there is currently no per-scene override — it's a global constant). |
| Black gap / background visible during an edge pan | `focusToTransform`'s translate clamp did not fully cover the card — usually because `footageH` (the true displayed footage height) was wrong or a focus rect's `w`/`h` was near-zero, driving `scale` to the `maxScale` cap while the pan target sits at a frame edge. | `focusToTransform` in `shots.ts` — verify `source.contentHeight` / `detectSource()` correctly identified the padding band; verify the offending shot's rect isn't degenerate.                                  |
| Malformed `shots.json` fails the whole render     | `validateShotsFile` in `render-all.mjs` throws with a `<scene>: shots[i]…` message on any structural mismatch (missing `fromMs`, bad rect shape, invalid `ease`/`captionPos`).                                                                                         | Fix the field per the error message; this validator is intentionally strict and pre-dates the render step so a bad camera track never silently mis-renders.                                                    |
| No captions render                                | Neither `durations.json` carries `words` (kokoro engine has none — only ElevenLabs' `/with-timestamps` does) nor does `captions.json` exist.                                                                                                                           | Run `caption.mjs` (whisper.cpp fallback) or switch `narrate.mjs --engine elevenlabs`.                                                                                                                          |
