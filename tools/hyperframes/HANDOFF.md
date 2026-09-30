# Handoff: Ptah promo videos and the ptah-ui motion kit (2026-10-01)

Read `README.md` (layout, source vs output) and `PLAYBOOK.md` (how we compose) in this folder first.
Then `kits/ptah-ui/SPEC.md` before touching a component.

## Where things are

| What | Where |
| --- | --- |
| Worktree / branch | `D:\projects\ptah-extension\.claude-worktrees\ptah-ui-motion-kit`, branch `feat/ptah-explainer-v3` (from `main` 0be18ad19). The kit, projects v1/v2 and `render.mjs` merged to main in PR #614 |
| Source (tracked) | `tools/hyperframes/` in the worktree |
| Finished videos | `D:\projects\ptah-extension\video-output\<project>\` (main checkout, gitignored, outside `dist/`) |
| Input media (not tracked) | each project's `assets/` in the worktree (music, SFX, footage, logos). Restore steps in `README.md` |
| Raw recording | `D:\projects\ptah-extension\apps\ptah-video-studio\promos\Recording 2026-09-30 172846.mp4` (untracked, 161 MB, never commit) |
| Editorial tooling (Resolve job) | `tools/video-editor/` in the main checkout, ignored whole. Its exports moved to `video-output/builder-invitation/export/` |

## State

| Leg | State |
| --- | --- |
| Footage promo (`projects/agentic-factory-promo`) | Rendered, 92 s 1080p: `video-output/agentic-factory-promo/ptah-agentic-factory-footage-cut.mp4`. User judged the pace too low |
| Explainer v1 (`projects/agent-lanes-explainer`) | SVG world, 90 s. Superseded; not rendered |
| Explainer v2 (`projects/agent-lanes-v2`) | 60 s, shader transitions + registry components: `video-output/agent-lanes-v2/ptah-lanes-v2.mp4`. User: text too small, background blobs not good |
| ptah-ui kit (`kits/ptah-ui`) | 11 components built and checked: session-shell, chat-message, tool-call-row, thinking-block, agent-report-card, subagent-bubble, agents-panel, composer, lane-completion-toast, peer-send, app-window. Gallery: `video-output/ptah-ui-gallery/ptah-ui-gallery.mp4` (approved by the user: "that's awesome") |
| Playbook | `PLAYBOOK.md`: gated phases, one scene per file, hooks, gates, skill map |
| Explainer v3 (`projects/agent-lanes-v3`) | Storyboard v1 approved (13 frames, 46.567 s, 26 bars at 134 BPM). Frame 1 (hook) built and approved. Frames 2-13 next. Frames are fragments assembled by `assemble.mjs` (see Traps) |
| Kit contrast | Muted token lifted to `#989291` (SPEC 1.5 deviation 2, user-approved option A); badge text weight 500 |

## Decisions (user-approved)

- Kit style = the real Ptah UI (anubis tokens from `libs/frontend`), not generic cards. Flat `#131317` + one static vignette. No drifting blobs.
- Type floor 26 px at design size; mount at u >= 1 (gallery used 1.1-1.6x). Zoom the camera to read small tiles, never shrink a mount.
- Finished videos go to `video-output/` via `render.mjs`. Not `dist/` (`npm run clean` = `rm -rf dist`), not inside a worktree.
- builder-invitation graphics `renders/` (11 GB .mov) stay in `tools/video-editor/projects/builder-invitation/graphics/*/renders/` while the Resolve timeline links them.
- `lane-completion-toast` is a visualization (the real `<agent-lane-completed>` push has no UI); it carries the eyebrow "PUSHED TO THE PARENT SESSION".
- Peer copy says "Accepted", never "delivered"/"received".

## Next

1. **Explainer v3** with the kit, following `PLAYBOOK.md`: `storyboard: yes` review first. Hook A (glitch-to-clarity on `app-window`, camera 3.5 -> 1.0 on the drop), feature scenes inside the 2+2 sessions (one scene file each under `compositions/frames/`), shader transitions, kinetic titles, outro lockup. Adopt `/hyperframes-keyframes` for camera moves, `/hyperframes-audio` for the SFX bus and ducking, `*.motion.json` sidecars.
2. **Footage promo rebuild** with the same kit/grammar (faster cuts, callouts as kit components).
3. 4K renders on approval: `node tools/hyperframes/render.mjs <project> <name> --4k`.
4. Open: the user mentioned an existing task to extract the video apps (video-studio, video-editor, this kit) into their own Nx plugin. Its ID was not found in `.ptah/specs` or the first task-board page. Ask for it; keep `tools/hyperframes` self-contained so the move stays a folder move.
5. Housekeeping: delete `kits/ptah-ui/scratch-*` (ignored test projects). Open a PR for `feat/ptah-explainer-v3` before the v3 render.

## Traps that cost time

- Run `npx hyperframes ...` from **PowerShell**; Git Bash cannot spawn `npx.cmd`. `render.mjs` runs npm's `npx-cli.js` through node (no shell) and works from both.
- Git Bash strips backslashes in `node -e` and in heredocs passed through the tool: write multi-line scripts with the Write tool as `.cjs` (the project `package.json` is `"type": "module"`).
- `hyperframes check` / `snapshot` do not show shader transitions: draft-render and read frames at every transition time.
- Mounted components: `root.dataset.duration` is the template default (4 s); `runtime.js` reads the host's `data-duration`. Never clamp cues to the template duration.
- Kit components must live in `compositions/components/` (lint exempts elastic roots there; elsewhere it errors `root_missing_dimensions`).
- `composition_heavy_overlay_count_high` (~40 radial-gradient/blur elements) can capture black frames: use SVG data-URI patterns and keep one blob per scene at most.
- A background `hyperframes preview` locks its project folder on Windows: `npx hyperframes preview --stop` (or stop that node PID) before moving/deleting.
- `pop()`-style `fromTo` with `immediateRender:false` leaves elements visible before their entrance. Only later tweens of an already-tweened property take `immediateRender:false`.
- A GSAP `yoyo` pulse that runs past a state change re-shows hidden text: fit whole yoyo pairs before the next beat.
- Kit mounts inside a sub-composition collapse: the bundler gives duplicate mounts unique runtime ids only when they are top-level hosts of `index.html` (`assignBundledRuntimeCompositionIds`); nested hosts get no scope, so every instance's `document.getElementById("root")` resolves the same element. v3 therefore keeps one fragment per frame in `compositions/frames/` and builds `index.html` with `node assemble.mjs` (template `src/index.tpl`). Edit fragments and the template, never `index.html`.
- `src/index.tpl` is not `.html` on purpose: lint and Studio treat any root-level or `src/` `.html` with `data-composition-id` as a composition (`multiple_root_compositions`), and Studio writes `data-hf-id` into it.
- Studio writes `data-hf-id` attributes into fragment files while the preview runs. Match fragment markup by id with attribute-tolerant patterns, never by the exact tag text.
- `tool-call-row` cues: overriding only c0/c1 leaves c2 (done) at its default, so c2 = c1 and the live text returns after done. Pass all three: `"c0,c1,c1+runFor"`.
- Layout audit reads `data-layout-allow-overlap` / `-occlusion` only on the flagged element itself (`hasAttribute`), `-overflow` also on ancestors (`closest`).
- The contrast audit samples rendered pixels. A vignette above the UI darkens badges in the corners below 4.5:1: keep the vignette under the UI (SPEC 3.4 background rule).