---
id: TASK_2026_407
status: backlog
type: BUGFIX
title: Investigate duplicated assistant responses in chat UI
depends_on: []
created: '2026-09-09T21:43:50.330Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Reproduce a duplicated assistant response in the Electron chat on current main. If it
  reproduces, trace streamed output, final-message reconciliation, replay and UI identity to
  the first layer that duplicates. If it does not, cancel the task as obsolete.
executor: frontend-developer
estimate: M
labels:
  - investigation
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Investigation only. Remaining work:

1. Reproduce on current main in Electron, with message ids or a persisted event trace. The
   original report (the TASK_2026_406 workflow-start announcement shown twice, the second copy
   shorter) is in `context.md`.
2. If it reproduces: find the first layer that duplicates (provider translation, backend
   stream events, stream reconciliation in `libs/frontend/chat-streaming`, routing in
   `chat-routing`, state in `chat-state`, replay or resume hydration, rendering in `chat-ui`).
   Recommend a narrow fix with regression coverage. Do not use global text dedupe.
3. If it does not reproduce: propose cancel as obsolete.

## Current state (2026-11-07)

- No investigation has run.
- The chat streaming path was rebuilt after the report (lane execution stream #751, lane report
  ordering #830/#844, SDK subagent report rows #847), so the defect may be gone.
- The TASK_2026_406 folder is retired from `.ptah/specs`; read it with
  `git show ff531866f:.ptah/specs/<folder>/<file>`.
