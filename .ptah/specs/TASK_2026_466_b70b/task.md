---
id: TASK_2026_466_b70b
status: backlog
type: BUGFIX
title: >-
  Agent messaging defects found by the TASK_2026_402 Batch 8 acceptance run
depends_on: []
created: '2026-09-17T00:00:00.000Z'
updated: '2026-09-17T00:00:00.000Z'
description: >-
  Five defects from the live Batch 8 run. A peer SendMessage to a busy ptah-cli
  lane is accepted but never reaches the model. Two live sessions from the same
  tab share one registry name. An agent report renders twice when summary equals
  message. mcp-serve exits fatally without an Anthropic API key before answering
  tools/list. Consecutive agent turns are concatenated on the tile without a
  separator.
executor: backend-developer
estimate: M
labels:
  - cli-agents
  - messaging
relatesTo:
  - TASK_2026_402_a5c7
---

See `context.md`.
