---
title: Workspace Configuration
description: The .claude/ and .ptah/ folders that PtahCode reads and writes in your project.
---

# Workspace Configuration

PtahCode uses two folders at the project root: `.claude/` and `.ptah/`. Global settings are in `~/.ptah/settings.json`.

## Folder layout

```
my-project/
├── CLAUDE.md                # Project instructions; PtahCode adds an analysis import block
├── .claude/
│   ├── agents/              # Agent definitions (Markdown)
│   ├── commands/            # Slash commands (Markdown)
│   ├── skills/              # Skills
│   └── settings.json        # Claude Agent SDK settings
└── .ptah/
    ├── analysis/            # Project analysis runs
    ├── specs/               # Task folders for the Tasks board
    └── harness/             # Sync state for other CLIs
```

## `.claude/agents/`

Each Markdown file defines an agent. The frontmatter describes the agent. The body is the system prompt. Refer to [Custom agents](/agents/custom-agents/).

## `.claude/settings.json`

Claude Agent SDK settings, such as permissions, hooks, and environment variables.

## `.ptah/analysis/`

The output of the project analysis. Refer to [Project analysis](/workspace/project-analysis/).

## `.ptah/specs/`

One folder for each task. The Tasks board reads these folders. Refer to [Tasks board](/tasks/).

## Copies for other CLIs

PtahCode copies agents, skills, and MCP servers into folders such as `.codex/`, `.cursor/`, `.github/`, and `.opencode/`. Refer to [Syncing agents to CLIs](/agents/syncing-to-cli/).

:::caution
Do not commit secrets (API keys, tokens) to `.claude/` or `.ptah/`. Put secrets in your global settings or in environment variables.
:::
