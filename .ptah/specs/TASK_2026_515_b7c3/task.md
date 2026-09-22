---
id: TASK_2026_515_b7c3
status: done
type: FEATURE
title: >-
  Push a completion signal from a CLI agent lane to the orchestrator session
description: >-
  A CLI agent spawned through ptah_agent_spawn does not tell the orchestrator
  when it finishes. The agent-lanes workflow is poll-based, so the orchestrator
  must call ptah_agent_status in a loop or wait without information. The
  background_agent_completed stream event exists but serves the webview only
  and has no producer for an orchestrator notification. Add a push signal from
  the agent process manager to the spawning session, and update the agent-lanes
  skill and the spawn prompt guidance so a lane reports its deliverable instead
  of exiting silently.
---

# Push a completion signal from a CLI agent lane to the orchestrator session

Side quest. Not part of lane A or lane B of `.ptah/specs/TASK_2026_490_583c`.

See `context.md`.
