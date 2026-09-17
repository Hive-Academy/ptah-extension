---
status: backlog
type: FEATURE
title: 'Lane completion contract: a finished lane must reach its orchestrator'
description: >-
  A CLI lane started with ptah_agent_spawn has no way to tell the session that
  started it that it finished. The orchestrator must poll, and when it does not,
  finished work sits unseen. ptah_agent_status also reports completed with exit
  code 0 for a lane that never wrote its deliverable. Define and ship one
  end-to-end completion contract - a blocking wait, deliverable verification,
  a push into the parent session, and survival across orchestrator restarts -
  for every lane family and every host. Widens TASK_2026_429_ba4e.
---

See `context.md` for the evidence, scope and acceptance criteria.
