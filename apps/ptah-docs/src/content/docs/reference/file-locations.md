---
title: File Locations
description: Where Ptah reads from and writes to on each platform.
---

All paths below use absolute examples. Substitute `<you>` with your username.

## User configuration

| Path                                                                                                                              | Purpose                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `C:\Users\<you>\.ptah\settings.json` (Win) / `/Users/<you>/.ptah/settings.json` (mac) / `/home/<you>/.ptah/settings.json` (Linux) | Global Ptah settings                        |
| `C:\Users\<you>\.ptah\plugins\` / `/Users/<you>/.ptah/plugins/` / `/home/<you>/.ptah/plugins/`                                    | Installed plugins (downloaded at runtime)   |
| `C:\Users\<you>\.ptah\templates\` / `/Users/<you>/.ptah/templates/` / `/home/<you>/.ptah/templates/`                              | Installed templates (downloaded at runtime) |

## Claude Agent SDK assets

| Path                                                                                                    | Purpose                                  |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `C:\Users\<you>\.claude\agents\` / `/Users/<you>/.claude/agents/` / `/home/<you>/.claude/agents/`       | User-wide custom agents                  |
| `C:\Users\<you>\.claude\skills\` / `/Users/<you>/.claude/skills/` / `/home/<you>/.claude/skills/`       | User-wide skills                         |
| `C:\Users\<you>\.claude\projects\` / `/Users/<you>/.claude/projects/` / `/home/<you>/.claude/projects/` | Imported Claude Code session transcripts |

## Electron user data

The Electron user-data folder holds the app's own cache, preferences, and window state.

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

## Workspace-local

These paths live **inside** each workspace folder:

| Path                                      | Purpose                                     |
| ----------------------------------------- | ------------------------------------------- |
| `<workspace>/.claude/agents/`             | Project-scoped custom agents                |
| `<workspace>/.claude/skills/`             | Project-scoped skills                       |
| `<workspace>/.claude/settings.json`       | Committed workspace settings                |
| `<workspace>/.claude/settings.local.json` | Personal workspace settings (ignore in Git) |
| `<workspace>/.ptah/plugins.json`          | Workspace-enabled plugins list              |
| `<workspace>/.ptah/screenshots/`          | Browser screenshots output                  |
| `<workspace>/.ptah/recordings/`           | Browser GIF recordings output               |
| `<workspace>/.ptah/specs/`                | Orchestration task specifications           |

## Cache

| OS      | Path                                         |
| ------- | -------------------------------------------- |
| Windows | `C:\Users\<you>\AppData\Roaming\Ptah\Cache\` |
| macOS   | `/Users/<you>/Library/Caches/Ptah/`          |
| Linux   | `/home/<you>/.cache/Ptah/`                   |

Safe to delete when reclaiming disk space; Ptah rebuilds what it needs on next launch.
