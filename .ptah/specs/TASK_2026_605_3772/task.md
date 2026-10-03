---
id: TASK_2026_605_3772
status: backlog
type: DEVOPS
title: "Type-check the chat, core and ui spec files in CI"
depends_on: []
created: "2026-10-03T12:10:08.545Z"
updated: "2026-10-03T12:10:08.545Z"
description: "Specs under tsconfig.spec.json in libs/frontend chat, core and ui are not type-checked by any target, so a spec can drift from the code it tests; add a typecheck-spec target and gate it in CI."
executor: devops-engineer
estimate: S
labels:
  - ci
  - testing
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Specs under tsconfig.spec.json in libs/frontend chat, core and ui are not type-checked by any target, so a spec can drift from the code it tests; add a typecheck-spec target and gate it in CI.

Full context, plan and discussion live in [./context.md](./context.md).
