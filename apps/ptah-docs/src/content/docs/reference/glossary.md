---
title: Glossary
description: Terms used throughout the Ptah docs.
---

**Agent** — A configured conversational entity with a specific system prompt, toolset, and permission profile. Ptah ships with a catalog and you can add your own under `.claude/agents/`.

**Autopilot** — A set of toggles that let an agent perform actions without pausing for approval. Off by default. See [Settings → Autopilot](/settings/autopilot).

**Effort level** — A hint to the provider about how much reasoning to spend on a request. `fast`, `balanced`, or `deep`. Providers that don't support reasoning budgets ignore it.

**MCP** — Model Context Protocol. The standard Ptah uses to expose tools to agents. Ptah ships a built-in MCP server and can connect to external ones.

**Orchestration** — A workflow mode where a lead agent breaks work into tasks and delegates to specialist sub-agents. Pro-tier.

**Plugin** — A bundle of agents, skills, and tools that extend Ptah for a specific domain. Plugins live under `~/.ptah/plugins/` and are enabled per workspace via `.ptah/plugins.json`.

**Provider** — A source of language-model completions (Claude, Copilot, Codex, Gemini, Ollama, OpenRouter). Configured in **Settings → Providers**.

**Session** — A single chat conversation, saved to disk and resumable. Sessions belong to a workspace.

**Skill** — A named, reusable procedure with its own instructions and optional allowed tools. Invoked from chat. Lives in `.claude/skills/` (workspace) or `~/.claude/skills/` (global).

**Template** — A scaffold for a new project, plugin, or skill. Templates live under `~/.ptah/templates/`.

**Worktree** — A secondary working copy of a Git repository. Ptah can create and manage worktrees so an agent can experiment without disturbing your main branch.

**Workspace** — The root folder of a project, as Ptah sees it. Settings under `.claude/` and `.ptah/` in that folder apply.
