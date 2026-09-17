---
status: backlog
type: feature
title: >-
  Teach orchestration and tribunal to use two-way agent messaging — report
  mid-run, answer and redirect live lanes, revise without respawning
description: >-
  TASK_2026_402 shipped ptah_agent_message (parent to lane, reporting the mode
  that fired - steer, interrupt-resume, queue-next-turn or unsupported) and
  ptah_agent_report (lane to parent, caller identified by transport), plus
  peer-session messaging for Claude sessions. No skill uses them. Lanes still
  end a run with a Clarifications Needed block and the parent still respawns
  with a restated context for every critique round and every revise loop.
  Write the messaging protocol once in the agent-lanes skill and use it where it
  removes a respawn or an exit-to-ask - Council cross-critique, Crucible
  revise rounds, orchestration clarification and mid-batch blockers - always
  branching on the reported mode, never assuming delivery.
---

# Two-way agent messaging in the workflow skills

Machine-owned carrier. Prose in `./context.md`.
