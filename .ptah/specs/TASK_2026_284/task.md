---
id: TASK_2026_284
status: backlog
type: feature
title: >-
  Add a pi harness target and decide skills and commands for opencode
description: >-
  opencode is now a harness target for agents and MCP. pi still gets no on-disk harness.
  Research pi's project-local `.pi/` layout, add a `pi` target for what it can carry, and
  decide if opencode should also get skills and commands.
parent: TASK_2026_640_11a5
labels:
  - P4
depends_on:
  - TASK_2026_279
updated: 2026-11-07T00:00:00.000Z
---

# opencode and pi harness support

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

`pi` is a first-class lane (`SYSTEM_CLI_TYPES`, `libs/shared/src/lib/types/agent-process.types.ts:81-90`)
but is not in `HARNESS_TARGET_IDS` (`libs/shared/src/lib/types/harness-sync.types.ts:20-28`), so a
pi lane gets the prompt and nothing more. Remaining work:

- Research pi's project-local `.pi/` layout (settings, extensions, skills). The pi adapter only
  confirms that `-a`/`--approve` trusts project `.pi/` config
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:48`).
- Add a `pi` target in `libs/backend/harness-sync/src/lib/targets/rival-targets.ts` for the facets
  pi supports. pi has no MCP concept upstream, so its MCP facet stays unsupported.
- Decide whether opencode should also carry skills and commands. Today they are marked
  unsupported (`rival-targets.ts:17`).

## Current state (2026-11-07)

- Done: opencode is a harness target for agents (`{ws}/.opencode/agent/*.md`) and MCP
  (`{ws}/opencode.json`), commit `849cf7108` (`rival-targets.ts:181-197`).
- Not done: no `pi` target.
- The "tribunal lanes" named in the old description are gone (Tribunal page removed in
  `dea55817c`); pi is still reachable through `ptah_agent_spawn` and the provider lanes.
- Depends on TASK_2026_279 (provenance marker), which is still open.
