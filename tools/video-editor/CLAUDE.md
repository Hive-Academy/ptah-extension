# Video editor: raw clip -> trimmable Resolve timeline -> HyperFrames overlays

One linear flow: intake -> transcribe -> choose the cut -> replay into Resolve
-> graphics -> finish in Resolve. Never hand back a flattened MP4.
The two decision points are the cut list and the graphics plan. Show both
before building. Everything else, just run.

This is tooling only. Nothing here ships. It is separate from
`apps/ptah-video-studio` (Remotion, screen-capture showcases); do not mix the two.

## Machine facts (learned 2026-09-06)

- Windows 11, Git Bash. `python` is 3.14.4 at `C:\Python314`. `uv` 0.12.10
  lives at `%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_*\uv.exe`
  and is on PATH in new shells only.
- GPU: RTX 3070 Laptop 8 GB, driver 610.47. WhisperX runs CUDA float16.
- ffmpeg 9.0 (Gyan, winget). Node 24.15.
- DaVinci Resolve **21.0.0.48, free edition**. External scripting is gated, so
  the MCP reaches Resolve only through the in-app bridge.
- `export PYTHONUTF8=1` in every script. Piped Python is cp1252 here.
- HyperFrames shells out to `npx` and cannot find `npx.cmd` from Git Bash.
  Run `npx hyperframes ...` from PowerShell (see `scripts/render-overlay.sh`).

## Resolve MCP

- Vendored at `vendor/davinci-resolve-mcp` (commit 6eca4bf, 2026-09-06), venv at
  `vendor/davinci-resolve-mcp/venv`. Registered in the repo-root `.mcp.json` as
  `davinci-resolve` with `RESOLVE_SCRIPT_API`, `RESOLVE_SCRIPT_LIB`,
  `PYTHONPATH`, `PYTHONHOME`, `DAVINCI_RESOLVE_BRIDGE=1`, `PYTHONUTF8=1`.
- Bridge installed into both `%APPDATA%` and `%PROGRAMDATA%`
  `...\Fusion\Scripts\Utility\`. Config: `~/.config/davinci-resolve-mcp/bridge.json`
  (loopback, port 49632, HMAC).
- **Every session**: Resolve must be running with a project open, and
  Workspace > Scripts > `resolve_bridge` must be started. Without it every tool
  reports a bridge fault (that is the point of `DAVINCI_RESOLVE_BRIDGE=1`).
- The compact server (default, no `--full`) exposes domain tools with an
  `action` parameter: `media_pool(action="create_timeline_from_clips", ...)`,
  `timeline(action="get_items_in_track", ...)`, `media_pool_item(action="get_clip_property")`,
  `edit_engine(action="plan_silence_ripple" | "execute_silence_ripple")`.
- There is no `media_pool list_clips`. To list the pool use
  `media_pool(action="probe_media_pool")`, which returns every clip with its
  id, media id, file path and duration in one call.
- `timeline(action="source_range_report", params={"track_type":"video","track_index":1})`
  recovers a whole edit decision list in one call: per item, its timeline
  range AND its source range. **Source frames are counted in the media's own
  rate, not the timeline's.** That is what makes a frame-rate rebuild lossless
  (see "Recovering an edit" below).
- Items adjacent to a transition report a source range longer than their
  timeline slot, by the transition's handles. Use the timeline duration for
  the conform, not the reported source length.
- Never call `timeline apply_cuts`: it deletes whole items and reports success.
- Target timelines by name, never "current". Read every write back.
- Save the project right after any build. An unsaved project can raise a GUI
  modal that no script can dismiss.

## Recovering an edit at a different frame rate

A hand-made cut is not lost when the timeline rate is wrong. Proven on
`builder-invitation`, 24 fps -> 60 fps, 22 clips, 10 ms of drift over 13:38.

1. `timeline source_range_report` on the video track. Save it verbatim to
   `<job>/edit/timeline1-items.json`, with the timeline rate, each item's
   timeline start and duration, and its source start.
2. `scripts/rebuild_clip_infos.py <job> --clip-id KEY=UUID ...` conforms it.
   Only the DURATION converts (`x target_fps / source_fps`); the source start
   is already in the media's rate and passes through untouched.
3. Set the new project's rate BEFORE importing any media. Resolve locks
   Timeline frame rate the moment the first clip enters the media pool, and
   it never prompts. Set Playback frame rate by hand too.
4. `media_pool create_timeline_from_clips` with the conformed `clip_infos`.
   Linked audio follows automatically; do not place it separately.
5. Read every item back and compare durations before claiming success.
6. Transitions do NOT survive. Record them in the JSON and re-add by hand.

`scripts/build_reference_audio.py <job>` cuts the same ranges out of the raw
files with ffmpeg and concatenates them. The result is timeline-relative, so
`frame = round(seconds * fps)` maps any word time straight onto the timeline.
Transcribe that, not a raw clip: `transcribe.py <job> --audio <wav>`.

## Frame-rate rules

1. `ffprobe` the raw clip first (`-show_entries stream=r_frame_rate,avg_frame_rate`).
2. After import, `GetClipProperty('FPS')` is the authority. iPhone VFR .MOV:
   ffprobe says 30000/1001, Resolve says 30.00.
3. The user sets Project Settings > Master Settings > Timeline frame rate AND
   Playback frame rate by hand. The API cannot write the playback rate. If they
   disagree, audio plays chopped.
4. If every clip duration reads back off by 1.001, the rate model is wrong.
   Rebuild the project at the right rate. Never nudge frames.

## clip_infos contract

`scripts/cuts_to_clip_infos.py <job> --clip-id <id> --fps <resolve fps>`:
source frames at the raw's rate, `end_frame` exclusive, `record_frame`
timeline-relative and cumulative. Readback timecodes carry the 01:00:00:00 offset.

## Transcription

- Venv: `~/.cache/video-editor/whisperx-venv` (Python 3.11, whisperx 3.8.6,
  torch 2.11.0+cu128). Python is at `Scripts/python.exe`.
- `uv pip install torch --index-url .../cu128` is a no-op when a CPU torch of
  the same version is present. Use `--reinstall-package torch
--reinstall-package torchaudio`. The CUDA wheel set is several GB and the
  install runs past 20 minutes; run it in the background.
- **`torchvision` must match `torch`.** The venv shipped `torchvision 0.23.0`
  (a CPU build for torch 2.8) against `torch 2.11.0+cu128`. WhisperX never
  imports torchvision, but `transformers` does, opportunistically, and the
  mismatch raises `RuntimeError: operator torchvision::nms does not exist`
  deep inside `transformers.image_utils`. It surfaces as the useless
  `ImportError: cannot import name 'Pipeline' from 'transformers'`. Fix:
  `uv pip install --reinstall-package torchvision torchvision==0.26.0
--index-url https://download.pytorch.org/whl/cu128` (8.9 MB, seconds).
  Diagnose by importing `transformers.pipelines.base` directly — the lazy
  loader hides the real traceback otherwise.
- Never pipe `transcribe.py` into `tail`. The pipe reports tail's exit code,
  so a total failure prints `[exited with code 0]`. Redirect to a log file.
- **`HF_HUB_DISABLE_SYMLINKS=1` or the GPU is never used.** Windows refuses
  symlink creation without Developer Mode, `huggingface_hub` caches with
  symlinks, and the failure lands at model load as
  `OSError(22, 'A required privilege is not held by the client')`. The device
  loop charges that to CUDA and silently falls back to CPU int8, which is
  roughly an order of magnitude slower. `transcribe.py` sets both HF symlink
  variables now. Always confirm the log says `on cuda/float16`, never trust
  that CUDA was used because `torch.cuda.is_available()` was True.
- Pass `--language ar` for this footage. Detection costs a pass and reads only
  the first 30 s.
- `scripts/transcribe.py <job>` -> `transcript/words.json`. Cached. `--force` re-runs.
- First run downloads large-v3 (~3 GB).

## Graphics

- HyperFrames pinned to `0.8.30` in `scripts/render-overlay.sh`. Skills are in
  `~/.claude/skills/hyperframes*`, `motion-graphics`, `media-use`.
- One composition per graphic, under `projects/<job>/graphics/<beat-name>/`.
  Render short pieces, never one long composition.
- `--format mov` carries alpha. Import onto video track 2 in Resolve.

## Job layout

```
projects/<kebab-title>/
  raw/          copied original, never modified (gitignored)
  transcript/   words.json, cuts.json, clip_infos.json (tracked)
  graphics/     one HyperFrames composition per graphic (renders/ gitignored)
  outputs/      Resolve exports (gitignored)
```

Name the job after the content, never after the camera file, a date or a stage.
