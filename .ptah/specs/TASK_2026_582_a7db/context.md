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
- **Versions.** Keep the pinned versions (HyperFrames `0.8.30`, the vendored Resolve MCP commit).
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

## Suggested workflow

Full: researcher-expert (history scan, Remotion license, Nx plugin packaging) -> software-architect (parity inventory and plan) -> user approval -> devops-engineer and backend-developer -> senior-tester -> reviewers.

Do not start before the user approves the plan. The new repository is public and outward-facing.
