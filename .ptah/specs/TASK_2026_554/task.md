---
id: TASK_2026_554
status: backlog
type: REFACTORING
title: 'Providers settings: split the two files over the size limit'
depends_on: [TASK_2026_551, TASK_2026_552]
created: "2026-09-24T08:26:07.000Z"
updated: "2026-09-24T08:26:07.000Z"
description: "providers-settings-state.service.ts (1200 lines) and provider-connection-card.component.ts (852 lines) are over the max-lines warning after PRs #575 and #581."
executor: frontend-developer
estimate: M
labels:
  - providers-settings
  - refactoring
  - priority-low
---

# TASK_2026_554 — Split the oversized providers settings files

Priority: **low** (maintenance only, no change the user can see).

## Why

- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` has 1200 lines, past
  the 1000-line mark that needs a deliberate look.
- `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts` has 852
  lines.

Recorded as out of scope in `.ptah/specs/TASK_2026_534/fix-report.md`.

## Scope

Apply the facade rule from the coding standards. The public class keeps its name, DI token and
signatures. Each extracted concern becomes an injected collaborator with a nameable purpose, for
example the `runCommit` pipeline or draft verification. Prefer 2–3 collaborators. No behavior
change.

## Acceptance

- Both files are under 700 lines, or the report gives a reason for each file that stays over.
- All existing `core` and `chat` specs pass with no change to their assertions.

## Process

REFACTORING, Partial. Run it after TASK_2026_551 and TASK_2026_552, because both edit these files.
