---
id: TASK_2026_329
status: done
type: BUGFIX
title: >-
  Clamp diag:cpu-profile duration and pin the with-engine isRegistered guard
  with a spec
depends_on: []
created: '2026-08-26T02:25:29.279Z'
updated: '2026-08-27T19:30:16.815Z'
description: >-
  The Electron diag:cpu-profile IPC forwards an unbounded durationMs into
  CpuProfileCapture; the uncommitted with-engine.ts guard move has no spec for a
  container without isRegistered.
executor: ollama-cloud
estimate: XS
labels:
  - regression-review
  - electron
  - cli-engine
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The Electron diag:cpu-profile IPC forwards an unbounded durationMs into CpuProfileCapture; the uncommitted with-engine.ts guard move has no spec for a container without isRegistered.

Full context, plan and discussion live in [./context.md](./context.md).
