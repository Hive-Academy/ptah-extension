---
id: TASK_2026_324
status: in_review
type: BUGFIX
title: >-
  Stop the session metadata store losing pre-branch stream events and unflushed
  writes
depends_on: []
created: '2026-08-26T02:25:13.743Z'
updated: '2026-08-27T16:47:45.675Z'
description: >-
  Old session blobs lose inline streamEvents on the next incidental write;
  saveAgentOutput and addCliSession are unsequenced and unequally retried; no
  host flushes the coalesced write queue on shutdown; per-agent keys leak on
  cliSessionId re-association.
executor: backend-developer
estimate: M
labels:
  - regression-review
  - agent-sdk
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Old session blobs lose inline streamEvents on the next incidental write; saveAgentOutput and addCliSession are unsequenced and unequally retried; no host flushes the coalesced write queue on shutdown; per-agent keys leak on cliSessionId re-association.

Full context, plan and discussion live in [./context.md](./context.md).
