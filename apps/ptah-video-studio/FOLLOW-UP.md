# Video Studio — Follow-up (session handoff)

Branch: `feat/video-studio-scene-production`. All changes below are UNCOMMITTED working-tree edits (plus one untracked root `AGENTS.md` unrelated to this work). Both `apps/ptah-video-studio` and `apps/ptah-electron-e2e` typecheck clean.

## Where this session ended

The user reported three defects in the rendered videos. All three were root-caused; fixes for all are implemented but only partially validated, and the full 13-scene re-capture (explicitly approved by the user) has NOT been started.

### Bug 1 — "Video completely off inside the Remotion frame" (FIXED, needs render verify)

Root cause: in `apps/ptah-video-studio/src/components/DeviceFrame.tsx` the card div had `overflow: hidden` but **no `position: relative`**, so the inner camera stage (`position: absolute; top/left: 0`) anchored to the outer full-screen wrapper — footage drew at composition origin, unclipped, with the empty card floating centered behind it (the rounded outline in the black zone of the user's screenshot). Every zoom/ring was offset by the card's margin.

Fix applied: `position: 'relative'` added to the card div.

Also applied (defense-in-depth): `focusToTransform` in `src/lib/shots.ts` now clamps the pan so the scaled footage always covers the card (new `footageH` param, passed `videoDispH` from DeviceFrame) — no background bleed on edge pans.

**NOT yet verified**: re-render `editor-tour` and eyeball frames AFTER this fix (the last verified render predates `position: relative`):

```bash
node apps/ptah-video-studio/scripts/render-all.mjs --scene editor-tour --out-res 1080p
# then extract frames (one ffmpeg call per timestamp!) and view:
# f=$(node -e "console.log(require('ffmpeg-static'))")
# "$f" -y -ss 5 -i dist/apps/ptah-electron-e2e/recordings/editor-tour/out/editor-tour.mp4 -frames:v 1 /tmp/et-5.png
# Expect: card centered w/ ~10.7% side margins, footage filling it, zoom at t≈15s centered with amber ring.
```

### Bug 2 — "Brutal silent gap at video start" (FIXED and VERIFIED)

Root cause: captures include 20+ s of app-boot/setup before the first narration beat (editor-tour first beat: 22,999 ms). Nothing trimmed it.

Fix applied in `apps/ptah-video-studio/scripts/render-all.mjs`: lead-in trim — skips footage up to `firstBeat - 700ms` (`LEAD_IN_MS`), shifts beats/shots/captions by the same amount (`computeLeadTrim`, `shiftShots`, `shiftCaptions`), passes `trimBeforeMs` prop → `ShowcaseVideo` → `BodyScene` → `DeviceFrame` → `OffthreadVideo trimBefore`. Verified on editor-tour: log line `trimmed 22299ms dead lead-in`, duration 2:01 → 1:36.6, correct.

### Bug 3 — flat narration, no hook/welcome (FIXED in scene sources, needs re-capture)

All 13 scene files in `apps/ptah-electron-e2e/src/showcase/*.scene.ts` re-scripted to the series structure **HOOK → WARMUP (new beat) → benefit-led body → PAYOFF**, contraction-free spoken prose (TTS convention). editor-tour was hand-written as the exemplar; the other 12 were done by 4 subagents and reported faithful. Full per-scene script lists are in the transcript; spot-check a couple of files for voice consistency if desired.

### Sliver-shot quality fix (FIXED, both sides)

editor-tour's first auto-shot targeted a 1.5%-wide divider → meaningless 3.2× scrollbar macro.

- Render-side: `normalizeFocus` in `shots.ts` (`MIN_FOCUS_EXTENT = 0.22`) expands degenerate focus rects (recentred, clamped) inside `focusAt`.
- Capture-side: `director.ts recordShot` now SKIPS boxes under 3% of frame on either axis.

### Canvas tile state pollution (FIXED, needs capture verify)

User flagged: session tiles persist in the profile, so canvas-orchestra re-captures open on stale `agent-1/2/3` tiles from the prior run — and `MAX_TILES = 9` means the 3rd re-run would silently fail to create tiles. Added `closeStaleAgentTiles()` to `canvas-orchestra.scene.ts`: closes ONLY tiles whose header label matches `/^agent-\d+$/` (via `[title="Close tile"]`, no confirm dialog), runs after `goToCanvas` but BEFORE the hook beat so the lead-in trim keeps cleanup out of the final cut. Note: the scene's hook/warmup now play OVER the canvas view (navigation was moved before the hook).

## Remaining work (in order)

1. ~~**Verify Bug-1 fix visually**~~ — DONE. Re-rendered editor-tour; card centred, footage fills it, zoom ring anchored, lead-in trimmed. ✅
2. ~~**Lint the touched files**~~ — DONE. `ptah-electron-e2e` + `ptah-video-studio` both lint clean (2 pre-existing studio warnings, unrelated). ✅
3. ~~**Commit**~~ — DONE (4 commits on branch):
   - `91a774ac5 fix(electron): anchor video studio camera stage + trim dead lead-in`
   - `b69ec6a7e feat(electron): hook-led narration rescript for all showcase scenes`
   - `2c1adf4a3 fix(electron): deterministic full-resolution showcase capture placement`
   - `01a786625 feat(electron): audio-first narration pipeline for showcase scenes`
4. **Full re-capture batch (user-approved)** — run the serial driver at `C:/Users/abdal/AppData/Local/Temp/ptah-video-driver.sh` for ALL 13 scenes. **AUDIO-FIRST order (new):** per scene `narrate.mjs --scene <s> --engine elevenlabs` (reads `apps/ptah-electron-e2e/src/showcase/scripts/<s>.json`, generates wavs + real durations BEFORE capture) → `playwright showcase.config.ts <s>` (director.say() paces every beat to the real clip length) → `render-all.mjs --scene <s> --out-res 1080p`. NO caption.mjs stage — captions come from ElevenLabs character alignment in durations.json (`clips[].words`). Env: `PTAH_SHOWCASE_RES=1440p`, `PTAH_SHOWCASE_SILENT_CAPTIONS=1`. Scene list: dashboard-tour canvas-orchestra editor-tour settings-tour marketplace-tour gateway-tour setup-wizard-tour memory-recall chat-code-edit cron-tour skills-tour thoth-tour tribunal-tour.
   - Narration skip logic reuses wavs when the script + voice settings are unchanged — re-running the batch does not re-bill unchanged scenes.
   - Pronunciation lives in `apps/ptah-video-studio/scripts/text-normalization.json` ("Ptah" → "puh-TAH" spoken; captions still show "Ptah"). Tune the respelling there if the read is off.
   - **Capture is now DETERMINISTIC & full-res.** The launcher (`showcase-launcher.ts`) picks a display that can host a `recordSize / scaleFactor` CSS window and sizes the window so the device buffer == the record size exactly. Watch stderr for `[showcase] capturing 2560x1440 device px … (full frame, no padding band)` — that's the success line. If instead you see `WARNING: best on-screen capture is …`, no display can host 1440p at its scale factor → the window would letterbox; drop to `PTAH_SHOWCASE_RES=1080p` or attach a 150%+/larger display. (This machine's 150%-scaled second monitor hosts 1440p via a 1708×960 CSS window; the 1080p primary at 100% cannot.)
   - **CRITICAL constraint from user: NEVER close running Ptah instances.** The launcher coexists with the user's `electron:serve` app — captures work with it running.
   - ElevenLabs voice: env in `apps/ptah-video-studio/.env` (voice ID OwubSIzHexQf7aOm2rKQ, MP3 transport, all working).
   - Agent-driven scenes (canvas-orchestra, chat-code-edit, memory-recall, tribunal-tour, skills-tour) spend real LLM tokens; run read-only tours first.
   - Prior full batch took ~2.5 h; renders ~5–15 min/scene on top.
5. **Post-batch integrity check** — per scene: mp4 exists, duration sane, beats/shots counts > 0 (probe with ffmpeg-static; note `ffprobe-static` package is broken on this machine — use the ffmpeg banner trick).
6. **Review pass with user** — hooks land? voice tone (narrate flags `--stability/--style`)? camera pacing?

## Gotchas for the next session

- Windows; always absolute paths for Read/Write. Foreground `sleep` is blocked in Bash tool; use background tasks.
- `ffprobe-static` resolves to a nonexistent exe — probe via `ffmpeg -hide_banner -i <file>` stderr instead.
- Piping a foreground render through `head` kills it (SIGPIPE) — run renders in background with output redirect.
- Remotion is 4.0.484: `OffthreadVideo` uses `trimBefore` (frames), not `startFrom`.
- beats/shots `tMs`/`fromMs` share one clock (wall-clock from record start) and are body-local in the composition; the lead-trim shifts ALL of them consistently — do not shift in more than one place.
- commitlint: scope must be from the allowed enum (`electron` works), subject lowercase, header length capped.
- The e2e project needed tags `scope:electron,type:app` in project.json for the `@ptah-extension/showcase-manifest` import — already committed earlier; if the Nx graph acts stale, `npx nx reset` (daemon reset suffices; workspace-data EPERM is ignorable).
