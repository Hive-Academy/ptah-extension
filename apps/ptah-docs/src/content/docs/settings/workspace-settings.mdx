---
title: Workspace Settings
description: Per-project configuration stored in .claude/ and .ptah/.
---

import { Aside } from '@astrojs/starlight/components';

Workspace settings live **inside your project** so they can be checked into version control and shared with teammates. Ptah uses two folders:

| Folder     | Purpose                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- |
| `.claude/` | Standard Claude agents, skills, and settings that any Claude Agent SDK tool understands |
| `.ptah/`   | Ptah-specific metadata — enabled plugins, workspace locks, screenshots, recordings      |

## `.claude/` folder

A typical layout:

```
.claude/
├── agents/                  # Custom sub-agents for this project
│   └── reviewer.md
├── skills/                  # Project-specific skills
│   └── release-notes/
│       └── SKILL.md
├── settings.json            # Workspace-only overrides
└── settings.local.json      # Personal overrides, not committed
```

| File / folder         | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `agents/`             | Markdown-defined sub-agents with their own tool permissions |
| `skills/`             | Named skill bundles with a `SKILL.md` entry point           |
| `settings.json`       | Committed workspace overrides (model, permissions, hooks)   |
| `settings.local.json` | Personal overrides; add to `.gitignore`                     |

## `.ptah/` folder

```
.ptah/
├── plugins.json             # List of enabled plugins for this workspace
├── screenshots/             # Output from ptah_browser_screenshot
├── recordings/              # Output from ptah_browser_record_stop
└── specs/                   # Task specifications when using orchestration
```

| File / folder  | Purpose                                                            |
| -------------- | ------------------------------------------------------------------ |
| `plugins.json` | Which plugins from `~/.ptah/plugins/` are active in this workspace |
| `screenshots/` | Default output for browser screenshots                             |
| `recordings/`  | Default output for browser GIF recordings                          |
| `specs/`       | Orchestration task descriptions and handoff documents              |

## Precedence

When Ptah resolves a setting, it merges layers in order — later layers override earlier ones:

1. Built-in defaults
2. Global — `~/.ptah/settings.json`
3. Workspace — `.claude/settings.json`
4. Personal workspace — `.claude/settings.local.json`

## Committing to Git

<Aside type="tip">
Recommended `.gitignore` entries:

```
.claude/settings.local.json
.ptah/screenshots/
.ptah/recordings/
```

Commit the rest — agents, skills, and `plugins.json` — so your whole team gets the same setup.

</Aside>

## Creating custom agents

Drop a Markdown file into `.claude/agents/` with front matter that describes the agent:

```markdown
---
name: reviewer
description: Strict TypeScript code reviewer
tools: [Read, Grep, Glob]
---

You are a senior TypeScript reviewer...
```

The new agent appears immediately in the agent picker for this workspace.
