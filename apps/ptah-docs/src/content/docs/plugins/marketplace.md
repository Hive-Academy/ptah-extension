---
title: Plugin Marketplace
description: Browse the curated Ptah plugin marketplace and discover what each plugin bundles.
---

The **Plugin Marketplace** is the in-app catalog of every plugin the Ptah team has curated. It's the starting point for extending any workspace with new agents, skills, templates, or slash commands.

![Plugin marketplace overview](/screenshots/plugin-marketplace.png)

## Opening the marketplace

From the Ptah desktop app:

1. Open the **Plugins** panel in the primary sidebar.
2. Click **Browse Marketplace**.
3. Ptah fetches the latest `content-manifest.json` from GitHub and lists every available plugin.

:::note
The marketplace is online-only. If you're offline, Ptah falls back to the plugins already downloaded into `~/.ptah/plugins/`.
:::

## What's inside a plugin

Every plugin is a self-contained folder with up to four contribution types. You can inspect them from the marketplace detail page before installing.

| Contribution  | Location in plugin       | Purpose                                                                                           |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| **Agents**    | `agents/*.md`            | Specialized sub-agents the orchestrator can spawn (e.g. `frontend-developer`, `security-auditor`) |
| **Skills**    | `skills/<name>/SKILL.md` | Scoped knowledge packs invoked on demand (e.g. `angular-frontend-patterns`)                       |
| **Templates** | `templates/*`            | Project scaffolds and prompt templates                                                            |
| **Commands**  | `commands/*.md`          | Slash commands registered in chat (e.g. `/orchestrate`)                                           |

### Example: `ptah-core`

```text
ptah-core/
├── .claude-plugin/
│   └── plugin.json        # Metadata (name, version, author)
├── commands/
│   ├── orchestrate.md
│   └── orchestrate-help.md
└── skills/
    ├── ddd-architecture/
    ├── orchestration/
    ├── skill-creator/
    ├── technical-content-writer/
    └── ui-ux-designer/
```

## Filtering and search

The marketplace supports:

- **Keyword search** against plugin name, description, and skill titles.
- **Stack filters** — Angular, React, Nx, Node, etc.
- **Contribution filters** — show only plugins that include skills, templates, or slash commands.

## Plugin details

Clicking a plugin opens its detail pane, which shows:

- **Version** and **author**
- **Included contributions** — a checklist of agents, skills, templates, and commands
- **README** — pulled from the plugin's repository
- **Install / Enable** controls for the active workspace

:::tip
Hover over any skill or command name in the detail view to preview its `SKILL.md` or command body without installing.
:::

## Next steps

- [Install and enable a plugin](/plugins/installing/)
- [Create your own plugin](/plugins/creating-plugins/)
