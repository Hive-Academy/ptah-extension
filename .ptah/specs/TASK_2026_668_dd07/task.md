---
id: TASK_2026_668_dd07
status: backlog
type: BUGFIX
title: "Remove prompt excerpt from chat:continue stop log"
depends_on: []
created: "2026-10-14T17:08:12.431Z"
updated: "2026-10-14T17:08:12.431Z"
description: "chat-session.service.ts logs the first 80 characters of a user prompt in the chat:continue stop-intent path."
estimate: XS
labels:
  - follow-up
  - privacy
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

chat-session.service.ts logs the first 80 characters of a user prompt in the chat:continue stop-intent path.

Full context, plan and discussion live in [./context.md](./context.md).
