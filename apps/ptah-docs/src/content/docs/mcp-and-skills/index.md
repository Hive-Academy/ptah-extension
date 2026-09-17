---
title: MCP & Skills
description: How Ptah uses the Model Context Protocol and Skills to extend every provider with consistent tools and knowledge.
---

**Model Context Protocol (MCP)** is the open standard for connecting language models to external tools and data. **Skills** are scoped knowledge packs the model can invoke on demand. Ptah uses both to deliver a consistent, high-leverage experience across every provider — Claude, Codex, Copilot, and local CLI agents alike.

## The two pillars

### MCP — tools the model can call

Ptah ships with a **built-in MCP server** exposing the `ptah_*` tool family: workspace analysis, diagnostics, file search, browser automation, git worktree management, agent spawning, and more. You can also plug in **third-party MCP servers** (filesystem, databases, SaaS APIs) via configuration.

### Skills — knowledge the model can invoke

Skills are versioned, file-based prompt packages. Each has a `SKILL.md` that tells the orchestrator _when_ to invoke it and _what_ context it adds. Ptah auto-publishes plugin skills as real file copies under the harness directory of every AI tool it detects — `.claude/skills/`, `.agents/skills/`, `.github/skills/`, and `.cursor/skills/` — so third-party AI clients (Claude Code, Copilot, Cursor, Codex CLI, Antigravity) discover the same knowledge.

The `agent-lanes` skill defines the CLI lane contract used by `orchestration` and `tribunal`. Keep it enabled when running those workflows on lanes — see [skill dependencies](/mcp-and-skills/skills/#skill-dependencies). When `ptah_*` tools are listed in a session, agent templates use them first; otherwise they use native tools directly.

## Why this matters

Without MCP and Skills, a model depends on whatever its provider gave it — Claude knows nothing about Copilot's tools, and vice versa. Ptah solves this with a unified layer:

- **One tool catalog** across all providers via the built-in MCP server.
- **One skill catalog** across all AI clients via manifest-owned copies in detected harness directories.
- **One extension mechanism** — plugins contribute both.

## Explore the docs

| Topic                                      | Link                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| The built-in MCP server and Code Execution | [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/) |
| Full catalog of `ptah_*` tools             | [Ptah tools](/mcp-and-skills/ptah-tools/)                   |
| What skills are, their dependencies, and how sync works     | [Skills](/mcp-and-skills/skills/)                           |
| Pre-curated skill catalog                  | [Popular skills](/mcp-and-skills/popular-skills/)           |
| Authoring your own skills                  | [Creating skills](/mcp-and-skills/creating-skills/)         |
| Connecting third-party MCP servers         | [Third-party MCP](/mcp-and-skills/third-party-mcp/)         |
