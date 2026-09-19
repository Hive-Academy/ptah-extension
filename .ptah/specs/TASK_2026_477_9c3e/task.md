---
id: TASK_2026_477_9c3e
status: backlog
type: feature
title: >-
  Tell every agent how two-way messaging works, on both sides of the spawn
description: >-
  Ptah's parent-side system prompt documents the agent tools, but a SPAWNED
  agent is told nothing about how to answer. `buildTaskPrompt` gives it the
  task, the file list and a deliverable path, and no word about
  `ptah_agent_report`, about messages arriving mid-run, or about what a
  refusal means. Add a two-way messaging section to the child-side prompt,
  and align the parent-side text and the agent-lanes skill with what the
  runtime now actually does.
---

# Two-way messaging guidance for agents

The mechanism works after TASK_2026_465, TASK_2026_466 and TASK_2026_467. The
guidance does not exist on the child side and is incomplete on the parent side.

See `context.md`.
