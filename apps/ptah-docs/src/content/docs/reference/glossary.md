---
title: Glossary
description: Terms used in the Ptah docs.
---

**Agent** — A configured AI worker with a system prompt, tools, and permissions. Ptah has built-in agents, and you can add your own in `.claude/agents/`.

**Autopilot** — The approval mode of the agent: ask, Auto-edit, Plan Mode, or Full Auto. See [Autopilot](/settings/autopilot/).

**CLI agent** — An agent CLI (for example Codex or Copilot) that Ptah runs as a lane for sub-tasks. See [CLI agents](/agents/cli-agents/).

**Effort level** — How much reasoning the model uses for a request. See [Effort levels](/chat/effort-levels/).

**MCP** — Model Context Protocol. The standard that Ptah uses to give tools to agents. Ptah has a built-in MCP server and can connect to external servers.

**Model tier** — One of the words `opus`, `sonnet`, and `haiku`. Each provider maps the tiers to real model ids.

**Orchestration** — A mode where a lead agent divides work into tasks and gives them to specialist sub-agents.

**Plugin** — A bundle of agents, skills, and tools for a domain. Plugins are in `~/.ptah/plugins/`. Ptah remembers which plugins are enabled for each workspace in its own workspace state.

**Provider** — A source of model responses, for example Claude, Codex, Copilot, Ollama, or OpenRouter. Connect providers in **Settings → Providers**.

**Ptah CLI instance** — An extra agent lane on a provider connection that you already have. See [Ptah CLI](/providers/ptah-cli/).

**Session** — One chat conversation. Ptah saves it, and you can continue it later. Sessions belong to a workspace.

**Skill** — A named, reusable procedure with its own instructions. Skills are in `.claude/skills/` (workspace) or `~/.claude/skills/` (user-wide).

**Worktree** — A second working copy of a Git repository. An agent can work in a worktree without changes to your main branch.

**Workspace** — The root folder of a project in Ptah. The `.claude/` and `.ptah/` folders in it hold the project configuration.
