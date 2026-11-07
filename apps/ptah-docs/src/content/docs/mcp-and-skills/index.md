---
title: MCP & Skills
description: How PtahCode uses the Model Context Protocol and skills to give every agent the same tools and knowledge.
---

**Model Context Protocol (MCP)** is the open standard that connects language models to external tools and data. **Skills** are focused knowledge packs that the model uses when they are relevant. PtahCode uses both for all the agents and CLI lanes that it starts.

## MCP — tools that the model can call

The PtahCode desktop app runs a **built-in MCP server** with the `ptah_*` tools: workspace analysis, diagnostics, file search, code index, browser automation, git worktrees, CLI agent lanes, and more. You can also add **third-party MCP servers** from the Marketplace or with a config file.

## Skills — knowledge that the model can use

A skill is a folder with a `SKILL.md` file. Its description tells the model when to use it. PtahCode copies plugin skills into the skill folder of each AI tool that it detects: `.claude/skills/`, `.agents/skills/`, `.github/skills/`, and `.cursor/skills/`. Claude Code, Copilot, Cursor, Codex, and Antigravity then find the same skills.

The `agent-lanes` skill defines the CLI lane rules that `orchestration` and `tribunal` use. Keep it enabled when you run those workflows on lanes. See [skill dependencies](/mcp-and-skills/skills/#skill-dependencies).

## Pages

| Topic                                         | Link                                                        |
| --------------------------------------------- | ----------------------------------------------------------- |
| The built-in MCP server                       | [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/) |
| The groups of `ptah_*` tools                  | [Ptah tools](/mcp-and-skills/ptah-tools/)                   |
| What skills are, their dependencies, and sync | [Skills](/mcp-and-skills/skills/)                           |
| The skills in the official plugin packs       | [Shipped skills](/mcp-and-skills/popular-skills/)           |
| Write your own skills                         | [Creating skills](/mcp-and-skills/creating-skills/)         |
| Add third-party MCP servers                   | [Third-party MCP](/mcp-and-skills/third-party-mcp/)         |
