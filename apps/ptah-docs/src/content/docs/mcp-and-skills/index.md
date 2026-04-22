---
title: MCP & Skills
description: How Ptah uses the Model Context Protocol and Skills to extend every provider with consistent tools and knowledge.
---

**Model Context Protocol (MCP)** is the open standard for connecting language models to external tools and data. **Skills** are scoped knowledge packs the model can invoke on demand. Ptah uses both to deliver a consistent, high-leverage experience across every provider — Claude, Gemini, Codex, Copilot, and local CLI agents alike.

## The two pillars

### MCP — tools the model can call

Ptah ships with a **built-in MCP server** exposing the `ptah_*` tool family: workspace analysis, diagnostics, file search, browser automation, git worktree management, agent spawning, and more. You can also plug in **third-party MCP servers** (filesystem, databases, SaaS APIs) via configuration.

### Skills — knowledge the model can invoke

Skills are versioned, file-based prompt packages. Each has a `SKILL.md` that tells the orchestrator _when_ to invoke it and _what_ context it adds. Ptah auto-publishes plugin skills as symlinks under `<workspace>/.claude/skills/` so third-party AI clients (Copilot, Cursor, Codex CLI) can discover the same knowledge.

## Why this matters

Without MCP and Skills, a model depends on whatever its provider gave it — Claude knows nothing about Copilot's tools, and vice versa. Ptah solves this with a unified layer:

- **One tool catalog** across all providers via the built-in MCP server.
- **One skill catalog** across all AI clients via `.claude/skills/` junctions.
- **One extension mechanism** — plugins contribute both.

## Explore the docs

| Topic                                      | Link                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| The built-in MCP server and Code Execution | [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/) |
| Full catalog of `ptah_*` tools             | [Ptah tools](/mcp-and-skills/ptah-tools/)                   |
| What skills are and how junctions work     | [Skills](/mcp-and-skills/skills/)                           |
| Pre-curated skill catalog                  | [Popular skills](/mcp-and-skills/popular-skills/)           |
| Authoring your own skills                  | [Creating skills](/mcp-and-skills/creating-skills/)         |
| Connecting third-party MCP servers         | [Third-party MCP](/mcp-and-skills/third-party-mcp/)         |
