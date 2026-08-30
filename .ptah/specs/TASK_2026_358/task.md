---
id: TASK_2026_358
status: backlog
type: FEATURE
title: 'Ptah-owned resumable fleet runner: SQLite run state, content-hash stage cache'
depends_on: []
created: '2026-08-29T05:42:01.326Z'
updated: '2026-08-29T05:42:01.326Z'
description: 'Ptah has an agent execution stack (ptah_agent_spawn, cli-agent-runtime, InternalQueryService, cron-scheduler JobRunner, tribunal lanes) but no multi-stage runner: JobRunner is documented as a pure executor and LaneRunnerService runs one call. Multi-agent fleets therefore depend on the Claude Code CLI Workflow tool, whose runner lives in claude.exe (resumeFromRunId and journal.jsonl appear 0 times in the SDK JS and 0 times in Ptah source; Ptah only sets CLAUDE_CODE_DISABLE_WORKFLOWS, groups events by workflowRunId, and reads workflow transcripts read-only). Its resume replays the longest unchanged PREFIX of agent() calls and parallel() orders calls non-deterministically, so a crash resume re-runs finished agents — the failure that cost three generations during the TASK_2026_341..354 fleet. Build a first-class Ptah runner instead: run and stage rows in ~/.ptah/ptah.db (persistence-sqlite migration), each stage keyed by a content hash of (stage, taskId, prompt, inputs) so replay order cannot matter, resume that survives a host crash AND a session change (not same-session-only), stage dispatch through the existing lanes (subagent, CLI agent, ptah-cli provider) so a fleet can mix vendors, cancel/steer per stage, and a Tasks-board surface to launch, watch and resume a run. TASK_2026_357 is the script-level workaround for the same problem and its .claude/workflows/fleet-fix.js plus the fleet-orchestration skill define the stage contract this runner should implement natively.'
executor: software-architect
estimate: XL
labels:
  - orchestration
  - workflow
  - persistence-sqlite
  - cli-agent-runtime
  - tasks-ui
  - log-audit-2026-08-28
relates_to:
  - TASK_2026_357
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Ptah has an agent execution stack (ptah_agent_spawn, cli-agent-runtime, InternalQueryService, cron-scheduler JobRunner, tribunal lanes) but no multi-stage runner: JobRunner is documented as a pure executor and LaneRunnerService runs one call. Multi-agent fleets therefore depend on the Claude Code CLI Workflow tool, whose runner lives in claude.exe (resumeFromRunId and journal.jsonl appear 0 times in the SDK JS and 0 times in Ptah source; Ptah only sets CLAUDE_CODE_DISABLE_WORKFLOWS, groups events by workflowRunId, and reads workflow transcripts read-only). Its resume replays the longest unchanged PREFIX of agent() calls and parallel() orders calls non-deterministically, so a crash resume re-runs finished agents — the failure that cost three generations during the TASK_2026_341..354 fleet. Build a first-class Ptah runner instead: run and stage rows in ~/.ptah/ptah.db (persistence-sqlite migration), each stage keyed by a content hash of (stage, taskId, prompt, inputs) so replay order cannot matter, resume that survives a host crash AND a session change (not same-session-only), stage dispatch through the existing lanes (subagent, CLI agent, ptah-cli provider) so a fleet can mix vendors, cancel/steer per stage, and a Tasks-board surface to launch, watch and resume a run. TASK_2026_357 is the script-level workaround for the same problem and its .claude/workflows/fleet-fix.js plus the fleet-orchestration skill define the stage contract this runner should implement natively.

Full context, plan and discussion live in [./context.md](./context.md).
