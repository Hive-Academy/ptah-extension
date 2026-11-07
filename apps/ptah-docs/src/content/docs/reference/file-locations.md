---
title: File Locations
description: Where Ptah reads from and writes to on each platform.
---

`~` is your home folder: `C:\Users\<you>` on Windows, `/Users/<you>` on macOS, and `/home/<you>` on Linux.

## User configuration (`~/.ptah/`)

| Path                          | Purpose                                                              |
| ----------------------------- | -------------------------------------------------------------------- |
| `~/.ptah/settings.json`       | Global settings (`provider.*`, `agentOrchestration.*`, `memory.*`, `skillSynthesis.*`, `cron.*`, `gateway.*`, and more) |
| `~/.ptah/ptah.db`             | Shared SQLite database: memory, skills, scheduled jobs, messaging    |
| `~/.ptah/plugins/`            | Plugins that Ptah downloads                                          |
| `~/.ptah/templates/agents/`   | Agent templates that Ptah downloads                                  |
| `~/.ptah/.content-cache.json` | Metadata of the downloaded plugin and template set                   |
| `~/.ptah/user/`               | Editable library copies of skills, agents, and commands (see below)  |

## Claude assets (`~/.claude/`)

| Path                  | Purpose                                   |
| --------------------- | ----------------------------------------- |
| `~/.claude/agents/`   | User-wide custom agents                   |
| `~/.claude/skills/`   | User-wide skills                          |
| `~/.claude/projects/` | Claude Code session transcripts that Ptah imports |

## Electron user data

The Electron user-data folder holds `config.json` (app settings), `secrets.json` (encrypted secrets), workspace state, and the cache of the app window.

| OS      | Path                                             |
| ------- | ------------------------------------------------ |
| Windows | `C:\Users\<you>\AppData\Roaming\Ptah\`           |
| macOS   | `/Users/<you>/Library/Application Support/Ptah/` |
| Linux   | `/home/<you>/.config/Ptah/`                      |

## Logs

| OS      | Path                                        |
| ------- | ------------------------------------------- |
| Windows | `C:\Users\<you>\AppData\Roaming\Ptah\logs\` |
| macOS   | `/Users/<you>/Library/Logs/Ptah/`           |
| Linux   | `/home/<you>/.config/Ptah/logs/`            |

## In the workspace

| Path                                      | Purpose                                     |
| ----------------------------------------- | ------------------------------------------- |
| `<workspace>/.claude/agents/`             | Agents for the project                      |
| `<workspace>/.claude/skills/`             | Skills for the project                      |
| `<workspace>/.claude/settings.json`       | Committed Claude settings                   |
| `<workspace>/.claude/settings.local.json` | Personal Claude settings (do not commit)    |
| `<workspace>/.ptah/specs/`                | Task specifications                         |
| `<workspace>/.ptah/screenshots/`          | Browser screenshots                         |
| `<workspace>/.ptah/roadmap.md`            | Roadmap from New project                    |
| `<workspace>/.agents/skills/`             | Skill copies for Codex and Antigravity      |
| `<workspace>/.github/skills/`             | Skill copies for Copilot                    |
| `<workspace>/.cursor/skills/`             | Skill copies for Cursor                     |

## The harness user layer

`~/.ptah/user/` holds editable copies of skills, agents, and commands. Skills are in `skills/<slug>/SKILL.md`. Ptah also keeps `.history/` snapshots and origin sidecar files in this layer. Ptah copies the layer to the folders of detected AI tools as real files, not links. The skill folders in the workspace are **derived copies**, and Ptah adds them to `.gitignore`.

Edit the source in `~/.ptah/user/`. Ptah overwrites a change in a derived copy at the next copy run.

**Which plugins are enabled is not stored in your workspace folder.** Ptah keeps that choice (enabled plugins, disabled plugins, and disabled skills) in its own workspace state. Change it on the plugin configuration screen.
