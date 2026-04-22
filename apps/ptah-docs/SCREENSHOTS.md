# Screenshot Checklist

Drop PNG files into `apps/ptah-docs/public/screenshots/` (served at `/screenshots/<name>.png`).

**Recommended specs**

- Format: PNG (lossless), fall back to WebP if size matters
- Width: 1600px for full-window shots, 800px for panel crops (retina-ready)
- Theme: Use the dark theme — matches the docs site's dark-first brand
- Crop: Tight to the subject; no OS chrome unless demonstrating install flow
- Redact: Real API keys, tokens, email, license keys — use `sk-...REDACTED`
- Annotations (optional): Use a subtle gold arrow/box `#D4AF37` to match brand

**Total: 48 screenshots across 13 sections**

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

## Agents (10)

| Filename                    | Shows                                                          | Page                            |
| --------------------------- | -------------------------------------------------------------- | ------------------------------- |
| `agents-overview.png`       | Agents panel listing installed agents                          | `agents/index.md`               |
| `agents-setup-wizard.png`   | Setup wizard landing step                                      | `agents/setup-wizard.md`        |
| `agents-wizard-step1.png`   | Wizard step 1 — project analysis                               | `agents/setup-wizard.md`        |
| `agents-wizard-step2.png`   | Wizard step 2 — stack detection & review                       | `agents/setup-wizard.md`        |
| `agents-catalog.png`        | Built-in agents catalog grid (13 agents)                       | `agents/built-in-agents.md`     |
| `agents-custom-editor.png`  | Custom agent editor (system prompt + tools)                    | `agents/custom-agents.md`       |
| `agents-cli-panel.png`      | CLI agents panel (Gemini / Codex / Copilot / ptah-cli status)  | `agents/cli-agents.md`          |
| `agents-orchestration.png`  | 3-tier orchestration hierarchy diagram or live view            | `agents/agent-orchestration.md` |
| `agents-sync-targets.png`   | CLI sync targets selection (Cursor / Gemini / Codex / Copilot) | `agents/syncing-to-cli.md`      |
| `agents-sync-diff.png`      | Diff view showing what will be written to each CLI             | `agents/syncing-to-cli.md`      |
| `agents-import.png`         | Auto-import of Claude CLI history — progress                   | `agents/importing-history.md`   |
| `agents-import-filters.png` | Import filter controls (date / project / agent)                | `agents/importing-history.md`   |

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

1. Build + run the Electron app locally (`nx serve ptah-electron` or equivalent)
2. Apply a sample workspace (e.g., a small open-source repo for realistic context)
3. Use OS screenshot tools: **Windows** — Snip & Sketch (`Win+Shift+S`); **macOS** — `Cmd+Shift+4` area select or `Cmd+Shift+5` window
4. Export as PNG, rename per the filename column above
5. Drop into `apps/ptah-docs/public/screenshots/`
6. Run `npx nx build ptah-docs` and spot-check in the preview

## Priority batches

If capturing gradually, suggested order:

1. **Highest impact** (above-the-fold / landing pages): `welcome.png`, `chat-overview.png`, `agents-overview.png`, `sessions-overview.png`, `settings-overview.png`
2. **Onboarding flow**: all 7 Getting Started shots
3. **Chat deep dives**: `chat-execution-tree.png`, `chat-at-suggestions.png`, `chat-cost-bar.png`
4. **Agents**: wizard steps, catalog, custom editor
5. **Remaining** — fill gaps as needed
