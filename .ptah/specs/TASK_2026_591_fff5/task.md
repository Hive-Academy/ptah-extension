---
id: TASK_2026_591_fff5
status: backlog
type: FEATURE
title: 'Give the opencode lane two-way messaging (queue, then steer and interrupt)'
depends_on: []
created: '2026-10-01T15:50:44.025Z'
updated: '2026-10-01T15:50:44.025Z'
description: 'OpencodeCliAdapter reports no messaging (capabilities all false) because it runs one-shot `opencode run` with no continue(); add queue-next-turn via `run --session`, then evaluate a serve-backed session for steer/interrupt.'
executor: backend-developer
estimate: M
labels:
  - cli-agents
  - messaging
relates_to:
  - TASK_2026_465_a25a
  - TASK_2026_402_a5c7
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

OpencodeCliAdapter reports no messaging (capabilities all false) because it runs one-shot `opencode run` with no continue(); add queue-next-turn via `run --session`, then evaluate a serve-backed session for steer/interrupt.

Full context, plan and discussion live in [./context.md](./context.md).
