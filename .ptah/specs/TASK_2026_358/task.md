---
id: TASK_2026_358
status: backlog
type: FEATURE
title: >-
  Build a Ptah-owned resumable fleet runner with SQLite run state and a content-hash stage cache
depends_on: []
created: '2026-08-29T05:42:01.326Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Ptah has no multi-stage runner, so fleets depend on the Claude Code Workflow tool, whose
  resume re-runs finished agents. Add a runner with run and stage rows in SQLite, stages keyed
  by content hash, crash- and session-safe resume, lane dispatch and a Tasks-board surface.
executor: software-architect
estimate: XL
labels:
  - orchestration
  - workflow
  - persistence-sqlite
  - cli-agent-runtime
  - tasks-ui
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Full context, plan and discussion live in [./context.md](./context.md).

## Description

Ptah runs single calls well (`ptah_agent_spawn`, `libs/backend/cli-agent-runtime`,
`InternalQueryService`, the cron `JobRunner`, `LaneRunnerService` in
`libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts`). It has no multi-stage
runner. Fleets use the Claude Code Workflow tool, whose runner lives in `claude.exe`. Its resume
replays the longest unchanged prefix of `agent()` calls and `parallel()` orders calls
non-deterministically, so a crash resume re-runs finished agents.

Remaining work (all of it):

- Run and stage tables in `~/.ptah/ptah.db` through a new migration in
  `libs/backend/persistence-sqlite/src/lib/migrations/` (latest is 0071).
- A stage key from a content hash of (stage, taskId, prompt, inputs), so replay order does not
  matter.
- Resume that survives a host crash and a session change.
- Stage dispatch through the existing lanes (subagent, CLI agent, ptah-cli provider), so a fleet
  can mix vendors. Cancel and steer per stage.
- A Tasks-board surface in `libs/frontend/tasks-ui` to launch, watch and resume a run.
- Use `.claude/workflows/fleet-fix.js` and
  `plugins/ptah-core/skills/orchestration/references/fleet.md` as the stage contract.

## Current state (2026-11-07)

- Not started: no fleet-run tables, migration or runner service in `libs/`.
- Ptah still only sets `CLAUDE_CODE_DISABLE_WORKFLOWS`
  (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1024`).
- The script workaround `.claude/workflows/fleet-fix.js` still exists. The TASK_2026_357 folder is
  no longer in `.ptah/specs/`.
- "Tribunal lanes" in the old description are gone (Tribunal page removed in `dea55817c`).
