---
id: TASK_2026_555
status: backlog
type: FEATURE
title: 'Providers settings: restore lost capabilities and replace the flat button-heavy UI'
depends_on: []
created: "2026-09-24T08:26:07.000Z"
updated: "2026-09-24T08:26:07.000Z"
description: "PR #575 (TASK_2026_523) shipped a flat, button-heavy Providers settings UI and removed 16 working capabilities. PR #581 (TASK_2026_534) fixed the runtime regressions and dead controls only and left the visual design out of scope. No task owned the rest."
executor: ui-ux-designer
estimate: L
labels:
  - providers-settings
  - ui
  - priority-medium
---

# TASK_2026_555 — Providers settings: parity and visual rework

Priority: **medium** (the page works, but it has fewer capabilities and a poorer UI than before #575).

## Why

- TASK_2026_533 records that PR #575 (TASK_2026_523) "shipped a flat, button-heavy UI, removed 16
  working capabilities, and introduced 4 runtime regressions". TASK_2026_533 then changed the
  skills (design gate, prototype, parity inventory, Gate 1.7) so this cannot happen again.
- TASK_2026_534 (PR #581) fixed the 4 runtime regressions, the dead controls and the CLI model
  lists. Its `task.md` says: "Scope is correctness only. The visual redesign is a separate task —
  do not restyle." That separate task was never created. This is that task.
- #581 restored some lost behavior (the Copilot auto-approve toggle, deep links, CLI model
  lists). Nobody has checked which of the 16 capabilities are still missing.

## Scope

1. **Parity inventory first.** Compare the page before #575 (`git show 7ecdefa45^1:<path>` for
   the old settings components) with `main`. Write `parity-inventory.md`: every capability of the
   old surface, whether `main` has it, and for each missing one: restore, or remove with a reason
   for the user to approve.
2. **Design.** The ui-ux-designer writes `design-spec.md` and a `prototype/` for the Providers tab
   (and the Agent Orchestration tab if the inventory shows gaps there). Use the existing daisyUI
   tokens and `libs/frontend/ui` components. Do not introduce rules the user did not ask for.
3. **Gate 1.7.** The user approves the design spec and the prototype before any implementation.
4. **Implementation** by batches, with a visual-reviewer before/after pass and a write→reader trace
   for every control that writes a setting (the TASK_2026_533 rule 5).

## Out of scope

- The items in TASK_2026_551, TASK_2026_552, TASK_2026_553 and TASK_2026_554.

## Acceptance

- `parity-inventory.md` has no capability that is missing without the user's approval.
- The approved design spec and prototype match the shipped page (visual-review.md, PASS).
- No setting write changes runtime behavior without a trace in the report.

## Process

FEATURE, Full workflow under the TASK_2026_533 gates: PM → parity inventory → designer →
Gate 1.7 (user) → architect → team-leader → batches with cross-side review → visual review.
