# Porting the Pipeline into a Fresh Nx Workspace

This describes moving the engine — capture harness + shared manifest lib +
Remotion studio app — out of `ptah-extension` and into a new Nx monorepo. It
is a manual copy-and-rewire today; see "Planned: `export-kit.mjs`" at the end
for what the skill owner intends to automate.

The engine is **three units**. Nothing else in `ptah-extension` is required.

| Unit                   | Source path (this repo)                                | What it is                                                                                      |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| A. Remotion studio app | `apps/ptah-video-studio/`                              | Compositions + `scripts/*.mjs` pipeline (narrate/caption/render)                                |
| B. Shared manifest lib | `libs/showcase-manifest/`                              | The `Beat`/`SceneManifest`/`Shot`/`ShotFocusRect`/`ShotsFile` TS types both sides import        |
| C. Capture harness     | `apps/<e2e-app>/src/showcase/_harness/` + a scenes dir | `Director`, launchers, fixtures, prewarm helpers, and the `*.scene.ts` + `scripts/*.json` pairs |

Unit C lives **inside** an existing (or new) Playwright e2e app in the target
workspace — it is not a standalone Nx project. In this repo that's
`apps/ptah-electron-e2e`.

## Step 1 — Copy the folders

```bash
# From the ptah-extension repo root, into <target-repo>:
cp -r apps/ptah-video-studio            <target-repo>/apps/<yourapp>-video-studio
cp -r libs/showcase-manifest            <target-repo>/libs/showcase-manifest
cp -r apps/ptah-electron-e2e/src/showcase <target-repo>/apps/<your-e2e-app>/src/showcase
```

Do NOT copy `apps/ptah-video-studio/node_modules`, `.whisper/`, or
`build/favicon.ico`-adjacent build artifacts — `node_modules` regenerates via
`npm install`; `.whisper/` regenerates on first `caption.mjs` run (~150MB
whisper.cpp binary + `base.en` model, gitignored).

Also copy (both are gitignored templates, not secrets):
`apps/ptah-video-studio/.env.example` → `<target>/apps/<yourapp>-video-studio/.env.example`.

## Step 2 — Rename the Nx package alias

The manifest lib is imported everywhere as `@ptah-extension/showcase-manifest`
(the Director, `manifest.types.ts`, `load-manifest.ts`, `shots.ts` all use this
literal string). Renaming it to your target scope requires editing **three**
places:

1. **`libs/showcase-manifest/package.json`** — `"name"` field:
   ```json
   { "name": "@<your-scope>/showcase-manifest", ... }
   ```
2. **`libs/showcase-manifest/project.json`** — `"name"` field (Nx project
   name — can differ from the package name, but keep them aligned to avoid
   confusion).
3. **Target workspace's `tsconfig.base.json`** — add the path mapping (this
   repo's entry, for reference):
   ```json
   "paths": {
     "@<your-scope>/showcase-manifest": ["./libs/showcase-manifest/src/index.ts"]
   }
   ```
4. **Every import site** — search-and-replace the literal string
   `@ptah-extension/showcase-manifest` across the copied `director.ts`,
   `manifest.types.ts` (no self-import, just the doc comment references),
   `load-manifest.ts`, `Root.tsx`'s import chain, and `ShowcaseVideo.tsx`.

The lib itself has no other workspace-specific coupling — it's pure TypeScript
interfaces (`Beat`, `SceneManifest`, `Shot`, `ShotFocusRect`, `ShotsFile`) with
zero runtime dependencies (`tags: ["scope:shared", "type:util"]`,
`format: ["cjs"]` esbuild output).

## Step 3 — npm dependencies to add

This repo has **no npm workspaces** — everything installs at the workspace
root `package.json`. Verified versions currently in use here:

| Package                         | Version                       | Used by                                                                                |
| ------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `remotion`                      | `4.0.484`                     | Composition runtime                                                                    |
| `@remotion/cli`                 | `4.0.484`                     | `remotion studio` / `remotion render`                                                  |
| `@remotion/captions`            | `4.0.484`                     | Caption token types/rendering                                                          |
| `@remotion/install-whisper-cpp` | `4.0.484`                     | `caption.mjs` (whisper.cpp wrapper)                                                    |
| `zod`                           | `4.3.6`                       | Runtime validation (`load-manifest.ts`, `shots.ts`)                                    |
| `@playwright/test`              | `^1.50.0`                     | Capture harness (Director, fixtures, scenes)                                           |
| `ffmpeg-static`                 | `5.2.0`                       | Audio decode/resample (`narrate.mjs`, `caption.mjs`), frame probing (`render-all.mjs`) |
| `kokoro-js`                     | `1.2.1`                       | Default local TTS engine (`narrate.mjs`)                                               |
| `sharp`                         | (transitive — pin explicitly) | Frame-band detection in `render-all.mjs`'s `detectSource()`                            |

`sharp` is **not** a direct dependency in this repo's `package.json` — it's
present in `node_modules` transitively (via some other tool in this
workspace) and `render-all.mjs` does a bare `require('sharp')`. **Add it
explicitly** (`npm install sharp`) in the target workspace; do not rely on it
being hoisted.

No dependency is needed for ElevenLabs (`narrate.mjs --engine elevenlabs` uses
the global `fetch`, Node ≥22.9).

## Step 4 — Narration env

`ELEVENLABS_API_KEY` (and `PTAH_ELEVENLABS_VOICE_ID`) are read from
`apps/<yourapp>-video-studio/.env` via `loadStudioEnv()` in `scripts/paths.mjs`.
This is deliberately **not** the workspace-root `.env` (kept separate so
license-server / other app secrets never leak into narration credentials, and
vice versa). Copy `.env.example` → `.env` in the new app dir and fill in:

```
ELEVENLABS_API_KEY=sk_...
PTAH_ELEVENLABS_VOICE_ID=your_voice_id_here
# PTAH_TTS_ENGINE=elevenlabs        # optional, else default kokoro (local, offline)
# PTAH_ELEVENLABS_MODEL=eleven_turbo_v2_5
```

Shell-exported env vars win over `.env` file values (CI secrets override).
`kokoro` (the default engine) needs no credentials — it downloads ONNX
weights into the Hugging Face cache on first run and works fully offline
afterward.

`paths.mjs` also resolves `WORKSPACE_ROOT` / `APP_ROOT` / `RECORDINGS_ROOT` by
walking up from its own file location — verify the walk depth
(`scriptsDir -> ../.. -> app root -> ../../.. -> workspace root`) still lands
correctly after the rename; it assumes `apps/<yourapp>-video-studio/scripts/`
is exactly as deep as `apps/ptah-video-studio/scripts/` was.

## Step 5 — Wire an Nx `project.json` for the studio app

Reference (`apps/ptah-video-studio/project.json`) targets, adapted:

```json
{
  "name": "<yourapp>-video-studio",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/<yourapp>-video-studio/src",
  "tags": ["scope:video-studio", "type:app"],
  "implicitDependencies": ["<your-e2e-app>"],
  "targets": {
    "studio": { "executor": "nx:run-commands", "options": { "cwd": "apps/<yourapp>-video-studio", "command": "npx remotion studio src/Root.tsx" } },
    "narrate": { "executor": "nx:run-commands", "options": { "command": "node apps/<yourapp>-video-studio/scripts/narrate.mjs" } },
    "caption": { "executor": "nx:run-commands", "options": { "command": "node apps/<yourapp>-video-studio/scripts/caption.mjs" } },
    "render": { "executor": "nx:run-commands", "options": { "command": "node apps/<yourapp>-video-studio/scripts/render-all.mjs" } },
    "video": {
      "executor": "nx:run-commands",
      "dependsOn": [{ "target": "showcase", "projects": ["<your-e2e-app>"] }],
      "options": {
        "parallel": false,
        "commands": ["node apps/<yourapp>-video-studio/scripts/narrate.mjs", "node apps/<yourapp>-video-studio/scripts/caption.mjs", "node apps/<yourapp>-video-studio/scripts/render-all.mjs"]
      }
    }
  }
}
```

The `"showcase"` target it depends on lives on the **e2e app's**
`project.json` (this repo's `apps/ptah-electron-e2e/project.json`), and for
the Electron capture path chains the app build first:

```json
"showcase": {
  "executor": "nx:run-commands",
  "dependsOn": [
    { "target": "build-dev", "projects": ["ptah-electron"] },
    { "target": "copy-renderer", "projects": ["ptah-electron"] }
  ],
  "options": {
    "parallel": false,
    "commands": [
      "node apps/ptah-electron-e2e/scripts/clean-recordings.mjs",
      "npx playwright test --config=apps/ptah-electron-e2e/showcase.config.ts",
      "node apps/ptah-electron-e2e/scripts/transcode.mjs"
    ]
  }
}
```

You will not have `ptah-electron`'s `copy-wasm.js` step or `transcode.mjs`
(that script predates `render-all.mjs` and is not part of the four documented
files here) — adapt the `dependsOn`/commands to whatever your target app's
dev-build target is called, and drop the wasm-copy line entirely if it does
not apply. `transcode.mjs` is not needed going forward — `render-all.mjs` is
the mp4 producer.

Also copy `apps/ptah-electron-e2e/showcase.config.ts` (or write an equivalent
Playwright config) — it is a **separate config** from the main e2e suite:
`testDir` points at the scenes dir, `testMatch: ['**/*.scene.ts']`, one
worker, `retries: 0`, long timeouts (15 min/scene), and `video: 'off'` because
the launcher/browser-context owns recording, not Playwright's built-in
capture.

## Step 6 — Smoke test

```bash
cd apps/<yourapp>-video-studio
npm install                              # picks up remotion/zod/etc at the root
npm run studio                           # opens Remotion Studio on the empty FALLBACK_MANIFEST — confirms the composition boots

# Capture one scene (adjust to your app's launcher/dev-server):
npx playwright test --config=apps/<your-e2e-app>/showcase.config.ts -g "<scene test title>"
# -> writes dist/apps/<your-e2e-app>/recordings/<slug>/{raw.webm,beats.json,shots.json}

node apps/<yourapp>-video-studio/scripts/narrate.mjs --scene <slug>
node apps/<yourapp>-video-studio/scripts/caption.mjs --scene <slug>   # only if not using elevenlabs alignment
node apps/<yourapp>-video-studio/scripts/render-all.mjs --scene <slug>
# -> dist/apps/<your-e2e-app>/recordings/<slug>/out/<slug>.mp4
```

If `npm run studio` fails to resolve `@<your-scope>/showcase-manifest`,
re-check Step 2's tsconfig path mapping and that `libs/showcase-manifest`
builds (`nx build showcase-manifest`).

## Shortcut: `export-kit.mjs`

`scripts/export-kit.mjs` automates Step 1 (the copy). It assembles a
copy-pasteable kit from the live source into `dist/video-showcase-kit/`,
excluding `node_modules`, build output (`dist`/`out`), `.env`, and the
`.whisper` cache, and bundling the `.claude/` skill + `video-director` agent
and a README alongside the three engine units:

```bash
node apps/ptah-video-studio/scripts/export-kit.mjs [--out <dir>]
# -> dist/video-showcase-kit/{apps/<studio>, libs/showcase-manifest, showcase-harness, .claude, README.md}
```

Copy that folder's contents into your target workspace, then still do **Step 2**
(rename the `@ptah-extension/showcase-manifest` alias to your scope) and
**Steps 3–5** (deps, env, `project.json`) by hand — the script deliberately does
NOT guess your scope or Nx wiring. It only removes the manual copy + artifact
pruning.
