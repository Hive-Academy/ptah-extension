---
id: TASK_2026_667_af48
status: backlog
type: BUGFIX
title: "Return an acknowledgement when a child session fails to start"
depends_on: []
created: "2026-10-14T17:08:12.287Z"
updated: "2026-10-30T03:38:08.921Z"
description: "PR #724 already drops a held /session-handoff on tab close, /clear and workspace removal. A failed child-session start still only broadcasts chat:error from reportStartFailure, so the caller cannot tell the start failed."
estimate: S
labels:
  - follow-up
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Failed-start chat:error has no ack; closing a tab keeps a held /session-handoff command and a pending banner promise.

Full context, plan and discussion live in [./context.md](./context.md).
