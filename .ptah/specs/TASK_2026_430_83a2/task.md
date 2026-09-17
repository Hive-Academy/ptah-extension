---
id: TASK_2026_430_83a2
status: in_review
type: BUGFIX
title: Keep session and sub-agent state lazy and bounded in the Electron state worker
depends_on: []
created: '2026-09-13T11:30:00.000Z'
updated: '2026-09-13T11:30:00.000Z'
description: >-
  Follow-up to TASK_2026_411. Legacy cliSessions stdout survives the session
  metadata split, unpaged detail reads exceed the worker message budget, and one
  oversized response crashes the shared state worker so the sessions sidebar
  never loads. Make session and sub-agent data lazily loaded and bounded end to
  end without deleting history.
executor: software-architect
estimate: L
labels:
  - performance
  - storage
relates_to:
  - TASK_2026_411
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Follow-up to TASK_2026_411: state worker crashes on oversized session detail records, so sessions never load.

Full context, plan and discussion live in [./context.md](./context.md).
