# Context

Decided by the user on 2026-09-30.

## User decision

- Focus the Ptah repository on Ptah updates.
- Extract the two mature video projects and their setup into a new repository.
- The new repository serves two purposes: a Claude plugin marketplace and an Nx plugin.
- Setup Hub changes in Ptah come later, in a separate task.

## Inventory to move

| Unit | Source in this repository | Notes |
|---|---|---|
| Remotion studio, render, narrate and caption scripts | `apps/ptah-video-studio/` | Includes `selfshot/` compositions and scripts |
| Capture and render contract | `libs/showcase-manifest/` | Package alias `@ptah-extension/showcase-manifest` must get a new scope |
| Capture harness (Director, Playwright fixtures) | `apps/ptah-electron-e2e/src/showcase/` | Scenes for Ptah stay in Ptah |
| Video editor (WhisperX, Resolve MCP, HyperFrames) | `tools/video-editor/` | Python and machine setup. Vendored `davinci-resolve-mcp` |
| Skill | `.claude/skills/video-showcase/` | |
| Agent | `.claude/agents/video-director.md` | |
| Kit exporter and port guide | `apps/ptah-video-studio/scripts/export-kit.mjs`, `PORT-TO-NEW-PROJECT.md` | These are the manual form of the future generators |
| HyperFrames pipeline (added 2026-10-01) | `tools/hyperframes/`: `render.mjs`, `PLAYBOOK.md`, `README.md`, `HANDOFF.md`, `kits/ptah-ui/` (`build.mjs`, `src/partials/runtime.js` + `base.css`, `SPEC.md`), `projects/*/assemble.mjs` + `src/index.tpl` | Generic parts move (see the addendum). The `ptah-ui` kit components and the Ptah promo projects stay in Ptah, like the Ptah scenes |

The architect must confirm this list with a full scan. Search for other imports of `showcase-manifest`, for CI jobs, for `package.json` scripts and for the `davinci-resolve` entry in the root `.mcp.json`.

## Target shape of the new repository

- **Nx plugin** (working name `@hive-academy/nx-video`):
  - `init` generator: dependencies, path alias, `.claude` skill and agent.
  - `studio` generator: Remotion app and `brand.config.ts` from generator options.
  - `scene` generator: a `*.scene.ts` file and its script JSON.
  - `editor` generator (optional): the video editor job layout, the Python venv setup with `uv`, and the Resolve MCP entry.
  - Executors: `capture`, `narrate`, `render`, `selfshot`, `doctor`.
  - `doctor` executor: change the machine facts in `tools/video-editor/CLAUDE.md` into checks with fix messages (ffmpeg, CUDA and torch versions, the torchvision match, `HF_HUB_DISABLE_SYMLINKS`, `npx.cmd` from Git Bash, the Resolve bridge).
- **Marketplace**: a `.claude-plugin/marketplace.json` with the skills, the agents and the MCP servers. The schema is in `libs/backend/plugin-marketplace` (`marketplace-manifest.schema.ts:66-98`).
- **Preset**: `create-nx-video` for new workspaces, built on the same plugin.

## Constraints

- **Private recordings must not leak.** Keep the `SELFSHOT_KIT_SLUGS` allowlist and the post-copy guard from `export-kit.mjs`. Add a CI check in the new repository that fails on any non-allowlisted ingest.
- **Git history.** Examine the history of every moved path for secrets and private media before you publish. Do not use a history-preserving extract unless the scan is clean.
- **Remotion license.** Remotion requires a company license for many for-profit teams. The README must state this before installation.
- **Two render engines.** The studio uses Remotion and the editor uses HyperFrames. The documentation must say which workflow uses which engine.
- **Versions.** Keep the pinned versions: the vendored Resolve MCP commit, and the HyperFrames pin of each project (`0.8.30` in `tools/video-editor`, `hyperframes@0.8.98` and `@hyperframes/shader-transitions@0.8.97` in `tools/hyperframes/projects/*` on 2026-10-01). A bare `npx hyperframes` resolves the latest release (0.8.104 on 2026-10-01), so generators and executors must call the pinned version.
- **Ptah must still record its videos.** Ptah scenes stay in `apps/ptah-electron-e2e/src/showcase/`. Ptah consumes the Director and the studio from the new package, not from a copy.

## Scope

In scope:

- The inventory, the extract plan and the new repository layout.
- The Nx plugin generators, executors and `doctor` checks.
- The marketplace manifest.
- Removal of the moved code from Ptah, and the change of Ptah to consume the new package.

Out of scope:

- Setup Hub changes in Ptah (marketplace install from the AI Team Builder, generator run from New Project, a video stack profile, a video preset). File these as a follow-up task after this task is done.
- New video features.

## Acceptance criteria

1. The new repository builds, lints and tests in CI on Windows, macOS and Ubuntu.
2. In an empty Nx workspace, `nx g @hive-academy/nx-video:init` and `nx g @hive-academy/nx-video:studio` give a studio that renders the smoke composition.
3. `nx run <studio>:doctor` reports each missing prerequisite with a fix message and exits non-zero when one is missing.
4. The self-shot `_smoke` render works from the new package.
5. The marketplace manifest validates against the Ptah marketplace schema, and Claude Code can install it.
6. The CI leak guard fails on a test fixture with a non-allowlisted slug.
7. Ptah records and renders one existing scene with the new package. The moved paths no longer exist in Ptah.

## Addendum 2026-10-01: HyperFrames pipeline and the promo series

Added after the agent-lanes promo work on branch `feat/ptah-explainer-v3` (sources: `tools/hyperframes/HANDOFF.md`, `PLAYBOOK.md`, `projects/agent-lanes-v3/STORYBOARD.md` v2). The user wants the plugin and its template to carry all of it.

### What moves and what stays

- Moves (generic): `render.mjs` (renders through node and npm's `npx-cli.js`, no shell; writes `video-output/<project>/` in the main checkout, never `dist/` or a worktree), the fragment assembler (`assemble.mjs` + `src/index.tpl`), the kit build (`build.mjs` with `/*@include*/` partials) and the kit runtime (`partials/runtime.js`: `cues`, `preroll`, `focus`, `dimOthers`, design-unit scaling), the playbook, and the brief / storyboard templates.
- Stays in Ptah: the `ptah-ui` kit components (Ptah's own UI) and the Ptah promo projects. Ptah consumes the moved parts from the package.

### Generators (in addition to `init`, `studio`, `scene`, `editor`)

- `hyperframes-project`: a project with the fragment pipeline (`compositions/frames/NN-*.html`, `src/index.tpl`, `assemble.mjs`), the pinned CLI in `package.json`, `BRIEF.md` and `STORYBOARD.md` templates, the music beat grid, and asset folders that are git-ignored with restore steps in the README.
- `frame`: one fragment skeleton (root attributes, `data-seam-in`, `data-duck`, frame-local times, the `(tl, T0)` script body).
- `kit` and `kit-component`: a UI motion kit with the shared runtime and a SPEC table per component.
- `promo` preset for a series of small feature promos: the series grammar from the agent-lanes pilot (one caption per beat in title-safe, at most one kit component on screen, one continuous world, prompt-first opening, a lockup with the feature name and the CTA), and a `storyboard.html` review sheet.

### Executors (in addition to `capture`, `narrate`, `render`, `selfshot`, `doctor`)

- `assemble`, `kit-build`, `check`, `snapshot` (scene midpoints and both sides of every cut), `preview` (background start, status and stop), `render` (to `video-output/`).

### Quality gates for the template

- `check` must pass with 0 errors. A CI rule fails on `data-layout-ignore` and `data-layout-allow-*` attributes in project sources (the v1 film hid the overlaps that the user rejected with them).
- Prefer `cut` seams and match cuts. Shader seams make Studio prepare html2canvas samples (about 45 s with 75 mounts and 11 seams), and Studio can then show the wrong scene after a seek.
- Kit components cannot nest inside a sub-composition (duplicate mounts collapse onto one `#root`); the fragment pipeline is the supported structure.

### Doctor checks to add

- `npx.cmd` cannot be spawned from Git Bash: executors run npm's `npx-cli.js` through node.
- A background Studio preview locks its project folder on Windows: stop it before a move or delete.
- Pin drift: report a project whose pin is behind the latest release (`hyperframes upgrade --check`).
- The HyperFrames skills are installed (`npx skills add heygen-com/hyperframes`); the marketplace lists them or documents the step.

### Kit lessons to keep as tests or validation

- An empty string variable falls back to the default.
- `tool-call-row`: the running cue must come after the label entrance; open a running row with `preroll`.
- `agents-panel` supports up to three lanes (`lane3Name`, `laneOffset`), as the real panel does.
- A product-truth checklist per kit (Ptah: built-in lane CLIs, no "2+2" canvas preset, peer outcome "Accepted", the lane toast is a labelled visualization).

### Acceptance criteria to add

8. In an empty Nx workspace, `hyperframes-project` + `frame` + `assemble` + `check` give a project that passes `check` with 0 errors, and `render` writes the MP4 to `video-output/`.
9. The CI rule fails on a fixture that uses `data-layout-ignore`.
10. Ptah's `agent-lanes-v3` and `agent-lanes-chat` projects assemble, check and render with the package.

## Suggested workflow

Full: researcher-expert (history scan, Remotion license, Nx plugin packaging) -> software-architect (parity inventory and plan) -> user approval -> devops-engineer and backend-developer -> senior-tester -> reviewers.

Do not start before the user approves the plan. The new repository is public and outward-facing.
