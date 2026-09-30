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

## Build and preview

```bash
cd tools/hyperframes/kits/ptah-ui && node build.mjs     # build components
cd gallery && npx hyperframes check                        # PowerShell on Windows (npx.cmd)
npx hyperframes preview --background
npx hyperframes render --quality delivery --output renders/ptah-ui-gallery.mp4
```

## Media not in git

Restore these before a render:

- Music: `apps/ptah-video-studio/assets/music/*.mp3` -> `<project>/assets/music/`
- SFX: the 19 files bundled with the media-use skill (`~/.claude/skills/media-use/audio/assets/sfx/`) -> `<project>/assets/sfx/`
- Brand icon: `apps/ptah-video-studio/public/brand/ptah-icon.png` -> `<project>/assets/brand/`
- Footage (agentic-factory-promo only): the original screen recording, re-encoded to `assets/footage/rec.mp4`
