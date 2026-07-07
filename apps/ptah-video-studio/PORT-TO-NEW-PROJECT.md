# Port the Video Showcase Pipeline to a New Project

A handoff/kickoff doc for setting up the **same narrated, camera-animated
marketing-video pipeline** in another Nx workspace (same tech stack, different
product). Read this, run the two prep steps, then paste the kickoff prompt into
a fresh Claude Code session **in the target repo**.

---

## What you're installing

Playwright drives your real app and records a flat screen capture plus a
`beats`/`shots` JSON manifest; Remotion renders that into an MP4 with virtual-
camera zoom/pan, amber highlight rings, motion blur, a device frame, word-timed
captions, AI narration, and a music bed. **Capture is dumb, render is smart** —
all cinematography is a post-process, so you re-render without re-recording.

The engine is **three units** + a Claude skill + a subagent:

| Unit                                                       | Source (this repo)                     |
| ---------------------------------------------------------- | -------------------------------------- |
| Remotion compositor + render/narrate/caption scripts       | `apps/ptah-video-studio/`              |
| Shared `beats`/`shots` types (capture↔render contract)     | `libs/showcase-manifest/`              |
| Capture harness: `Director` + Playwright fixtures + scenes | `apps/ptah-electron-e2e/src/showcase/` |
| Claude skill (install + authoring + camera/render docs)    | `.claude/skills/video-showcase/`       |
| Specialist subagent                                        | `.claude/agents/video-director.md`     |

## Prep — do this in THIS (ptah) repo first

1. **Generate the portable kit:**
   ```bash
   node apps/ptah-video-studio/scripts/export-kit.mjs
   # -> dist/video-showcase-kit/  (3 engine units + .claude skill/agent + README)
   ```
2. **Copy `dist/video-showcase-kit/` into your target repo** (a scratch location
   is fine — the new session's Claude will move files into place). The `.claude/`
   folder inside carries the `video-showcase` skill and `video-director` agent, so
   they light up in the new repo automatically.

## Decisions to make before the new session (have answers ready)

| Decision                            | Notes                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Studio app name**                 | e.g. `apps/<yourapp>-video-studio`                                                                                               |
| **Which e2e app hosts the harness** | existing Playwright e2e app, or a new one                                                                                        |
| **Capture runtime**                 | `web` (Playwright browser recording of your dev server) or `electron` (`_electron.launch` of a dist build). Both launchers ship. |
| **Brand**                           | `wordmark`, `productName`, `tagline`, `ctaLabel`, plus theme colors + font (goes in `brand.config.ts`)                           |
| **Narration engine**                | `kokoro` (local, offline, no key) or `elevenlabs` (needs `ELEVENLABS_API_KEY`)                                                   |
| **First scene**                     | one concrete flow to prove the pipeline end-to-end (e.g. "dashboard tour")                                                       |

---

## KICKOFF PROMPT — paste this into a new Claude Code session in the TARGET repo

> I'm installing a portable marketing-video pipeline into this Nx workspace. I've
> copied a kit into `./video-showcase-kit/` (contains `apps/<studio>`,
> `libs/showcase-manifest`, `showcase-harness/`, and a `.claude/` folder with a
> `video-showcase` skill + `video-director` agent).
>
> First, read `./video-showcase-kit/.claude/skills/video-showcase/SKILL.md` and
> its `reference/install.md`, then use the `video-showcase` skill to drive the
> install. Do it in this order and stop for my confirmation after each phase:
>
> 1. **Analyze** — detect this workspace's Nx layout, existing e2e app, dev-server
>    command, and TypeScript path config. Tell me what you found and your plan.
> 2. **Place the engine** — move the three units into place: the studio app to
>    `apps/<studio>`, the lib to `libs/showcase-manifest`, the harness to my e2e
>    app's `src/showcase/`. Rename the `@ptah-extension/showcase-manifest` package
>    alias to my scope in `tsconfig.base.json` + the lib's `package.json`/`project.json`
>    and every import site.
> 3. **Deps + env** — add the required deps (remotion, @remotion/cli, zod,
>    @playwright/test, ffmpeg-static, sharp, kokoro-js) and set up narration env.
> 4. **Brand + runtime** — write `apps/<studio>/src/brand.config.ts` with my brand
>    values, and wire the capture runtime (web or electron) I choose.
> 5. **First scene** — scaffold one `*.scene.ts` + `scripts/<scene>.json` for a
>    real flow in my app, using the `video-director` agent and the Director API in
>    `reference/scene-authoring.md`.
> 6. **Smoke test** — `npm run studio` boots the composition; then capture the one
>    scene and render it (`render-all.mjs --scene <slug>`); confirm the mp4 exists.
>
> My answers to the setup decisions: **app name** = <…>, **e2e app** = <…>,
> **capture runtime** = <web|electron>, **brand** = <wordmark / productName /
> tagline / ctaLabel / colors>, **narration** = <kokoro|elevenlabs>, **first
> scene** = <…>. Don't invent app selectors — inspect my actual UI (or ask) when
> authoring the scene.

---

## Gotchas the new session should know (all documented in the skill)

- **`sharp` is an implicit dep here** — add it explicitly in the target repo;
  `render-all.mjs` `detectSource()` does a bare `require('sharp')`.
- **RPC/selectors are app-specific** — scenes target YOUR UI; the Director itself
  is generic. Don't copy ptah's scene selectors verbatim.
- **Camera grammar knobs** live in `render-all.mjs` (`HOLD_MS`,
  `RELEASE_MIN_GAP_MS`, `ESTABLISH_MS`, `MIN_SHOT_MS`) — the release-shot logic is
  what makes the camera zoom back out between highlights (see
  `reference/camera-and-render.md`).
- **Re-skinning is one file** — `brand.config.ts`. Never scatter brand strings
  back into components.
- **Preview without full renders** — `cd apps/<studio> && npm run studio` opens
  Remotion Studio to scrub the camera frame-by-frame.
