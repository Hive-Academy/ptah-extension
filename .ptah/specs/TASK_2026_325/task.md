---
id: TASK_2026_325
status: in_review
type: BUGFIX
title: >-
  Make ptah_get_diagnostics report partial compile failures and stop serving
  stale or failed results from cache
depends_on: []
created: '2026-08-26T02:25:16.577Z'
updated: '2026-08-27T16:47:47.112Z'
description: >-
  Per-config errors are dropped once any config compiles; the 30 s cache is
  keyed on root only and returns pre-edit results; unavailable results are
  cached like successes; a cross-root worker replacement rejects an unrelated
  in-flight compile; the worker has no dedicated spec.
executor: backend-developer
estimate: M
labels:
  - regression-review
  - workspace-intelligence
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Per-config errors are dropped once any config compiles; the 30 s cache is keyed on root only and returns pre-edit results; unavailable results are cached like successes; a cross-root worker replacement rejects an unrelated in-flight compile; the worker has no dedicated spec.

Full context, plan and discussion live in [./context.md](./context.md).
