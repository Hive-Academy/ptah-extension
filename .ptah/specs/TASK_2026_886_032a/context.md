# Task Context - TASK_2026_886_032a

## User Request
i would like you to start a new task with our subagents only to check the status of our tasks ,
basically i want to do a full sweep of the tasks thats already merged and finishes at first to make
sure we are on the proper status also would like to clear up merged worktrees we have locally as
well , then i would like to check our backlog to make sure we don't have old tasks that's stale now
after our latest changes and evidence from codebase

## Task Type
RESEARCH (task-registry audit) with a DEVOPS-style local cleanup step.

## Complexity
Medium (about 456 task folders, about 69 worktrees).

## Strategy
Partial. Phase A (status audit of done/in_review/in_progress tasks) and Phase B (worktree merge
audit) run in parallel as read-only subagents. The orchestrator applies status edits and removes
worktrees. Phase C (backlog staleness audit) runs after Phase A. No production code changes.

## CLI Lanes
Gate 0.1: `disabled` for this task. Source: current explicit user instruction ("with our
subagents only"), which overrides the stored global preference for CLI lanes. Approval mode:
`user` for any removal or cancellation decision.

## Worktree
`<repo>\.claude-worktrees\task-status-sweep` on branch
`chore/task-status-sweep` from `origin/main` 390808edf.

## Conversation Summary
- Worktree cleanup scope: only `.claude-worktrees/*` in this repository. The Ptah app review
  worktrees under `%APPDATA%/Ptah Dev/review/attempts/` are owned by the app and are out of scope.
- Remove a worktree only when its branch is merged (or its PR is merged) and it has no
  uncommitted or unpushed work. Branches are kept (project rules forbid branch deletion without
  a separate instruction).
