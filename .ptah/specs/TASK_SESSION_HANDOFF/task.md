---
id: TASK_SESSION_HANDOFF
status: done
type: FEATURE
title: >-
  Automatic session hand-over to a successor session
depends_on: []
created: '2026-10-08T00:18:25.000Z'
updated: '2026-10-09T22:04:43.000Z'
description: >-
  At the handoff budget stage, after a turn ends, Ptah asks the agent for a handoff, starts a successor session seeded with it, binds and focuses it, delivers held input once in order and closes the source. Adds successor mode to ptah_session_start, including child lease transfer. Shipped in PR #682 (merge e28076526).
labels:
  - chat
  - session-budget
  - agent-sdk
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

At the handoff budget stage, after a turn ends, Ptah asks the agent for a handoff, starts a successor session seeded with it, binds and focuses it, delivers held input once in order and closes the source. Adds successor mode to ptah_session_start, including child lease transfer. Shipped in PR #682 (merge e28076526).
