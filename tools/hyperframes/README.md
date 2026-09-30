# tools/hyperframes

HyperFrames video source for Ptah marketing: the `ptah-ui` motion kit and the promo projects built with it.
Source only. Media is local and never committed (see `.gitignore`: deny by default).

## Layout

| Path | What |
| --- | --- |
| `kits/ptah-ui/` | Motion kit: HyperFrames components that recreate the real Ptah chat UI (anubis theme) at video scale |
| `kits/ptah-ui/SPEC.md` | Component spec. Every style fact cites the real source (`libs/frontend/chat`, `chat-ui`) |
| `kits/ptah-ui/src/` | Component sources and shared partials (`base.css` tokens, `runtime.js` motion helpers) |
| `kits/ptah-ui/build.mjs` | Inlines partials, writes `components/` and the gallery copies |
| `kits/ptah-ui/gallery/` | Review composition: every component animating once |
| `projects/agentic-factory-promo/` | Footage cut of the orchestration recording |
| `projects/agent-lanes-explainer/` | Illustrated explainer v1 (SVG world) |
| `projects/agent-lanes-v2/` | Illustrated explainer v2 (shader transitions + registry components) |
| `render.mjs` | Render wrapper: output goes to `video-output/` in the main checkout |

## Source vs output

| Kind | Where | In git |
| --- | --- | --- |
| Source (compositions, kit, specs, briefs) | `tools/hyperframes/**` | yes (deny-by-default `.gitignore`) |
| Input media (music, SFX, footage, stills) | `<project>/assets/**` | no, restore per "Media not in git" |
| Scratch (snapshots, beats, `.hyperframes/`, `.media/`) | inside each project | no |
| Finished videos | `video-output/<project>/` in the **main checkout** | no |

`video-output/` is not under `dist/` on purpose: `npm run clean` runs `rm -rf dist`. It is also not inside a worktree, because removing a worktree deletes its ignored files.

## Build, preview, render

```bash
cd tools/hyperframes/kits/ptah-ui && node build.mjs     # build components
cd gallery && npx hyperframes check                        # PowerShell on Windows (npx.cmd)
npx hyperframes preview --background

# from the repo (or worktree) root: renders land in <main checkout>/video-output/<project>/
node tools/hyperframes/render.mjs tools/hyperframes/kits/ptah-ui/gallery ptah-ui-gallery
node tools/hyperframes/render.mjs tools/hyperframes/projects/agent-lanes-v2 ptah-lanes-v2 --4k
node tools/hyperframes/render.mjs <project> <name> --draft      # fast review render
```

Never pass `--output` inside a project folder: a render there is lost with the worktree.

## Media not in git

Restore these before a render:

- Music: `apps/ptah-video-studio/assets/music/*.mp3` -> `<project>/assets/music/`
- SFX: the 19 files bundled with the media-use skill (`~/.claude/skills/media-use/audio/assets/sfx/`) -> `<project>/assets/sfx/`
- Brand icon: `apps/ptah-video-studio/public/brand/ptah-icon.png` -> `<project>/assets/brand/`
- Footage (agentic-factory-promo only): the original screen recording, re-encoded to `assets/footage/rec.mp4`
