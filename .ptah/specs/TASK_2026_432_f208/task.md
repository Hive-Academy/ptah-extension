---
status: backlog
type: bugfix
title: >-
  Subagent templates grant delegation to roles that may not delegate and teach
  task-ID allocation to every specialist
description: >-
  Verified in a two-round tribunal. visual-reviewer and ui-ux-designer include
  STATIC:CLI_DELEGATION while agent-catalog.md:33 forbids both from
  delegating. All 15 templates expand STATIC:TASK_SPEC_CONTRACT through
  renderTaskSpecAgentBlock (task-spec.contract.ts:506), which teaches git
  fetch, ls-tree scans and mkdir-lock ID allocation to specialists that only
  write one deliverable. _shared/cli-delegation.md:13 demands resume
  unconditionally although several adapters report no CLI session id. And
  team-leader.template.md carries five near-identical return blocks. Fix the
  grants, split the task-spec block by role, make resume conditional, and
  collapse the return blocks into one schema.
---

# Subagent template role-grant and size fixes

Machine-owned carrier. Prose in `./context.md`.
