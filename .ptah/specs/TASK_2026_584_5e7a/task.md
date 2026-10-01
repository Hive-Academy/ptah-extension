---
id: TASK_2026_584_5e7a
status: in_progress
type: FEATURE
title: >-
  Let an agent start and steer full Ptah chat sessions, each in its own worktree
description: >-
  Expose session start, message, status and stop as MCP tools backed by the
  existing chat RPC path, so an orchestrating agent can open several Ptah
  sessions (each bound to its own git worktree), let each one run its own
  orchestration, and receive reports and completion signals back through the
  existing agent messaging and lane-completion channels.
labels:
  - agent-lanes
  - orchestration
  - research
relates_to:
  - TASK_2026_147
  - TASK_2026_358
  - TASK_2026_386
  - TASK_2026_402_a5c7
  - TASK_2026_419_95af
  - TASK_2026_580_9f77
depends_on: []
created: 2026-09-30T00:00:00.000Z
updated: 2026-09-30T00:00:00.000Z
---

## Description

Today an agent can spawn CLI lanes (`ptah_agent_spawn`) and can create worktrees (`ptah_git_worktree_add`), but it cannot start a full Ptah chat session. A full session has the orchestration skill, subagents, the Ptah MCP tools and a visible tab in the UI. The frontend already starts sessions through RPC. This task exposes that path to agents.

Target flow: the parent session starts three child sessions. Each child session gets its own worktree, runs the orchestration workflow for one task, and reports back to the parent through messages and a completion signal.

Phase 1 is a feasibility study. Read `context.md` and `research-report.md`.
