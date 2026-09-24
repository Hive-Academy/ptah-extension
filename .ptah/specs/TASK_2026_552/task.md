---
id: TASK_2026_552
status: backlog
type: BUGFIX
title: 'Provider setup: one tier conflict must not cancel the other tier saves'
depends_on: []
created: "2026-09-24T08:26:07.000Z"
updated: "2026-09-24T08:26:07.000Z"
description: "In the provider setup wizard, a conflict on one edited main-agent tier marks every later tier write in the same save as not saved, because each tier write depends on the one before it."
executor: frontend-developer
estimate: S
labels:
  - providers-settings
  - priority-medium
---

# TASK_2026_552 — A tier conflict cancels later tier saves

Priority: **medium** (visible to the user, has a workaround).

## Why

The provider setup commit in `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
queues one operation per edited main-agent tier (`:495-500`), each with `dependsOnPrevious: true`.
A tier write returns `'conflict'` when another window changed the stored value after the wizard
read it (`:498-500`). `runCommit` then marks every later operation as not saved.

Example: the user edits Opus and Haiku. Opus conflicts. Haiku is not saved either, although
nothing changed it. The user must open setup and save again.

Recorded as out of scope in `.ptah/specs/TASK_2026_534/fix-report.md` ("A conflict on one edited
tier marks the later tier operations in the same commit as not saved").

## Scope

- Tier writes depend on the credential and endpoint writes, not on each other. A conflict on one
  tier reports that tier only.
- Activation (`:511-519`) still waits for every tier write and does not run if any tier
  conflicted, as today.
- The save summary names each conflicted tier and each saved tier.

## Acceptance

- Spec: edit two tiers and make the first conflict. The second is saved, activation does not run,
  and the summary names the conflicted tier.
- The existing TASK_2026_534 specs for conflicts and activation still pass.

## Process

BUGFIX, Minimal. Cross-side review. Verify `core` and `chat`.
