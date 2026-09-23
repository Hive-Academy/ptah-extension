---
id: TASK_2026_530_e933
status: backlog
type: BUGFIX
title: Make degradation-audit skip tracked-but-missing files
depends_on: []
created: "2026-09-22T11:27:19.154Z"
updated: "2026-09-22T11:27:19.154Z"
description: "check-degradation.ts opens every git-tracked path without an existence check, so any unstaged deletion fails the lint target and the pre-commit hook for every session in that checkout."
executor: backend-developer
estimate: XS
labels:
  - tooling
  - pre-commit
  - degradation-audit
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

check-degradation.ts opens every git-tracked path without an existence check, so any unstaged deletion fails the lint target and the pre-commit hook for every session in that checkout.

Full context, plan and discussion live in [./context.md](./context.md).
