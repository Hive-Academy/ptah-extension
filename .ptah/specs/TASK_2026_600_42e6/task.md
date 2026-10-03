---
id: TASK_2026_600_42e6
status: backlog
type: BUGFIX
title: Exit non-zero when ptah auth test fails
depends_on: []
created: "2026-10-03T12:09:57.893Z"
updated: "2026-10-03T12:09:57.893Z"
description: "`ptah auth test` always returns ExitCode.Success, also when auth:testConnection reports success: false (now including a thrown failure), so scripts cannot gate on it."
executor: backend-developer
estimate: XS
labels:
  - cli
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

`ptah auth test` always returns ExitCode.Success, also when auth:testConnection reports success: false (now including a thrown failure), so scripts cannot gate on it.

Full context, plan and discussion live in [./context.md](./context.md).
