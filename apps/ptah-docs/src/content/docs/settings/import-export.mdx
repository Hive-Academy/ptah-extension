---
title: Import & Export
description: Back up and restore your Ptah configuration.
---

import { Aside } from '@astrojs/starlight/components';

You can package your entire Ptah setup — global settings, agents, skills, plugins, and templates — into a single archive and restore it on another machine.

## Export

**Settings → Import & Export → Export configuration** produces a `.ptah-config.zip` file containing:

| Included            | Path in archive      |
| ------------------- | -------------------- |
| Global settings     | `ptah/settings.json` |
| Installed plugins   | `ptah/plugins/`      |
| Installed templates | `ptah/templates/`    |
| Agents              | `claude/agents/`     |
| Skills              | `claude/skills/`     |

<Aside type="caution">
**API keys are stripped on export.** Secrets are encrypted to your local OS keychain and cannot be moved to another machine. You'll need to re-enter them after import.
</Aside>

## Import

**Settings → Import & Export → Import configuration** restores a previously-exported archive. You can choose:

- **Merge** — add entries to your existing setup, keeping current values on conflict
- **Replace** — wipe the target folders and restore the archive verbatim

Import is applied atomically. If any step fails, Ptah rolls back so your existing setup is never left half-migrated.

## Manual backup

The same data is just files on disk — a plain `zip` of the following folders is a valid backup:

| OS      | Folders to include                                 |
| ------- | -------------------------------------------------- |
| Windows | `C:\Users\<you>\.ptah\`, `C:\Users\<you>\.claude\` |
| macOS   | `~/.ptah/`, `~/.claude/`                           |
| Linux   | `~/.ptah/`, `~/.claude/`                           |

Restore by unzipping over the originals. Exclude `settings.json` if you want to keep your current secrets.

## Versioning with Git

Many teams keep `~/.claude/agents/` and `~/.claude/skills/` in a personal dotfiles repo. Ptah has no objection — it only cares that the files are on disk when it launches.
