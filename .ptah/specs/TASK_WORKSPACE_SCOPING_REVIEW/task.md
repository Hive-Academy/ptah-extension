---
id: TASK_WORKSPACE_SCOPING_REVIEW
status: done
type: BUGFIX
title: >-
  Workspace-scoping sync review: Tribunal, Tasks, Memory, Cron and Harness
  Builder
depends_on: []
created: '2026-08-09T15:26:27.189Z'
updated: '2026-08-09T15:26:27.212Z'
status_inferred: true
description: >-
  Code-logic review of ef32f9c4b (per-workspace state across all pages): six
  failure modes, two critical, scored 5/10 NEEDS_REVISION. Findings covered an
  unstamped openTask response race, a Harness Builder pin wiped before build
  start, unnormalized cron workspaceRoot matching, and a removedWorkspace$
  single-shot ack ordering hazard. Addressed in 88f68ea53.
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Workspace-scoping sync review: Tribunal, Tasks, Memory, Cron and Harness Builder

Full context, plan and discussion live in [./context.md](./context.md).
