---
status: backlog
type: feature
title: >-
  Share Ptah's main-agent system prompt with every CLI — native instruction
  channel for spawned lanes, and an instructions facet for CLIs the user runs
description: >-
  Ptah shares skills, commands, agents and MCP with every CLI through
  harness-sync, but not its own system prompt. A Claude SDK session gets
  PTAH_CORE_SYSTEM_PROMPT plus the workspace enhanced prompt plus identity,
  output style, memory and code-symbol blocks. A spawned rival lane (codex,
  antigravity, opencode, copilot, cursor, pi) gets only the ~8KB enhanced
  prompt folded into the task message, never PTAH_CORE and never in the CLI's
  native instruction slot. A CLI the user launches gets nothing — there is no
  instructions facet and nothing writes AGENTS.md, GEMINI.md,
  copilot-instructions.md or cursor rules, although two CLAUDE.md files claim
  AGENTS.md is propagated. A codex role also replaces the user's own
  developer_instructions. Give every lane Ptah's prompt through its native
  channel (codex developer_instructions = Ptah prompt + role, merged with the
  user's value), add a harness-sync instructions facet that writes a
  managed Ptah section into each CLI's instruction file without clobbering
  user content, and make the core prompt CLI-neutral.
---

# Share Ptah's system prompt with every CLI

Machine-owned carrier. Prose in `./context.md`.
