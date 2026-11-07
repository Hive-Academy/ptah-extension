---
id: TASK_2026_651_2fb8
status: backlog
type: REFACTORING
title: "Run each workspace analysis phase as a visible chat session"
depends_on: []
created: '2026-10-13T16:57:54.758Z'
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Manifest v4 already stores per-phase sessionId and freshness (PR #732). Analysis phases still
  register as non-tab surfaces. Run each phase as a workflow-tagged chat session that survives turns.
estimate: L
labels:
  - setup-wizard
  - chat
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Phase 4 of TASK_2026_647_1b0f (wizard plan 2). Run each workspace-analysis phase as a normal,
visible chat session (a workflow-tagged tab) that survives turns, instead of a non-tab surface.
The entry point in the Electron renderer is the onboarding Analyze step
(`libs/frontend/onboarding/src/lib/analyze/analysis-step.store.ts`), which drives the setup-wizard
services `WizardAnalysisRunner` and `SetupWizardStateService`.

## Current state (2026-11-07)

- Done: the `.ptah/analysis` manifest v4 stores per-phase sessionId, attempt, input fingerprints
  and verification status (PR #732;
  `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts:74`). Agent and guidance
  generation run in chat tabs (PR #763).
- Left: analysis phases still bind as non-tab surfaces
  (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:229`, registered by
  `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts:541`).
- The Setup Wizard pages moved into the onboarding module (PR #877). Plan against that UI, not the
  old wizard view.

Full context, plan and discussion live in [./context.md](./context.md).
