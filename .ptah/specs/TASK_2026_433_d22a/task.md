---
status: in_review
type: feature
title: >-
  Let a CLI lane act as a named subagent role — ptah_agent_spawn takes a role
  and the lane runs with that role's generated prompt
description: >-
  Today a workflow chooses between a Task-tool subagent (frontend-developer,
  code-logic-reviewer, ...) and a CLI lane (codex, antigravity, a ptah-cli
  provider), and a CLI lane gets only the task string. ptah_agent_spawn has no
  role parameter, so running antigravity AS the frontend-developer means the
  conductor pasting a whole template into the task by hand, which no skill
  does consistently. Add an optional role to ptah_agent_spawn that resolves the
  workspace's generated agent definition and delivers it to the lane — natively
  where the CLI reads agent files (codex, copilot, cursor already receive them
  from harness-sync), injected as a system preamble where it does not
  (antigravity has no agent facet) — and report which delivery was used. Then
  one routing table in the skills picks subagent or lane per role.
---

# Role-addressed CLI lanes

Machine-owned carrier. Prose in `./context.md`.
