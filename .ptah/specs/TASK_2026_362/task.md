---
id: TASK_2026_362
status: backlog
type: FEATURE
title: >-
  Decide the fate of the native pi-ai agent loop branch, then merge or park it
depends_on: []
created: '2026-08-31T12:00:00.000Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  An in-house agent loop on pi-ai, exposed as a `NativeAgentAdapter` behind `IAgentAdapter`,
  exists only on branch `feat/native-agent-loop-pi-ai` (15 commits, about 6000 behind main).
  Decide whether to rebuild it on current main or park it; nothing is on main.
estimate: XL
labels:
  - agent-loop
  - agent-sdk
  - pi-ai
  - architecture
  - research
  - partial
  - unmerged-branch
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Native Ptah agent loop on pi-ai as a second conductor beside the Claude Agent SDK.

Full context, plan and discussion live in [./context.md](./context.md).

## Description

Goal: a second conductor beside the Claude Agent SDK. An in-house turn/step engine, tools,
context management, session log, subagents and hooks on the pi-ai provider layer, exposed as a
`NativeAgentAdapter` behind `IAgentAdapter` (`libs/shared/src/lib/types/agent-adapter.types.ts:319`).
Users pick it or the SDK conductor per session. Ptah MCP tools become in-process tools.

Remaining work:

1. Decide: rebuild on current main, or park the branch and close this task.
2. If rebuild: port batches B1-B9 from `feat/native-agent-loop-pi-ai` onto main. A plain rebase
   is not realistic at this distance. Wire DI in the Electron container only
   (`apps/ptah-electron/src/di/`), run scoped verification, open a PR.

## Current state (2026-11-07)

- Research is complete (`research-report.md`); `implementation-plan.md` and `batches.md` hold
  the design.
- Branch `feat/native-agent-loop-pi-ai` (`5e8041ce8` .. `957d4aebd`) has 15 commits not on main and
  is 6051 commits behind `origin/main` (checked 2026-11-07).
- None of the seven planned libs exist on main (`agent-loop-contracts`, `llm-providers`,
  `agent-loop`, `agent-tools`, `agent-session`, `native-agent-adapter`, `agent-runtime`).
- The plan targets host composition roots that were removed (VS Code, CLI, TUI in `1cee6fafe`).
  Only the Electron root is left.
