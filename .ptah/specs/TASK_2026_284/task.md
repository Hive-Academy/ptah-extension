---
id: TASK_2026_284
status: backlog
type: feature
title: >-
  Two of the eight CLIs Ptah drives get no harness at all — decide what opencode
  and pi can carry, then carry it
description: >-
  TASK_2026_278 made one reconciler fan skills, commands, agents and MCP out to
  claude, codex, copilot, cursor, antigravity and vscode. opencode and pi are
  full first-class lanes everywhere else — `SYSTEM_CLI_TYPES`, CLI detection,
  `ptah_agent_spawn`, the settings UI, tribunal lanes — and they receive no
  on-disk harness whatsoever. A subagent on either gets the prompt and nothing
  more. The only recorded rationale is one line in `cli-skill-sync.types.ts`
  saying `CliTarget` excludes "the CLIs Ptah can drive but has no harness
  surface for", which is an assertion rather than an argument: the repo already
  attests that opencode has agents/commands/modes/plugins directories behind
  `OPENCODE_CONFIG_DIR` and a documented `mcp` config block, and that pi has a
  project-local `.pi/` carrying settings, extensions and skills. Neither
  layout is known from the repo, so the first half of this task is upstream
  research. Ptah's own MCP server is separately fine on opencode and absent on
  pi, which has no MCP concept upstream.
---

# opencode and pi harness support

Machine-owned metadata carrier. Prose lives in `./context.md`.
