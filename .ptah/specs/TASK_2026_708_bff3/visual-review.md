# Visual review - TASK_2026_708_bff3 (Electron)

Run 2026-10-20. Verdict: **PASS**.

## Setup

- Before: `main` at `a745b9692`, built in the main checkout (`build-dev` + `copy-renderer-dev`).
- After: `feat/voice-canvas-life` work tree, same build targets.
- Electron launched with Playwright `_electron`, `--remote-debugging-port=9334`, throwaway
  HOME/USERPROFILE/APPDATA/LOCALAPPDATA, `--user-data-dir` and `PTAH_DB_PATH` under `%TEMP%`,
  an empty temp workspace as the last argument, viewport 1440x900. Port 9334 free after each run.
- Voice tab -> New session. Through `ng.getComponent(...).renderer`, a fake delegate child
  (`parentId` = root) was injected with state `idle`, then switched to `starting`.
- Canvas frames captured in-page with `toDataURL` at fixed rAF times after the switch:
  ~335 ms (pulse in flight) and ~900 ms (arrival ring). Twinkle evidence: changed-pixel count
  between two frames 1.6 s apart with the child idle (threshold: RGB sum delta > 12).
- Screenshots (git-ignored PNGs) are in `screenshots/`; numbers in `screenshots/*-result.json`.

## Results

| Scenario | Build | active | max pulses | twinkle diff px | Observed |
| --- | --- | --- | --- | --- | --- |
| dark | before | true | n/a | 104 | Flowing link only (particles cause the diff) |
| dark | after | true | 1 | 143 | Bright head on the bezier at ~335 ms; ring around the worker at ~900 ms |
| light | before | true | n/a | 91 | Flowing link only |
| light | after | true | 1 | 137 | Head and ring visible in the run ink on the light backdrop |
| reduced motion | before | false | n/a | 0 | Static scene |
| reduced motion | after | false | 0 (pending 0) | 0 | Static scene, no pulse queued, no twinkle |

- The after diff is about 40-46 px higher than before in both themes: the twinkle overlay adds
  change on top of the flowing-link particles. Twinkling dots are subtle, as designed.
- Reduced motion: identical to before (no frames, no pulse, no twinkle). Static link unchanged.
- The solid amber disc around the root in the canvas PNGs is a `toDataURL` export effect of the
  soft root glow. It appears in the before frames too; the page screenshots show the normal glow.
- Light-theme twinkle is faint but visible in the diff; no tuning needed (HANDOFF open item).

## Not covered

- Real microphone level and real delegated work: the throwaway profile has no provider login.
  The real-profile check needs the user's approval.
