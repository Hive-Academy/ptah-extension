---
id: TASK_2026_449_5aad
status: done
type: BUGFIX
title: Keep the peer registry session name in sync with the Ptah session name
depends_on: []
created: '2026-09-15T12:00:00.000Z'
updated: '2026-09-15T12:00:00.000Z'
description: >-
  The name an agent sees for a peer session (the CLI registry --name, fixed at
  spawn) drifts from the Ptah tab title after a rename or auto-title. Show the
  Ptah title in the peer picker, and make a rename reach the registry name by
  restarting the idle session process with the new --name.
executor: backend-developer
estimate: M
labels:
  - peer-sessions
  - agent-messaging
relates_to:
  - TASK_2026_402
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Peer registry session names drift from Ptah session titles; link them.

Full context, plan and discussion live in [./context.md](./context.md).
