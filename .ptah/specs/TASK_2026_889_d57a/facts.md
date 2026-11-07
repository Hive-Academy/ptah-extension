# Ground truth seed (verify, do not trust blindly)

Each fact names its evidence. Agents must still confirm any fact they rely on in the code.

## Product

- The product is the open-source **PtahCode desktop app** (Electron, `apps/ptah-electron`).
  It is the only supported host. Evidence: commit 1cee6fafe, `apps/` listing.
- The Electron renderer is `apps/ptah-extension-webview` (the name is historical, it is not a
  VS Code host).
- Apps that exist today: `ptah-docs`, `ptah-electron`, `ptah-electron-e2e`,
  `ptah-extension-webview`, `ptah-landing-page`, `ptah-landing-page-e2e`.

## Removed (any doc that describes these as current is stale)

| Removed                                                        | Commit    | Where it went                     |
| -------------------------------------------------------------- | --------- | --------------------------------- |
| VS Code extension (`apps/ptah-extension-vscode`, e2e app)       | 1cee6fafe | deleted                           |
| `libs/backend/platform-vscode`                                 | 1cee6fafe | deleted                           |
| Headless CLI `apps/ptah-cli`, Ink TUI `apps/ptah-tui`          | 1cee6fafe | deleted                           |
| `.claude/skills/ptah-cli-usage`                                | 1cee6fafe | deleted                           |
| License server, its e2e app, `libs/api`, `libs/api-contracts`  | 0dde8a197 | Hive-Academy/ptah-builders repo   |
| Builders portal libs (account, admin, auth, members, pricing, panel-ui) | 0dde8a197 | ptah-builders repo     |
| Landing `/demo` replay pipeline                                | 0dde8a197 | deleted                           |
| Video studio, HyperFrames tools, ptah-video plugin             | b69359901 | nx-video workspace                |
| Discourse community integration and theme app                  | fd1b4557e | deleted                           |

## Kept on purpose (do not call these removed)

- `libs/backend/cli-engine` and `libs/backend/platform-cli` stay as the headless engine for the
  mcp-bench `cli-headless` and memory-skills hosts. They are not a user-facing CLI product.
- Provider CLI lanes (`ptah_agent_spawn` with codex, copilot, cursor, opencode, grok, claude, ...)
  and ptah-cli provider lanes stay.
- `libs/backend/vscode-core` and `vscode-lm-tools` still exist as shared infrastructure despite
  their names.
- Downloadable plugin content lives in `plugins/` (moved from the VS Code app tree).

## Landing site (apps/ptah-landing-page + libs/web/*)

- Routes: `''` (home), `docs`, `download`, `terms-and-conditions`, `privacy`
  (`apps/ptah-landing-page/src/app/app.routes.ts`).
- The landing markets only the open-source desktop app. The download page always shows GitHub
  release links.
- Pricing and signup links go to `builders.ptah.live`. License verification API URL is unchanged.
- Docs site URL: `https://docs.ptah.live` (`apps/ptah-docs/astro.config.mjs`).

## Recent Electron changes worth checking against docs (git log, Nov 2026)

- Remote machines (ssh transport, pairing, registry) wired into the desktop host: dc3d5e425,
  3fae1cb71, 453c53edb, `libs/backend/remote-machines`, `libs/frontend/machines-ui`.
- Lane restart resume and capped restart resume: 29abadeaf, 01c167725.
- MCP caller authentication: 9101d8bc6.
- Plan limits merged into the task section, todos dropped: 82596b65e.
- Animated rail reorders on the canvas: 16e1db0ba.
- Named Claude accounts on Linux and macOS: fd03461be.

Use `git log --oneline -60 --no-merges` for more.
