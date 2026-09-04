---
id: TASK_2026_328
status: done
type: BUGFIX
title: >-
  Register memory.enabled as a file-based key, bound the internal-query queue
  wait, and fix the readJsonlTail first-line drop
depends_on: []
created: '2026-08-26T02:25:26.464Z'
updated: '2026-08-27T17:45:26.849Z'
description: >-
  memory.enabled is missing from FILE_BASED_SETTINGS_KEYS; wizard callers of
  InternalQueryService.execute queue behind the default-1 gate with no wait
  ceiling and the constructor injects optional deps without isOptional;
  readJsonlTail drops a real first line when windowStart equals 1.
executor: backend-developer
estimate: S
labels:
  - regression-review
  - agent-sdk
  - memory-curator
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

memory.enabled is missing from FILE_BASED_SETTINGS_KEYS; wizard callers of InternalQueryService.execute queue behind the default-1 gate with no wait ceiling and the constructor injects optional deps without isOptional; readJsonlTail drops a real first line when windowStart equals 1.

Full context, plan and discussion live in [./context.md](./context.md).
