---
id: TASK_2026_199
status: done
type: BUGFIX
title: Antigravity CLI integration — spawnable via MCP, and driven through agy's stream-json
description: >-
  Two defects in the Antigravity (`agy`) integration, verified against v1.1.11 at
  `C:\Users\abdal\AppData\Local\agy\bin\agy.exe`. (1) `ptah_agent_list` reports
  `antigravity: installed` and `CliType` carries seven members, but three
  surfaces still hard-coded the old `['codex','copilot','cursor']` triple — the
  MCP tool schema, the stdio dispatcher's zod enum, and
  `AgentProcessManager.getPreferredCli` — so spawning antigravity/opencode/pi
  failed input validation before reaching the adapter. All three now derive from
  a single `SYSTEM_CLI_TYPES` const in `libs/shared`, which `CliType` is also
  derived from. (2) The Antigravity adapter asserted `agy` has no structured
  output mode and classified stdout with a `NARRATION_PREFIX` regex heuristic.
  v1.1.11 supports `--output-format stream-json`; the adapter now parses the real
  event stream into `CliOutputSegment`s, takes the conversation id from the
  `init` event instead of the mtime-scanning `resolveSessionId` heuristic that
  raced between concurrent agents, and maps `reasoningEffort` to `--effort`.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
