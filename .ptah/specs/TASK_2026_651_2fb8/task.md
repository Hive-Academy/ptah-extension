---
id: TASK_2026_651_2fb8
status: backlog
type: REFACTORING
title: "Run each Setup Wizard analysis phase as a visible chat session"
depends_on: []
created: '2026-10-13T16:57:54.758Z'
updated: "2026-10-30T03:38:08.921Z"
description: "Manifest v4 already stores per-phase sessionId, attempt, fingerprints and verification (PR #732). Analysis phases still register as non-tab surfaces in chat-routing stream-router.service.ts; run each phase as a workflow-tagged chat session that survives turns."
parent: TASK_2026_647_1b0f
estimate: L
labels:
  - setup-wizard
  - chat
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Phase 4 (wizard plan 2): one chat session per analysis phase; .ptah/analysis manifest records sessionId, status and freshness per phase.

Full context, plan and discussion live in [./context.md](./context.md).
