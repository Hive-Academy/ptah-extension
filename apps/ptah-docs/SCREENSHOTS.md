# Screenshot Checklist

Drop PNG files into `apps/ptah-docs/public/screenshots/` (served at `/screenshots/<name>.png`).

**Recommended specs**

- Format: PNG (lossless), fall back to WebP if size matters
- Width: 1600px for full-window shots, 800px for panel crops (retina-ready)
- Theme: Use the dark theme — matches the docs site's dark-first brand
- Crop: Tight to the subject; no OS chrome unless demonstrating install flow
- Redact: Real API keys, tokens, email, license keys — use `sk-...REDACTED`
- Annotations (optional): Use a subtle gold arrow/box `#D4AF37` to match brand

**Total: 54 screenshots across 15 sections**

---

## Getting Started (7)

| Filename                 | Shows                                                   | Page                              |
| ------------------------ | ------------------------------------------------------- | --------------------------------- |
| `welcome.png`            | Welcome screen for unlicensed users on first launch     | `getting-started/first-launch.md` |
| `install-windows.png`    | Windows installer wizard                                | `getting-started/installation.md` |
| `install-macos.png`      | macOS DMG drag-to-Applications                          | `getting-started/installation.md` |
| `setup-analysis.png`     | Project analysis progress step                          | `getting-started/first-launch.md` |
| `setup-import.png`       | Session import dialog (`~/.claude/projects/` discovery) | `getting-started/first-launch.md` |
| `license-activate.png`   | License activation panel with key input                 | `getting-started/signing-in.md`   |
| `providers-settings.png` | Providers settings panel with API key fields            | `getting-started/signing-in.md`   |

## Chat (5)

| Filename                    | Shows                                                     | Page                       |
| --------------------------- | --------------------------------------------------------- | -------------------------- |
| `chat-overview.png`         | Chat window with a sample conversation                    | `chat/index.md`            |
| `chat-at-suggestions.png`   | `@` autocomplete dropdown showing file/symbol suggestions | `chat/file-attachments.md` |
| `chat-autopilot-toggle.png` | Autopilot toggle in the chat header                       | `chat/autopilot.md`        |
| `chat-cost-bar.png`         | Cost summary card above chat input                        | `chat/cost-and-tokens.md`  |
| `chat-execution-tree.png`   | Execution tree for a multi-agent turn (expanded)          | `chat/execution-tree.md`   |
| `chat-model-selector.png`   | Provider/model dropdown in chat header                    | `chat/switching-models.md` |

## Agents (9)

| Filename                    | Shows                                                 | Page                            |
| --------------------------- | ----------------------------------------------------- | ------------------------------- |
| `agents-overview.png`       | Agents panel listing installed agents                 | `agents/index.md`               |
| `agents-catalog.png`        | Built-in agents catalog grid (14 agents)              | `agents/built-in-agents.md`     |
| `agents-custom-editor.png`  | Custom agent editor (system prompt + tools)           | `agents/custom-agents.md`       |
| `agents-cli-panel.png`      | CLI agents panel (Codex / Copilot / ptah-cli status)  | `agents/cli-agents.md`          |
| `agents-orchestration.png`  | 3-tier orchestration hierarchy diagram or live view   | `agents/agent-orchestration.md` |
| `agents-sync-targets.png`   | CLI sync targets selection (Cursor / Codex / Copilot) | `agents/syncing-to-cli.md`      |
| `agents-sync-diff.png`      | Diff view showing what will be written to each CLI    | `agents/syncing-to-cli.md`      |
| `agents-import.png`         | Auto-import of Claude CLI history — progress          | `agents/importing-history.md`   |
| `agents-import-filters.png` | Import filter controls (date / project / agent)       | `agents/importing-history.md`   |

## Setup (6)

| Filename                    | Shows                                              | Page                       |
| --------------------------- | -------------------------------------------------- | -------------------------- |
| `setup-hub.png`             | Setup Hub dashboard — four Quick Action cards      | `setup/index.md`           |
| `agents-setup-wizard.png`   | Setup wizard landing step                          | `setup/setup-wizard.md`    |
| `agents-wizard-step1.png`   | Wizard step 1 — project analysis                   | `setup/setup-wizard.md`    |
| `agents-wizard-step2.png`   | Wizard step 2 — stack detection & review           | `setup/setup-wizard.md`    |
| `setup-ai-team-builder.png` | AI Team Builder — transcript + live config preview | `setup/ai-team-builder.md` |
| `setup-new-project.png`     | New Project Setup — planning + roadmap             | `setup/new-project.md`     |

## Marketplace (3)

| Filename                       | Shows                                       | Page                          |
| ------------------------------ | ------------------------------------------- | ----------------------------- |
| `marketplace-overview.png`     | Marketplace hub — provider list             | `marketplace/index.md`        |
| `marketplace-mcp-registry.png` | MCP Registry browse/install surface         | `marketplace/mcp-registry.md` |
| `marketplace-smithery.png`     | Smithery surface — popular servers + badges | `marketplace/smithery.md`     |

## Sessions (7)

| Filename                           | Shows                                            | Page                            |
| ---------------------------------- | ------------------------------------------------ | ------------------------------- |
| `sessions-overview.png`            | Sessions panel overview                          | `sessions/index.md`             |
| `sessions-tabs.png`                | Tab strip with multiple sessions open            | `sessions/managing-sessions.md` |
| `sessions-history.png`             | Session history list with search                 | `sessions/session-history.md`   |
| `sessions-analytics.png`           | Analytics dashboard main view                    | `sessions/analytics.md`         |
| `sessions-analytics-trends.png`    | Trend charts (cost / tokens / quality over time) | `sessions/analytics.md`         |
| `sessions-cost-summary.png`        | Per-session cost summary card                    | `sessions/cost-summary.md`      |
| `sessions-autoimport.png`          | Auto-import banner on first launch               | `sessions/auto-import.md`       |
| `sessions-autoimport-disambig.png` | Disambiguation prompt when project paths collide | `sessions/auto-import.md`       |

## Workspace (4)

| Filename                 | Shows                                                         | Page                                  |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------- |
| `open-folder-dialog.png` | Native Open Folder dialog                                     | `workspace/opening-a-workspace.md`    |
| `recent-workspaces.png`  | Recent workspaces list                                        | `workspace/opening-a-workspace.md`    |
| `file-tree-panel.png`    | File tree panel with expanded folders                         | `workspace/file-tree.md`              |
| `workspace-switcher.png` | Quick workspace switcher                                      | `workspace/switching-workspaces.md`   |
| `context-inspector.png`  | Context inspector showing what's attached to the current turn | `workspace/workspace-intelligence.md` |

## Git (4)

| Filename                  | Shows                                           | Page                |
| ------------------------- | ----------------------------------------------- | ------------------- |
| `git-status-bar.png`      | Branch + dirty-state indicator in status bar    | `git/git-status.md` |
| `diff-side-by-side.png`   | Side-by-side diff view with syntax highlighting | `git/diffs.md`      |
| `diff-agent-proposed.png` | Agent-proposed diff with accept/reject controls | `git/diffs.md`      |
| `commit-composer.png`     | Commit composer with agent-suggested message    | `git/commits.md`    |

## Plugins (2)

| Filename                   | Shows                                  | Page                     |
| -------------------------- | -------------------------------------- | ------------------------ |
| `plugin-marketplace.png`   | Plugin marketplace grid                | `plugins/marketplace.md` |
| `plugin-enable-toggle.png` | Enable/disable toggle on a plugin card | `plugins/installing.md`  |

## Templates (1)

| Filename              | Shows                           | Page                           |
| --------------------- | ------------------------------- | ------------------------------ |
| `templates-panel.png` | Templates panel with categories | `templates/using-templates.md` |

## Browser Automation (1)

| Filename               | Shows                                                              | Page                                        |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `browser-settings.png` | Browser settings (executable path, headless toggle, user-data dir) | `browser-automation/launching-a-browser.md` |

## Settings (2)

| Filename                | Shows                       | Page                |
| ----------------------- | --------------------------- | ------------------- |
| `settings-overview.png` | Settings panel landing page | `settings/index.md` |
| `theme-toggle.png`      | Light/dark theme toggle     | `settings/theme.md` |

---

## Capture workflow

```bash
nx run ptah-docs:screenshots      # drives the real app, writes public/screenshots/
nx run ptah-docs:check-screenshots # every /screenshots/… reference resolves
```

`screenshots` runs Playwright against the built Electron app
(`apps/ptah-electron-e2e/docs-screenshots.config.ts`, shot files in
`src/docs-screenshots/*.shot.ts`) and writes PNGs straight into
`public/screenshots/`. It is NOT part of `nx run ptah-electron-e2e:e2e` — a
capture pass writes files, so it only runs when asked.

How the run is set up, and why (TASK_2026_260):

- **Real backend, no RPC mocks.** The e2e fixtures replace the whole `rpc` IPC
  listener, which paints an empty state on every surface. These fixtures only
  launch and navigate.
- **A copy of the real profile.** Session metadata lives in the Electron
  `userData` dir, so a fresh profile has no sessions and no settings. The
  harness copies the small state-bearing part of `~/.ptah` into a temp dir —
  never the secret envelopes, and the cached license is stripped, so no key,
  name or email can reach an asset.
- **A real project for read-only surfaces** (`PTAH_DOCS_WORKSPACE`, default
  `D:\projects\property-hub`), **a throwaway sample repo for git surfaces.** The
  app rewrites `.codex/agents/*.toml` in any workspace it opens, and Source
  Control row actions stage files for real, so git shots never point at
  a developer's repository.

Adding a shot: put it in the matching `*.shot.ts`, call
`shoot(page, '<filename-without-extension>')`, and crop to the subject with
`{ crop: locator }`. Re-run the target and look at the PNG before committing it.

### Captured by the automated pass

`file-tree-panel`, `git-status-bar`, `commit-composer`, `diff-side-by-side`,
`workspace-switcher`, `recent-workspaces`, `settings-overview`,
`agents-orchestration`, `theme-toggle`, `setup-new-project`,
`sessions-overview`, `sessions-history`, `sessions-tabs`.

The rest of the list above is still hand-captured.

### Removed references (no capturable surface, 2026-08-17)

These were referenced by docs pages with no file behind them. The surface does
not exist in the app, so the reference was removed rather than faked:

| Shot                                                  | Why not                                                                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-folder-dialog`                                  | Native OS dialog — outside the renderer Playwright drives                                                                                             |
| `sessions-analytics`, `sessions-analytics-trends`     | The dashboard is card-only (no charts), and its widest range is 14 days, so no profile here has a session inside it                                   |
| `sessions-cost-summary`                               | Cost comes from JSONL transcripts; no session on hand has any                                                                                         |
| `sessions-autoimport`, `sessions-autoimport-disambig` | No auto-import banner or disambiguation prompt exists                                                                                                 |
| `agents-import`, `agents-import-filters`              | No import-history surface exists                                                                                                                      |
| `agents-sync-targets`, `agents-sync-diff`             | No CLI-sync UI exists                                                                                                                                 |
| `context-inspector`                                   | No context-inspector surface exists                                                                                                                   |
| `templates-panel`                                     | No Templates panel exists in the Electron app                                                                                                         |
| `diff-agent-proposed`                                 | Needs a live agent turn proposing an edit — not reproducible in a capture pass                                                                        |
| `browser-settings`                                    | `ptah-browser-settings` exists but holds one "Allow Localhost" toggle, while the page describes an executable path, headless toggle and user-data dir |

The last two rows are docs-prose drift, not missing assets: the pages describe
behaviour the app does not have. Fixing that prose is a separate pass.
