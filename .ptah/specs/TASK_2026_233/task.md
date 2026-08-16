---
id: TASK_2026_233
status: in_review
type: BUGFIX
title: >-
  Hardcoded vendor lists survive in the MCP tool descriptions and four other
  places the skill sweep could not reach
description: >-
  The tribunal/orchestration skill sweep in commit 5cdb14d89 replaced every
  hardcoded vendor list in those skills with runtime discovery via
  ptah_agent_list, because CLI adapters ship per release and every machine
  configures different providers -- this workspace, for instance, has no codex
  or copilot at all while it does have a Claude (Subscription) lane. The same
  defect class survives at the code layer and in three adjacent surfaces that
  were out of that commit's scope. Chief among them, buildAgentSpawnTool's own
  description advertises "Ptah CLI agents (OpenRouter, Moonshot, Z.AI)" -- a
  fixed list that omits the two providers actually configured here, and which
  every agent reads before choosing a lane. buildAgentStatusTool enumerates its
  return fields without mentioning the CLI Session ID it does emit, which is the
  sole signal every resume path in both skills now branches on; a reviewer
  reading only that description concluded the resume paths were dead code.
  Neither is user-visibly broken today, so this is filed rather than fixed.
assignee: null
depends_on: []
executor: null
claim: null
created: 2026-08-11T00:00:00.000Z
updated: '2026-08-16T08:03:07.523Z'
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
