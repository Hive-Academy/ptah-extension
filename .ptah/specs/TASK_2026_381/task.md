---
id: TASK_2026_381
status: backlog
type: REFACTORING
title: >-
  Bound renderer memory: virtualize the chat transcript and cap the
  streamingState retained on finalized messages
depends_on: []
created: "2026-09-06T02:00:00.000Z"
updated: "2026-09-06T02:00:00.000Z"
description: >-
  A single Electron window with one live session holds 2474 MB private in the
  renderer process. The transcript renders every message through one unbounded
  `@for` with no virtualization, and every finalized ExecutionChatMessage
  retains its full streamingState execution tree including whole tool inputs
  and outputs. The agent-monitor path is already capped
  (agent-output-retention.ts); the tab transcript is the one uncapped surface.
  Bound both.
executor: software-architect
estimate: L
labels:
  - performance
  - memory
  - electron
  - frontend
relates_to:
  - TASK_2026_380
  - TASK_2026_331
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The renderer, not the agent session, holds the memory. Virtualize the
transcript and cap the retained per-message execution tree.

Full context, measurements and scope live in [./context.md](./context.md).
