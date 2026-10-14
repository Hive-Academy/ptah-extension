---
id: TASK_2026_673_467a
status: backlog
type: BUGFIX
title: Serialize handoff pointer collection per session
depends_on: []
created: "2026-10-14T19:33:47.394Z"
updated: "2026-10-14T19:33:47.394Z"
description: "Concurrent prompts of one session can read the same rotation window of pending handoff records (review M4); serialize per cursor key or reserve a window."
estimate: XS
labels:
  - follow-up
relates_to:
  - TASK_2026_657_subagent_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Concurrent prompts of one session can read the same rotation window of pending handoff records (review M4); serialize per cursor key or reserve a window.

Full context, plan and discussion live in [./context.md](./context.md).
