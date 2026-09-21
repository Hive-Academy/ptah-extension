---
id: TASK_2026_465_a25a
status: in_review
type: FEATURE
title: >-
  Antigravity lane accepts queued messages via stream-json input; probe opencode serve
depends_on: []
created: '2026-09-17T00:00:00.000Z'
updated: '2026-09-17T00:00:00.000Z'
description: >-
  ptah_agent_message returns unsupported for antigravity and opencode because both
  adapters run one-shot with stdin closed. agy 1.2.5 supports
  --input-format stream-json (one NDJSON message per stdin line, one turn each,
  requires --output-format stream-json), which can give the antigravity lane
  queue-next-turn messaging. opencode serve is a candidate for the opencode lane
  but its mid-turn message behaviour is unverified and it is not installed here.
executor: backend-developer
estimate: M
labels:
  - cli-agents
  - messaging
relatesTo:
  - TASK_2026_402_a5c7
---

See `context.md`.
