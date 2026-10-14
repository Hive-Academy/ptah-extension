---
id: TASK_2026_670_3d09
status: backlog
type: BUGFIX
title: Block renderer writes to secret settings keys
depends_on: []
created: "2026-10-14T17:08:12.674Z"
updated: "2026-10-14T17:08:12.674Z"
description: "settings:set lets the renderer write gateway.*.tokenCipher and provider endpoint keys; restrict these keys at the RPC boundary."
estimate: S
labels:
  - follow-up
  - security
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

settings:set lets the renderer write gateway.*.tokenCipher and provider endpoint keys; restrict these keys at the RPC boundary.

Full context, plan and discussion live in [./context.md](./context.md).
