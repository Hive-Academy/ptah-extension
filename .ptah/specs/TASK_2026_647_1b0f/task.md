---
id: TASK_2026_647_1b0f
status: done
type: REFACTORING
title: "Setup Hub on chat sessions: finish the analysis-phase follow-up"
depends_on: []
created: '2026-10-13T16:57:42.646Z'
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Builders, wizard generation and manifest v4 are on main (PRs #736, #763, #732). Children 680 and
  682 are cancelled. Only TASK_2026_651 (analysis phases as chat sessions) is left.
estimate: XL
labels:
  - epic
  - chat
  - harness-builder
  - setup-wizard
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Epic. Setup flows run on normal chat sessions (shared input, messages, restore). The only remaining
child is TASK_2026_651_2fb8: run each workspace-analysis phase as a visible, workflow-tagged chat
session instead of a non-tab surface.

## Current state (2026-11-07)

- Done: session embed and workflow tabs (PR #733); builders on the shared chat session (PR #736);
  manifest v4, freshness and self-gathering generation (PR #732); wizard generation in chat tabs
  (PR #763).
- The builder views were replaced by the onboarding module (PR #877). So TASK_2026_680_bc6c (open a
  flagged session in its builder) and TASK_2026_682_f705 (builder review leftovers) are
  `cancelled`.
- Left: TASK_2026_651_2fb8 (`backlog`). Analysis phases still register as non-tab surfaces
  (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:229`).
- The Tribunal page was removed (`dea55817c`). The `context.md` note that Tribunal uses
  `WorkflowSessionClaimService` is out of date.

Full context, plan and discussion live in [./context.md](./context.md).
