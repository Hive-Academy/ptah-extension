# Handoff: builder-invitation (written 2026-09-07)

Read `CLAUDE.md` in this folder first — machine facts, MCP tool names,
frame-rate rules, and the traps that cost real time. Then
`projects/builder-invitation/graphics/BUILD-SPEC.md` before touching any
graphic.

This supersedes the 2026-09-06 handoff, which described the setup phase.

## What this job is

A 13:38 talking-head invitation video. Narration is Egyptian Arabic with
English technical terms. On-screen graphics are English. No music bed.

The argument: an AI-generated MVP is not a maintainable application; a
developer who understands the software development life cycle plus AI gets
both speed and awareness; come build a SaaS together for two weeks, free and
open source.

## State

| Leg                          | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline rebuilt 24 → 60 fps | Done. `builder-invitation-60` / `builder-invitation-cut`, 49128 frames, 818.80 s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Transcript                   | Done. `transcript/words.json`, WhisperX large-v3, CUDA, `--language ar`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Transliteration cleanup      | Done. 97 substitutions, `words-clean.json`, timing verified unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Arabic captions              | Done. `transcript/captions-ar.srt`, 209 cues, 0 overlaps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Primary grade                | Done, twice. First pass was a neutral contrast lift; the user judged it still too warm (the orange wall bounces onto everything). Second pass 2026-09-07 is a teal-orange look, node 1 CDL. A-roll (idx 0-4, 19-21): Slope `1.019 1.04 1.102`, Offset `-0.048 -0.033 0.011`, Power `1.186 1.186 1.123`, Sat `0.80`. B-roll (idx 5-18), mild so the screen capture stays true: Slope `1.02 1.02 1.051`, Offset `0.002 0.007 0.022`, Power `1.0`, Sat `0.9`. Simulated on export frames with numpy first (`.scratch/grade/`), then confirmed against a 60-frame Resolve test render: wall RGB 253/141/37 → 225/130/62, skin 213/139/83 → 185/126/98 |
| Graphics                     | Done. 20 built, rendered and placed — V2 holds 19, V3 holds G08. Every duration read back equals its `nb_frames`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Sound on graphics            | **Not done.** Deliberate — no music bed, so bare SFX would sit exposed over speech                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Thumbnail + copy             | Done 2026-09-07. `export/thumbnail-final.png` (1280x720) and `-1920.png`, alt headline in `thumbnail-final-alt*.png`. Built by `.scratch/thumb/compose.py` (whisperx venv python): Gemini backdrop via Antigravity CLI (no person, no text) + real camera frame cut out with `hyperframes remove-background --device cpu` + Inter text drawn with PIL. Gemini repaints faces and tops out at 1376x768, so never let it render the presenter. `export/publish-copy.md` holds Arabic (primary) and English title, description, tags, LinkedIn post                                                                                                  |
| Export                       | `export/builder-invitation-final.mp4` (first grade, 49128 frames, 818.816 s, 7.8 Mb/s) is complete and verified. `export/builder-invitation-final-graded.mp4` (teal-orange grade) started 2026-09-07. MP4 / H.264 / AAC, 1920x1080, 60 fps. `VideoQuality` is NOT writable through the API on 21.0 free (`SetRenderSettings` returns false for any value, including 0), so the job runs on Resolve's automatic quality, which lands near 8 Mb/s. For more, the user saves a Deliver-page preset with a bitrate and it loads via `render_presets`                                                                                                  |

## The original project is intact

`builder-invitation` (24 fps) is untouched and is the fallback. All work is in
`builder-invitation-60`. Resolve auto-archives the timeline before destructive
operations — `builder-invitation-cut_archived_v01`, `_v02` and so on.

## Owed work, in order

1. **Verify the export.** `render verify_output {job_id, expected_frames: 49128}`,
   then `ffprobe` the MP4: 49128 frames, 60 fps, 818.80 s, AAC audio.
2. **The three transitions.** Smooth Cut, Cross Dissolve and Blur Dissolve did
   not survive the rebuild. Cut points are in `edit/timeline1-items.json`.
   Re-add by hand in the GUI, then re-export.
3. **Upload.** The MP4 plus `transcript/captions-ar.srt` as a separate caption
   track. Do not burn the captions in.

If a graphic needs a change: edit its folder, re-render with
`scripts/render-overlay.sh <abs comp dir> <abs out>` (never in parallel),
delete the old item from the timeline, re-run
`python scripts/plan_overlay_placement.py projects/builder-invitation`, place
with `append_to_timeline` on the planner's track, and read the track back.

## Things that will bite you

- **`AppendToTimeline` silently truncates an overlapping clip** and reports
  success. G08 lost a full second — its whole fade-in. A graphic's FILE is
  longer than its CONTENT because of the fade-out, so spans computed from the
  beat plan's out-point are wrong. Use the planner; it reads real frame counts.
- **HyperFrames renders at 30 fps unless the composition root carries
  `data-fps="60"`.** `render-overlay.sh` now asserts the rate and the alpha
  channel and fails loudly.
- **`hyperframes check` passes broken compositions.** Every agent that looked
  at its own contact sheet found a defect the automated gates missed: a
  collided word, a strikethrough through the wrong text, a 20px overflow, a
  tween resolving from its exit state at t=0. Reading the sheet is not
  optional.
- **Power windows are not in Resolve's scripting API.** Not a free-edition
  limit — they simply are not exposed. The primary grade is scripted; window
  work is manual.

## Manual work only the user can do

1. **Re-add the three transitions** (see above).
2. **Power windows in the Color page**, if wanted. Two moves, and they are the
   biggest remaining gain:
   - A-roll: a tracked window on the face, `+8 to +12` gain inside; outside it
     `-12` gain and `-15` saturation to stop the orange wall competing.
   - B-roll: a window on the webcam picture-in-picture, `+10` gain, so the face
     matches the A-roll instead of sinking into the dark UI.
3. **Review `transcript/REVIEW.md`** — 34 caption tokens flagged for a human
   ear before the SRT ships.

## Do not

- Do not use `apps/ptah-video-studio`. That is the Remotion showcase pipeline
  and a different flow entirely.
- Do not burn the captions in. Ship the SRT.
- Do not run renders in parallel.
- Do not call `timeline apply_cuts`.
- Do not target "current timeline" — target by name, and read every write back.
